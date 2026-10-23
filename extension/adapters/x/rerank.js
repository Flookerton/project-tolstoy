// Tolstoy reranker: a pure function over one timeline response body.
//
// rerankTimeline(json, scoreFn, threshold) -> { json, checked, moved }
//   json      a new object with the same shape, or the original object if
//             anything at all looked unexpected (Tolstoy must never break a feed)
//   checked   how many posts were scored
//   moved     one record per moved post: { id, handle, text, reasons }
//
// What it does, in words:
//   - only normal post entries are scored; cursors and promoted entries are
//     neither scored nor moved, so the ad slot and pagination stay X's business
//   - a conversation module is one unit, scored by its strongest post
//   - within a batch, units at or above the threshold move to the end of the
//     batch's scored run, keeping their relative order; everything else keeps
//     its order
//   - the batch's sortIndex values are handed out again in the new order, which
//     is what makes the new order the order X shows (see docs/research-notes.md,
//     section 3: X displays by sortIndex descending, not by array position)
//
// No network, no storage, no logging. Loaded as a content script (world: MAIN)
// and by the Node tests, so it writes to globalThis and to module.exports.

(function (root) {
  "use strict";

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function contentOf(entry) {
    return isObject(entry) && isObject(entry.content) ? entry.content : null;
  }

  function isCursor(content) {
    return !!content && content.entryType === "TimelineTimelineCursor";
  }

  function isModule(content) {
    return !!content && content.entryType === "TimelineTimelineModule";
  }

  function isPostItem(content) {
    if (!content || content.entryType !== "TimelineTimelineItem") {
      return false;
    }
    var item = content.itemContent;
    return !!item && (item.itemType === "TimelineTweet" || item.__typename === "TimelineTweet");
  }

  function isPromoted(entry) {
    if (typeof entry.entryId === "string" && entry.entryId.indexOf("promoted") === 0) {
      return true;
    }
    var content = contentOf(entry);
    var item = content && content.itemContent;
    return !!(item && (item.promotedMetadata || item.promoted_metadata));
  }

  // The payload wraps a post in a union. A tombstone or an unavailable post has
  // no text, so it is left alone.
  function unwrapTweet(result) {
    if (!isObject(result)) {
      return null;
    }
    if (result.__typename === "TweetWithVisibilityResults" && isObject(result.tweet)) {
      return result.tweet;
    }
    if (result.legacy || result.rest_id) {
      return result;
    }
    return null;
  }

  function resultOf(itemContent) {
    var results = itemContent && itemContent.tweet_results;
    return unwrapTweet(results && results.result);
  }

  function textOf(tweet) {
    if (!isObject(tweet)) {
      return "";
    }
    var note = tweet.note_tweet && tweet.note_tweet.note_tweet_results && tweet.note_tweet.note_tweet_results.result;
    if (note && typeof note.text === "string" && note.text) {
      return note.text;
    }
    if (tweet.legacy && typeof tweet.legacy.full_text === "string") {
      return tweet.legacy.full_text;
    }
    if (typeof tweet.full_text === "string") {
      return tweet.full_text;
    }
    return "";
  }

  function handleOf(tweet) {
    if (!isObject(tweet)) {
      return "";
    }
    var core = tweet.core && tweet.core.user_results && tweet.core.user_results.result;
    if (core && core.core && typeof core.core.screen_name === "string") {
      return core.core.screen_name;
    }
    if (core && core.legacy && typeof core.legacy.screen_name === "string") {
      return core.legacy.screen_name;
    }
    return "";
  }

  function idOf(tweet, entryId) {
    if (isObject(tweet) && typeof tweet.rest_id === "string") {
      return tweet.rest_id;
    }
    if (isObject(tweet) && tweet.legacy && typeof tweet.legacy.id_str === "string") {
      return tweet.legacy.id_str;
    }
    if (typeof entryId === "string" && entryId.indexOf("tweet-") === 0) {
      return entryId.slice("tweet-".length);
    }
    return "";
  }

  // Every post in a conversation module, as { tweet, entryId } pairs.
  function modulePosts(content) {
    var posts = [];
    var items = content && content.items;
    if (!Array.isArray(items)) {
      return posts;
    }
    items.forEach(function (item) {
      var itemContent = isObject(item) && isObject(item.item) ? item.item.itemContent : null;
      var tweet = resultOf(itemContent);
      if (tweet) {
        posts.push({ tweet: tweet, entryId: isObject(item) ? item.entryId : "" });
      }
    });
    return posts;
  }

  function describe(tweet, entryId, reasons) {
    var text = textOf(tweet);
    return {
      id: idOf(tweet, entryId),
      handle: handleOf(tweet),
      text: text.length > 140 ? text.slice(0, 140) : text,
      reasons: reasons
    };
  }

  // Score one unit: a single post, or a module scored by its strongest post.
  function scoreUnit(unit, scoreFn) {
    var posts = unit.posts;
    var best = null;
    posts.forEach(function (post) {
      var text = textOf(post.tweet);
      if (!text) {
        return;
      }
      var result = scoreFn(text);
      var score = result && typeof result.score === "number" ? result.score : 0;
      var reasons = result && Array.isArray(result.reasons) ? result.reasons : [];
      unit.checked += 1;
      if (!best || score > best.score) {
        best = { score: score, reasons: reasons, tweet: post.tweet, entryId: post.entryId };
      }
    });
    unit.score = best ? best.score : 0;
    unit.best = best;
  }

  // The timeline root is documented for HomeTimeline as
  // data.home.home_timeline_urt. A reply page carries its conversation under
  // data.threaded_conversation_with_injections_v2 (v1 on older builds, see
  // docs/research-notes.md section 2). The root for HomeLatestTimeline is not
  // documented anywhere, so we also accept any object two levels under data that
  // carries an instructions array.
  function timelineRoots(json) {
    var found = [];
    var data = isObject(json) ? json.data : null;
    if (!isObject(data)) {
      return found;
    }
    function push(candidate, reply) {
      if (!isObject(candidate) || !Array.isArray(candidate.instructions)) {
        return;
      }
      for (var i = 0; i < found.length; i += 1) {
        if (found[i].node === candidate) {
          return;
        }
      }
      found.push({ node: candidate, reply: reply });
    }
    if (isObject(data.home) && isObject(data.home.home_timeline_urt)) {
      push(data.home.home_timeline_urt, false);
    }
    push(data.threaded_conversation_with_injections_v2, true);
    push(data.threaded_conversation_with_injections, true);
    Object.keys(data).forEach(function (outer) {
      var level = data[outer];
      if (!isObject(level)) {
        return;
      }
      Object.keys(level).forEach(function (inner) {
        push(level[inner], false);
      });
    });
    return found;
  }

  // Hand the batch's own sortIndex values out again in the new order, biggest
  // first, so a client that sorts by sortIndex shows what a client that reads
  // the array shows. Values are decimal strings that can exceed what a double
  // holds, so they are compared as BigInt.
  function renumber(entries) {
    var values = [];
    for (var i = 0; i < entries.length; i += 1) {
      var value = entries[i].sortIndex;
      if (typeof value !== "string") {
        return false;
      }
      values.push(value);
    }
    values.sort(function (a, b) {
      var left, right;
      try {
        left = BigInt(a);
        right = BigInt(b);
      } catch (error) {
        return 0;
      }
      if (left === right) {
        return 0;
      }
      return left > right ? -1 : 1;
    });
    for (var j = 0; j < entries.length; j += 1) {
      entries[j].sortIndex = values[j];
    }
    return true;
  }

  // renumber() can only do its job when every entry carries a string sortIndex.
  // The check happens before anything is touched, so a batch that cannot be
  // renumbered is left exactly as X sent it and nothing is reported for it.
  function canRenumber(entries) {
    for (var i = 0; i < entries.length; i += 1) {
      if (typeof entries[i].sortIndex !== "string") {
        return false;
      }
    }
    return true;
  }

  function rerankBatch(entries, scoreFn, threshold, moved) {
    if (!canRenumber(entries)) {
      return 0;
    }

    var units = [];
    var checked = 0;

    entries.forEach(function (entry, index) {
      var content = contentOf(entry);
      // Anything we do not read is fixed: cursors, promoted entries, and any
      // entry type we do not recognise stay exactly where X put them.
      var movable = !isCursor(content) && (isPostItem(content) || isModule(content));
      if (!movable || isPromoted(entry)) {
        return;
      }
      var posts;
      if (isModule(content)) {
        posts = modulePosts(content);
      } else {
        var tweet = resultOf(content.itemContent);
        posts = tweet ? [{ tweet: tweet, entryId: entry.entryId }] : [];
      }
      units.push({ index: index, entry: entry, posts: posts, checked: 0, score: 0, best: null });
    });

    units.forEach(function (unit) {
      scoreUnit(unit, scoreFn);
      checked += unit.checked;
    });

    var cool = units.filter(function (unit) {
      return unit.score < threshold;
    });
    var hot = units.filter(function (unit) {
      return unit.score >= threshold;
    });
    var order = cool.concat(hot);

    // The order and the sortIndex values X sent, so a failure halfway can put
    // everything back exactly as it was.
    var sentOrder = entries.slice();
    var sentIndexes = entries.map(function (entry) {
      return entry.sortIndex;
    });

    order.forEach(function (unit, position) {
      entries[units[position].index] = unit.entry;
    });

    if (!renumber(entries)) {
      entries.length = 0;
      Array.prototype.push.apply(entries, sentOrder);
      for (var restore = 0; restore < entries.length; restore += 1) {
        entries[restore].sortIndex = sentIndexes[restore];
      }
      return 0;
    }

    hot.forEach(function (unit) {
      if (unit.best) {
        moved.push(describe(unit.best.tweet, unit.best.entryId, unit.best.reasons));
      }
    });

    return checked;
  }

  // ---------------------------------------------------------------- reply pages
  // On a reply page the focal post and the thread above it stay exactly where X
  // put them. Only the replies below the focal post are scored, and within their
  // own run they move to the end. See docs/research-notes.md section 2 for the
  // payload shape this reads.

  function idFromEntryId(entryId) {
    if (typeof entryId !== "string") {
      return "";
    }
    var match = /^(?:tweet|conversationthread|conversation)-?(\d+)$/.exec(entryId);
    return match ? match[1] : "";
  }

  // Which post the page is about. X names the conversation module after it:
  // conversationthread-<focalTweetId>. It is looked up across every batch in the
  // payload, because a later page of replies arrives without the focal post.
  function focalIdOf(root) {
    var instructionList = root && Array.isArray(root.instructions) ? root.instructions : [];
    for (var i = 0; i < instructionList.length; i += 1) {
      var entries = instructionList[i] && instructionList[i].entries;
      if (!Array.isArray(entries)) {
        continue;
      }
      for (var j = 0; j < entries.length; j += 1) {
        var entryId = entries[j] && entries[j].entryId;
        if (typeof entryId === "string" && entryId.indexOf("conversationthread-") === 0) {
          var id = idFromEntryId(entryId);
          if (id) {
            return id;
          }
        }
      }
    }
    return "";
  }

  function itemTweet(item) {
    var itemContent = isObject(item) && isObject(item.item) ? item.item.itemContent : null;
    return resultOf(itemContent);
  }

  function itemTweetId(item) {
    var tweet = itemTweet(item);
    if (tweet) {
      return idOf(tweet, isObject(item) ? item.entryId : "");
    }
    return idFromEntryId(isObject(item) ? item.entryId : "");
  }

  // Score one run of movable entries inside one container and move the heated
  // ones to the end of that run, keeping their relative order. The container is
  // renumbered with its own sortIndex values, so X shows the new order.
  function rerankRun(list, movable, scoreFn, threshold, moved, isModuleItem) {
    var units = [];
    movable.forEach(function (index) {
      var item = list[index];
      var posts;
      if (isModuleItem) {
        var tweet = itemTweet(item);
        posts = tweet ? [{ tweet: tweet, entryId: isObject(item) ? item.entryId : "" }] : [];
      } else {
        var content = contentOf(item);
        var only = content ? resultOf(content.itemContent) : null;
        posts = only ? [{ tweet: only, entryId: isObject(item) ? item.entryId : "" }] : [];
      }
      units.push({ item: item, posts: posts, checked: 0, score: 0, best: null });
    });

    units.forEach(function (unit) {
      scoreUnit(unit, scoreFn);
    });

    var checked = units.reduce(function (sum, unit) {
      return sum + unit.checked;
    }, 0);

    var cool = units.filter(function (unit) {
      return unit.score < threshold;
    });
    var hot = units.filter(function (unit) {
      return unit.score >= threshold;
    });
    var order = cool.concat(hot);

    var sent = movable.map(function (index) {
      return list[index];
    });
    var sentIndexes = movable.map(function (index) {
      return list[index].sortIndex;
    });

    order.forEach(function (unit, position) {
      list[movable[position]] = unit.item;
    });

    if (!renumber(list)) {
      movable.forEach(function (index, position) {
        list[index] = sent[position];
        list[index].sortIndex = sentIndexes[position];
      });
      return 0;
    }

    hot.forEach(function (unit) {
      if (unit.best) {
        moved.push(describe(unit.best.tweet, unit.best.entryId, unit.best.reasons));
      }
    });

    return checked;
  }

  function rerankReplyBatch(entries, scoreFn, threshold, moved, focalId) {
    var checked = 0;

    // Where the focal post sits in the batch, when it is here at all.
    var focalEntryIndex = -1;
    if (focalId) {
      entries.forEach(function (entry, index) {
        if (focalEntryIndex === -1 && idFromEntryId(entry.entryId) === focalId) {
          focalEntryIndex = index;
        }
      });
    }

    var replyIndexes = [];
    var runs = [];

    entries.forEach(function (entry, index) {
      var content = contentOf(entry);
      if (isCursor(content) || isPromoted(entry)) {
        return;
      }

      if (isModule(content)) {
        var items = content.items;
        // Without a focal post inside the module we cannot tell the thread above
        // from the replies below, so the module is left exactly as it is.
        if (!Array.isArray(items) || !items.length || !canRenumber(items)) {
          return;
        }
        var focalHere = -1;
        if (focalId) {
          items.forEach(function (item, itemIndex) {
            if (focalHere === -1 && itemTweetId(item) === focalId) {
              focalHere = itemIndex;
            }
          });
        }
        if (focalHere === -1) {
          return;
        }
        var movable = [];
        for (var itemIndex = focalHere + 1; itemIndex < items.length; itemIndex += 1) {
          // A promoted item keeps its own slot and is never scored, the same way
          // a promoted entry does on the home timeline.
          if (!isPromoted(items[itemIndex])) {
            movable.push(itemIndex);
          }
        }
        if (movable.length) {
          runs.push({ list: items, movable: movable, isModuleItem: true });
        }
        return;
      }

      if (!isPostItem(content)) {
        return;
      }

      // A plain post entry above the focal post is the thread, not a reply.
      var isFocal = focalId && idFromEntryId(entry.entryId) === focalId;
      var aboveFocal = focalId && focalEntryIndex !== -1 && index < focalEntryIndex;
      if (isFocal || aboveFocal) {
        return;
      }
      // With no focal post anywhere in the batch we cannot tell what this is, so
      // nothing here is scored. On a later page of replies the focal post is gone
      // and every post entry is a reply, which is the case focalId covers.
      if (!focalId) {
        return;
      }
      replyIndexes.push(index);
    });

    if (replyIndexes.length) {
      runs.push({ list: entries, movable: replyIndexes, isModuleItem: false });
    }

    runs.forEach(function (run) {
      checked += rerankRun(run.list, run.movable, scoreFn, threshold, moved, run.isModuleItem);
    });

    return checked;
  }

  // Every post in a payload as { id, text }, in payload order, so a caller can
  // score a whole batch in one go (the on-device model does that), cache the
  // answers by post id, and hand the scores back to rerankTimeline through its
  // score function. Promoted posts, cursors and the thread above a focal post are
  // left out, exactly as they are when reranking.
  function collectTexts(json) {
    var texts = [];
    try {
      timelineRoots(json).forEach(function (rootInfo) {
        var replyFocalId = rootInfo.reply ? focalIdOf(rootInfo.node) : "";
        rootInfo.node.instructions.forEach(function (instruction) {
          if (!isObject(instruction) || instruction.type !== "TimelineAddEntries" || !Array.isArray(instruction.entries)) {
            return;
          }
          instruction.entries.forEach(function (entry, index) {
            var content = contentOf(entry);
            if (!content || isCursor(content) || isPromoted(entry)) {
              return;
            }
            if (isModule(content) && Array.isArray(content.items)) {
              var start = 0;
              if (rootInfo.reply) {
                start = -1;
                if (replyFocalId) {
                  content.items.forEach(function (item, itemIndex) {
                    if (start === -1 && itemTweetId(item) === replyFocalId) {
                      start = itemIndex + 1;
                    }
                  });
                }
                if (start === -1) {
                  return;
                }
              }
              for (var i = start; i < content.items.length; i += 1) {
                if (isPromoted(content.items[i])) {
                  continue;
                }
                var item = content.items[i];
                var text = textOf(itemTweet(item));
                if (text) {
                  texts.push({ id: idOf(itemTweet(item), item.entryId), text: text });
                }
              }
              return;
            }
            if (!isPostItem(content)) {
              return;
            }
            if (rootInfo.reply) {
              if (!replyFocalId) {
                return;
              }
              var id = idFromEntryId(entry.entryId);
              var focalIndex = -1;
              rootInfo.node.instructions.forEach(function (other) {
                if (!Array.isArray(other.entries)) {
                  return;
                }
                other.entries.forEach(function (candidate, candidateIndex) {
                  if (instruction === other && idFromEntryId(candidate.entryId) === replyFocalId && focalIndex === -1) {
                    focalIndex = candidateIndex;
                  }
                });
              });
              if (id === replyFocalId || (focalIndex !== -1 && index < focalIndex)) {
                return;
              }
            }
            var only = resultOf(content.itemContent);
            var body = textOf(only);
            if (body) {
              texts.push({ id: idOf(only, entry.entryId), text: body });
            }
          });
        });
      });
    } catch (error) {
      return [];
    }
    return texts;
  }

  function rerankTimeline(json, scoreFn, threshold) {
    var original = { json: json, checked: 0, moved: [] };
    try {
      if (!isObject(json)) {
        return original;
      }
      var scorer = scoreFn || (root.TolstoyScore && root.TolstoyScore.scorePost);
      if (typeof scorer !== "function") {
        return original;
      }
      var limit = typeof threshold === "number" ? threshold : (root.TolstoyRules && root.TolstoyRules.THRESHOLD) || 0.5;

      var roots = timelineRoots(json);
      if (!roots.length) {
        return original;
      }

      // Work on a copy, so a surprise halfway through cannot leave a half-moved
      // feed behind. On success the copy is what gets returned.
      var working = JSON.parse(JSON.stringify(json));
      var moved = [];
      var checked = 0;

      timelineRoots(working).forEach(function (rootInfo) {
        var replyFocalId = rootInfo.reply ? focalIdOf(rootInfo.node) : "";
        rootInfo.node.instructions.forEach(function (instruction) {
          if (!isObject(instruction) || instruction.type !== "TimelineAddEntries" || !Array.isArray(instruction.entries)) {
            return;
          }
          checked += rootInfo.reply
            ? rerankReplyBatch(instruction.entries, scorer, limit, moved, replyFocalId)
            : rerankBatch(instruction.entries, scorer, limit, moved);
        });
      });

      return { json: working, checked: checked, moved: moved };
    } catch (error) {
      return original;
    }
  }

  var api = {
    rerankTimeline: rerankTimeline,
    collectTexts: collectTexts,
    threshold: (root.TolstoyRules && root.TolstoyRules.THRESHOLD) || 0.5
  };
  root.TolstoyRerank = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);

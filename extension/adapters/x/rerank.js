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
  // data.home.home_timeline_urt. The root for HomeLatestTimeline is not
  // documented anywhere, so we also accept any object two levels under data that
  // carries an instructions array.
  function timelineRoots(json) {
    var roots = [];
    var data = isObject(json) ? json.data : null;
    if (!isObject(data)) {
      return roots;
    }
    var known = data.home && data.home.home_timeline_urt;
    if (isObject(known)) {
      roots.push(known);
    }
    Object.keys(data).forEach(function (outer) {
      var level = data[outer];
      if (!isObject(level)) {
        return;
      }
      Object.keys(level).forEach(function (inner) {
        var candidate = level[inner];
        if (isObject(candidate) && Array.isArray(candidate.instructions) && roots.indexOf(candidate) === -1) {
          roots.push(candidate);
        }
      });
    });
    return roots;
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

  function rerankBatch(entries, scoreFn, threshold, moved) {
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

    order.forEach(function (unit, position) {
      entries[units[position].index] = unit.entry;
    });

    renumber(entries);

    hot.forEach(function (unit) {
      if (unit.best) {
        moved.push(describe(unit.best.tweet, unit.best.entryId, unit.best.reasons));
      }
    });

    return checked;
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

      timelineRoots(working).forEach(function (timelineRoot) {
        timelineRoot.instructions.forEach(function (instruction) {
          if (!isObject(instruction) || instruction.type !== "TimelineAddEntries" || !Array.isArray(instruction.entries)) {
            return;
          }
          checked += rerankBatch(instruction.entries, scorer, limit, moved);
        });
      });

      return { json: working, checked: checked, moved: moved };
    } catch (error) {
      return original;
    }
  }

  var api = { rerankTimeline: rerankTimeline, threshold: (root.TolstoyRules && root.TolstoyRules.THRESHOLD) || 0.5 };
  root.TolstoyRerank = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);

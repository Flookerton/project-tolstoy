// The fixture page's own script. It stands in for X's client: it asks for the
// timeline through fetch, draws the posts the way X draws them (an article per
// post with a status link inside), and records every message Tolstoy posts so a
// check can read what happened.
//
// The adapter under test wraps window.fetch and XMLHttpRequest, so what this
// page sees is what X's own client would see.
//
// The extra requests run only when a check asks for them, so the banner
// photographed after the first batch shows the count for that batch alone.

(function () {
  "use strict";

  // This is a page script, not a test. Node's test runner walks every file under
  // tests/, so it does nothing when there is no document.
  if (typeof document === "undefined") {
    return;
  }

  var status = document.getElementById("status");
  var count = document.getElementById("count");
  var order = document.getElementById("order");
  var passthrough = document.getElementById("passthrough");
  var xhrOut = document.getElementById("xhr");
  var feed = document.getElementById("feed");

  var TIMELINE = "/i/api/graphql/test-query-id/HomeTimeline";
  var LATEST = "/i/api/graphql/test-query-id/HomeLatestTimeline";
  var OTHER = "/i/api/graphql/test-query-id/OtherQuery";
  var DETAIL = "/i/api/graphql/test-query-id/TweetDetail";

  var test = {
    bannerText: "",
    entryIds: [],
    sortIndexes: [],
    parseError: null,
    messages: [],
    xhr: {},
    latestOrder: [],
    otherQuery: "",
    ready: false
  };
  window.tolstoyTest = test;

  // Says "the model is not here" to the page whenever a check wants it to, which is
  // what a half-woken service worker looks like from the page. A check posts this and
  // then asks for another batch, so the batch is asked about while the page believes
  // there is no model: it must be queued, and must still be scored once the real
  // answer arrives. Nothing in the extension knows this exists.
  test.sayModelIsAbsent = function () {
    window.postMessage({ source: "tolstoy", type: "modelStatus", ready: false, reason: "absent" }, window.location.origin);
  };

  // A stand-in for the model, for the timing checks and nothing else.
  //
  // ?fakeModel=50 answers every score request after 50ms, ?fakeModel=never never
  // answers at all. The reply carries made-up scores so that a post which the rules
  // leave alone is moved by the "model", which is what makes it possible to watch the
  // deadline behaviour without waiting on a real model. The interceptor drops a reply
  // that arrives for a request it has already finished, so the real bridge answering
  // later cannot disturb either case. Without the query string this does nothing.
  // ?falseStatus=1 tells the page the model is not here, before the first timeline
  // arrives. That is what a half-woken service worker can look like from the page, and
  // it exists so a check can prove that a batch asked about then is queued rather than
  // dropped. The real answer follows it a moment later.
  var params = null;
  try {
    params = new URLSearchParams(window.location.search);
  } catch (error) {
    params = null;
  }
  var fakeModel = null;
  try {
    fakeModel = new URLSearchParams(window.location.search).get("fakeModel");
  } catch (error) {
    fakeModel = null;
  }
  if (fakeModel) {
    window.addEventListener("message", function (event) {
      var data = event.data;
      if (!data || data.source !== "tolstoy" || data.type !== "scoreRequest") {
        return;
      }
      if (fakeModel === "never") {
        return;
      }
      var delay = Number(fakeModel);
      if (!isFinite(delay) || delay < 0) {
        delay = 50;
      }
      var texts = Array.isArray(data.texts) ? data.texts : [];
      window.setTimeout(function () {
        var scores = {};
        var labels = {};
        for (var i = 0; i < texts.length; i += 1) {
          // Anything that reads like a personal insult is called hostile here, so a
          // check can watch one post move and the rest stay where they are.
          var hot = /pathetic|worthless|burns down|waste of oxygen/i.test(texts[i]);
          scores[texts[i]] = hot ? 0.93 : 0.02;
          labels[texts[i]] = "insult";
        }
        window.postMessage({
          source: "tolstoy",
          type: "scoreResult",
          id: data.id,
          scores: scores,
          labels: labels,
          done: true
        }, window.location.origin);
      }, delay);
    });
  }

  // Every message Tolstoy posts, in order, with the time it arrived. This is how
  // the checks answer "did the settings beat the first batch".
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.source !== "tolstoy") {
      return;
    }
    test.messages.push({
      type: data.type,
      totals: !!data.totals,
      mode: data.mode || null,
      temperature: data.temperature || null,
      checked: typeof data.checked === "number" ? data.checked : null,
      moved: Array.isArray(data.moved) ? data.moved.length : null,
      at: Math.round(performance.now())
    });
  });

  function readBanner() {
    var host = document.querySelector('[data-tolstoy="banner"]');
    if (!host || !host.shadowRoot) {
      count.textContent = "banner: not mounted";
      test.bannerText = "";
      return "";
    }
    var strip = host.shadowRoot.querySelector(".strip");
    var text = strip ? strip.textContent.replace(/\s+/g, " ").trim() : "";
    count.textContent = "banner: " + text;
    test.bannerText = text;
    return text;
  }

  setInterval(readBanner, 200);

  function entriesOf(json) {
    var timeline = json.data.home.home_timeline_urt;
    var add = timeline.instructions.filter(function (instruction) {
      return instruction.type === "TimelineAddEntries";
    })[0];
    return add.entries;
  }

  // The TweetDetail response has a different shape from the home timeline. Its
  // instructions mix a TimelinePinEntry for the focal post with TimelineAddEntries
  // for the conversation module and later replies. The focal post is drawn first,
  // then everything else in the order X sent it, with nothing drawn twice.
  function entriesOfDetail(json) {
    var instructions = json.data.threaded_conversation_with_injections_v2.instructions;
    var entries = [];
    var seen = {};

    function add(entry) {
      if (!entry || !entry.entryId || seen[entry.entryId]) {
        return;
      }
      entries.push(entry);
      seen[entry.entryId] = true;
    }

    // The focal post first.
    instructions.forEach(function (instruction) {
      if (instruction.type === "TimelinePinEntry" && instruction.entry) {
        add(instruction.entry);
      }
    });

    // Then the replies and everything else, as X ordered them. A conversation
    // module is a container: X draws each post inside it, so the page does too.
    instructions.forEach(function (instruction) {
      if (instruction.type !== "TimelineAddEntries" || !Array.isArray(instruction.entries)) {
        return;
      }
      instruction.entries.forEach(function (entry) {
        var content = entry && entry.content;
        if (content && Array.isArray(content.items)) {
          content.items.forEach(function (item) {
            // A module item keeps its tweet under item.itemContent, one level
            // shallower than a top-level entry's content.itemContent.
            if (item && item.item) {
              add({ entryId: item.entryId, content: item.item });
              return;
            }
            add(item);
          });
          return;
        }
        add(entry);
      });
    });

    return entries;
  }

  function handleOf(entry) {
    var result = entry.content.itemContent.tweet_results.result;
    var core = result.core && result.core.user_results && result.core.user_results.result;
    if (!core) {
      return "unknown";
    }
    // The fixture keeps the handle in core.screen_name, the way X does; the
    // older shape puts it under legacy.
    return core.core && core.core.screen_name ? core.core.screen_name
      : (core.legacy && core.legacy.screen_name) || "unknown";
  }

  function textOf(entry) {
    var result = entry.content.itemContent.tweet_results.result;
    return (result.legacy && result.legacy.full_text) || "";
  }

  function draw(entries) {
    feed.textContent = "";
    entries.forEach(function (entry) {
      if (!entry.entryId || entry.entryId.indexOf("tweet-") !== 0) {
        return;
      }
      var id = entry.entryId.replace("tweet-", "");
      var handle = handleOf(entry);
      var article = document.createElement("article");
      article.setAttribute("data-testid", "tweet");
      article.setAttribute("data-status-id", id);

      var who = document.createElement("p");
      who.className = "post-handle";
      who.textContent = "@" + handle;

      var words = document.createElement("p");
      words.className = "post-text";
      words.textContent = textOf(entry);

      var link = document.createElement("a");
      link.className = "post-time";
      link.setAttribute("href", "/" + handle + "/status/" + id);
      link.textContent = "2h";

      article.appendChild(who);
      article.appendChild(words);
      article.appendChild(link);
      feed.appendChild(article);
    });
  }

  function fetchTimeline(url) {
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ queryId: "test-query-id", variables: { count: 20 } })
    }).then(function (response) {
      return response.text();
    });
  }

  // The three XHR shapes from the task: a handler set before send(), a listener
  // added before send(), and responseType "json". Each records the order it saw.
  function xhrTimeline(url, shape) {
    return new Promise(function (resolve) {
      var xhr = new XMLHttpRequest();
      var settled = false;

      function record(value) {
        if (settled) {
          return;
        }
        settled = true;
        try {
          var json = typeof value === "string" ? JSON.parse(value) : value;
          resolve(entriesOf(json).map(function (entry) {
            return entry.entryId;
          }));
        } catch (error) {
          resolve(["parse error: " + error]);
        }
      }

      xhr.open("POST", url, true);

      if (shape === "readystatechange") {
        xhr.onreadystatechange = function () {
          if (xhr.readyState === 4) {
            record(xhr.responseText);
          }
        };
      } else if (shape === "load") {
        xhr.addEventListener("load", function () {
          record(xhr.responseText);
        });
      } else if (shape === "json") {
        xhr.responseType = "json";
        xhr.onload = function () {
          record(xhr.response);
        };
      }

      xhr.send(JSON.stringify({ queryId: "test-query-id", variables: { count: 20 } }));
    });
  }

  function xhrOther() {
    return new Promise(function (resolve) {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", OTHER, true);
      xhr.onload = function () {
        resolve(xhr.responseText);
      };
      xhr.send(JSON.stringify({ queryId: "test-query-id" }));
    });
  }

  // Called by a check once the first batch has been photographed.
  test.runXhrCases = async function () {
    var shapes = ["readystatechange", "load", "json"];
    var lines = [];
    for (var i = 0; i < shapes.length; i += 1) {
      var ids = await xhrTimeline(TIMELINE, shapes[i]);
      test.xhr[shapes[i]] = ids;
      lines.push(shapes[i] + ": " + ids.join(", "));
    }
    xhrOut.textContent = lines.join("\n");
    test.otherQuery = await xhrOther();
    passthrough.textContent = "other query came back as: " + test.otherQuery;
    test.latestOrder = entriesOf(JSON.parse(await fetchTimeline(LATEST))).map(function (entry) {
      return entry.entryId;
    });
    test.extraDone = true;
    return true;
  };

  // A fresh batch, the way scrolling asks for one.
  test.anotherBatch = function () {
    return fetchTimeline(TIMELINE);
  };

  async function run() {
    try {
      var params = new URLSearchParams(window.location.search);
      var isDetail = params.get("detail") === "1";
      // Said here, immediately before the timeline is asked for, because that is the
    // moment that matters: the batch arrives with the page believing the model is not
    // there, which is what a half-woken worker looks like.
    if (params && params.get("falseStatus") === "1") {
      window.postMessage({ source: "tolstoy", type: "modelStatus", ready: false, reason: "absent" }, window.location.origin);
    }
    var body = await fetchTimeline(isDetail ? DETAIL : TIMELINE);
      var json = JSON.parse(body);
      var entries = isDetail ? entriesOfDetail(json) : entriesOf(json);
      test.entryIds = entries.map(function (entry) {
        return entry.entryId;
      });
      test.sortIndexes = entries.map(function (entry) {
        return entry.sortIndex;
      });
      order.textContent = test.entryIds.join("\n");
      draw(entries);
      status.textContent = (isDetail ? "thread loaded: " : "timeline loaded: ") + entries.length + " entries";
      test.ready = true;
    } catch (error) {
      test.parseError = String(error);
      status.textContent = "timeline failed: " + error;
    }
  }

  run();
})();

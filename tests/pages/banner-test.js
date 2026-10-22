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
      var body = await fetchTimeline(TIMELINE);
      var json = JSON.parse(body);
      var entries = entriesOf(json);
      test.entryIds = entries.map(function (entry) {
        return entry.entryId;
      });
      test.sortIndexes = entries.map(function (entry) {
        return entry.sortIndex;
      });
      order.textContent = test.entryIds.join("\n");
      draw(entries);
      status.textContent = "timeline loaded: " + entries.length + " entries";
      test.ready = true;
    } catch (error) {
      test.parseError = String(error);
      status.textContent = "timeline failed: " + error;
    }
  }

  run();
})();

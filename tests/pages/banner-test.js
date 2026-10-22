// Test page logic: call the same path shape X's timeline uses, then show what
// the page actually received. The adapter under test wraps window.fetch, so
// whatever this page sees is what X's own client would see.

(function () {
  "use strict";

  // This file is the script for the browser test page, not a test of its own.
  // Node's test runner walks every JavaScript file under tests/, so it has to do
  // nothing when there is no document.
  if (typeof document === "undefined") {
    return;
  }

  var status = document.getElementById("status");
  var count = document.getElementById("count");
  var order = document.getElementById("order");
  var passthrough = document.getElementById("passthrough");

  function call(path) {
    return fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ queryId: "test-query-id", variables: { count: 20 } })
    }).then(function (response) {
      return response.text();
    });
  }

  function entriesOf(json) {
    var instructions = json.data.home.home_timeline_urt.instructions;
    var add = instructions.filter(function (instruction) {
      return instruction.type === "TimelineAddEntries";
    })[0];
    return add.entries;
  }

  function showBannerText() {
    var host = document.querySelector('[data-tolstoy="banner"]');
    if (!host || !host.shadowRoot) {
      count.textContent = "banner: not mounted";
      return "";
    }
    var strip = host.shadowRoot.querySelector(".strip");
    var text = strip ? strip.textContent.replace(/\s+/g, " ").trim() : "";
    count.textContent = "banner: " + text;
    return text;
  }

  window.tolstoyTest = {
    bannerText: showBannerText,
    entryIds: [],
    sortIndexes: [],
    parseError: null
  };

  setInterval(showBannerText, 250);

  call("/i/api/graphql/test-query-id/HomeTimeline")
    .then(function (body) {
      var json = JSON.parse(body);
      var entries = entriesOf(json);
      window.tolstoyTest.entryIds = entries.map(function (entry) {
        return entry.entryId;
      });
      window.tolstoyTest.sortIndexes = entries.map(function (entry) {
        return entry.sortIndex;
      });
      order.textContent = window.tolstoyTest.entryIds.join("\n");
      status.textContent = "timeline loaded: " + entries.length + " entries";
    })
    .catch(function (error) {
      window.tolstoyTest.parseError = String(error);
      status.textContent = "timeline failed: " + error;
    });

  // A different GraphQL call must come back exactly as it was sent.
  call("/i/api/graphql/test-query-id/OtherQuery")
    .then(function (body) {
      passthrough.textContent = "other query came back as: " + body;
    })
    .catch(function (error) {
      passthrough.textContent = "other query failed: " + error;
    });
})();

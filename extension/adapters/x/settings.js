// Tolstoy settings bridge on x.com, ISOLATED world, document_start.
//
// The MAIN world script cannot read chrome.storage, so this file reads the
// settings and hands them over with window.postMessage, tagged source
// "tolstoy", same origin. It answers a request as well as pushing, so the page
// script does not have to wait for anything, and it pushes again whenever the
// settings change while the page is open.
//
// It reads settings and nothing else. No feed content is stored or sent.

(function () {
  "use strict";

  var SOURCE = "tolstoy";
  var STORAGE_KEY = "tolstoySettings";
  var DEFAULTS = { temperature: "balanced", blur: false };

  var current = { temperature: DEFAULTS.temperature, blur: DEFAULTS.blur };

  function post() {
    try {
      window.postMessage({ source: SOURCE, type: "settings", settings: current }, window.location.origin);
    } catch (error) {
      // If even this fails, the page script keeps its Balanced default.
    }
  }

  function hasStorage() {
    return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  }

  function load() {
    if (!hasStorage()) {
      post();
      return;
    }
    chrome.storage.local.get(STORAGE_KEY, function (items) {
      var saved = items && items[STORAGE_KEY];
      if (saved && typeof saved === "object") {
        if (["calm", "balanced", "unfiltered"].indexOf(saved.temperature) !== -1) {
          current.temperature = saved.temperature;
        }
        current.blur = !!saved.blur;
      }
      post();
    });
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window || event.origin !== window.location.origin) {
      return;
    }
    var data = event.data;
    if (data && data.source === SOURCE && data.type === "requestSettings") {
      post();
    }
  });

  if (hasStorage() && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== "local" || !changes[STORAGE_KEY]) {
        return;
      }
      var next = changes[STORAGE_KEY].newValue;
      if (next && typeof next === "object") {
        if (["calm", "balanced", "unfiltered"].indexOf(next.temperature) !== -1) {
          current.temperature = next.temperature;
        }
        current.blur = !!next.blur;
        post();
      }
    });
  }

  load();
})();

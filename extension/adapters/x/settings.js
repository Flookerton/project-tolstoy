// Tolstoy bridge on x.com, ISOLATED world, document_start.
//
// The MAIN world script cannot read chrome.storage or talk to the rest of the
// extension, so this file carries three things across, all with window.postMessage
// tagged source "tolstoy" and checked against this origin:
//
//   settings      from chrome.storage, pushed on load, on change, and on request
//   model status  whether the on-device model is downloaded and loaded
//   scores        post TEXT only, one batch at a time, out to the model and the
//                 scores back. Handles and ids never cross here, and the text is
//                 never written down or sent off this computer.
//
// It reads settings and passes messages. It stores nothing and logs nothing.

(function () {
  "use strict";

  var SOURCE = "tolstoy";
  var STORAGE_KEY = "tolstoySettings";
  var DEFAULTS = { temperature: "balanced", blur: false };

  var current = { temperature: DEFAULTS.temperature, blur: DEFAULTS.blur };

  function post(message) {
    try {
      window.postMessage(Object.assign({ source: SOURCE }, message), window.location.origin);
    } catch (error) {
      // If even this fails, the page script keeps its Balanced default.
    }
  }

  function postSettings() {
    post({ type: "settings", settings: current });
  }

  function hasRuntime() {
    return typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage;
  }

  function postModelStatus() {
    if (!hasRuntime()) {
      post({ type: "modelStatus", ready: false, reason: "absent" });
      return;
    }
    try {
      // Every message to the worker carries the source tag. The worker ignores
      // anything untagged, which is how this bridge spent a while asking the
      // worker questions it never answered.
      chrome.runtime.sendMessage({ source: SOURCE, type: "modelStatus" }, function (reply) {
        if (chrome.runtime.lastError || !reply) {
          post({ type: "modelStatus", ready: false, reason: "absent" });
          return;
        }
        post({ type: "modelStatus", ready: !!reply.ready, reason: reply.reason || (reply.ready ? "ready" : "absent") });
      });
    } catch (error) {
      post({ type: "modelStatus", ready: false, reason: "absent" });
    }
  }

  // Scores come back a group at a time, and the group size is deliberately small:
  // the page holds a timeline for a fixed budget and reranks with whatever has
  // arrived by then, so many small answers are worth more than one big one.
  var GROUP = 4;
  var asking = {};

  function askForScores(id, texts) {
    if (!hasRuntime() || !Array.isArray(texts) || !texts.length) {
      return;
    }
    if (asking[id]) {
      return;
    }
    asking[id] = true;

    var queue = texts.slice();

    function stop() {
      delete asking[id];
    }

    function next() {
      var part = queue.splice(0, GROUP);
      if (!part.length) {
        post({ type: "scoreResult", id: id, scores: {}, done: true });
        stop();
        return;
      }
      try {
        chrome.runtime.sendMessage({ source: SOURCE, type: "score", texts: part }, function (reply) {
          if (chrome.runtime.lastError) {
            post({ type: "scoreResult", id: id, scores: {}, done: true });
            stop();
            return;
          }
          var scores = (reply && reply.scores) || {};
          var labels = (reply && reply.labels) || {};
          var answered = Object.keys(scores).length > 0;
          post({ type: "scoreResult", id: id, scores: scores, labels: labels, done: !queue.length });
          if (!answered && reply && reply.ok === false) {
            // The model is not available, so there is nothing to wait for. The
            // page falls back to the rules on its own timer either way.
            post({ type: "scoreResult", id: id, scores: {}, done: true });
            stop();
            return;
          }
          if (queue.length) {
            next();
            return;
          }
          stop();
        });
      } catch (error) {
        post({ type: "scoreResult", id: id, scores: {}, done: true });
        stop();
      }
    }

    next();
  }

  function hasStorage() {
    return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  }

  function read() {
    if (!hasStorage()) {
      postSettings();
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
      postSettings();
    });
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window || event.origin !== window.location.origin) {
      return;
    }
    var data = event.data;
    if (!data || data.source !== SOURCE) {
      return;
    }
    if (data.type === "requestSettings") {
      read();
      return;
    }
    if (data.type === "requestModelStatus") {
      postModelStatus();
      return;
    }
    if (data.type === "scoreRequest" && typeof data.id === "string" && Array.isArray(data.texts)) {
      askForScores(data.id, data.texts);
    }
  });

  // The panel can change the settings, and the download can finish or be removed,
  // while a tab is open. Both reach the page without a reload.
  if (hasRuntime() && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (message) {
      if (!message || message.source !== SOURCE) {
        return;
      }
      if (message.type === "settingsChanged") {
        read();
      }
      if (message.type === "modelChanged") {
        post({
          type: "modelStatus",
          ready: !!message.ready,
          reason: message.reason || (message.ready ? "ready" : "absent")
        });
      }
    });
  }

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
        postSettings();
      }
    });
  }

  read();
  postModelStatus();
})();

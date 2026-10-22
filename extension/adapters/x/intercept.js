// Tolstoy X adapter, MAIN world, document_start.
//
// Wraps window.fetch and XMLHttpRequest, reads only the timeline responses,
// scores each post with the published rules, and either moves the heated posts
// to the end of their batch or leaves them where X put them for the veil to
// soften in place. Everything else passes through untouched.
//
// Settings arrive from adapters/x/settings.js by postMessage. Until the first
// settings message the temperature is Balanced, which is also the default in the
// panel. Nothing is stored, and no request of our own is ever made.

(function () {
  "use strict";

  var GUARD = "__tolstoyXInterceptInstalled";
  if (window[GUARD]) {
    return;
  }
  window[GUARD] = true;

  var SOURCE = "tolstoy";
  var API_PATH = "/i/api/graphql/";
  var OPERATIONS = ["HomeTimeline", "HomeLatestTimeline"];
  var URL_KEY = "__tolstoyRequestUrl";

  // Calm, Balanced and Unfiltered, from the orchestration's decision table.
  var THRESHOLDS = { calm: 0.45, balanced: 0.5, unfiltered: 1.01 };

  var settings = { temperature: "balanced", blur: false };
  var settingsSeen = false;
  var totals = { checked: 0, moved: [] };

  function isTimelineRequest(url) {
    if (typeof url !== "string" || url.indexOf(API_PATH) === -1) {
      return false;
    }
    var pathname;
    try {
      pathname = new URL(url, window.location.href).pathname;
    } catch (error) {
      return false;
    }
    var last = pathname.split("/").filter(Boolean).pop() || "";
    return OPERATIONS.indexOf(last) !== -1;
  }

  function threshold() {
    var value = THRESHOLDS[settings.temperature];
    return typeof value === "number" ? value : THRESHOLDS.balanced;
  }

  // "move" reorders, "blur" counts and lets the veil soften posts in place,
  // "off" only counts, which is what Unfiltered does.
  function mode() {
    if (settings.temperature === "unfiltered") {
      return "off";
    }
    return settings.blur ? "blur" : "move";
  }

  function report(payload) {
    // Totals, so a banner or veil that loaded late can ask for the truth instead
    // of missing a batch that already went by.
    totals.checked += payload.checked || 0;
    if (Array.isArray(payload.moved) && payload.moved.length) {
      Array.prototype.push.apply(totals.moved, payload.moved);
    }

    try {
      window.postMessage(
        {
          source: SOURCE,
          type: "counts",
          checked: payload.checked,
          moved: payload.moved,
          mode: payload.mode,
          temperature: settings.temperature
        },
        window.location.origin
      );
    } catch (error) {
      // The banner is a courtesy, never a requirement.
    }
  }

  // Answers "what have you seen so far", so a late listener still gets the whole
  // visit rather than a banner stuck at zero.
  function reportTotals() {
    try {
      window.postMessage(
        {
          source: SOURCE,
          type: "counts",
          totals: true,
          checked: totals.checked,
          moved: totals.moved,
          mode: mode(),
          temperature: settings.temperature
        },
        window.location.origin
      );
    } catch (error) {
      // Nothing to do: the banner keeps whatever it already had.
    }
  }

  // Returns { text, moved } or null. Null means "hand back exactly what X sent".
  function rerankBody(bodyText) {
    try {
      if (typeof bodyText !== "string" || !bodyText) {
        return null;
      }
      var json = JSON.parse(bodyText);
      if (!json || typeof json !== "object") {
        return null;
      }
      var rerank = window.TolstoyRerank;
      var score = window.TolstoyScore;
      if (!rerank || !score) {
        return null;
      }

      var currentMode = mode();
      // In blur mode the posts are scored but not moved, so the batch goes back
      // exactly as X sent it and the veil does the softening in the page.
      var result = rerank.rerankTimeline(json, score.scorePost, threshold());
      if (!result || typeof result.checked !== "number") {
        return null;
      }

      var moved = currentMode === "off" ? [] : result.moved || [];
      if (result.checked > 0) {
        report({ checked: result.checked, moved: moved, mode: currentMode });
      }
      return {
        text: currentMode === "move" ? JSON.stringify(result.json) : bodyText,
        moved: moved
      };
    } catch (error) {
      return null;
    }
  }

  // ---------------------------------------------------------------- window.fetch
  var originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function () {
      var url = "";
      try {
        var first = arguments[0];
        url = typeof first === "string" ? first : (first && first.url) || "";
      } catch (error) {
        url = "";
      }

      var call = originalFetch.apply(this, arguments);
      if (!isTimelineRequest(url)) {
        return call;
      }

      return call.then(function (response) {
        try {
          return response.text().then(function (body) {
            var outcome = rerankBody(body);
            var text = outcome && outcome.moved.length && mode() === "move" ? outcome.text : body;
            var headers = new Headers(response.headers);
            // The body was decompressed on the way in, so the original encoding
            // and length headers no longer describe it.
            headers.delete("content-encoding");
            headers.delete("content-length");
            var replaced = new Response(text, {
              status: response.status,
              statusText: response.statusText,
              headers: headers
            });
            // X reads response.url in places, so keep it truthful.
            try {
              Object.defineProperty(replaced, "url", { value: response.url });
            } catch (error) {
              // Older engines may refuse; the response is still correct.
            }
            return replaced;
          });
        } catch (error) {
          return response;
        }
      });
    };
  }

  // ------------------------------------------------------- window.XMLHttpRequest
  var XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype && typeof XHR.prototype.open === "function") {
    var originalOpen = XHR.prototype.open;
    var originalSend = XHR.prototype.send;
    var originalResponseText = Object.getOwnPropertyDescriptor(XHR.prototype, "responseText");
    var originalResponse = Object.getOwnPropertyDescriptor(XHR.prototype, "response");

    XHR.prototype.open = function () {
      try {
        this[URL_KEY] = arguments[1];
      } catch (error) {
        // Reading the URL is a nicety, not a requirement.
      }
      return originalOpen.apply(this, arguments);
    };

    XHR.prototype.send = function () {
      var request = this;
      if (!isTimelineRequest(request[URL_KEY])) {
        return originalSend.apply(this, arguments);
      }

      var done = false;
      var cached = null;

      // The getters are defined now, before send() returns, so a handler X
      // registered earlier still reads the reranked body rather than the
      // original one.
      // The body, from whichever getter still works. Chrome throws on
      // responseText once responseType is "json", so the parsed response is the
      // source there.
      function rawBody() {
        if (request.responseType === "json") {
          try {
            var parsed = originalResponse && originalResponse.get ? originalResponse.get.call(request) : null;
            if (parsed && typeof parsed === "object") {
              return JSON.stringify(parsed);
            }
          } catch (error) {
            return null;
          }
          return null;
        }
        try {
          return originalResponseText && originalResponseText.get ? originalResponseText.get.call(request) : null;
        } catch (error) {
          return null;
        }
      }

      function resolveBody() {
        if (done) {
          return cached;
        }
        done = true;
        if (request.readyState !== 4) {
          return null;
        }
        var body = rawBody();
        if (typeof body !== "string" || !body) {
          return null;
        }
        var outcome = rerankBody(body);
        cached = outcome && outcome.moved.length && mode() === "move" ? outcome.text : body;
        return cached;
      }

      try {
        Object.defineProperty(request, "responseText", {
          configurable: true,
          get: function () {
            var text = resolveBody();
            if (text !== null && text !== undefined) {
              return text;
            }
            return originalResponseText && originalResponseText.get ? originalResponseText.get.call(request) : "";
          }
        });

        Object.defineProperty(request, "response", {
          configurable: true,
          get: function () {
            if (request.responseType === "json") {
              var text = resolveBody();
              if (typeof text === "string") {
                try {
                  return JSON.parse(text);
                } catch (error) {
                  return null;
                }
              }
            }
            if (request.responseType === "" || request.responseType === "text") {
              var asText = resolveBody();
              if (asText !== null && asText !== undefined) {
                return asText;
              }
            }
            return originalResponse && originalResponse.get ? originalResponse.get.call(request) : null;
          }
        });
      } catch (error) {
        // If the response cannot be shadowed, X's version wins and we fail open.
      }

      return originalSend.apply(this, arguments);
    };
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window || event.origin !== window.location.origin) {
      return;
    }
    var data = event.data;
    if (!data || data.source !== SOURCE) {
      return;
    }
    if (data.type === "requestCounts") {
      reportTotals();
      return;
    }
    if (data.type !== "settings" || !data.settings) {
      return;
    }
    settingsSeen = true;
    if (["calm", "balanced", "unfiltered"].indexOf(data.settings.temperature) !== -1) {
      settings.temperature = data.settings.temperature;
    }
    settings.blur = !!data.settings.blur;
  });

  // Ask for the settings at once, and let the bridge answer whenever it is up.
  try {
    window.postMessage({ source: SOURCE, type: "requestSettings" }, window.location.origin);
  } catch (error) {
    // Balanced is a safe default.
  }

  // Whether the settings beat the first batch is reported by the check script;
  // this flag is only for that measurement.
  window.__tolstoySettingsSeen = function () {
    return settingsSeen;
  };
})();

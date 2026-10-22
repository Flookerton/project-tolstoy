// Tolstoy X adapter, MAIN world, document_start.
//
// Wraps window.fetch and XMLHttpRequest, reads only the timeline responses,
// scores and reranks them with scoring/score.js and adapters/x/rerank.js, and
// hands X the modified body. Everything else passes through untouched.
//
// No network call of its own, no storage, no logging: moved posts live only in
// page memory and are reported to the banner with window.postMessage.
//
// Load order comes from the manifest: scoring/rules.js, scoring/score.js,
// adapters/x/rerank.js, then this file.

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

  // Match on the trailing operation name of the path, never on a pinned query
  // id, because X rotates the id. See docs/research-notes.md, section 2.
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

  function report(checked, moved) {
    try {
      window.postMessage({ source: SOURCE, type: "counts", checked: checked, moved: moved }, window.location.origin);
    } catch (error) {
      // Nothing to do: the banner is a courtesy, never a requirement.
    }
  }

  // Returns { text, moved } or null. Null means "hand back what X sent".
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
      var rules = window.TolstoyRules;
      if (!rerank || !score || !rules) {
        return null;
      }
      var result = rerank.rerankTimeline(json, score.scorePost, rules.THRESHOLD);
      if (!result || typeof result.checked !== "number") {
        return null;
      }
      if (result.checked > 0) {
        report(result.checked, result.moved || []);
      }
      return { text: JSON.stringify(result.json), moved: result.moved || [] };
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
            var text = outcome && outcome.moved.length ? outcome.text : body;
            var headers = new Headers(response.headers);
            // The body was decompressed on the way in, so the original
            // encoding and length headers no longer describe it.
            headers.delete("content-encoding");
            headers.delete("content-length");
            return new Response(text, {
              status: response.status,
              statusText: response.statusText,
              headers: headers
            });
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
      var url = request[URL_KEY];
      if (isTimelineRequest(url)) {
        try {
          request.addEventListener("readystatechange", function () {
            if (request.readyState !== 4) {
              return;
            }
            if (request.responseType && request.responseType !== "text") {
              return;
            }
            var body;
            try {
              body = request.responseText;
            } catch (error) {
              return;
            }
            var outcome = rerankBody(body);
            if (!outcome || !outcome.moved.length) {
              return;
            }
            try {
              Object.defineProperty(request, "responseText", {
                configurable: true,
                get: function () {
                  return outcome.text;
                }
              });
              Object.defineProperty(request, "response", {
                configurable: true,
                get: function () {
                  return outcome.text;
                }
              });
            } catch (error) {
              // If the response cannot be replaced, X's version wins.
            }
          });
        } catch (error) {
          // Fall through to the original send.
        }
      }
      return originalSend.apply(this, arguments);
    };
  }
})();

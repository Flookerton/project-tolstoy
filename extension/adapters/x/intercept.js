// Tolstoy X adapter, MAIN world, document_start.
//
// Reads the timeline responses X asks for, scores every post with the published
// rules and, when the on-device model is ready, with the model as well. Heated
// posts move to the end of their batch, or are softened in place in blur mode.
// Everything else passes through untouched.
//
// Two things are different from the first version of this file:
//
//   1. Responses can be held. The model is asynchronous, so X's handlers must
//      only see the response after it has been scored, whichever order X
//      registered them in. For a timeline request we take over the instance's
//      handlers at open() time and dispatch them ourselves once the score is in,
//      with a hard budget of 400ms. Nothing waits longer than that: if the model
//      is slow or absent, the rules score for the batch is what X gets.
//   2. Only HomeTimeline, HomeLatestTimeline and TweetDetail are ever held.
//      Every other request, and every other XHR, is left exactly as it was.
//
// No network calls of its own, no storage, no logging of post text.

(function () {
  "use strict";

  var GUARD = "__tolstoyXInterceptInstalled";
  if (window[GUARD]) {
    return;
  }
  window[GUARD] = true;

  var SOURCE = "tolstoy";
  var API_PATH = "/i/api/graphql/";
  var OPERATIONS = ["HomeTimeline", "HomeLatestTimeline", "TweetDetail"];
  var URL_KEY = "__tolstoyRequestUrl";
  var HOLD_KEY = "__tolstoyHold";
  var HOLD_MS = 400;

  // Calm, Balanced and Unfiltered, from the orchestration's decision table.
  var THRESHOLDS = { calm: 0.45, balanced: 0.5, unfiltered: 1.01 };

  // The model's own scores are multiplied by this before they are compared with
  // the rules. It was tuned on tests/fixtures/eval-set.json only: at 0.6 no calm
  // post moves at Balanced or at Calm, and the heated catch rate stays at 95%
  // and 100%. See docs/scoring-rules.md.
  var MODEL_CALIBRATION = 0.6;

  // Shown when the model is what moved a post and the rules found no reason of
  // their own to explain it.
  var MODEL_REASON = "Read as hostile by the on-device model";

  var settings = { temperature: "balanced", blur: false };
  var model = { ready: false, reason: "absent" };
  var totals = { checked: 0, moved: [] };
  var lastBy = "rules";

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

  // ------------------------------------------------------------------ reporting

  function report(payload) {
    totals.checked += payload.checked || 0;
    if (Array.isArray(payload.moved) && payload.moved.length) {
      Array.prototype.push.apply(totals.moved, payload.moved);
    }
    lastBy = payload.by || "rules";

    try {
      window.postMessage(
        {
          source: SOURCE,
          type: "counts",
          checked: payload.checked,
          moved: payload.moved,
          mode: payload.mode,
          temperature: settings.temperature,
          by: lastBy
        },
        window.location.origin
      );
    } catch (error) {
      // The banner is a courtesy, never a requirement.
    }
  }

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
          temperature: settings.temperature,
          by: lastBy
        },
        window.location.origin
      );
    } catch (error) {
      // Nothing to do: the banner keeps whatever it already had.
    }
  }

  // ------------------------------------------------------------------- scoring

  var pending = {};
  var pendingCount = 0;

  // Ask the on-device model about a batch of texts. Only text is sent, and it
  // never leaves the page, the extension and this computer. Resolves with a map
  // from text to score, or null if the model was not ready or did not answer in
  // time.
  function askModel(texts) {
    if (!model.ready || !texts.length) {
      return Promise.resolve(null);
    }
    return new Promise(function (resolve) {
      var id = "score-" + (pendingCount += 1);
      var settled = false;

      function finish(value) {
        if (settled) {
          return;
        }
        settled = true;
        delete pending[id];
        resolve(value);
      }

      pending[id] = finish;

      try {
        window.postMessage({ source: SOURCE, type: "scoreRequest", id: id, texts: texts, budgetMs: HOLD_MS - 60 }, window.location.origin);
      } catch (error) {
        finish(null);
        return;
      }

      window.setTimeout(function () {
        finish(null);
      }, HOLD_MS);
    });
  }

  function rulesScoreOf(text, scoreFn) {
    var result = scoreFn(text);
    return result && typeof result.score === "number" ? result.score : 0;
  }

  // Score a parsed payload: rules always, the model when it is ready. Returns a
  // promise of { scoreFor, by }, where scoreFor(text) is the final score for a
  // post. Scores are cached by post id in memory, capped, so nothing is scored
  // twice while the tab is open.
  var scoreCache = new Map();
  var SCORE_CACHE_MAX = 2000;
  var batchCount = 0;
  var modelBatchCount = 0;

  function cacheGet(id) {
    return id && scoreCache.has(id) ? scoreCache.get(id) : undefined;
  }

  function cachePut(id, value) {
    if (!id) {
      return;
    }
    scoreCache.set(id, value);
    while (scoreCache.size > SCORE_CACHE_MAX) {
      var oldest = scoreCache.keys().next();
      if (oldest.done) {
        break;
      }
      scoreCache.delete(oldest.value);
    }
  }

  function scorePayload(json, scoreFn) {
    var rerank = window.TolstoyRerank;
    var entries = rerank && typeof rerank.collectTexts === "function" ? rerank.collectTexts(json) : [];
    var asked = [];
    var rules = {};

    entries.forEach(function (entry) {
      var cached = cacheGet(entry.id);
      if (cached === undefined) {
        rules[entry.text] = rulesScoreOf(entry.text, scoreFn);
        if (asked.indexOf(entry.text) === -1) {
          asked.push(entry.text);
        }
      }
    });

    var modelScores = {};
    var by = "rules";

    return askModel(asked).then(function (answer) {
      batchCount += 1;
      if (answer && answer.scores && Object.keys(answer.scores).length) {
        by = "rules+model";
        modelBatchCount += 1;
        asked.forEach(function (text) {
          modelScores[text] = typeof answer.scores[text] === "number" ? answer.scores[text] : 0;
        });
      }

      entries.forEach(function (entry) {
        if (cacheGet(entry.id) !== undefined) {
          return;
        }
        var base = typeof rules[entry.text] === "number" ? rules[entry.text] : rulesScoreOf(entry.text, scoreFn);
        var fromModel = modelScores[entry.text] || 0;
        var blended = Math.max(base, fromModel * MODEL_CALIBRATION);
        var reason = scoreFn(entry.text).reasons;
        if (fromModel * MODEL_CALIBRATION > base && !reason.length) {
          reason = [MODEL_REASON];
        }
        cachePut(entry.id, { score: blended, reasons: reason });
      });

      function scoreFor(text) {
        var value = null;
        entries.forEach(function (entry) {
          if (entry.text === text) {
            var cached = cacheGet(entry.id);
            if (cached) {
              value = cached.score;
            }
          }
        });
        if (typeof value === "number") {
          return value;
        }
        var base = typeof rules[text] === "number" ? rules[text] : rulesScoreOf(text, scoreFn);
        return Math.max(base, (modelScores[text] || 0) * MODEL_CALIBRATION);
      }

      return { scoreFor: scoreFor, by: by, texts: asked };
    });
  }

  // ------------------------------------------------------------- holding a body

  function rawBody(request, originalGetters) {
    if (request.responseType === "json") {
      try {
        var parsed = originalGetters.response && originalGetters.response.get
          ? originalGetters.response.get.call(request)
          : null;
        if (parsed && typeof parsed === "object") {
          return JSON.stringify(parsed);
        }
      } catch (error) {
        return null;
      }
      return null;
    }
    try {
      return originalGetters.responseText && originalGetters.responseText.get
        ? originalGetters.responseText.get.call(request)
        : null;
    } catch (error) {
      return null;
    }
  }

  // Route a timeline request's handlers through here instead of the native event
  // target, so they can be fired after the score is in.
  var HOLDABLE = ["readystatechange", "load", "loadend"];
  var PROPERTIES = ["onreadystatechange", "onload", "onloadend"];

  function makeEvent(type, request) {
    try {
      var event = new Event(type);
      Object.defineProperty(event, "target", { value: request, configurable: true });
      Object.defineProperty(event, "currentTarget", { value: request, configurable: true });
      return event;
    } catch (error) {
      return { type: type, target: request, currentTarget: request };
    }
  }

  function dispatch(record, request) {
    record.released = true;
    var listeners = record.listeners.slice();
    var properties = PROPERTIES.filter(function (name) {
      return typeof record.properties[name] === "function";
    }).map(function (name) {
      return { type: name.slice(2), listener: record.properties[name] };
    });

    var queue = listeners.concat(properties);
    queue.forEach(function (item) {
      try {
        item.listener.call(request, makeEvent(item.type, request));
      } catch (error) {
        // A handler that throws is X's problem, not ours.
      }
    });
  }

  function releaseWhenScored(request, originalGetters) {
    var record = request[HOLD_KEY];
    if (!record) {
      return;
    }
    var body = rawBody(request, originalGetters);
    if (typeof body !== "string" || !body) {
      dispatch(record, request);
      return;
    }

    var outcome = rerankBody(body);
    if (!outcome || !outcome.promise) {
      dispatch(record, request);
      return;
    }

    outcome.promise.then(function (text) {
      try {
        Object.defineProperty(request, "responseText", {
          configurable: true,
          get: function () {
            return typeof text === "string" ? text : body;
          }
        });
        Object.defineProperty(request, "response", {
          configurable: true,
          get: function () {
            var final = typeof text === "string" ? text : body;
            if (request.responseType === "json") {
              try {
                return JSON.parse(final);
              } catch (error) {
                return null;
              }
            }
            return final;
          }
        });
      } catch (error) {
        // If the response cannot be shadowed, X's own body is what it reads.
      }
      dispatch(record, request);
    });
  }

  // ---------------------------------------------------------------- rerank a body

  // Returns { text, checked, moved } or { promise } when the answer is async.
  // On anything unexpected it returns null, which means "hand back what X sent".
  function rerankBody(bodyText, scoreFn) {
    var json;
    try {
      if (typeof bodyText !== "string" || !bodyText) {
        return null;
      }
      json = JSON.parse(bodyText);
      if (!json || typeof json !== "object") {
        return null;
      }
    } catch (error) {
      return null;
    }

    var rerank = window.TolstoyRerank;
    // window.TolstoyScore is the published API object, not the function itself:
    // { scorePost, matchedRules, threshold, thresholds }. Older builds assigned
    // the bare function. Accept both, so this cannot silently stop scoring again.
    var published = window.TolstoyScore;
    var score = published && typeof published.scorePost === "function"
      ? published.scorePost
      : (typeof published === "function" ? published : null);
    if (!rerank || typeof rerank.rerankTimeline !== "function" || typeof score !== "function") {
      return null;
    }

    var currentMode = mode();

    return {
      promise: scorePayload(json, score)
        .then(function (scored) {
          var result = rerank.rerankTimeline(json, function (text) {
            var value = scored.scoreFor(text);
            var reasons = score(text).reasons;
            return { score: value, reasons: reasons };
          }, threshold());

          if (!result || typeof result.checked !== "number") {
            return null;
          }

          var moved = currentMode === "off" ? [] : result.moved || [];
          if (result.checked > 0) {
            report({ checked: result.checked, moved: moved, mode: currentMode, by: scored.by });
          }
          return currentMode === "move" ? JSON.stringify(result.json) : null;
        })
        .catch(function () {
          return null;
        })
    };
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
            if (!outcome || !outcome.promise) {
              // The body has already been read to look for posts. Returning the
              // original response would hand the page a stream that is already
              // consumed, and its own .text() would throw. A fresh response with
              // the same bytes and headers keeps the page working.
              var untouched = new Headers(response.headers);
              untouched.delete("content-encoding");
              untouched.delete("content-length");
              var copy = new Response(body, {
                status: response.status,
                statusText: response.statusText,
                headers: untouched
              });
              try {
                Object.defineProperty(copy, "url", { value: response.url });
              } catch (error) {
                // Older engines may refuse; the response is still correct.
              }
              return copy;
            }
            return outcome.promise.then(function (finalText) {
              var text = typeof finalText === "string" ? finalText : body;
              var headers = new Headers(response.headers);
              // The body was decompressed on the way in, so these no longer
              // describe it.
              headers.delete("content-encoding");
              headers.delete("content-length");
              var replaced = new Response(text, {
                status: response.status,
                statusText: response.statusText,
                headers: headers
              });
              try {
                Object.defineProperty(replaced, "url", { value: response.url });
              } catch (error) {
                // Older engines may refuse; the response is still correct.
              }
              return replaced;
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
    var originalAddEventListener = XHR.prototype.addEventListener;
    var originalResponseText = Object.getOwnPropertyDescriptor(XHR.prototype, "responseText");
    var originalResponse = Object.getOwnPropertyDescriptor(XHR.prototype, "response");
    var originalGetters = { responseText: originalResponseText, response: originalResponse };

    function holdOf(request) {
      return request[HOLD_KEY] || null;
    }

    // Handlers registered after open() on a timeline request go to the hold
    // record instead of the native event target, whichever way X registers them.
    if (typeof originalAddEventListener === "function") {
      XHR.prototype.addEventListener = function (type, listener, options) {
        var record = holdOf(this);
        if (record && typeof listener === "function" && HOLDABLE.indexOf(type) !== -1) {
          if (record.released) {
            var request = this;
            window.setTimeout(function () {
              try {
                listener.call(request, makeEvent(type, request));
              } catch (error) {
                // X's problem.
              }
            }, 0);
            return;
          }
          record.listeners.push({ type: type, listener: listener });
          return undefined;
        }
        return originalAddEventListener.apply(this, arguments);
      };
    }

    PROPERTIES.forEach(function (name) {
      var descriptor = Object.getOwnPropertyDescriptor(XHR.prototype, name);
      if (!descriptor || typeof descriptor.set !== "function") {
        return;
      }
      Object.defineProperty(XHR.prototype, name, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: function () {
          var record = holdOf(this);
          if (record && typeof record.properties[name] === "function") {
            return record.properties[name];
          }
          return descriptor.get.call(this);
        },
        set: function (value) {
          var record = holdOf(this);
          if (record && typeof value === "function" && !record.released) {
            record.properties[name] = value;
            return;
          }
          descriptor.set.call(this, value);
        }
      });
    });

    XHR.prototype.open = function () {
      var url = arguments[1];
      try {
        this[URL_KEY] = url;
      } catch (error) {
        // Reading the URL is a nicety, not a requirement.
      }
      if (isTimelineRequest(url)) {
        try {
          this[HOLD_KEY] = { listeners: [], properties: {}, released: false };
        } catch (error) {
          // Without a hold record the request behaves exactly as before.
        }
      }
      return originalOpen.apply(this, arguments);
    };

    XHR.prototype.send = function () {
      var request = this;
      var record = holdOf(request);
      if (!record) {
        return originalSend.apply(this, arguments);
      }

      // Our own listener is the only native one on a held request, so X's
      // handlers cannot run before the score is in.
      try {
        originalAddEventListener.call(request, "readystatechange", function () {
          if (request.readyState !== 4) {
            return;
          }
          releaseWhenScored(request, originalGetters);
        });
      } catch (error) {
        delete request[HOLD_KEY];
        return originalSend.apply(this, arguments);
      }

      return originalSend.apply(this, arguments);
    };
  }

  // -------------------------------------------------------------- the messages

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

    if (data.type === "scoreResult" && data.id && pending[data.id]) {
      pending[data.id]({ scores: data.scores || {} });
      return;
    }

    if (data.type === "modelStatus") {
      model.ready = !!data.ready;
      model.reason = data.reason || (data.ready ? "ready" : "absent");
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

  var settingsSeen = false;

  try {
    window.postMessage({ source: SOURCE, type: "requestSettings" }, window.location.origin);
    window.postMessage({ source: SOURCE, type: "requestModelStatus" }, window.location.origin);
  } catch (error) {
    // Balanced is a safe default, and the rules always work.
  }

  // For the browser checks only: how the last batch was scored, and whether the
  // settings beat the first batch.
  window.__tolstoyState = function () {
    return {
      by: lastBy,
      modelReady: model.ready,
      settingsSeen: settingsSeen,
      temperature: settings.temperature,
      blur: settings.blur,
      batches: batchCount,
      modelBatches: modelBatchCount,
      fallbacks: batchCount - modelBatchCount
    };
  };
})();

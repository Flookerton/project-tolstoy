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
  // The page owns the clock. There are two budgets: the first timeline batch of a
  // page load waits at most 400ms, because the person is looking straight at it,
  // and later batches, the ones scrolling asks for, wait up to 1500ms, because X
  // requests those before the person reaches the bottom. Page timers are precise;
  // a service worker's timers are clamped by the browser, which is why the clock
  // lives here and not in the worker.
  // The budget is the model's, and the page still has to parse and rerank after
  // it, so the first budget is set a little under the 400ms the person is
  // promised: measured end to end, a batch with a 320ms model budget came back in
  // about 400ms including the rerank.
  var HOLD_FIRST_MS = 320;
  var HOLD_SCROLL_MS = 1400;

  // Calm, Balanced and Unfiltered, from the orchestration's decision table.
  var THRESHOLDS = { calm: 0.45, balanced: 0.5, unfiltered: 1.01 };

  // The model's own scores are multiplied by this before they are compared with
  // the rules. It was chosen from tests/fixtures/model-scores-main.json, which
  // holds the raw label scores of every post in the main eval set as measured by
  // this model in this browser, with the model id and the file's sha256 recorded
  // alongside. On that file, 1.0 is the largest value that still meets both bars:
  // at Balanced one calm post moves and 95 percent of heated posts are caught, and
  // at Calm two calm posts move and 98 percent are caught. It rescues one hostile
  // post the rules alone miss (the "toothless crackhead" one from the live check)
  // and it costs one calm post (a gaming "I am going to kill this boss" idiom).
  // See docs/scoring-rules.md.
  // The bundled model's calibration. The worker reports the figure for whichever
  // model is in use and this is replaced with it, but the page can score before
  // that answer arrives, and the model that is always there is the small one.
  var MODEL_CALIBRATION = 0.8;

  // The calibration each model is read at, keyed by the model's id. The worker reports
  // both when it reports its status, so the page never assumes a scale: the two models
  // do not share one, and the figures were each chosen from that model's own measured
  // scores on the main eval set.
  var CALIBRATIONS = {};

  function calibrationFor(modelId) {
    if (modelId && typeof CALIBRATIONS[modelId] === "number" && CALIBRATIONS[modelId] > 0) {
      return CALIBRATIONS[modelId];
    }
    return MODEL_CALIBRATION;
  }

  // The model's labels, said in plain words. Whichever label produced the score is
  // the reason shown first, and no post is ever left without a reason at all: a
  // missing or unrecognised label falls back to "Hostile tone." rather than the
  // word "undefined".
  var MODEL_REASONS = {
    insult: "Insults someone",
    threat: "Threatens harm",
    identity_hate: "Attacks people for who they are",
    severe_toxic: "Severely hostile"
  };
  var HOSTILE_TONE = "Hostile tone.";

  function modelReason(label) {
    return (typeof label === "string" && MODEL_REASONS[label]) ? MODEL_REASONS[label] : HOSTILE_TONE;
  }

  // One plain sentence per reason, no repeats, and nothing that is not a string.
  function cleanReasons(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (item) {
      if (typeof item === "string" && item && out.indexOf(item) === -1) {
        out.push(item);
      }
    });
    return out;
  }

  var settings = { temperature: "balanced", blur: false };
  var model = { ready: false, reason: "absent" };
  var modelStatusSeen = false;
  var modelAsks = 0;
  // Times from navigation, for the report only: when the page learned the model
  // exists, and when the model page confirmed it had run something once.
  var modelReadyAt = null;
  var modelWarmedAt = null;
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

  // The service worker may still be waking when the page first asks whether the
  // model is there, and a single answer of "no" would otherwise be believed for
  // the whole visit. Ask again a few times, and on earlier batches. This costs one
  // message per attempt and nothing else.
  function askModelStatusAgain() {
    // Asked again whenever the answer is not "ready", not only when there has been no
    // answer at all: one early "not ready" from a worker that was still waking used to
    // be believed for the rest of the visit.
    if (model.ready || modelAsks >= 8) {
      return;
    }
    modelAsks += 1;
    try {
      window.postMessage({ source: SOURCE, type: "requestModelStatus" }, window.location.origin);
    } catch (error) {
      // The next attempt will try again.
    }
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

  // A post the model flagged after its batch was already shown. It is softened in
  // place, never moved, so nothing that is already on screen ever jumps position.
  // "Show anyway" still works, and Unfiltered never softens anything.
  function reportLate(caught) {
    try {
      window.postMessage(
        {
          source: SOURCE,
          type: "lateCaught",
          caught: caught,
          // The model did this reading, so the footer has to say so on the late path
          // too. Without it the page credited the rules while the model was softening
          // posts in front of the person.
          by: "rules+model",
          mode: mode(),
          temperature: settings.temperature
        },
        window.location.origin
      );
    } catch (error) {
      // The veil is a courtesy, never a requirement.
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

  // Batches asked about before the model was ready, waiting for it. Nothing is lost
  // and nothing waits on screen: the caller is answered at once with "no scores yet",
  // and these go out as late asks, whose answers soften posts in place.
  var queued = [];
  var queuedBatches = 0;
  var flushedBatches = 0;
  var flushTries = 0;
  var flushTimer = null;

  // Hand a set of texts to the bridge as an ask that is already past its deadline, so
  // whatever comes back is treated as late by definition.
  function askLate(texts, onLate) {
    var id = "score-" + (pendingCount += 1);
    pending[id] = {
      scores: {},
      labels: {},
      texts: texts,
      onLate: onLate || null,
      released: true,
      done: false,
      finish: null
    };
    try {
      window.postMessage({ source: SOURCE, type: "scoreRequest", id: id, texts: texts }, window.location.origin);
    } catch (error) {
      delete pending[id];
    }
  }

  // Send what was queued. This runs as soon as a ready answer arrives, and also on a
  // timer while anything is still waiting, because the answer that silences the model
  // can also be the one that is wrong: if the status never says ready but the model is
  // there, the texts still need to be asked about. Asking costs one message, and the
  // bridge answers at once when there is no model to ask.
  function flushQueue() {
    if (!queued.length) {
      return;
    }
    var items = queued.splice(0, queued.length);
    items.forEach(function (item) {
      // This is the ask, delayed: it counts as one, in the batch kind it came from.
      flushedBatches += 1;
      askedBatchCount += 1;
      coverage[item.batch || "first"].asked += item.texts.length;
      askLate(item.texts, item.onLate);
    });
  }

  function armFlush() {
    if (flushTimer !== null || flushTries >= 5) {
      return;
    }
    flushTries += 1;
    flushTimer = window.setTimeout(function () {
      flushTimer = null;
      if (queued.length) {
        flushQueue();
      }
      // And ask again, in case the status is what is wrong.
      askModelStatusAgain();
      if (queued.length) {
        armFlush();
      }
    }, 1500);
  }
  var firstBatchDone = false;
  var lateCaught = 0;
  // Coverage, for the report only: how many posts of each batch had a model
  // score before the batch was handed to X, counted for the first batch of the
  // page load and for the batches scrolling asks for, separately.
  // Per batch kind: asked is the posts the model was given, scored is the posts it
  // answered about before they were drawn, and late is the posts it answered about
  // afterwards, which is what the late catch works from.
  var coverage = { first: { asked: 0, scored: 0, late: 0 }, scroll: { asked: 0, scored: 0, late: 0 } };

  // The only test seam in this file. The browser checks set
  // sessionStorage.tolstoyTestHoldMs to pin the model deadline, so a late catch can
  // be shown on purpose instead of waited for: with the deadline at 0 the page has
  // handed the batch back before any score can arrive, and everything after that is
  // a late catch by definition. Nothing on x.com sets this key, and a value that is
  // not a number, or is negative, is ignored.
  function testHoldMs() {
    try {
      var raw = window.sessionStorage.getItem("tolstoyTestHoldMs");
      if (raw === null || raw === "") {
        return null;
      }
      var value = Number(raw);
      return isFinite(value) && value >= 0 ? value : null;
    } catch (error) {
      return null;
    }
  }

  // Ask the on-device model about a batch of texts. Only text is sent, and it
  // never leaves the page, the extension and this computer.
  //
  // The answer arrives a group at a time. Whatever has arrived when the budget
  // runs out is what the caller gets; the rest keeps coming, and any later score
  // that pushes a post over the line is handed to onLate, which softens it in
  // place instead of moving it, so nothing that has already been shown ever jumps
  // position.
  function askModel(texts, onLate) {
    if (!texts.length) {
      return Promise.resolve(null);
    }
    if (modelStatusSeen && !model.ready) {
      // Not a drop. A batch asked about while the model is not known to be ready is
      // remembered and scored the moment it is, because the posts on screen have
      // already been drawn by then and there is nothing else left to do with them.
      // Dropping here is what let a single early "not ready" answer, from a worker
      // that was still waking, silence the model for the whole visit.
      queued.push({ texts: texts, onLate: onLate || null, batch: firstBatchDone ? "scroll" : "first" });
      queuedBatches += 1;
      askModelStatusAgain();
      armFlush();
      // Not null: the caller counts its batches, and this one has not been asked yet.
      // It is counted as an ask when it is actually sent, so that a batch is never
      // counted twice and never counted as a deadline that fell through.
      return Promise.resolve({ queued: true });
    }
    var id = "score-" + (pendingCount += 1);
    var pinned = testHoldMs();
    var budget = pinned === null ? (firstBatchDone ? HOLD_SCROLL_MS : HOLD_FIRST_MS) : pinned;
    firstBatchDone = true;

    var record = {
      scores: {},
      labels: {},
      texts: texts,
      onLate: onLate || null,
      released: false,
      done: false,
      batch: firstBatchDone ? "scroll" : "first",
      finish: null
    };
    pending[id] = record;

    return new Promise(function (resolve) {
      function finish() {
        if (record.released) {
          return;
        }
        record.released = true;
        resolve({ scores: record.scores, labels: record.labels });
      }

      record.finish = finish;

      try {
        window.postMessage({ source: SOURCE, type: "scoreRequest", id: id, texts: texts }, window.location.origin);
      } catch (error) {
        finish();
        return;
      }

      window.setTimeout(finish, budget);
    });
  }

  // Every text in the batch has an answer, so there is nothing left to wait for.
  function allScored(record) {
    for (var i = 0; i < record.texts.length; i += 1) {
      if (typeof record.scores[record.texts[i]] !== "number") {
        return false;
      }
    }
    return true;
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
  // Not every batch needs the model, and not every batch that asks gets an answer in
  // time. Counting those as one thing made the fallback figure look like 50 batches
  // of failure when the truth was 50 batches whose posts the page already knew.
  var askedBatchCount = 0;
  var deadlineFallbacks = 0;
  // Whether the model has had a hand in this visit at all. Once it has, the footer
  // says so for the rest of the visit: a later batch whose texts are already scored
  // is answered from the cache, and a footer that flipped back to "Scored by: rules"
  // would be telling the person something untrue about the page in front of them.
  var modelEverUsed = false;

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

    // Scores per model, because the two do not share a scale. The score that decides a
    // post is the largest any model gives after its own calibration, and the reason
    // shown is the one from whichever model produced it.
    var byModel = {};

    function noteScores(modelId, calibration, scores, labels) {
      if (!scores) {
        return;
      }
      var key = modelId || "bundled";
      if (!byModel[key]) {
        byModel[key] = {
          scores: {},
          labels: {},
          calibration: typeof calibration === "number" && calibration > 0 ? calibration : calibrationFor(modelId)
        };
      }
      Object.keys(scores).forEach(function (text) {
        byModel[key].scores[text] = typeof scores[text] === "number" ? scores[text] : 0;
      });
      Object.keys(labels || {}).forEach(function (text) {
        byModel[key].labels[text] = labels[text] || "";
      });
    }

    // The strongest reading of one post across every model that has answered, already
    // scaled by that model's calibration.
    function verdictFor(text) {
      var best = { score: 0, label: "", model: null };
      Object.keys(byModel).forEach(function (key) {
        var entry = byModel[key];
        var raw = typeof entry.scores[text] === "number" ? entry.scores[text] : 0;
        var scaled = raw * entry.calibration;
        if (scaled > best.score) {
          best = { score: scaled, label: entry.labels[text] || "", model: key };
        }
      });
      return best;
    }

    var by = "rules";
    var movedIds = {};

    // Scores that arrive after the batch has already been handed to X. A post
    // that only now crosses the line is softened where it stands; it is never
    // moved, because it has been on screen all along.
    function onLateScores(latePayload) {
      var lateScores = (latePayload && latePayload.scores) || {};
      var lateLabels = (latePayload && latePayload.labels) || {};
      // Which model these came from matters: it carries its own calibration.
      var lateCalibration = (latePayload && typeof latePayload.calibration === "number" && latePayload.calibration > 0)
        ? latePayload.calibration
        : calibrationFor(latePayload && latePayload.model);
      if (mode() === "off") {
        return;
      }
      var limit = threshold();
      var caught = [];
      entries.forEach(function (entry) {
        if (movedIds[entry.id]) {
          return;
        }
        var fromModel = typeof lateScores[entry.text] === "number" ? lateScores[entry.text] : 0;
        if (!fromModel) {
          return;
        }
        var base = typeof rules[entry.text] === "number" ? rules[entry.text] : rulesScoreOf(entry.text, scoreFn);
        if (fromModel * lateCalibration >= limit && base < limit) {
          movedIds[entry.id] = true;
          var body = typeof entry.text === "string" ? entry.text : "";
          caught.push({
            id: entry.id,
            handle: entry.handle || "",
            text: body.length > 140 ? body.slice(0, 140) : body,
            reasons: [modelReason(lateLabels[entry.text])],
            late: true
          });
        }
      });
      if (!caught.length) {
        return;
      }
      lateCaught += caught.length;
      // A late catch is the model doing the reading, so the footer has to say so:
      // without this the page credited the rules while the model was softening posts.
      modelEverUsed = true;
      reportLate(caught);
    }

    var whichBatch = firstBatchDone ? "scroll" : "first";
    askModelStatusAgain();

    return askModel(asked, onLateScores).then(function (answer) {
      batchCount += 1;
      if (answer && answer.queued) {
        // Waiting for the model. It is counted when its ask actually goes out.
        return;
      }
      var got = answer && answer.scores ? Object.keys(answer.scores).length : 0;
      coverage[whichBatch].asked += asked.length;
      coverage[whichBatch].scored += got;
      if (asked.length) {
        askedBatchCount += 1;
        if (!got) {
          // The model was asked and the deadline arrived first. This is the fallback.
          deadlineFallbacks += 1;
        }
      }
      if (answer && answer.scores && Object.keys(answer.scores).length) {
        by = "rules+model";
        modelBatchCount += 1;
        noteScores(answer.model, answer.calibration, answer.scores, answer.labels);
      }

      entries.forEach(function (entry) {
        if (cacheGet(entry.id) !== undefined) {
          return;
        }
        var base = typeof rules[entry.text] === "number" ? rules[entry.text] : rulesScoreOf(entry.text, scoreFn);
        var verdict = verdictFor(entry.text);
        var blended = Math.max(base, verdict.score);
        var ruleReasons = cleanReasons(scoreFn(entry.text).reasons);
        var reason = ruleReasons;
        if (blended > base) {
          // A model is what crossed the line, so its reason leads and the rules'
          // reasons follow it. It is the reason of the model that produced the score
          // that decided the post, not of whichever model happened to answer last.
          reason = cleanReasons([modelReason(verdict.label)].concat(ruleReasons));
        }
        if (!reason.length) {
          reason = [HOSTILE_TONE];
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
        return Math.max(base, verdictFor(text).score);
      }

      // The reasons that belong with that score. The reranker used to be handed the
      // blended score and the rules' reasons, so a post the model moved could be
      // listed with the rules' reason alone, or with none.
      function reasonFor(text) {
        var value = null;
        entries.forEach(function (entry) {
          if (entry.text === text) {
            var cached = cacheGet(entry.id);
            if (cached && Array.isArray(cached.reasons) && cached.reasons.length) {
              value = cached.reasons;
            }
          }
        });
        if (Array.isArray(value) && value.length) {
          return value;
        }
        var ruleReasons = cleanReasons(scoreFn(text).reasons);
        var reading = verdictFor(text);
        var rulesOnly = typeof rules[text] === "number" ? rules[text] : rulesScoreOf(text, scoreFn);
        if (reading.score > rulesOnly) {
          return cleanReasons([modelReason(reading.label)].concat(ruleReasons));
        }
        return ruleReasons.length ? ruleReasons : [HOSTILE_TONE];
      }

      return {
        scoreFor: scoreFor,
        reasonFor: reasonFor,
        by: by,
        texts: asked,
        // The batch's own moves are not late catches. rerankBody hands them back
        // here, inside this closure, because this is where the list lives.
        markMoved: function (list) {
          if (!Array.isArray(list)) {
            return;
          }
          list.forEach(function (post) {
            if (post && post.id !== undefined) {
              movedIds[String(post.id)] = true;
            }
          });
        }
      };
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
            return {
              score: scored.scoreFor(text),
              reasons: typeof scored.reasonFor === "function" ? scored.reasonFor(text) : cleanReasons(score(text).reasons)
            };
          }, threshold());

          if (!result || typeof result.checked !== "number") {
            return null;
          }

          // Anything this batch already moved is not a late catch.
          if (typeof scored.markMoved === "function") {
            scored.markMoved(result.moved);
          }

          var moved = currentMode === "off" ? [] : result.moved || [];
          if (result.checked > 0) {
            if (scored.by === "rules+model") {
              modelEverUsed = true;
            }
            report({ checked: result.checked, moved: moved, mode: currentMode, by: modelEverUsed ? "rules+model" : "rules" });
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
      var record = pending[data.id];
      var incoming = data.scores || {};
      if (record.released) {
        // These arrived after the batch was drawn. They still count, in their own
        // column, so that asked equals scored plus late plus nothing.
        var lateGot = Object.keys(incoming).length;
        if (lateGot) {
          record.lateGot = (record.lateGot || 0) + lateGot;
          coverage[record.batch || "first"].late += lateGot;
        }
      }
      var incomingLabels = data.labels || {};
      Object.keys(incoming).forEach(function (text) {
        record.scores[text] = incoming[text];
      });
      Object.keys(incomingLabels).forEach(function (text) {
        record.labels[text] = incomingLabels[text];
      });

      if (record.released) {
        // This batch is already on screen. A score that arrives now can soften a
        // post in place, but it can never move one.
        if (record.onLate) {
          record.onLate({
            scores: incoming,
            labels: incomingLabels,
            model: data.model || null,
            calibration: typeof data.calibration === "number" ? data.calibration : null
          });
        }
        if (data.done) {
          delete pending[data.id];
        }
        return;
      }

      if (data.done || allScored(record)) {
        var finish = record.finish;
        delete pending[data.id];
        if (typeof finish === "function") {
          finish();
        }
      }
      return;
    }

    if (data.type === "modelWarmed") {
      if (modelWarmedAt === null) {
        modelWarmedAt = Math.round(window.performance.now());
      }
      return;
    }

    if (data.type === "modelStatus") {
      modelStatusSeen = true;
      if (data.ready && modelReadyAt === null) {
        modelReadyAt = Math.round(window.performance.now());
      }
      model.ready = !!data.ready;
      if (data.ready) {
        flushQueue();
      }
      if (data.models && typeof data.models === "object") {
        // Both models and both calibrations, so whichever answers is read on its own
        // scale.
        Object.keys(data.models).forEach(function (key) {
          var entry = data.models[key];
          if (entry && typeof entry.id === "string" && typeof entry.calibration === "number") {
            CALIBRATIONS[entry.id] = entry.calibration;
          }
        });
      }
      if (typeof data.calibration === "number" && data.calibration > 0) {
        // The model the worker says is in use, and the scale it is read at.
        MODEL_CALIBRATION = data.calibration;
      }
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

  // Ask again while there is no answer, at a human pace, for the first few tries.
  (function keepAsking(tries) {
    if (modelStatusSeen || tries >= 5) {
      return;
    }
    window.setTimeout(function () {
      askModelStatusAgain();
      keepAsking(tries + 1);
    }, 900);
  })(0);

  // For the browser checks only: how the last batch was scored, and whether the
  // settings beat the first batch.
  window.__tolstoyState = function () {
    return {
      by: lastBy,
      modelReady: model.ready,
      settingsSeen: settingsSeen,
      temperature: settings.temperature,
      blur: settings.blur,
      // What each counter counts, because they were read as contradictory when they
      // were only measuring different things:
      //   batches            every batch the interceptor handled
      //   askedBatches       batches whose texts were actually sent to the model
      //   modelBatches       batches the model answered about before they were drawn
      //   deadlineFallbacks  batches that were asked and got nothing before the deadline
      //   knownBatches       batches that needed no ask, every post already scored
      //   queuedBatches      batches asked while the model was not known to be ready
      //   flushedBatches     queued batches whose texts were sent once the model was
      //   queuedNow          batches still waiting for the model at this moment
      //
      // The invariant, which the cold-start browser test checks: every batch either
      // needed no ask, was asked, or is still waiting.
      //   batches === knownBatches + askedBatches + queuedNow
      batches: batchCount,
      modelBatches: modelBatchCount,
      askedBatches: askedBatchCount,
      deadlineFallbacks: deadlineFallbacks,
      knownBatches: batchCount - askedBatchCount,
      queuedBatches: queuedBatches,
      flushedBatches: flushedBatches,
      queuedNow: queued.length,
      flushTries: flushTries,
      fallbacks: batchCount - modelBatchCount,
      lateCaught: lateCaught,
      holdFirstMs: HOLD_FIRST_MS,
      holdScrollMs: HOLD_SCROLL_MS,
      coverage: coverage,
      modelStatusSeen: modelStatusSeen,
      modelAsks: modelAsks,
      modelReadyAt: modelReadyAt,
      modelWarmedAt: modelWarmedAt
    };
  };
})();

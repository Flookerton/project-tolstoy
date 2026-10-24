// Tolstoy background service worker.
//
// Two jobs:
//
//   1. Open the welcome page once, on the first install, and never again: not on
//      a browser restart, not on an update, not on a reload. The "onInstalled"
//      event tells us why it is running, so nothing has to be stored to remember
//      that the welcome page was already shown.
//
//   2. Carry post text from a page to the on-device model and the scores back,
//      and manage the model's one download. The worker never scores anything and
//      never holds on to post text: it passes a batch through, gets numbers back,
//      and forgets the text. The only things written down are the settings and
//      whether the model is present.
//
// The only network request this extension ever makes is the model download, and
// only after the person agrees to it. It goes to Hugging Face and nowhere else.

var MODEL_ID = "Xenova/toxic-bert";

// Two models. The small one comes inside the extension and is always there, so
// scoring needs no download and no network at all. The stronger one is a download
// the person chooses, and while it is on this computer it is the one in use.
// Calibration travels with the model because the two do not share a scale: the
// numbers below were each chosen from that model's own scores on the main eval set.
const BUNDLED_MODEL = { id: "minilm-toxic-jigsaw", label: "MiniLM", bundled: true, calibration: 0.8 };
const STRONGER_MODEL = { id: "Xenova/toxic-bert", label: "toxic-bert", bundled: false, calibration: 1 };

function modelInUse(state) {
  return state.active === "stronger" && state.stronger.status === "ready" ? STRONGER_MODEL : BUNDLED_MODEL;
}
var MODEL_REVISION = "main";
var MODEL_FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "onnx/model_quantized.onnx"
];
var CACHE_NAME = "transformers-cache";
var STATE_KEY = "tolstoyModel";
var MODEL_HOST = "https://huggingface.co/";

function modelUrl(file) {
  return MODEL_HOST + MODEL_ID + "/resolve/" + MODEL_REVISION + "/" + file;
}

// ---------------------------------------------------------------- offscreen page

var creating = null;

async function hasOffscreen() {
  if (!chrome.offscreen) {
    return false;
  }
  if (typeof chrome.offscreen.hasDocument === "function") {
    return chrome.offscreen.hasDocument();
  }
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (!chrome.offscreen) {
    return false;
  }
  if (await hasOffscreen()) {
    return true;
  }
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: "offscreen/offscreen.html",
        reasons: ["WORKERS"],
        justification: "Run the on-device model that scores posts locally."
      })
      .catch(function () {
        // Another call may have created it first.
      })
      .finally(function () {
        creating = null;
      });
  }
  await creating;
  const present = await hasOffscreen();
  if (present) {
    await waitForPage();
  }
  return present;
}

// The offscreen page is an ES module that imports the runtime, so for a moment after
// the document is created there is nothing listening: a message sent then comes back
// with no answer, and the model request looks like a failure. A ping is answered
// synchronously by the page as soon as its listener exists, so this waits for that
// instead of guessing at a delay. It costs nothing when the page is already up.
async function waitForPage(tries) {
  const attempts = typeof tries === "number" ? tries : 20;
  for (let i = 0; i < attempts; i += 1) {
    const answer = await tellOffscreen({ type: "modelPing" }, 1);
    if (answer && answer.ok) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function closeOffscreen() {
  if (!chrome.offscreen) {
    return;
  }
  try {
    if (await hasOffscreen()) {
      await chrome.offscreen.closeDocument();
    }
  } catch (error) {
    // Already closed.
  }
}

// Talking to the offscreen page costs about 200ms the first time a worker wakes
// up, and nothing after that. That is too much to pay inside a 400ms hold, so the
// channel is warmed as soon as the model is known to be present, while the person
// is still reading the page.
function warmChannel() {
  tellOffscreen({ type: "modelPing" });
}

function tellOffscreen(message, tries) {
  const attempts = typeof tries === "number" ? tries : 2;
  const payload = Object.assign({ source: "tolstoy" }, message);
  async function attempt(n) {
    try {
      const answer = await chrome.runtime.sendMessage(payload);
      if (answer !== undefined) {
        return answer;
      }
      if (n + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 120));
        return attempt(n + 1);
      }
      return { ok: false, message: "no answer from the model page" };
    } catch (error) {
      if (n + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 120));
        return attempt(n + 1);
      }
      return { ok: false, message: String((error && error.message) || error) };
    }
  }
  return attempt(0);
}

// ----------------------------------------------------------------- model state

// The stored shape is { active, stronger }: active names the model in use, and
// stronger is the state of the optional download. A value written before the small
// model was bundled is read as the stronger model's own state, so an install that
// already has the download keeps working.
function normalise(raw) {
  if (raw && raw.stronger && typeof raw.stronger === "object") {
    return { active: raw.active === "stronger" ? "stronger" : "bundled", stronger: raw.stronger };
  }
  if (raw && typeof raw.status === "string") {
    return { active: raw.status === "ready" ? "stronger" : "bundled", stronger: raw };
  }
  return { active: "bundled", stronger: { status: "absent", files: 0, bytes: 0 } };
}

async function readState() {
  const stored = await chrome.storage.local.get(STATE_KEY);
  return normalise(stored && stored[STATE_KEY]);
}

// Patches the stronger model's state. The model in use follows from it: the
// stronger model is in use exactly when it is ready here, so removing it puts the
// bundled one back without anything else having to say so.
async function writeState(patch) {
  const current = await readState();
  const stronger = Object.assign({}, current.stronger, patch);
  const next = { active: stronger.status === "ready" ? "stronger" : "bundled", stronger: stronger };
  await chrome.storage.local.set({ [STATE_KEY]: next });
  broadcast({ type: "modelChanged", ready: true, active: next.active, reason: stronger.status });
  return next;
}

function broadcast(message) {
  try {
    chrome.runtime.sendMessage(Object.assign({ source: "tolstoy" }, message)).catch(function () {
      // Nothing is listening, which is fine.
    });
  } catch (error) {
    // Nothing is listening, which is fine.
  }
}

// ------------------------------------------------------------------ the download

async function downloadModel() {
  const cache = await caches.open(CACHE_NAME);
  let bytes = 0;
  let files = 0;

  await writeState({ status: "downloading", files: 0, bytes: 0 });

  for (const file of MODEL_FILES) {
    const url = modelUrl(file);
    let response;
    try {
      response = await fetch(url, { cache: "no-store" });
    } catch (error) {
      continue;
    }
    if (!response.ok) {
      // Not every model carries every optional file.
      continue;
    }

    const total = Number(response.headers.get("content-length")) || 0;
    const reader = response.body && response.body.getReader ? response.body.getReader() : null;
    const chunks = [];

    if (reader) {
      for (;;) {
        const step = await reader.read();
        if (step.done) {
          break;
        }
        chunks.push(step.value);
        bytes += step.value.length;
        broadcast({ type: "modelProgress", file: file, bytes: bytes, total: total });
      }
    } else {
      const buffer = await response.arrayBuffer();
      chunks.push(new Uint8Array(buffer));
      bytes += buffer.byteLength;
    }

    let length = 0;
    for (const chunk of chunks) {
      length += chunk.length;
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }

    await cache.put(
      url,
      new Response(body, {
        status: 200,
        headers: {
          "content-type": response.headers.get("content-type") || "application/octet-stream",
          "content-length": String(length)
        }
      })
    );
    files += 1;
    await writeState({ status: "downloading", files: files, bytes: bytes });
  }

  if (!files) {
    return writeState({ status: "absent", files: 0, bytes: 0, error: "no files downloaded" });
  }

  // Load it once, so a broken download is found now rather than in the middle of
  // someone's feed.
  const ready = await ensureOffscreen();
  if (!ready) {
    return writeState({ status: "downloaded", files: files, bytes: bytes, error: "no offscreen document" });
  }
  const loaded = await tellOffscreen({ type: "modelLoad" });
  if (!loaded || !loaded.ok) {
    return writeState({
      status: "downloaded",
      files: files,
      bytes: bytes,
      error: (loaded && loaded.message) || "the model did not load"
    });
  }
  return writeState({ status: "ready", files: files, bytes: bytes, device: loaded.device || "wasm" });
}

async function removeModel() {
  try {
    await caches.delete(CACHE_NAME);
  } catch (error) {
    // Nothing cached.
  }
  const state = await writeState({ status: "absent", files: 0, bytes: 0 });
  await closeOffscreen();
  return state;
}

// ------------------------------------------------------------------ the warm-up

// Called as soon as an x.com tab starts, which is before X asks for its first
// timeline. It makes sure the model page exists and has run something once, so the
// first batch of the visit has a model to ask rather than a cold one.
var warming = null;

async function warmModel() {
  const state = await readState();
  const inUse = modelInUse(state);
  if (warming) {
    return warming;
  }
  const started = Date.now();
  warming = (async function () {
    const wasOpen = await hasOffscreen();
    const ready = await ensureOffscreen();
    if (!ready) {
      return { ok: false, ready: false, reason: "no offscreen document" };
    }
    const answer = await tellOffscreen({ type: "modelWarm", model: inUse });
    return {
      ok: !!(answer && answer.ok),
      ready: !!(answer && answer.ok),
      ms: Date.now() - started,
      created: !wasOpen,
      device: (answer && answer.device) || state.stronger.device || "none"
    };
  })();
  try {
    return await warming;
  } finally {
    warming = null;
  }
}

// ------------------------------------------------------------------- the scores

// Two caches, one per model, because the two do not share a scale and a score
// remembered from one is not an answer for the other.
var textCache = new Map();
var strongCache = new Map();
var TEXT_CACHE_MAX = 2000;

function cacheFor(model) {
  return model && model.id === STRONGER_MODEL.id ? strongCache : textCache;
}
// Four posts per model call, measured on this machine: one call takes about
// 120ms plus about 45ms per post on WASM, so four posts land in about 250ms,
// comfortably inside the page's 400ms hold. Eight posts take about 490ms and
// would never arrive in time, which would make the model useless.
var SCORE_GROUP = 4;
var SCORE_BUDGET_MS = 370;

function remember(text, score, label, model) {
  const cache = cacheFor(model);
  cache.set(text, { score: score, label: label || "" });
  while (cache.size > TEXT_CACHE_MAX) {
    const oldest = cache.keys().next();
    if (oldest.done) {
      break;
    }
    cache.delete(oldest.value);
  }
}

function collect(texts, model) {
  const cache = cacheFor(model);
  const scores = {};
  const labels = {};
  for (const text of texts) {
    if (cache.has(text)) {
      const held = cache.get(text);
      scores[text] = held.score;
      labels[text] = held.label || "";
    }
  }
  return { scores: scores, labels: labels };
}

function sleepUntil(deadline) {
  const left = deadline - Date.now();
  return new Promise(function (resolve) {
    setTimeout(resolve, left > 0 ? left : 0);
  });
}

// Score these texts in small groups and answer with the first group, then keep
// going in the background.
//
// The first group is what the page waits for. Four posts take about 250ms, well
// inside the page's 400ms hold, so the page gets real model scores for the first
// four posts of every batch and the rules cover the rest. The remaining groups
// are finished afterwards and remembered, so the same posts are instant when X
// serves them again, which it does constantly.
//
// A timer is kept as a safety net in case a group hangs. It is not the main path:
// Chrome clamps timers in a service worker, so it can fire later than asked. The
// page's own hold is the guarantee that nothing waits past 400ms.
// The stronger model, when the person has downloaded it, reads every batch as well.
// The small model answers inside the deadline so the batch can go out on time; these
// answers arrive afterwards, where they soften a post in place rather than moving it,
// and on a scroll batch, whose budget is longer, they often arrive in time to be used
// for the ordering itself. Nothing here waits for this: it is started after the batch
// has been answered, and its scores are pushed to the page as they come.
async function scoreWithStronger(texts, id) {
  const state = await readState();
  if (state.stronger.status !== "ready") {
    return;
  }
  const groups = [];
  for (let start = 0; start < texts.length; start += SCORE_GROUP) {
    groups.push(texts.slice(start, start + SCORE_GROUP));
  }
  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i];
    const missing = group.filter((text) => !strongCache.has(text));
    if (missing.length) {
      const answer = await tellOffscreen({ type: "modelScore", texts: missing, model: STRONGER_MODEL });
      if (!answer || !answer.ok || !answer.scores) {
        // The stronger model could not answer for this group. Stop: a page that is
        // waiting for scores it will never get is worse than a page that never asked.
        return { ok: false, message: (answer && answer.message) || "the stronger model did not answer" };
      }
      for (const text of missing) {
        remember(
          text,
          typeof answer.scores[text] === "number" ? answer.scores[text] : 0,
          (answer.labels && answer.labels[text]) || "",
          STRONGER_MODEL
        );
      }
    }
    const held = collect(group, STRONGER_MODEL);
    broadcast({
      type: "modelScores",
      id: id || null,
      model: STRONGER_MODEL.id,
      calibration: STRONGER_MODEL.calibration,
      scores: held.scores,
      labels: held.labels,
      done: i === groups.length - 1
    });
  }
  return { ok: true };
}

async function scoreTexts(texts, budgetMs, id) {
  const wanted = [];
  for (const text of texts) {
    if (typeof text !== "string" || !text) {
      continue;
    }
    if (wanted.indexOf(text) === -1) {
      wanted.push(text);
    }
  }

  const missing = wanted.filter(function (text) {
    return !textCache.has(text);
  });
  if (!missing.length) {
    const held = collect(wanted);
    return { ok: true, scores: held.scores, labels: held.labels, modelled: 0, asked: wanted.length };
  }

  const ready = await ensureOffscreen();
  if (!ready) {
    const held = collect(wanted);
    return { ok: false, message: "no offscreen document", scores: held.scores, labels: held.labels };
  }

  warmChannel();

  const budget = typeof budgetMs === "number" && budgetMs > 0 ? budgetMs : SCORE_BUDGET_MS;
  const deadline = Date.now() + budget;
  let modelled = 0;

  async function scoreGroup(group) {
    const state = await readState();
    const answer = await tellOffscreen({ type: "modelScore", texts: group, model: modelInUse(state) });
    if (!answer || !answer.ok || !answer.scores) {
      return false;
    }
    for (const text of group) {
      remember(
        text,
        typeof answer.scores[text] === "number" ? answer.scores[text] : 0,
        (answer.labels && answer.labels[text]) || ""
      );
    }
    modelled += group.length;
    return true;
  }

  const firstGroup = missing.slice(0, SCORE_GROUP);
  let answered = false;

  const first = scoreGroup(firstGroup).then(function (ok) {
    answered = ok;
    return ok;
  });

  const guard = sleepUntil(deadline).then(function () {
    return false;
  });

  await Promise.race([first, guard]);

  // The batch has been answered. Anything the small model could not finish, and the
  // whole batch for the stronger model if it is here, carries on in the background.
  scoreWithStronger(wanted, id).catch(function () {
    // Nothing to do about it: the page has its answer and the rules carry the rest.
  });

  const held = collect(wanted);
  const reply = {
    ok: true,
    scores: held.scores,
    labels: held.labels,
    model: BUNDLED_MODEL.id,
    calibration: BUNDLED_MODEL.calibration,
    modelled: modelled,
    asked: wanted.length,
    partial: Object.keys(held.scores).length < wanted.length
  };

  // The rest, after the page has its answer. Nothing waits on this.
  const rest = missing.slice(SCORE_GROUP);
  if (rest.length) {
    (async function () {
      for (let start = 0; start < rest.length; start += SCORE_GROUP) {
        const ok = await scoreGroup(rest.slice(start, start + SCORE_GROUP));
        if (!ok) {
          break;
        }
      }
    })();
  }

  return reply;
}

// -------------------------------------------------------------------- messages

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || message.source !== "tolstoy") {
    return false;
  }

  if (message.type === "modelStatus") {
    readState().then(function (state) {
      if (state.stronger.status === "ready") {
        warmChannel();
      }
      const inUse = modelInUse(state);
      sendResponse({
        // A model is always here now, so this is always true. What varies is which
        // one, and how its score is read.
        ready: true,
        active: inUse.bundled ? "bundled" : "stronger",
        model: inUse.id,
        calibration: inUse.calibration,
        // Both models, with the calibration each is read at, so the page can use
        // whichever answers without assuming a scale.
        models: {
          bundled: { id: BUNDLED_MODEL.id, calibration: BUNDLED_MODEL.calibration },
          stronger: {
            id: STRONGER_MODEL.id,
            calibration: STRONGER_MODEL.calibration,
            ready: state.stronger.status === "ready"
          }
        },
        reason: state.stronger.status,
        stronger: state.stronger,
        bytes: state.stronger.bytes || 0,
        files: state.stronger.files || 0,
        device: state.stronger.device || null
      });
    });
    return true;
  }

  if (message.type === "modelDownload") {
    downloadModel()
      .then(function (state) {
        sendResponse({ ok: state.status === "ready", state: state });
      })
      .catch(function (error) {
        sendResponse({ ok: false, state: { status: "absent" }, message: String((error && error.message) || error) });
      });
    return true;
  }

  if (message.type === "modelRemove") {
    removeModel()
      .then(function (state) {
        sendResponse({ ok: true, state: state });
      })
      .catch(function (error) {
        sendResponse({ ok: false, message: String((error && error.message) || error) });
      });
    return true;
  }

  if (message.type === "modelLoad") {
    readState()
      .then(function (state) {
        return ensureOffscreen().then(function (ready) {
          if (!ready) {
            throw new Error("no offscreen document");
          }
          return tellOffscreen({ type: "modelLoad", model: modelInUse(state) });
        });
      })
      .then(function (answer) {
        sendResponse(answer || { ok: false });
      })
      .catch(function (error) {
        sendResponse({ ok: false, message: String((error && error.message) || error) });
      });
    return true;
  }

  if (message.type === "warm") {
    warmModel()
      .then(function (result) {
        sendResponse(result);
      })
      .catch(function (error) {
        sendResponse({ ok: false, ready: false, message: String((error && error.message) || error) });
      });
    return true;
  }

  if (message.type === "score") {
    // No readiness check: the bundled model is always here. The offscreen page
    // reports if it cannot load, and a failed stronger model falls back to it.
    readState()
      .then(function () {
        return scoreTexts(Array.isArray(message.texts) ? message.texts : [], message.budgetMs, message.id);
      })
      .then(function (result) {
        if (result !== null) {
          sendResponse(result || { ok: false, scores: {} });
        }
      })
      .catch(function (error) {
        sendResponse({ ok: false, message: String((error && error.message) || error), scores: {} });
      });
    return true;
  }

  if (message.type === "modelState") {
    // From the offscreen page, telling us how a load went.
    if (message.state && message.state.status === "failed") {
      readState().then(function (state) {
        if (state.status === "ready") {
          writeState(Object.assign({}, state, { status: "downloaded", error: message.state.message }));
        }
      });
    }
    return false;
  }

  if (message.type === "settingsChanged") {
    broadcast({ type: "settingsChanged" });
    return false;
  }

  return false;
});

// The model page can be closed by Chrome at any time. There is nothing to clean
// up: the next score request creates it again.
chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome/welcome.html") });
  }
  // Just installed or just updated: get the model page up, if the model is there.
  warmModel();
});

// A browser start is the one moment the model page is definitely gone, because
// nothing survives a restart. Recreating it here, rather than waiting for the first
// x.com tab to ask, is what lets the first timeline of the session be scored by the
// model instead of by the rules alone. The page then stays alive across tabs until
// the model is removed.
chrome.runtime.onStartup.addListener(function () {
  warmModel();
});

// And warm the model whenever this worker starts at all, which is the case that
// actually decides it: the worker starts when the extension loads, when the browser
// starts, and when the first message wakes it after Chrome has put it to sleep. It
// starts well before anyone opens a timeline. Loading the model from the extension's
// own files takes about 850ms, which is longer than the 400ms a first timeline waits,
// so the only way the first screen of a visit can be model-scored is for the model to
// be loaded before that visit begins. Nothing here waits for the result, and if it
// fails the rules carry the page exactly as they always have.
warmModel();

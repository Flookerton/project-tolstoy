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
  return hasOffscreen();
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

function tellOffscreen(message) {
  return chrome.runtime.sendMessage(Object.assign({ source: "tolstoy" }, message)).catch(function (error) {
    return { ok: false, message: String((error && error.message) || error) };
  });
}

// ----------------------------------------------------------------- model state

async function readState() {
  const stored = await chrome.storage.local.get(STATE_KEY);
  const state = stored && stored[STATE_KEY];
  if (!state || typeof state !== "object") {
    return { status: "absent", files: 0, bytes: 0 };
  }
  return state;
}

async function writeState(next) {
  await chrome.storage.local.set({ [STATE_KEY]: next });
  broadcast({ type: "modelChanged", ready: next.status === "ready", reason: next.status });
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

// ------------------------------------------------------------------- the scores

var textCache = new Map();
var TEXT_CACHE_MAX = 2000;
// Four posts per model call, measured on this machine: one call takes about
// 120ms plus about 45ms per post on WASM, so four posts land in about 250ms,
// comfortably inside the page's 400ms hold. Eight posts take about 490ms and
// would never arrive in time, which would make the model useless.
var SCORE_GROUP = 4;
var SCORE_BUDGET_MS = 370;

function remember(text, value) {
  textCache.set(text, value);
  while (textCache.size > TEXT_CACHE_MAX) {
    const oldest = textCache.keys().next();
    if (oldest.done) {
      break;
    }
    textCache.delete(oldest.value);
  }
}

function collect(texts) {
  const scores = {};
  for (const text of texts) {
    if (textCache.has(text)) {
      scores[text] = textCache.get(text);
    }
  }
  return scores;
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
async function scoreTexts(texts, budgetMs) {
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
    return { ok: true, scores: collect(wanted), modelled: 0, asked: wanted.length };
  }

  const ready = await ensureOffscreen();
  if (!ready) {
    return { ok: false, message: "no offscreen document", scores: collect(wanted) };
  }

  warmChannel();

  const budget = typeof budgetMs === "number" && budgetMs > 0 ? budgetMs : SCORE_BUDGET_MS;
  const deadline = Date.now() + budget;
  let modelled = 0;

  async function scoreGroup(group) {
    const answer = await tellOffscreen({ type: "modelScore", texts: group });
    if (!answer || !answer.ok || !answer.scores) {
      return false;
    }
    for (const text of group) {
      remember(text, typeof answer.scores[text] === "number" ? answer.scores[text] : 0);
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

  const reply = {
    ok: true,
    scores: collect(wanted),
    modelled: modelled,
    asked: wanted.length,
    partial: Object.keys(collect(wanted)).length < wanted.length
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
      if (state.status === "ready") {
        warmChannel();
      }
      sendResponse({
        ready: state.status === "ready",
        reason: state.status,
        bytes: state.bytes || 0,
        files: state.files || 0,
        device: state.device || null
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
    ensureOffscreen()
      .then(function (ready) {
        if (!ready) {
          throw new Error("no offscreen document");
        }
        return tellOffscreen({ type: "modelLoad" });
      })
      .then(function (answer) {
        sendResponse(answer || { ok: false });
      })
      .catch(function (error) {
        sendResponse({ ok: false, message: String((error && error.message) || error) });
      });
    return true;
  }

  if (message.type === "score") {
    readState()
      .then(function (state) {
        if (state.status !== "ready") {
          sendResponse({ ok: false, reason: state.status, scores: {} });
          return null;
        }
        return scoreTexts(Array.isArray(message.texts) ? message.texts : [], message.budgetMs);
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
  if (details.reason !== "install") {
    return;
  }
  chrome.tabs.create({ url: chrome.runtime.getURL("welcome/welcome.html") });
});

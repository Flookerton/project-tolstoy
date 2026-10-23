// The on-device model, in an offscreen document.
//
// Why an offscreen document rather than the service worker: the model is about
// 110 MB and takes seconds to load, and a service worker is stopped whenever
// Chrome decides it has been idle, which would throw the loaded model away
// between batches. An extension page keeps it warm for as long as the page is
// open, it can use WASM and WebGPU, and the service worker can close it again
// when nobody needs it. The worker creates this page on demand and recreates it
// if the browser closes it.
//
// What it does: takes a list of post texts, returns one score per text, using
// only the labels insult, threat, identity_hate and severe_toxic. toxic and
// obscene are deliberately ignored, so swearing alone never moves a post.
//
// Nothing here is written to disk, nothing is logged, and nothing is sent
// anywhere. The text it is given lives in a local array for one call and is
// dropped afterwards.

import { env, pipeline } from "../vendor/transformers/transformers.js";

const MODEL_ID = "Xenova/toxic-bert";
const WANTED_LABELS = ["insult", "threat", "identity_hate", "severe_toxic"];

// The model is fetched once, with the person's consent, by the service worker,
// and lands in the browser's own cache. From then on this page reads it from
// there. Remote models are off, which means the library throws on a cache miss
// instead of reaching for the network: it cannot fetch anything, even by
// accident. Local models stay on because that is the switch that lets the
// library consult the cache at all. The local path points at the vendor folder,
// which holds no model files at all.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = chrome.runtime.getURL("vendor/");
env.useBrowserCache = true;
env.cacheKey = "transformers-cache";
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("vendor/transformers/");
// An offscreen document is not cross-origin isolated, so threads are not
// available and asking for them only produces warnings.
env.backends.onnx.wasm.numThreads = 1;

let classifier = null;
let loading = null;
let device = "none";
let failure = "";

function report(state) {
  try {
    chrome.runtime.sendMessage({ source: "tolstoy", type: "modelState", state: state });
  } catch (error) {
    // The worker will ask again if it needs to.
  }
}

async function load() {
  if (classifier) {
    return classifier;
  }
  if (loading) {
    return loading;
  }
  loading = (async () => {
    // WASM first, then WebGPU. That is the opposite of the usual advice, and it
    // is what the numbers on this machine say: the model is asked for small
    // groups under a 400ms deadline, and WebGPU spends about 250ms per call
    // getting set up, whatever the size of the group, while WASM spends about
    // 85ms and then roughly 30ms per post. Twenty posts take about 1.3 seconds on
    // WASM and about 1.8 seconds on WebGPU, and a two-post group takes 150ms on
    // WASM against 340ms on WebGPU. WebGPU stays as the fallback for machines
    // without WASM SIMD.
    const attempts = ["wasm"];
    if (typeof navigator !== "undefined" && navigator.gpu) {
      attempts.push("webgpu");
    }

    for (const candidate of attempts) {
      try {
        classifier = await pipeline("text-classification", MODEL_ID, { dtype: "q8", device: candidate });
        device = candidate;
        failure = "";
        report({ status: "ready", device: device });
        return classifier;
      } catch (error) {
        failure = String((error && error.message) || error).slice(0, 200);
        report({ status: "failed", device: candidate, message: failure });
      }
    }
    loading = null;
    throw new Error(failure || "the model could not be loaded");
  })();
  return loading;
}

// Posts are scored in small groups in one model call rather than one at a time.
// The model was trained on single sentences, but the runtime pads a group and
// runs it as one batch, which is several times faster than the same posts one
// after another, and the numbers come out the same. Groups are kept small so a
// batch of replies still returns promptly.
const GROUP = 8;

async function scoreTexts(texts) {
  const model = await load();
  const scores = {};
  // The label that produced the score, so the page can say why the model moved a
  // post instead of showing a bare number or, worse, the word "undefined".
  const labels = {};
  const clean = texts.map(function (text) {
    return typeof text === "string" && text.trim() ? text : " ";
  });

  for (let start = 0; start < clean.length; start += GROUP) {
    const part = clean.slice(start, start + GROUP);
    let flat = [];
    try {
      const output = await model(part, { top_k: null });
      flat = Array.isArray(output) ? output.flat() : [output];
    } catch (error) {
      flat = [];
    }

    // Every text contributes the same number of label rows, in order.
    const per = part.length ? Math.max(1, Math.round(flat.length / part.length)) : 1;
    part.forEach(function (text, index) {
      let best = 0;
      let bestLabel = "";
      for (let k = index * per; k < (index + 1) * per; k += 1) {
        const row = flat[k];
        if (row && WANTED_LABELS.indexOf(row.label) !== -1 && typeof row.score === "number" && row.score > best) {
          best = row.score;
          bestLabel = row.label;
        }
      }
      scores[text] = best;
      labels[text] = bestLabel;
    });
  }

  // Answered under the text the caller sent, not under a padded copy of it.
  const answer = { scores: {}, labels: {} };
  texts.forEach(function (text, index) {
    const usable = typeof text === "string" && text;
    answer.scores[text] = usable ? scores[clean[index]] || 0 : 0;
    answer.labels[text] = usable ? labels[clean[index]] || "" : "";
  });
  return answer;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // A no-op the worker sends to keep the channel to this page warm. It costs
  // nothing and saves about 200ms on the first real request after a worker start.
  if (message && message.type === "modelPing") {
    sendResponse({ ok: true, status: "page" });
    return false;
  }

  if (!message || message.source !== "tolstoy") {
    return false;
  }
  if (message.type === "modelLoad") {
    load()
      .then(() => sendResponse({ ok: true, device: device }))
      .catch((error) => sendResponse({ ok: false, message: String((error && error.message) || error) }));
    return true;
  }
  if (message.type === "modelScore") {
    scoreTexts(Array.isArray(message.texts) ? message.texts : [])
      .then((result) => sendResponse({ ok: true, scores: result.scores, labels: result.labels, device }))
      .catch((error) => sendResponse({ ok: false, message: String((error && error.message) || error) }));
    return true;
  }
  if (message.type === "modelDevice") {
    sendResponse({ device, ready: !!classifier, failure });
    return false;
  }
  return false;
});

// Tell the worker this page is up, without loading anything yet.
report({ status: "page", device: "none" });

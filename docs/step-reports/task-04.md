# Task 4 step report

From the builder to the orchestrator. Covers Task 4 and the addendum, in the order the
addendum asked for. Where something is not verified, it says so plainly.

Commits, in order, on `main`:

| Commit | What |
| --- | --- |
| `c11e702` | The fixture page learns to draw a thread |
| `034b3bd` | Part A: read replies, the slur rule, and the scorer handoff fix |
| `c66fd84` | Parts C and D: the optional on-device model, and the panel around it |
| `fe136fa` | Addendum: calibration from measured scores, and the deadline in the page |
| this one | This report |

## 1. Part A's check: reply pages are read and scored

**Passing, 14 checks of 14.** `tolstoy-tools/check-reply-page.mjs` loads the extension in
Chromium, serves `tests/fixtures/tweet-detail.json` on the x.com origin, opens the fixture page
with `?detail=1`, and checks the whole path:

- the focal post is drawn first, and the thread above it is still there, unmoved by the scorer;
- every reply is still on the page, and the heated replies sit after the calm ones in their run
  (heated at positions 5, 6, 8 after calm at 1, 2, 3, 4);
- the batch is scored and reported (`checked 7, moved 3`);
- the banner names them: "3 heated posts moved down.";
- the focal post is still first after scrolling;
- the model downloads from the panel, the panel settles on "On this computer" with a Remove
  link, the footer of "Show them" says how the batch was scored, each row carries a reason, and
  Remove puts the panel back to the offer;
- no request left for anything but x.com and Hugging Face.

The fixture page gained a `TweetDetail` branch: it reads
`data.threaded_conversation_with_injections_v2.instructions`, draws the `TimelinePinEntry` (the
focal post) first, then the replies, expanding the conversation module into the posts X would
draw, and drawing nothing twice. Written up in `docs/research-notes.md` section 5, labelled
unverified against a live payload.

## 2. The calibration, redone

The short version is in `docs/model-and-calibration.md`. The shape of it:

- **The spike was right and I was wrong.** I had called it suspect because it scored "Cull them
  all before this gets worse" at 0.015 while the extension scored slurs at 0.88. Those are
  different posts. Run side by side, Node and the browser agree to four decimals: `faggot`
  0.8818 both, "I hope your house burns down" 0.8817 against 0.8820, "This sauce is fucking
  incredible" 0.0974 against 0.1012. There was no label mix-up and the model was running. The
  spike has been deleted anyway, superseded by the measured file.
- `tests/fixtures/model-scores-main.json` now holds the raw label scores for all 153 posts of
  the main eval set, measured by the real model in Chromium through the shipped vendored
  runtime, with the model id, the byte size, and the **sha256 of the model file itself**
  (`620012c9bed13e3c58b9c959d160d955ff033a1a27528212b9da5b0aa4ac3f73`).
- **The calibration is 1**, chosen from that file only. It is the largest value that still meets
  both bars: Balanced 1 calm moved and 95 percent of heated caught, Calm 2 calm and 98 percent.
  At 1.2 the Balanced bar breaks.

### The held-out set, run once, not tuned on

| Temperature | Calm flagged | Heated caught |
| --- | --- | --- |
| Balanced (0.5) | 0 rules, 0 with the model, of 16 | 1 rules, **9 with the model**, of 16 |
| Calm (0.45) | 0 rules, 1 with the model, of 16 | 1 rules, **10 with the model**, of 16 |

**The heated bars are missed.** The target was at least 12 of 16 at Balanced; the model gets 9,
up from 1 with the rules alone. Seven are still missed, and the model scores them near zero:
H2 0.007, H7 0.265, H8 0.001, H11 0.036, H12 0.006, H14 0.086, H16 0.477. Raising the
calibration far enough to reach them moves calm posts and breaks the main-set bar. This
calibration was not adjusted to improve these numbers. The one-word slur, H10, is caught, by the
slur rule at 0.90.

## 3. The speed rulings

**a. A smaller model.** Searched, and **none was found that is ready to use**, so `Xenova/toxic-bert`
stays, as the addendum allows. The candidates and why each fell through:

| Model | Params | Licence | Why not |
| --- | --- | --- | --- |
| `minuva/MiniLMv2-toxic-jigsaw` | 22.7M | Apache-2.0 | Closest fit, but its ONNX is `model_optimized.onnx` at the repo root, with no `onnx/` folder and no matching config/tokenizer layout, so Transformers.js's loader cannot find it. Making it work would mean vendoring a file under a name its own repo does not use. |
| `unitary/toxic-bert`, `unitary/unbiased-toxic-roberta`, `martin-ha/toxic-comment-model`, `s-nlp/roberta_toxicity_classifier` | 110M to 125M | mixed | Over the 30M cap. |
| `cointegrated/rubert-tiny-toxicity`, `BunnyNoBugs/rubert-tiny2-russe-toxicity`, other `tiny` ones | about 29M | mixed | Russian, not English. |
| `citizenlab/…-multilingual-cased-toxicity`, `ml6team/distilbert-…`, `EIStakovskii/…` | 67M and up | mixed | Over the cap, and mostly non-English. |

Note that `Xenova/toxic-bert` is itself about 110M parameters, so the model in use is over the
cap too. The ruling anticipated that; if a small English classifier ships with a proper
`onnx/model_quantized.onnx`, swapping it in is a change to `MODEL_ID`, `MODEL_FILES` and the
calibration, and the measurement scripts are already in place to redo the table.

**b, c. The deadline is in the page, with two budgets.** Done in `fe136fa`. `intercept.js` owns
both clocks and sets the batch deadline itself: 320ms of model time for the first batch of a
page load, 1400ms for later batches, sized so a batch is back in about 400ms including the
rerank (a run with a 400ms model budget came back at 489ms end to end, which is why the budget
is 320ms and not 400ms). The bridge in `settings.js` asks the worker four posts at a time and
streams each group's scores to the page as they arrive, so the page reranks with whatever has
arrived.

**d. Late catches.** Implemented: `intercept.js` keeps the batch record open after release, and
a score that arrives later and lifts a post over the line is posted as a late catch. `veil.js`
softens that post where it stands, in move mode as well as blur mode, and never moves it, and
the banner adds "N softened after a closer look." **Not yet demonstrated on the fixture**: the
run that was meant to show it produced no late catches, and the reason is the same one below.

**e. Coverage.** Not measured yet. The harness that was meant to produce it reported
`coverage: {first: {asked: 18, scored: 0}, scroll: {asked: 0, scored: 0}}` while also reporting
41 batches, which is self-contradictory: the two counters are incremented on the same line. That
is a defect in my harness or in the counter, and it has to be understood before any coverage
number is quoted. **No coverage figure is claimed here.**

## 4. The three defects worth your attention

Checking the addendum turned up three real bugs, all now fixed and committed in `fe136fa`. The
first is the important one.

1. **The bridge had never talked to the worker.** `settings.js` sent `{type: "modelStatus"}` and
   `{type: "score"}`, and the worker ignores any message without `source: "tolstoy"`. So in a
   real page the extension never learned whether the model was present and never received a
   single score, while every direct harness call worked because the harnesses tagged their
   messages. **The on-device model has not actually scored anything in a page until this
   commit.** This is very likely what the owner saw as "the rules miss real hostility": the
   model was never in the loop.
2. **The scorer handoff was rejected.** `intercept.js` validated `window.TolstoyScore` as if it
   were the scoring function, but `score.js` publishes the API object. Every batch was rejected
   and nothing was scored at all, on the home timeline as well as reply pages. Fixed in
   `034b3bd`. This is why the home-timeline browser check's "4 heated posts moved down" was
   missing.
3. **Every batch threw.** The bookkeeping for a batch's own moved ids was added to `rerankBody`,
   where that list does not exist, so the promise caught a `ReferenceError` and handed X back its
   own order. Fixed in `fe136fa`.

Also fixed: reading the response body to score it left the page holding a consumed stream, so the
page's own `.text()` threw ("body stream already read"); the wrapper now always returns a fresh
response with the same bytes.

## 5. Done-when items from Task 4 and the addendum

| Item | State |
| --- | --- |
| Reply pages scored, focal and thread untouched, heated moved or veiled | **Verified**, 14 of 14 |
| Main eval bars reported and passing | **Verified**, calibration 1.0 |
| Held-out numbers reported once, untuned | **Verified**, reported above, heated bars missed |
| Calibration comes from `model-scores-main.json` | **Verified** |
| Model comparison table | **Reported**; no compliant small model found, toxic-bert stays |
| Coverage numbers | **Not measured**, counter anomaly described above |
| Late catch shown working on the fixture | **Not demonstrated** |
| Speed: median and slowest 20-post batch, WASM and WebGPU | **Measured**: 1.27s WASM, 1.8s WebGPU for 20 posts; 20 posts in one call, warm. Under the new budget the page sees the first group of four |
| 400ms fallback rate across 50 batches | **Not measured** in the current code. The old number (50 of 50) was taken before the bridge bug was fixed and before the deadline moved into the page, so it means nothing now |
| No install warning with the new permission and the CSP | **Not re-checked** this round. The `offscreen` permission and the CSP bytecode policy are new since Task 3's check |
| Network: nothing before consent, only Hugging Face during, nothing after | **Verified**: 0 before, `huggingface.co` and `us.aws.cdn.hf.co` during the download, 0 while scoring |
| Remove deletes the files and returns the panel to the offer | **Verified** |
| Panel matches mockup 3 and fits 380x640, fresh side-by-side | **Not re-checked** this round, though the panel did change |
| All earlier tests pass | **Verified**, 39 node tests |
| New XHR and fetch timing cases | **Not written** |

## 6. Live check steps for the owner

1. Open a post with replies and scroll the replies. The focal post and the thread above it should
   stay put, heated replies should move down, and "Show them" should list them with reasons.
2. Download the model from the panel. The panel should show a progress bar, then "On this
   computer" with a Remove link.
3. Check the line at the bottom of "Show them". It should say "Scored by: rules" or "Scored by:
   rules and the on-device model". If it says "rules" while the model is downloaded, that is a
   bug and worth reporting.
4. If a post is softened after the batch has already appeared, the banner should add "N softened
   after a closer look." and nothing should jump position. This path is built but not yet
   shown working, so it is worth watching.

## 7. What I would do next, in order

1. Find the coverage-counter contradiction and get real coverage numbers, then re-run the
   50-batch fallback rate. Everything about the speed rulings depends on these.
2. Demonstrate a late catch on the fixture, with the model, deterministically.
3. Re-check the install warning and the panel's fit, both of which changed this round.
4. Write the XHR and fetch timing cases (model answers quickly; model never answers).
5. Consider a second pass at the held-out misses. Seven of sixteen is the honest number, and the
   pattern in them (threats phrased as wishes, "vermin and should be treated like it") suggests a
   rule for indirect dehumanizing language would do more than a better model would.

# The on-device model, and how its calibration was chosen

Written for Task 4, after the orchestrator's addendum. Everything here is measured, not
estimated, and the commands that produced it are in `tolstoy-tools/` (outside this repo,
because they need Playwright).

## The model

| | |
| --- | --- |
| Model | `Xenova/toxic-bert`, revision `main` |
| File | `onnx/model_quantized.onnx`, quantized (`dtype: "q8"`) |
| Size | 110,720,344 bytes (about 106 MB) |
| sha256 of the model file | `620012c9bed13e3c58b9c959d160d955ff033a1a27528212b9da5b0aa4ac3f73` |
| Runtime | the extension's own vendored Transformers.js, in an offscreen document |
| Backend | WASM first, WebGPU as the fallback (see below) |
| Labels kept | `insult`, `threat`, `identity_hate`, `severe_toxic` |
| Labels ignored | `toxic`, `obscene`, so swearing alone never moves a post |

The hash is of the bytes actually used: it is read back out of the browser cache and digested in
the page, not copied from a download page.

## How the calibration was chosen

`tests/fixtures/model-scores-main.json` holds the raw label scores for every post in the main
eval set, measured by this model in this browser, with the model id and the file hash recorded
inside it. It has 153 rows: the 129 eval items plus the 6 viewpoint-neutrality pairs.

The shipped blend is `final = max(rules, model * calibration)`, and a post moves when
`final >= threshold`. A **higher** calibration makes the model more sensitive, so the useful
value is the largest one that still keeps calm posts in place.

| Calibration | Balanced: calm moved / heated caught | Calm: calm moved / heated caught |
| --- | --- | --- |
| 0.2 to 0.6 | 0 / 62 of 66 (94%) | 0 / 64 of 66 (97%) |
| 0.8 | 1 / 62 of 66 (94%) | 1 / 64 of 66 (97%) |
| **1.0** | **1 / 63 of 66 (95%)** | **2 / 65 of 66 (98%)** |
| 1.2 | 2 / 63 of 66 (95%) | 2 / 65 of 66 (98%) |
| 1.8 | 3 / 63 of 66 (95%) | 3 / 65 of 66 (98%) |

**Chosen: 1.0.** It is the largest value that meets both bars, and it is the model's own natural
boundary (0.5) with no shift at all. At 1.2 the Balanced bar breaks.

What 1.0 buys and costs on the main set:

- It rescues **one** hostile post the rules alone miss: "So funny this toothless crackhead
  consistently reaches out to people in my circle… Never change bozo", which the live check
  flagged. Model 0.561, rules 0.00.
- It costs **one** calm post: "I am going to kill this boss fight tonight if it takes all
  evening", a gaming idiom. Model 0.710.

That is the honest size of the model's contribution on this eval set: one post either way. The
rules already catch the clear cases, including every slur in the set, so the model's marginal
value here is small. Its real value shows on the held-out set below, where the rules catch one
of sixteen.

## The held-out set, run once, not tuned on

`tests/fixtures/heldout-set.json` was written by the orchestrator before the rules or the
calibration were touched. It is reported as it came out, at calibration 1.0.

| Temperature | Calm posts flagged | Heated posts caught |
| --- | --- | --- |
| Balanced (0.5) | 0 of 16, rules alone and with the model | 1 of 16 rules alone, **9 of 16** with the model |
| Calm (0.45) | 0 rules, **1** with the model, of 16 | 1 of 16 rules alone, **10 of 16** with the model |

**The held-out targets are not met.** The task asked for at most 1 calm post flagged and at
least 12 of 16 heated caught at Balanced. Calm is fine at 0, and the model lifts recall from 1
to 9, but 9 is short of 12. At Calm the bar of 95 percent is further away still.

The seven the model also misses, with their model scores:

| # | Post | Model |
| --- | --- | --- |
| H2 | Someone needs to put him in the ground | 0.007 |
| H7 | these freaks should be locked up and the key thrown away | 0.265 |
| H8 | People who vote like that are vermin and should be treated like it | 0.001 |
| H11 | Go back to whatever hole you crawled out of | 0.036 |
| H12 | Nobody would miss you if you disappeared | 0.006 |
| H14 | You people make me sick, every last one of you | 0.086 |
| H16 | Delete your account, you absolute waste of oxygen | 0.477 |

Two of those are close (H7 at 0.265, H16 at 0.477) and the rest are not close at all. Several are
threats phrased as wishes or instructions rather than as slurs or name-calling, which is a
pattern this model does not read as hostility. Raising the calibration far enough to catch them
starts moving calm posts: at 1.2 a second calm post moves at Balanced and the main eval bar
breaks.

This calibration was **not** adjusted to improve these numbers. The set exists to be reported,
not tuned on.

## A correction to an earlier claim

An earlier report called `model-spike.json` suspect, on the grounds that it scored "Cull them
all before this gets worse" at 0.015 while the extension scored slurs at 0.88. **That was my
error, not the spike's.** The two numbers are for different posts. Checked directly, the Node
path and the browser path agree to four decimals on the same text:

| Post | Node, max of the four kept labels | In the extension |
| --- | --- | --- |
| `faggot` | 0.8818 | 0.8818 |
| I hope your house burns down | 0.8817 | 0.8820 |
| This sauce is fucking incredible, I am making it every week | 0.0974 | 0.1012 |
| Cull them all before this gets worse | 0.0147 | not measured |

There was no label-index mix-up and the model was running. "Cull them all" really does score
0.0147 across the four kept labels, because the model reads it as `toxic` (0.394) and `toxic` is
one of the two labels we deliberately ignore. The spike has been deleted anyway: its numbers are
superseded by `model-scores-main.json`, which is measured through the shipped path and records
its own provenance.

## Why WASM is tried before WebGPU

The usual advice is the other way round, and on this machine the numbers say to ignore it. The
model is asked for small groups under a deadline, and WebGPU spends about 250ms per call on
setup whatever the size of the group, while WASM spends about 85ms and then roughly 30ms per
post.

| Posts in one call | WASM | WebGPU |
| --- | --- | --- |
| 1 | 90ms warm | 290ms warm |
| 4 | 260ms | 450ms |
| 8 | 500ms | 730ms |
| 20 | 1.27s | 1.8s |

WebGPU remains the fallback for machines without WASM SIMD.

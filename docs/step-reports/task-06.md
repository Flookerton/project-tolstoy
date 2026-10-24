# Task 6: Cold start, both models, and a popup that fits

Builder: Hermes Agent. Repo: `Flookerton/project-tolstoy`, branch `main`.
One commit per part. Every number is from a run on this machine, and the script that
produced it is named so it can be run again.

## Commits

| Part | Commit | What it is |
| --- | --- | --- |
| A | `645fcd4` | Never drop an ask: a queue, a status that heals, and counters that agree |
| B | `f22bfca` | Both models: the small one inside the deadline, the stronger one behind it |
| C | `8e06475` | The panel fits 380 x 600 |

Parts A and B share `intercept.js`, and B and C share the two panel files, so each commit
says which of the other part's changes it carries. Nothing was split by hand across a
file, because a file whose history is rewritten to look tidy is worse than a commit
message that says what is in it.

## Part A: never drop an ask

### The cause, in one paragraph

A batch was dropped, not queued, whenever the page had heard a status and that status
said the model was not there: `askModel` returned "no scores" and sent nothing, and
because the status re-ask condition was "have we heard anything at all", a single early
answer of "not there", which is what a half-woken service worker looks like from a page,
was believed for the whole visit. Nothing was ever asked, so nothing could arrive late,
and the posts on the first screen were never looked at again. That is one path to the
numbers you saw, and it is the path your own reading named: `askedBatches: 1` with
`modelAsks: 0` and `lateCaught: 0` is exactly what it produces, because `coverage.asked`
counts the texts the page meant to ask about, `askedBatches` counts the batch, and
neither of them means a request went out. `deadlineFallbacks` was also counting that
batch as a deadline that fell through, which it was not: no deadline was ever reached
because no ask was ever made.

I could not reproduce your trigger. In my cold-start runs the late catch did happen, 3 of
the 5 AI-only posts softened at about 800ms with the model's own reasons. What I found
instead was the path that produced it, plus two smaller faults in the same area: the
footer credited the rules while the model was doing the softening, and the counters could
not be reconciled with each other.

### What changed

* **A batch asked about while the model is not known to be ready is queued**, with the
  kind of batch it was, and an ask that is already past its deadline is sent for it the
  moment the model answers, or on a timer if the status is what is wrong. The page is
  never held waiting for this; the batch goes out on time as it always did.
* **The status heals.** It is asked again whenever the answer is not "ready", not only
  when there has been no answer, so one wrong early answer cannot silence the model for a
  visit.
* **The late catch credits the model.** The late-catch report carries the credit and the
  banner takes it, so the footer reads "Scored by: rules and the on-device model" when the
  model is what softened posts. Before this the page credited the rules while the model
  worked in front of the person.
* **The counters count one thing each**, and the state says what:

  | Counter | What it counts |
  | --- | --- |
  | `batches` | every batch the interceptor handled |
  | `knownBatches` | batches that needed no ask, every post already scored |
  | `askedBatches` | batches whose texts were sent to the model, at once or after flushing |
  | `queuedBatches` | batches asked while the model was not known to be ready |
  | `flushedBatches` | queued batches whose texts were actually sent afterwards |
  | `queuedNow` | batches still waiting for the model at this moment |
  | `deadlineFallbacks` | batches that were asked and got nothing before the deadline |
  | `modelBatches` | batches the model answered about before they were drawn |
  | `modelAsks` | times the page asked the worker for a status because it had none |

  with one invariant, which the test checks: every batch either needed no ask, was asked,
  or is still waiting. `batches === knownBatches + askedBatches + queuedNow`.

### The cold-start browser test

`tests/browser/cold-start.mjs`, a fresh profile each time, first load, no waiting for the
model before navigating, and nothing asking the model anything before the run is over
because asking would warm it and there would be no cold start left to test. Which of the
five the model calls hostile is settled afterwards, from the model itself. It replaced an
earlier version of the same file which did ask first and therefore tested nothing.

| Case | Result |
| --- | --- |
| Straight in, nothing warmed | the model calls 3 of the 5 hostile; all 3 softened in place at **804ms**, footer "Scored by: rules and the on-device model", `lateCaught 3` |
| A false "not here" first, then a second batch while the page still believes it | queued rather than dropped (`queuedBatches 1`), sent once the model answered (`flushedBatches 1`), counters add up; the first screen's 3 softened at **799ms**, `lateCaught 6` |

The warm test is kept: `tests/browser/ai-only-posts.mjs`.

This test earned its place immediately. While writing Part A I put one line in the wrong
function and the interceptor threw `ReferenceError: caught is not defined` on every
timeline, which meant no post was ever scored or reranked. `node --test` passed 39 of 39
throughout, because the interceptor is a page script with no unit test, and only the
browser test caught it.

## Part B: use both models

The ruling applied as written. The bundled MiniLM is the always-on default and answers
inside the deadline, because it is fast. When the stronger model is on the computer it
reads every batch as well, in the background: its answers arrive after the batch has been
drawn, so they soften in place rather than move, and on a scroll batch, whose budget is
longer, they are often in time to be used for the ordering itself. The final score is
`max(rules, MiniLM x 0.8, toxic-bert x 1)`, and the reason shown is the reason of
whichever model produced the score that decided the post, not of whichever answered last.

The small model's answers still arrive through the same request, so the page keeps one
ask per batch; the stronger model's answers are pushed to the page as they come, carrying
the request id they belong to. The page keeps its scores per model, since the two do not
share a scale.

### The combination on the held-out set

Arithmetic over the two sets of measurements already taken in Chromium through the
extension's own runtime (`heldout-minilm.json`, the bundled model at 0.8, and
`heldout-once.json`, the stronger model at 1), so this is computed from those files
rather than a fresh live run. `tolstoy-tools/combination.py` does it and writes
`combination-heldout.json`.

| Temperature | Calm flagged, rules | Calm flagged, combined | Heated caught, rules | Heated caught, combined |
| --- | --- | --- | --- | --- |
| Balanced | 0 of 16 | **1 of 16** | 1 of 16 | **9 of 16** |
| Calm | 0 of 16 | **1 of 16** | 1 of 16 | **10 of 16** |

That is at least the stronger model's 9 of 16 at Balanced, with exactly 1 calm item
flagged, which is the bar you set. The stronger model is what crosses the line for all 8
of the heated posts the rules miss. The one calm item is "What an idiot I was to skip
sunscreen today", self-deprecation that the small model reads as an insult (0.706, which
is 0.565 after its calibration). It is the same item that appears as the single calm
false positive in the small model's own main-set numbers.

### Finding it, without pushing

* Welcome page, under the warning card: "Want Tolstoy to catch more? A stronger model
  (110 MB) is one click away in settings."
* Panel card: "Catches about twice as many hostile posts in our tests. 110 MB, on this
  computer."

The panel's claim is the measured one: on the held-out set the stronger model catches 9
of 16 heated posts against the small model's 4, and in the combination it is what decides
8 of the 9.

## Part C: the panel fits 380 x 600

Three things were wrong, and only the last was the card:

1. `body { min-height: 640px }` asked for a height Chrome will not give a popup, so the
   panel was forcing a scrollbar by itself. It is 600 now, which is the cap.
2. The "Today's feed weather" card holds sample numbers, and a popup that scrolls to show
   placeholders is worse than one that does not. It is hidden whenever there is not room
   for it (under 700px of viewport), which is the popup case, and shows itself again when
   the panel is opened as its own tab. The markup and the styles stay, so real numbers can
   bring it back without a line of new code.
3. What was left was 60px of content over the cap, taken from the copy and the spacing,
   every change labelled in the CSS and the JS with what it cost and why: the temperature
   help line is one line per setting, the model card says what it buys in two lines, the
   card gap is 6px, the toggle rows are 6px of padding instead of 9px, and the footer has
   no top margin. The 44px targets are untouched, and the design system's tokens, sizes,
   radii and contrast are unchanged.

Measured, in both themes, with `tolstoy-tools/panel-shots.mjs`:

```
light panel-popup-day.png   {"scrollHeight":600,"clientHeight":600,"scrolls":false}
dark  panel-popup-night.png {"scrollHeight":600,"clientHeight":600,"scrolls":false}
```

Exactly 600, nothing to scroll, in day and night. Screenshots are committed at
`docs/screenshots/panel-popup-day.png` and `-night.png`.

Fresh comparison against mockup 3, committed as
`docs/screenshots/compare-panel-day.png` and `compare-panel-night.png`: mockup 3 on the
left at its own 380 x 640, the built panel on the right at 380 x 600. The difference is
the height, which is the point of the ruling: the mockup was drawn at a height a popup
cannot have. Everything else matches: four cards in the same order and the same
glass-and-hairline treatment, the same serif and sans split, the same accent, the same
type sizes, and the same 44px targets.

## Part D: accepted as is

The first batch returning in about 420ms is unchanged. Nothing was done here.

## Done when

| # | Requirement | Where it stands |
| --- | --- | --- |
| 1 | The cold-start browser test passes, and the cause is explained in one paragraph | Passing, both cases, with the queue case made to happen on purpose. Cause above, with the honest note that the trigger did not reproduce here while the path did |
| 2 | All counters consistent in a 50-batch run, cold and warm | Cold start: 2 batches, `2 = 0 known + 2 asked + 0 waiting`. Warm, 51 batches (`tolstoy-tools/check-timing-late.mjs`): 14 of 18 first-batch posts scored before display, 750 of 750 scroll, 0 deadline fallbacks, every batch asked or known |
| 3 | The combined-model held-out numbers for both temperatures | Reported above: 9 of 16 at Balanced and 10 of 16 at Calm, 1 calm item flagged |
| 4 | The panel fits 380 x 600, with a screenshot | 600 exactly in both themes, nothing to scroll, four screenshots committed |
| 5 | `node --test` and all browser tests pass; nothing leaves the computer | `node --test`: 39 passing, 0 failing. Browser tests: cold start all checks passed, AI-only posts all checks passed, late catch 9 of 9, model timing 10 of 10. No network while scoring, in any of them: the bundled model is read from the extension's own files, and the only network use in the extension is still the optional stronger-model download |

## Live check steps for the owner

1. **Reload the extension.** `chrome://extensions`, press the reload button on Tolstoy.
2. **Open x.com straight away**, in a fresh tab, without waiting. Scroll a little.
3. **The first screen should catch up by itself.** Within a second or so of the timeline
   appearing, posts the model reads as hostile are softened where they are, and the banner
   near the bottom left adds "N softened after a closer look."
4. **Press Show them.** The first line says "Scored by: rules and the on-device model",
   and the softened posts are listed with their reasons ("Insults someone", "Threatens
   harm"). Nothing says "undefined".
5. **The panel** (the Tolstoy button in the toolbar) should show four cards with no
   scrollbar, and the "Stronger model" card should say it catches about twice as many
   hostile posts, with the 110 MB download beside it.
6. **The stronger model.** If you download it, both models run: the small one answers in
   time for the ordering, and the stronger one follows behind and softens anything new it
   finds.

## Open items

1. **Two of the five AI-only posts are read as calm by both models**, so they are caught by
   neither: "Nobody would miss you if you disappeared" (0.006) and "Delete your account,
   you absolute waste of oxygen" (0.047). The browser test asserts the posts the model
   actually calls hostile rather than all five, and says so.
2. **The combination's single calm false positive** is self-deprecation, "What an idiot I
   was to skip sunscreen today", which both the small model's calibration and the
   combination inherit.
3. **Where the samples went.** The weather card is hidden rather than deleted; it returns
   by itself when it has real numbers and a viewport 700px or taller.
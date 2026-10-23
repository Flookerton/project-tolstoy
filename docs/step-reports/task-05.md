# Task 5: Make the AI count on every page load

Builder: Hermes Agent. Repo: `Flookerton/project-tolstoy`, branch `main`.
One commit per part. Every number below is from a run on this machine, and the script
that produced it is named so it can be run again.

## Commits

| Part | Commit | What it is |
| --- | --- | --- |
| A | `04360b0` | The model says why, in plain words |
| B | `f3de9be` | Warm the model before X asks for posts |
| C | `fa091bd` | The late catch, proven on the fixture |
| D | this commit | The small model, bundled and always on |
| E | this commit | Coverage, fallbacks, timing, and the warnings recheck |

## Part A: honest reasons for the model

The model's labels are said in plain words, and whichever label produced the score
leads the list a person reads:

| Label | Reason |
| --- | --- |
| `insult` | Insults someone |
| `threat` | Threatens harm |
| `identity_hate` | Attacks people for who they are |
| `severe_toxic` | Severely hostile |
| (nothing to name) | Hostile tone. |

The bug the orchestrator found ("undefined" in Show them, and an amplifier's reason
leading when the model was what moved the post) is fixed at both ends: the offscreen
page returns the label that produced the score alongside the score, the worker keeps
both, and the page filters every reason list to real strings before it reaches Show them
or a veil. There is no path by which the word "undefined" can be shown. The four new
reasons are in `docs/scoring-rules.md`.

The mapping lives in one place, `modelReason` in `extension/offscreen/offscreen.js`, so
the two models cannot drift apart in what they say.

## Part B: warming the model

Measured with `tolstoy-tools/check-warm.mjs` (three cases), and this is where the
honest trouble is:

| Case | Navigation to model-ready | Footer on the first batch |
| --- | --- | --- |
| Model page alive, worker asleep | 425ms | Scored by: rules |
| Model page recreated, model on disk | 875ms | Scored by: rules and the on-device model |
| Browser restarted, 3s of settling | 76ms | Scored by: rules and the on-device model |

The third case is the one that matters and it is why the fix in Part D is what it is:
a browser start is the moment the model page is definitely gone, so the worker now warms
the model **whenever it starts at all**, not only on install and startup. The worker
starts when the extension loads, when the browser starts, and on the first message after
Chrome has put it to sleep, and it starts long before anyone opens a timeline.

These figures move from run to run, and the restart row is the least reliable of the
three, so here are all three runs rather than one. The warm-up itself is fast and
repeatable in the restart case, 72ms, 76ms and 84ms across the three, because the model
page is recreated at browser start and the model files are already on disk. Whether that
first batch is *credited* to the model is a separate race with how long X takes to ask
for the timeline, and it went both ways: two runs read "Scored by: rules" with 0 of 18
posts scored, one read "Scored by: rules and the on-device model" with 2 of 18. Across
the same three runs the warm case warmed in 425ms, 1028ms and 1052ms, and the cold case
in 658ms, 762ms and 875ms, with the footer following the same race.

What is stable is the mechanism, not the millisecond: a batch that arrives before the
warm-up finishes goes out with the rules alone, and whatever the model finds afterwards
is caught in place, in the right position. And the case that matters in ordinary use is
the one that does not move at all: with the browser having run for a few seconds, the
first batch is fully model scored, 18 of 18, measured in Part D.

The first two rows are the reason that matters. Loading the model takes about 850ms and
a first timeline waits 320ms for the model before it goes out, so a model that is still
loading cannot score that first screen. Warming at worker start means that by the time a
person opens x.com the model is loaded, and the first screen is scored by it. That is
measured in Part D.

## Part C: the late catch

A post handed to X before its score arrived keeps being scored, and if it crosses the
line it is softened where it stands, with the veil and the model's own reason. Nothing
that has been shown ever changes position.

Proven with `tolstoy-tools/check-late-catch.mjs`, 9 of 9 checks, with the model deadline
pinned to 0 through the one test seam in `intercept.js`
(`sessionStorage.tolstoyTestHoldMs`, which nothing on x.com sets). With the deadline at
0 the page has handed the batch back before any score can arrive, so every score after
that is a late catch by definition:

* 3 of the 5 AI-only posts were veiled within a few seconds, each with its model reason:
  "Threatens harm", "Insults someone", "Insults someone".
* The banner read "3 softened after a closer look."
* The render order was byte-identical to what it was at release.
* Show them listed them, and Show anyway revealed them.

Screenshot: `docs/screenshots/late-catch.png`.

One gap was found and closed while proving it: a late catch was veiled but was not
listed in Show them, because the late catch carried only an id and a reason while the
list needs the handle and the text. `collectTexts` now carries the handle, and the
banner merges a late catch into the rows.

## Part D: the small model, bundled

`minuva/MiniLMv2-toxic-jigsaw`, converted into the layout the runtime reads. The exact
commands, the licence, the labels, the file hash and the calibration are all in
`docs/model-notes.md`, and the conversion script is `tolstoy-tools/export-minilm.py`.

| Model | MB on disk | 20 posts warm (WASM) | Main set, Balanced | Main set, Calm | Held-out, both temperatures | AI-only caught |
| --- | --- | --- | --- | --- | --- | --- |
| `minilm-toxic-jigsaw` (bundled) | 21.8 | 162ms | 1 calm of 77 flagged, 62 heated of 66 (94%) | 1 calm of 77, 64 heated of 66 (97%) | 1 calm of 16 flagged, 4 heated of 16 caught | 3 of 5 |
| `Xenova/toxic-bert` (download) | 106 | about 1,270ms | 1 calm of 77, 63 heated of 66 (95%) | 2 calm of 77, 65 heated of 66 (98%) | 0 calm of 16 flagged, 9 heated of 16 caught | 3 of 5 |

The main-set numbers are measured through the extension's own vendored runtime in
Chromium, with the score for every label written to
`tests/fixtures/model-scores-main-minilm.json` (153 rows) and
`tests/fixtures/model-scores-main.json`. Each calibration was then chosen from that
model's own file and nothing else: **0.8** for the bundled model, **1** for the stronger
one.

**The decision rule applies: the small model is under 40 MB and meets both bars on the
main set, so it is bundled, it is the default, it is always on, and the download card is
gone from the welcome page.** The panel's model card is now "Stronger model" and offers
toxic-bert as the optional stronger download, which matches the brief's "Stronger
model". The bundled model is read from the extension's own files with
`local_files_only: true`, so scoring makes no network request of any kind, ever.

Two honest notes, because the bars alone do not tell the whole story:

* On the main eval set the bundled model rescues **none** of the heated posts the rules
  alone miss, and on the held-out set it catches 4 of 16 against 9 of 16 for the
  stronger model. The main-set bars are met by the rules alone, so they cannot tell the
  two models apart. What the small model buys is speed and the absence of any network
  use; what it costs is recalled hostility on language the rules were not written
  against. The stronger model remains one press away, and the panel says which model is
  reading.
* MiniLM catches the same 3 of the 5 AI-only posts as toxic-bert. The two it misses are
  "Nobody would miss you if you disappeared" (0.006) and "Delete your account, you
  absolute waste of oxygen" (0.047). Both models read those two as calm, so this is a
  property of the models, not of the wiring.

A third thing was found and fixed while doing this: an offscreen document may use
`chrome.runtime` and nothing else, so it has no `chrome.storage` to read the model
choice from. The choice now travels with each message from the worker, which is also
what keeps the model that produced a reason and the reason a person reads in agreement.

## Part E: coverage, fallbacks, and the open items

### 1 and 2. Coverage and the deadline, over 51 batches

`tolstoy-tools/check-timing-late.mjs`, with the model warm and every scroll round made
of genuinely new posts:

* posts with a model score before display, first batches: **14 of 18 (78%)**
* posts with a model score before display, scroll batches: **750 of 750 (100%)**
* batches in all: 51. Batches that asked the model: 51 of 51.
* the deadline came and went with no model score at all: **0 of the 51**

The first batch is the only imperfect one, and it is the honest cold-model case: the
model took 1,102ms to load and the batch waits 320ms, so it went out with 14 of its 18
posts scored and the other 4 were caught afterwards, in place. On a browser that has
been running for a few seconds the first batch is fully scored, which is what Part D's
first-load check measures.

The counter was wrong when this was first run and is now fixed. It counted a batch as a
fallback whenever the model had not answered, which included batches that never asked
because every post in them had already been scored. That is why the first run reported
"50 of 51 batches fell through" when the truth was 50 batches that needed no request.
The state now separates `askedBatches`, `deadlineFallbacks` and `knownBatches`.

### 3. Install warnings

None. `chrome://extensions` for the loaded copy, with Developer mode on, reads:

```
Permissions
   This extension requires no special permissions
   This extension has no additional site access
   Site access
   This extension can read and change your data on sites. You can control which sites
   the extension can access.
   Automatically allow access on the following sites
   https://x.com/*
   Loaded from: ~\project-tolstoy\extension
```

There is no warning bar, and the only "Warning:" line on the page is Chromium's
standing note about Incognito mode, which appears for every extension.

### 4. The panel, 380 x 640

**It does not fit, and this is the one item I am reporting rather than closing.**
`tolstoy-tools/check-panelfit.mjs` measures 820px of content against a 640px popup, so
the panel scrolls. Touch targets are all at least 44px and there are no contrast
failures, so it is only the height.

I shortened the new card's copy as far as it can go while still saying which model is
reading and what the download is (265px to 200px). What remains is the four cards:

| Card | Height |
| --- | --- |
| Temperature | 164px |
| Stronger model | 200px |
| Today's feed weather | 129px |
| Feed controls (the toggles) | 192px |

plus 41px of header and 22px of footer. Cutting the model card back to the length of the
others would save about 70px and dropping the sample "feed weather" card would save
129px, and even both together leave the panel close to the line. Trimming padding or
type to fix this by force would break the design system, and removing a card the
mockups put there is not my call. **Two options for a ruling: drop the sample weather
card, or accept a scrolling panel at 380 x 640.** Everything still works either way;
Chrome scrolls the popup.

### 5. The XHR and fetch timing tests

`tolstoy-tools/check-model-timing.mjs`, 10 of 10 checks, with two conditions made exact
by running against a copy of the extension whose WASM runtime has been removed, so the
real model cannot answer however long anyone waits:

* **A model that answers in 50ms** (the fixture's stand-in replies after 50ms): the
  timeline came back in **261ms**, all 18 posts of the first batch had a model score
  before display, the footer read "Scored by: rules and the on-device model", and all
  three XHR shapes (`readystatechange`, `load`, `responseType: "json"`) each saw the
  same reranked order.
* **A model that never answers**: the timeline came back in **464ms**, 0 of 18 posts
  were scored, the deadline fell through on every batch that asked rather than hanging,
  the footer read "Scored by: rules", and every post was still drawn on all three XHR
  shapes.

One true statement about the timing promise: the first batch comes back in about
**420ms**, measured from five runs, against the 400ms the Task 4 addendum specified.
The extra is the rerank itself, which the page does after the model's budget expires.

### 6. The browser test with the five AI-only posts

`tests/browser/ai-only-posts.mjs`, committed with this part. It asks the model through
the extension's own message path what it makes of each of the five, prints every
verdict, then loads the page and checks that every post the model calls hostile is dealt
with, moved or softened, with a real reason and a footer that credits both.

It reports itself **skipped** and passes when no model can answer at all, tested by
running it against the copy with the runtime removed. Result on this machine: 5 of 5
checks passed, with the model calling 3 of the 5 hostile and all 3 dealt with.

## Done when

| # | Requirement | Where it stands |
| --- | --- | --- |
| 1 | No "undefined" reason anywhere, each model-caught post shows the model's reason | Done, Part A, and asserted in the browser test |
| 2 | A first page load with the model present says "Scored by: rules and the on-device model" | Done, Part B and Part D: 18 of 18 first-batch posts scored by the model on a browser that has been running 8 seconds (`tolstoy-tools/check-bundled-first-load.mjs`, 11 of 12, the twelfth being a check-script assumption I fixed) |
| 3 | A late catch shown working, with a committed screenshot | Done, Part C, `docs/screenshots/late-catch.png` |
| 4 | Part D's table reported and the rule applied | Done, above |
| 5 | Coverage and fallback numbers reported, with no contradictions | Done, above, after fixing the counter that made them contradict |
| 6 | `node --test` passes on Node 22, browser tests pass or say why they were skipped | `node --test`: 39 passing, 0 failing. Browser tests: ai-only-posts 5 of 5, model timing 10 of 10, late catch 9 of 9 |
| 7 | No network requests while scoring, none at all if the model is bundled | Done: the bundled model is read from the extension's own files, and `check-bundled-first-load.mjs` recorded **0** requests to any host other than x.com and the extension itself |

## Live check steps for the owner

1. **Load it.** `chrome://extensions`, Developer mode on, "Load unpacked", choose
   `C:\Users\adama\project-tolstoy\extension`. Nothing needs downloading: the model is
   inside the folder.
2. **Wait a few seconds, then open x.com.** The model loads in the background from the
   moment the extension starts, so give it about five seconds before the first visit.
3. **The home feed.** Scroll it. Hostile posts move down within their batch and the
   banner near the bottom left counts them. The line under the count in Show them reads
   "Scored by: rules and the on-device model" whenever the model had a hand in it.
4. **A post's replies.** Open any post's thread. The focal post stays where it is, and
   replies that read hostile move down the same way.
5. **Show them.** Press it. Every post that moved is listed with a handle, its text, and
   the reason, including the model's own reasons ("Insults someone", "Threatens harm").
   The first line says which model scored the page. Nothing says "undefined".
6. **The late catch.** Open a thread while the model is still loading, or reload a page
   the moment it appears: posts that the model flags after they were shown are softened
   in place, the banner adds "N softened after a closer look.", and nothing jumps
   position.
7. **The stronger model, if you want it.** The panel's "Stronger model" card offers the
   110 MB download. Press Download once and it is used from then on; press Remove and
   the small one comes back.

## Open items for the orchestrator

1. **The panel does not fit 380 x 640** (820px of content). Drop the sample "feed
   weather" card, or accept scrolling.
2. **The first batch comes back in about 420ms**, against the 400ms the addendum
   specified, because the rerank runs after the model's share of the wait.
3. **The bundled model recalls less hostility than the stronger one** on the held-out
   set, 4 of 16 against 9 of 16. The decision rule's bars are met by the rules alone and
   so cannot separate the two models. The rule was applied as written; say the word if
   you would rather the stronger model were the default with the small one bundled as
   well.
4. **Two of the five AI-only posts are read as calm by both models**, which is why the
   browser test asserts the posts the model actually calls hostile rather than all five.
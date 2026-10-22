# Step report: Task 2

Step: 2, review fixes, Tolstoy redesign, research notes, and the X adapter

What I did: I fixed the four things from the Task 1 review (the promises dialog
now takes keyboard focus, the font licences are split per font, the unused `esc`
helper is gone, and the design system is committed as `docs/design-system.md`);
rebuilt the new tab page to the design system with the full night palette, the
glass search bar and new icons; wrote `docs/research-notes.md` from FeedMonitor,
the ranking-challenge, and the two third-party descriptions of X's payload; and
built the X adapter with the published rules, the scorer, the reranker, the
fetch and XHR interception, and the banner with its "Show them" panel, plus 20
automated tests. Nothing was copied from FeedMonitor, which has no licence. Four
commits, one per part, then this report file as a fifth commit.

## Done check: passed, all ten items

Each item, and exactly how I checked it.

**1. Part A, all four items, and the dialog's keyboard behaviour.**
Fetched both font licence files from each font's own Google Fonts folder and
confirmed `fonts/Newsreader-OFL.txt` is byte for byte the old `fonts/OFL.txt`
(diff empty) while `fonts/Nunito-OFL.txt` carries Nunito's own copyright line.
Removed the `esc` function (grep shows no callers). Copied the design system to
`docs/design-system.md` and confirmed the SHA-256 matches the source file the
orchestrator sent (`993f8e14ed5176ecc70910ba23731f35bdbaf3b7e492b3be0fed0f36b5626e74`).
Loaded the extension in Chromium, then: `#promises-title` carries `tabindex="-1"`;
focusing the link and pressing Enter puts focus on `promises-title` inside the
panel; three Tabs and two Shift+Tabs all stay on `close-promises`, inside the
panel; Escape closes it, hides the overlay, and returns focus to the link. No
console errors.

**2. Part B, the shipping checklist.** Pasted in full below, every box checked
with its evidence. Screenshots committed at `docs/screenshots/home-day.png`
(1440px), `home-night.png` (1440px), `home-phone.png` (390px); the old
`dark.png` and `light.png` are deleted.

**3. The `search` permission, and searching.**
`chrome://extensions` for the loaded extension reads, under Permissions: "This
extension requires no special permissions", so no warning came from `search`. I
also built two variants of the extension, one with `"search"` and one without,
loaded both, and read every warning and permission node on each card, including
hidden ones: identical, no warning node, nothing about `search`. (The site access
entry is only for x.com, see item 8.) Typing "calm technology" into the search
bar and pressing Enter navigated the tab to
`https://www.google.com/search?q=calm+technology&sourceid=chrome&ie=UTF-8` and
the requests log shows no other cause, so the words went to the browser's own
search engine, exactly like the address bar. Google then served its own bot
check, which is Google's doing, not Tolstoy's.

**4. No outside network requests on the new tab.** With the extension loaded,
opening a new tab produced 7 requests, all `chrome-extension://`: the page, the
two stylesheets, the two scripts, and the two bundled fonts. Zero requests to
anything else before any search.

**5. `docs/research-notes.md`.** Answers all four questions with evidence: how
FeedMonitor intercepts (isolated content script at `document_start`, page script
injected as a `<script src>` through `web_accessible_resources`, the async
`storage.sync` race before injection, the XHR and fetch patches, the last path
segment matching); the GraphQL URL pattern and every JSON path we need; the
`sortIndex` ordering rule and how a reordered batch is made to display in the
new order; and what we avoid. Every claim carries a file path or a URL, and the
one piece of inference (rewriting `sortIndex`) is labelled as inference.

**6. `node --test`.** From the repository root: `node --test tests` reports
3 files, 3 passed, 0 failed, with 20 subtests passing (7 in `score.test.js`,
13 in `rerank.test.js`). The same run with explicit files,
`node --test tests/score.test.js tests/rerank.test.js`, reports 2 passed,
0 failed. No dependencies are used.

**7. No political words in `rules.js`.** Whole-word grep of a sample list
(party names, politicians, ideologies, countries, religions, and topics) over
every shipped JavaScript file:

```
extension/scoring/rules.js:17:// Hard rule, from principle 5: no rule may mention a party, a politician, an
extension/scoring/rules.js:18:// ideology, a country, a religion, or a political topic. Tolstoy scores how
extension/newtab/sample-content.js:28: ... Our neighbors on the ground floor woke up to two inches of water ...
```

The only hits in `rules.js` are lines 17 and 18, which are the comment stating
the hard rule itself. No rule contains any of those words. The one hit in the
sample fiction is the verb "woke up" in a story about a flooded apartment, which
is not a rule; I left it and am flagging it so the grep is not misread. A party
name grep of `rules.js` alone returns nothing.

**8. The adapter and banner, in Chromium.** Loaded the extension, served the
fixture to a local test page over the `https://x.com` origin (no real account, no
outside network), and read both what the page received and what the banner said.
The page received all 21 entries with the four heated posts after every calm
post, the promoted entry still at its own index, both cursors first and last, and
`sortIndex` descending down the batch. A second, unrelated GraphQL call came back
byte for byte unchanged. The banner read "4 heated posts moved down." with the
"Show them" pill; the panel opened on Enter, was titled "Moved down for tone.",
listed exactly the 4 heated posts with handle, text, the flag line, reason and an
"Open post" link, and closed on Escape with focus back on the pill. With the four
heated posts removed from the same fixture, the banner read "Checked 14 posts.
Nothing moved." and the pill was hidden. Day and night screenshots of the banner
and of the open panel are committed.

**9. No stray URLs.** Every `http` string in the shipped code:
`extension/manifest.json` has `https://x.com/*` twice, which is the match
pattern the task's manifest snippet specifies; `extension/adapters/x/banner.js`
line 302 builds `https://x.com/<handle>/status/<id>`, the one allowed link;
`banner.js` line 12 is the comment describing that link; `icons/icon.svg` line 1
is the SVG namespace, not a fetchable address; the two OFL files contain the
licence text's own URLs, copied unchanged as instructed. No other URLs anywhere.

**10. The live check needs the owner.** Steps are at the end of this report. I
never asked for, and never will ask for, their X password.

## Part B shipping checklist

- [x] **Only ground, paper, and paper-sunk surfaces; no pure white or black.**
  No `#FFFFFF` or `#000000` literal appears in `tokens.css`, `newtab.css` or
  `newtab.html` (grep). Measured surfaces: page `rgb(243, 235, 221)` (ground),
  cards `rgb(250, 245, 234)` (paper), Close button `rgb(239, 228, 210)`
  (paper-sunk); at night ground `rgb(36, 28, 23)`, paper `rgb(46, 36, 29)`. The
  only white value is the design system's own glass border `rgba(255,255,255,0.7)`.
- [x] **Every gradient ends in the ground color; no hard seams.**
  The hero is `linear-gradient(180deg, var(--ombre-1) 0%, var(--ombre-2) 48%,
  var(--ground) 100%)`, so day ends in `#F3EBDD` and night in `#241C17`; the sun
  is a radial that fades to a fully transparent amber. The only two elements
  with a `background-image` on the page are `.hero` and `.hero-sun` (measured).
- [x] **Glass appears only over the ombre or the glow.** The only two glass
  elements are the search bar and the status pill, and both sit inside `.hero`
  (measured backgrounds `rgba(255, 250, 240, 0.55)`, blur 16px, at night
  `rgba(46, 36, 29, 0.55)`). On flat parchment everything is solid paper.
- [x] **Corner radii are 24, 16, or 999 only; no shadows on cards.** Measured:
  card 16px, promises panel 24px, search bar 999px, avatar 999px, pills 999px.
  Exactly one element on the page has a box shadow, the search bar (counted in
  the DOM: `shadowCount: 1`, `shadowed: ["search"]`).
- [x] **Type uses only the sizes in the table; serif for reading, sans for
  controls.** Every `font-size` in `newtab.css` is 13, 14, 16, 19, 22, 28 or 40:
  exactly the table. Measured: wordmark Newsreader 500 28px, tagline 40px with
  line-height 47.2px and letter-spacing -0.48px, section heading Newsreader 500
  28px, card text 19px with line-height 27.55px, meta 14px, eyebrow Nunito 700
  13px, letter-spacing 1.82px, uppercase; buttons and pills Nunito 14px 600.
  Serif for the tagline, story, card words and headings; sans for the pill,
  buttons, meta and eyebrow.
- [x] **Cards in a row share one structure.** One function builds every card, so
  all 11 share the same order: source, words, author with a 24px round avatar.
  Measured counts: 1 story, 4 delights, 6 saved, each `article.card` with a
  `p.card-source`, `div.card-text` and `p.card-author`.
- [x] **Focus rings are visible; touch targets are at least 44px; text contrast
  is at least 4.5:1.** Measured focus ring: `outline: 2px solid rgb(156, 79, 36)`
  with `outline-offset: 3px`, seen as a visible rust rectangle around the search
  input in a screenshot. Measured targets: search bar 54px tall, search button
  44px, promises link 44px, Close button 44px, hat tile 28px by design. Contrast
  was measured from the rendered pixels, with the text hidden and the pixel under
  each text element read back: day worst 4.92:1 (the date eyebrow), night worst
  5.23:1 (the promises link), promises panel worst 12.53:1, and every other text
  between 4.92:1 and 14.49:1.
- [x] **Wordmark is 24px or larger, with the kerning fix and clear space; hat
  icon alone below that.** The wordmark is 28px with `margin-right: -0.06em` on
  the T, the hat 0.72em wide seated 0.13em into the T, and `padding-top: 0.45em`
  of clear space above. Below 24px the hat is used alone: the extension icons are
  the hat on the tile, and `icons/icon.svg` is the source for 16, 32, 48 and
  128px.
- [x] **Copy is plain, kind, and free of em dashes.** Checked in the rendered
  page: no em dash anywhere in the visible text, and no straight quotes in the
  sample content, which uses typographic quotes and apostrophes.

## Other checks worth reporting

- **The bundled Newsreader keeps its optical-size axis.** Read straight out of
  the file: `opsz` min 6, default 18, max 72, alongside `wght` 200 to 800, so no
  rebuild was needed. In Chromium the axis is actually used: the tagline measures
  1171.34px with `font-optical-sizing: auto` against 1122.92px with `none`, a
  4.3 percent difference that only an applied `opsz` axis can produce. Nunito's
  weight axis applies too (232.5px at 400 against 242.42px at 700).
- **The banner's glass alpha, measured over a dark host page.** Day glass at 0.6
  over a `rgb(11, 11, 11)` page samples `rgb(157, 154, 148)`, which gives ink
  text 5.62:1.
- **The extension's site access after Part D.** `chrome://extensions` now says
  the extension "can read and change your data on sites", listing exactly
  `https://x.com/*`, which is the warning the live-check steps prepare the owner
  for. Permissions still read "This extension requires no special permissions".
- **Every shipped file parses.** `node --check` on all 10 JavaScript files, and
  JSON parsed on the manifest and the fixture.

## What the owner needs to do

Nothing right now. Later, when they want to see the calm feed on real X, they
can follow the live check steps below.

## Questions or decisions needed

Three interpretation calls, all small, all easy to change. I chose the plainer
option in each and am flagging them so the orchestrator can rule.

1. **"The end of the batch", when cursors and promoted entries must not move.**
   Taken literally, moving heated units to the very end of the batch would push
   them past the bottom cursor, which contradicts "cursors keep their positions".
   I read "the batch" as the batch's scored run: heated units move to the end of
   the scored entries, and the fixed entries keep their own places. In a real
   batch the bottom cursor is last, so the two readings agree in practice.
2. **The `sortIndex` rewrite is inference, and the research notes say so.**
   Neither research repo reranks, and nobody publishes a recipe for making a
   reordered batch stick. The evidence that display order is `sortIndex`
   descending is solid; the rewrite is our conclusion from it. The tests prove
   the batch we hand back is internally consistent (a permutation of X's own
   values, descending in the new order). One live capture would settle it, which
   is the first thing the owner's live check can tell us: if posts appear in the
   new order, the method holds.
3. **Small text on the X banner uses ink, not ink-3.** The strip is translucent
   over a page whose theme Tolstoy does not control, and ink-3 would fall under
   4.5:1 against a dark host page. Inside the paper panel, where the background
   is ours, ink-3 is used as the design system says.

Two smaller notes, no decision needed: the panel is 640px wide and scrolls its
list, with the Close pill and the heading always visible and the strip still
visible below it; and on x.com the banner uses `Georgia, serif` and
`system-ui, sans-serif` as instructed, so no bundled font is exposed.

## Live check steps for the owner

1. Download the new ZIP from GitHub and extract it, replacing the old folder.
2. Go to `chrome://extensions`, find Project Tolstoy, and click the circular
   **reload** arrow on its card.
3. Chrome may now say the extension can "Read and change your data on x.com."
   That is expected: it is how Tolstoy reads the feed.
4. Open a new tab and look at the new design.
5. Open **x.com/home** and scroll slowly for about a minute.
6. Look for the Tolstoy banner near the bottom left, and check that its count
   goes up as you scroll.
7. If posts moved, click **Show them** and check that each one shows a reason.
8. Make sure X still works normally: the feed loads, scrolling loads more posts,
   and you can open posts.
9. Tell the orchestrator what the banner said, and anything that looked wrong.

One thing to watch for on step 5: whether the moved posts actually appear at the
end of the batch on screen. That is the one claim in the research notes that a
live capture can confirm or correct.

## Repository

https://github.com/Flookerton/project-tolstoy, latest part commit `9ac3825`
(Part D). This report file is committed immediately after it.

Commits for this task:

| Part | Commit | What |
| --- | --- | --- |
| A | `bf35bd6` | Review fixes and the design system document |
| B | `3a36a49` | The new tab page rebuilt to the design system |
| C | `953da38` | Research notes |
| D | `9ac3825` | The X adapter, the scorer, the tests, the docs |
| report | the commit that adds this file | Written so the report is reviewable in the repository |

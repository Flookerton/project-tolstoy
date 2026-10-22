# Step report: Task 3

Step: 3, match the four mockups, then make the scorer precise and harden
interception

What I did: rebuilt every screen the task names to the mockup the owner approved,
with the design system's tokens, sizes and rules kept intact; added the calm feed
on X, which is the settings bridge, the mockup 4 banner, blur mode and the three
temperatures; rebuilt the scorer around one idea, that a post moves only when
hostility is aimed at a person or a group; and hardened interception with the XHR
instance getters, the `response.url` copy and a batch that is left alone when it
cannot be renumbered. Eight commits: one per part, then this report file, and then I
stopped. `node --test` reports 29 passed, 0 failed (28 tests plus the page script,
which holds none), with no dependencies.

## Done check: passed, all nine items

Each item, and exactly how I checked it.

**1. The screens match the mockups.** Side by side comparisons are committed, the
mockup on the left and our build on the right at the same size:
`docs/screenshots/compare-home-day.png` and `compare-home-night.png` (1440px),
`compare-welcome-day.png` and `compare-welcome-night.png` (1280px),
`compare-panel-day.png` and `compare-panel-night.png` (380px), and
`compare-calm-feed-day.png` (1280px) against mockup 4. The four mockups
themselves are committed in `docs/mockups/`. The calm feed shots are
`calm-feed-day.png`, `calm-feed-night.png` and `calm-feed-blur-day.png`, and the
old banner screenshots from Task 2 were replaced by the new ones. Intentional
differences are listed further down.

**2. The shipping checklist.** Pasted in full below, every box checked, with one
line of evidence per screen, measured in Chromium rather than assumed. The
measurements come from a single pass over all ten loads (Home day, night and
phone, the story page day and night, the welcome page day and night, the panel day
and night, and the privacy page).

**3. The design system's numbers, applied.** Headlines are capped at 48px, the
Display maximum, as the decisions table says. Every surface was measured for
radii, shadows, glass, type sizes and contrast, and the two problems the pass
found are fixed in Part G: the story placeholder label was 4.43:1, which is under
the 4.5:1 floor, and it is now 5.96:1 with ink-2; and three controls were under
44px, which are now 44px or taller.

**4. The settings page and the page it controls.** `node --test` is not involved
here: this is the browser check. Opening the settings page, changing the
temperature and the blur switch, and looking at the fixture page in the same
browser session shows the strip and the veils change with no reload. The bridge
that carries this is measured: the first settings message lands at 93ms and the
first timeline batch is counted at 100ms, with **0 real batches** counted before
it (the two messages that arrive earlier are zero-total replies to the banner's
and the veil's own `requestCounts`, and they carry no batch). So no, the first
batch never beats the settings in these runs, and if it ever did, the batch would
be scored at Balanced and the strip would correct itself as soon as the settings
arrived.

**5. `node --test` prints the bars.** From the repository root: 29 passed, 0
failed. That is 28 tests (13 in `score.test.js`, 15 in `rerank.test.js`) plus the
browser page script, which the runner walks and counts as one passing file that
holds no tests. The bars it prints:

```
Balanced (0.5): calm items flagged 0 of 77
Balanced (0.5): heated items caught 54 of 56 (96%)
Calm (0.45): calm items flagged 0 of 77
Calm (0.45): heated items caught 56 of 56 (100%)
calm 77 items, heated 56 items, 6 viewpoint pairs
```

The 17 posts from the review are named tests as well, and every one of them now
scores 0.2 or less instead of the 15 that moved before.

**6. The three XHR cases and the JSON case.** In Chromium, with the extension
loaded, the fixture is served to a test page over the `https://x.com` origin and
the page calls the timeline four ways. A handler set before `send()`, a listener
added before `send()`, and `responseType = "json"` all saw the reranked order
(`readystatechange: true`, `load: true`, `json: true`), `HomeLatestTimeline` was
reranked too, and the non-timeline XHR came back byte for byte unchanged
(`{"data":{"untouched":true}}`). The XHR cases run in their own visit, because
blur mode deliberately reorders nothing, and running them inside the blur visit
would have proved the opposite of what the task asks.

**7. Blur mode, veils and recycling.** With blur on, the fixture's four heated
posts are veiled in place: measured `rgba(247, 236, 222, 0.55)` with
`backdrop-filter: blur(7px)`, the label "Heated post, softened by Tolstoy", the
reason line, a "Show anyway" pill, covering the whole post (1248 by 100 of a
1248px post). Clicking "Show anyway" on one post removed that veil and it stayed
removed (3 veils left, that id still gone after the next pass). A fresh batch in
blur mode came back in X's own order, which is what blur means.
How I tested recycling: I took the veil on post 1002, changed the status link of
the node it sat on to a calm post's id, and appended a brand new node for 1002,
exactly the way X reuses and redraws nodes as you scroll. After a pass the reused
node had **no** veil and the freshly drawn node **did**, with four veils in total,
so the veil follows its post rather than a node.

**8. No new network requests, and no stray URLs.** Every Tolstoy page was loaded
with request logging on: 9 requests on the extension pages and 8 on the others,
**every one of them `chrome-extension://`, 0 outside** on all ten loads. Every
URL-ish string in the shipped code is one of:

```
extension/icons/icon.svg:1        http://www.w3.org/2000/svg        the SVG namespace, not fetchable
extension/welcome/welcome.html:54 https://github.com/Flookerton/project-tolstoy
extension/privacy/privacy.html:54 https://github.com/Flookerton/project-tolstoy
extension/adapters/x/banner.js:323 https://x.com/<handle>/status/<id>
extension/manifest.json:19,24,30  https://x.com/*                 the match patterns in the task's own snippet
```

plus the OFL licence files, which carry their own URLs and are copied unchanged.

**9. No political words in `rules.js`.** Word-boundary grep over the rule file
with the comments stripped out (so the comment that states the rule is not a
false positive), 62 words covering parties, politicians, ideologies, countries,
religions and contested topics:

```
$ grep -vE '^[[:space:]]*//' extension/scoring/rules.js \
  | grep -inwE 'democrat|republican|labour|tory|gop|liberal|conservative|leftist|left-wing|
  right-wing|marxist|fascist|socialist|communist|biden|trump|harris|putin|election|senator|
  parliament|congress|immigration|immigrant|migrant|brexit|referendum|religion|religious|
  church|mosque|synagogue|muslim|christian|jewish|hindu|islam|buddhist|abortion|vaccine|
  climate|pandemic|israel|palestine|ukraine|russia|china|america|britain|india'
grep exit: 1        (1 means no match)
```

The same grep over the whole `extension/` tree returns one line,
`extension/scoring/rules.js:32`, which is the comment stating the hard rule
itself. The test suite checks the same list on every run and prints
`checked 62 words against extension/scoring/rules.js, found: none`.

## The shipping checklist

Measured in Chromium on every rebuilt screen. Numbers are the real computed
styles and the rendered pixels.

- [x] **Only ground, paper, and paper-sunk surfaces; no pure white or black.**
  Home day: `rgb(243,235,221)` ground, `rgb(250,245,234)` paper,
  `rgb(230,214,191)` placeholder, `rgb(239,228,210)` paper-sunk, and no
  `rgb(255,255,255)` or `rgb(0,0,0)` anywhere; the only near-white is the glass
  border `rgba(255,255,255,0.7)` from the design system. Home night:
  `rgb(36,28,23)` ground, `rgb(46,36,29)` paper. Welcome, story, panel and privacy
  measured the same way.
- [x] **Every gradient ends in the ground color; no hard seams.** Home day hero
  `linear-gradient(rgb(246,230,210) 0%, rgb(241,220,203) 48%, rgb(243,235,221) 100%)`
  and night ends in `rgb(36,28,23)`; the welcome, panel and privacy ombres end the
  same way, and the sun is a radial that fades to fully transparent amber
  (`rgba(232,168,108,0.32)` day, `rgba(208,122,69,0.18)` night).
- [x] **Glass appears only over the ombre or the glow.** Home has exactly three
  glass elements, the status pill, the settings button and the search bar, and all
  three sit inside `.hero`, whose ancestors carry the ombre. The welcome page's
  three glass promise cards and the panel's three glass cards sit over the ombre
  layer, which the screenshots show; on flat parchment every card is solid paper.
- [x] **Corner radii are 24, 16, or 999 only; no shadows on cards.** Home:
  `{999px, 24px, 16px}` and nothing else. Story: `{999px}`. Welcome:
  `{16px, 24px, 999px}`. Panel: `{16px, 999px}`. Shadows: Home has exactly one,
  the search bar (`rgba(90,60,30,0.08) 0 8px 24px`), which is the single floating
  element; story and privacy have none; the panel has exactly one, the toggle
  knob, which the design system asks for.
- [x] **Type uses only the sizes in the table; serif for reading, sans for
  controls.** Home and story use `{13, 14, 16, 19, 22, 28, 48}`; welcome
  `{14, 16, 22, 48}`; panel `{13, 14, 22, 28}`; privacy `{14, 16, 19, 22, 48}`.
  Every one of those is in the table. Font families measured: only
  `Newsreader, Georgia, serif` (13 text elements on Home, 17 on the story page)
  and `Nunito, system-ui, sans-serif` (19 on Home), and the serif text is the
  reading text while the sans text is the meta, eyebrow, labels and buttons.
- [x] **Cards in a row share one structure.** Home builds the story card, the four
  saved cards and the three delight rows from single functions, so each row has
  one order: source, words, author. Measured: 4 saved cards with
  `p.card-source`, `div.card-text`, `p.card-author` and a 24px round avatar, and
  3 delight rows with the same accent dot and hairline divider structure.
- [x] **Focus rings are visible; touch targets are at least 44px; text contrast
  is at least 4.5:1.** The ring rule measured out of the stylesheet is
  `a:focus-visible, button:focus-visible, input:focus-visible, [role="switch"]:focus-visible
  { outline: 2px solid var(--accent); outline-offset: 3px; }`, which is rust
  `#9C4F24` by day and `#D07A45` by night, with
  `[tabindex="-1"]:focus, [tabindex="-1"]:focus-visible { outline: none }` for
  headings focused by script. Targets: min 44px on Home day, night and phone, on
  the story page, and on the panel (the toggle is a 44px button around the 44 by
  26 track, and each segmented option is 44 by 101). The two 19px entries are the
  inline links inside welcome and privacy sentences, see the differences list.
  Contrast was measured from the rendered pixels, with the text hidden and the
  pixel under each text box read back: worst 4.92:1 Home day, 4.73:1 Home night,
  4.99:1 story day, 5.23:1 story night, 4.95:1 welcome day, 5.17:1 welcome night,
  4.69:1 panel day, 5.98:1 panel night, 4.99:1 privacy.
- [x] **Wordmark is 24px or larger, with the kerning fix and clear space; hat
  icon alone below that.** Measured: Home and the panel 28px with the T at
  `margin-right: -1.68px` (0.06em), hat 20px wide (0.72em), clear space 12.6px
  (0.45em) above; welcome 48px with the hat 35px and 21.6px of clear space. Below
  24px the hat is used alone, which is what the extension icons are.
- [x] **Copy is plain, kind, and free of em dashes.** `document.body.innerText`
  contains no em dash on any of the ten loads, and the strip, the panel, the
  scanner copy and the sample content use plain sentences.

## Intentional differences from the mockups

Each of these is a choice, not a miss, and each is easy to change.

1. **Headlines are 48px, not the mockups' slightly larger display type.** The
   decisions table says to match the mockups visually but use only the design
   system's sizes, and 48px is the Display maximum.
2. **Blur mode says "softened", move mode says "moved down".** Mockup 4 shows a
   blurred post next to a banner that says "6 heated posts have been moved down",
   which mixes the two modes. Tolstoy's strip names the mode it is actually in, so
   it reads "4 heated posts moved down." in move mode and "4 heated posts
   softened." in blur mode, and the "Show them" panel heading follows the same
   rule ("Moved down for tone." against "Softened for tone.").
3. **Inline links inside sentences are 19px tall**, on the welcome footer and the
   privacy page. They are text links inside a sentence rather than controls, so
   they do not carry a 44px target. If you would rather they did, the fix is
   padding on those two anchors.
4. **Small wording in our own copy**: the search placeholder keeps its full stop
   ("Search the web."), the delight lines end with full stops, and the fourth
   saved card is full width with its text left aligned. The mockup draws them
   slightly differently, and the task's own text asks for the full-width card.
5. **The working set is the same as Task 2's**: the tests use a synthetic fixture
   and a local test page, and the host site in the calm feed screenshots is a
   neutral stand-in, as the mockup's caption says it should be.

## Other checks worth reporting

- **The promise dialog focus fix is untouched** and still passes: the panel title
  takes focus, Tab and Shift+Tab stay inside, Escape returns focus to the pill.
- **The panel still fits.** 380 by 640 with `scrollHeight` equal to
  `clientHeight` at 640, so there is nothing to scroll, day and night, after the
  target sizes grew to 44px.
- **The banner over a dark host page.** The day strip sampled over a
  `rgb(11,11,11)` page is `rgb(240,219,209)`, which gives ink 11.82:1, so the
  opaque ombre tile is readable on X's black theme as the decision asked.
- **Every shipped file parses.** `node --check` on every shipped `.js`, and the
  manifest and both fixtures parse as JSON.
- **One file carries two parts' work.** `adapters/x/intercept.js` landed in the
  Part E commit, and it contains Part G's items 1 and 2 (the XHR instance getters
  and the `response.url` copy), because the file was rewritten in one pass and
  splitting a single file across two commits would have left a broken commit in
  between. Everything else is split by part.
- **The review table listed fifteen posts and called them seventeen.** All
  fifteen rows are in the test suite and in the evaluation set as calm items. If
  two more were meant, they were not in the table.

## What the owner needs to do

Nothing right now. The live check below is for after this task is accepted.

## Questions or decisions needed

Four small ones, each with the choice I made:

1. **Blur mode's banner wording.** I made the strip name the mode. If you would
   rather it always say "moved down", as the mockup literally reads, that is a one
   line change.
2. **The two inline links on the welcome and privacy pages** are 19px tall. I left
   them as text links inside a sentence. Tell me if you want 44px targets there.
3. **The XHR cases live in their own browser visit**, because blur mode reorders
   nothing and the cases have to run where posts actually move. If you want them
   run in the same visit, the check would set the temperature back to Balanced
   first.
4. **The fourth saved card is full width**, per the task's text, while the mockup
   draws it under the first column. I followed the task.

## Live check steps for the owner

1. Download the new ZIP from GitHub and extract it, replacing the old folder.
2. Go to `chrome://extensions`, find Project Tolstoy, and click the circular
   **reload** arrow on its card.
3. Chrome may now say the extension can "Read and change your data on x.com."
   That is expected: it is how Tolstoy reads the feed.
4. Open a new tab. You should see the new Tolstoy Home, and if this is the first
   install you will also see the **welcome page** with the promises. Click the
   Tolstoy icon in the toolbar for the **settings panel** (if you do not see the
   icon, open the puzzle piece menu and pin it), and try the temperature control:
   Calm, Balanced and Unfiltered.
5. Open **x.com/home** and scroll slowly for about a minute.
6. Look for the Tolstoy strip near the bottom left, and check that its count goes
   up as you scroll.
7. If posts moved, click **Show them** and check that each one shows a reason.
8. Turn blur on in the settings panel, come back to the feed and reload the tab,
   and check that heated posts are softened in place with a "Show anyway" button.
9. Make sure X still works normally: the feed loads, scrolling loads more posts,
   and you can open posts.
10. Tell the orchestrator what the strip said, and anything that looked wrong.

One thing to watch for on step 5: whether the moved posts actually appear at the
end of the batch on screen. That is the one claim in the research notes that a
live capture can confirm or correct.

## Repository

https://github.com/Flookerton/project-tolstoy, latest part commit `5ec5294`
(Part G). This report file is committed immediately after it.

Commits for this task:

| Part | Commit | What |
| --- | --- | --- |
| A | `1c74778` | Shared design foundations and the four mockups |
| B | `39db7b0` | Tolstoy Home to mockup 1, and the story reading page |
| C | `520a9c2` | The welcome page, the privacy page, and the once-only open |
| D | `f3647fe` | The extension panel to mockup 3, with real settings |
| E | `f9ec2bb` | The calm feed on X: settings bridge, banner, blur mode |
| F | `69aff4b` | The scorer rebuilt around hostility aimed at people |
| G | `5ec5294` | Interception robustness and the small fixes |
| report | the commit that adds this file | Written so the report is reviewable in the repository |

# Research notes: reading and reordering an X timeline

Build step 4. Read on October 22, 2026 by the builder, for Task 2 Part C.

What I read, and what it is worth:

| Source | Commit | Licence | What it can tell us |
| --- | --- | --- | --- |
| [FeedMonitor](https://github.com/StanfordHCI/FeedMonitor) | `08c7c3ef` | **none** | How to intercept the timeline. No code may be copied from it |
| [Prosocial Ranking Challenge](https://github.com/HumanCompatibleAI/ranking-challenge) | `a4532c1d` | MIT in `module/` only | How a hosted ranker was wired, and what we must not copy |
| [Trekhleb, API design of the X home timeline](https://trekhleb.dev/blog/2024/api-design-x-home-timeline/) | site, Dec 2024 | n/a | The GraphQL URL and response shape |
| [twitter-web-exporter](https://github.com/prinsss/twitter-web-exporter) | `main` | MIT | Field paths, and the `sortIndex` ordering rule |

Neither research repo parses X's timeline JSON at all. FeedMonitor forwards the whole
response body as an opaque string to a server and pastes the reply back, and it has no
`entries`, `sortIndex` or `tweet_results` anywhere in it (checked by grep). The
ranking-challenge defines its own survey-style schema instead. So every path in section 2
comes from the two third-party sources above, not from the research code.

## 1. How FeedMonitor intercepts the timeline

It uses two JavaScript worlds on purpose (`BrowserExtension/manifest.json`):

- an **isolated world** content script at `run_at: "document_start"`, matching
  `*://x.com/*`, `*://twitter.com/*` and `*://localhost/*` (no `world` key: this predates it);
- a **page world** script, `injected.js`, declared only in `web_accessible_resources`,
  because a content script cannot see the page's own `fetch` and `XMLHttpRequest`. Its own
  header says so: "This script runs in the PAGE's own JavaScript context (not in the
  isolated content-script sandbox)" (`BrowserExtension/injected.js:7-10`).

Injection method (`BrowserExtension/launcher.js:101-102`): create a `<script>` element,
set `src = chrome.runtime.getURL('injected.js')`, append it to `document.head`, and remove
the tag on load. No `world: "MAIN"`, no `blob:`, no `eval`.

Timing, and the catch: the content script attaches at `document_start`, but the override is
installed later, inside an async callback. `launcher.js:57` first waits for
`chrome.storage.sync.get(['user_id'])` and only then injects, so the patch lands after a
storage round trip, and `injected.js:83` guards against a double install
(`window.SUBSCRIBED` already defined). Their methods paper only asks for the override to run
"as soon as the main page is loaded". Tolstoy's plan, `world: "MAIN"` at `document_start`
with no storage read on the path, removes that race, because we need no identity before we
can work.

What it patches, and how a request is matched: `XMLHttpRequest.prototype.open`, `send` and
`setRequestHeader`, plus `window.fetch` (`injected.js:153-161, 272-275`). A request is
interesting only if the **last path segment** of its URL is in
`window.SUBSCRIBED = ["HomeTimeline", "HomeLatestTimeline"]` (`injected.js:96, 209, 293`),
which survives X rotating its query id. For a matched request the page's own callback is
suspended: the response is stashed and a `CustomEvent("ProcessResponse")` goes to the
content script (`injected.js:216-246, 305-345`). Delivery resumes on `CustomFeedReady`,
either as a fresh `new Response(body, {status, statusText, headers})` for `fetch`
(`injected.js:381-388`) or by making the read-only `responseText` and `response` writable
with `Object.defineProperty` and calling the saved callback (`injected.js:391-404`). It also
patches `history.pushState`/`replaceState` so a route change to `/home` is observable
(`injected.js:422-461`). We do not need that, because our content script is already there
from page load.

The hop we delete: `BrowserExtension/logic.js:75` posts `{feed_info: evt.detail}` to
`POST /get_feed`, where `detail.response` is the entire feed JSON as a string, and the
study server (`Backend/main.py:88-100`) writes it to `data/feed_<user_id>.json` before
returning a replacement. The repo's own reranker is a stub: `Backend/feed_logic.py` ends
with "# Default behaviour: return the feed unchanged (observation-only / passthrough).
return feed".

## 2. The GraphQL URL and the JSON paths (HomeTimeline, HomeLatestTimeline)

Request: `POST https://x.com/i/api/graphql/{query-id}/HomeTimeline` and the same with
`HomeLatestTimeline`, with a body of `{queryId, variables: {count, cursor?, seenTweetIds[]},
features}` (Trekhleb). The query id rotates between deployments, so code must never pin it:
match the trailing operation name instead. FeedMonitor and twitter-web-exporter both do.

Response, and the paths we need. "E" means one entry inside the instruction's `entries`
array.

| Need | Path |
| --- | --- |
| timeline root | `data.home.home_timeline_urt.instructions[]` |
| batch | the instruction with `type === "TimelineAddEntries"`, then `.entries[]` |
| a normal post | `E.entryId` starts with `tweet-`, `E.content.entryType === "TimelineTimelineItem"`, `E.content.itemContent.__typename === "TimelineTweet"` |
| the tweet object | `E.content.itemContent.tweet_results.result`, which may be absent (limited visibility) or a union: `Tweet`, `TweetWithVisibilityResults` (real tweet at `.tweet`), `TweetTombstone`, `TweetUnavailable` |
| tweet text | `…result.note_tweet.note_tweet_results.result.text` when present, otherwise `…result.legacy.full_text` |
| author handle | `…result.core.user_results.result.core.screen_name` (newer payloads). Trekhleb's 2024 types still show `…result.legacy.screen_name`, so read both |
| tweet id | `…result.rest_id`, also in `E.entryId` as `tweet-<id>` |
| top cursor | `E.content.entryType === "TimelineTimelineCursor"`, `E.entryId` starts with `cursor-top-`, `E.content.cursorType === "Top"`, token in `E.content.value` |
| bottom cursor | same with `cursor-bottom-` and `"Bottom"`. `cursorType` can also be `ShowMore` or `ShowMoreThreads` |
| promoted post | `E.content.itemContent.promotedMetadata` present, or `E.entryId` starts with `promoted-` (`promoted-tweet-<id>-<hash>`) |
| conversation module | `E.content.entryType === "TimelineTimelineModule"`, often `displayType === "VerticalConversation"`, tweets at `E.content.items[].item.itemContent.tweet_results.result`, inner ids like `conversationthread-<id>-tweet-<tid>` |

Design consequences, all from those sources: `tweet_results` can be missing or a union, so
every read needs a guard; `legacy` is being emptied field by field, so prefer the newer
paths and fall back; any `entryType` we do not recognise is passed through untouched.

One gap, stated plainly: nobody documents the response root of `HomeLatestTimeline`. The
third-party exporters apply the same `data.home.home_timeline_urt` extractor to both
operations, which suggests the same root, but I found no explicit statement. Our reranker
therefore looks for the `instructions` array under the known root first, and under any
other single-key object in `data` second, and fails open if it finds nothing.

## 3. How X decides display order, and how a new order can stick

Entries carry `sortIndex` next to `entryId`, and the display order is `sortIndex`
**descending**, not array position:

- twitter-web-exporter `src/utils/api.ts` sorts before use, with this comment: "After an
  update, Twitter's API may return array items in random order. Here we sort them by
  `sortIndex` descending to ensure the correct order in the timeline", and its
  `compareSortIndex` docstring says "The bigger the sortIndex, the earlier the entry appears
  in the timeline".
- Trekhleb: "The sorting order of the timeline entries is defined by the backend via the
  `sortIndex` properties", higher values sit higher.
- `sortIndex` is a decimal string that can exceed IEEE-754 precision (twitter-web-exporter
  compares with `BigInt`; a module example is 73343543020642838441). Never use `Number()`
  on it.

So reordering the `entries` array alone is not enough: a client that sorts by `sortIndex`
would put the batch back the way X sent it. Our method, and it is an inference from the
above rather than a published recipe (labelled as such, not verified against a live capture
yet), is:

1. work out the new order of the batch's units (cursors and promoted entries are not
   scored, and they keep their own places);
2. take the batch's existing `sortIndex` values, sort them descending, and hand them out
   again in the new display order, so the top entry gets the largest value;
3. leave every other field alone and send the modified JSON back to the page.

An entry that does not move keeps the same `sortIndex` it arrived with, because it keeps the
same position in the list, which keeps cursors and ads consistent with their old slots. Both
readers now agree: if the client trusts array order it sees our order, and if it sorts by
`sortIndex` it computes the same order. Interception (section 1) already solves delivery,
so this stays inside the page with no round trip.

Approaches we rejected: reordering DOM nodes (X recycles them while scrolling, so the tree
is never complete), CSS flex `order` on tweet cells (works for a profile timeline, cannot
see the whole batch), and FeedMonitor's remove-and-reinsert-at-scroll-position trick
(fragile, and it needs to track which posts were consumed). The ranking-challenge paper
gives one precedent worth keeping: it treated "ads and items without text content" as
immovable and reordered around them, which matches our decision to leave promoted entries
exactly where X put them. It also only reranked the first N posts of a slate, because it
cannot move a post from one batch into another. Tolstoy has the same limit, so we only ever
reorder within the batch we were handed.

## 4. What we deliberately avoid

FeedMonitor, and why each item is out for us:

- a persistent participant id, created once and kept in `chrome.storage.sync`
  (`launcher.js:57-67`), so it rides the person's Google account;
- that id, the page URL and the extension version attached to every request
  (`libs/client.js:73-86`);
- the raw feed text itself leaving the machine (`logic.js:75`, `Backend/main.py:88-89`);
- a behavioural dossier: rendered tweet ids, per-tweet visibility timers, link clicks inside
  tweets, likes and retweets with their request bodies, a 10 second heartbeat, tab focus and
  time on page (`events.js`, `Backend/main.py:31-54`);
- feed content printed to the developer console (`logic.js:54`, `injected.js:244`);
- ranking on a server, and a CORS-enabled backend to reach it (`Backend/main.py:18`);
- freezing the scroll while a server call is in flight (`events.js:326-342`). With local
  scoring there is nothing to wait for.

The ranking-challenge, same reasoning, different shape: its ranker request carries
`session.user_id`, `session.user_name_hash` and a survey block with party, ideology, income
and ethnicity (`docs/api_reference.md:15-43`), it sends the text of up to 50 posts to a
hosted service (`module/src/ranking_challenge/request.py:54-107`), and the service answers
with `ranked_ids` (`response.py:24-37`). Even its control group went through the server. Its
one good idea is that every author field is already a hash.

Tolstoy's rules, which the adapter follows: no network calls of its own; no user id, no
session, no account data; feed text never leaves the page and is never logged, and moved
posts live only in page memory; no server ranking; promoted entries are skipped, not scored
and not reordered; parse defensively and, on anything unexpected, hand X back exactly what
it sent.

## 5. The reply page response (TweetDetail)

Written in Task 4, from `tests/fixtures/tweet-detail.json` and the public descriptions of the
endpoint. Not yet confirmed against a live payload, and labelled as unconfirmed here.

- The request is `POST /i/api/graphql/<query id>/TweetDetail`. Same `/i/api/graphql/` prefix,
  same one-query-id-per-operation habit as the home timeline, which is why the adapter matches
  on the trailing operation name and never on a pinned query id.
- The body is **not** `data.home.home_timeline_urt`. It is
  `data.threaded_conversation_with_injections_v2`; older builds carry
  `data.threaded_conversation_with_injections`, without the `_v2`. Both hold the familiar
  `instructions: [{ type, entries }]` array, so the reranker looks for either.
- Three instruction types appear, and the shape is what matters:
  - `TimelineAddEntries` holding a **conversation module**: one entry whose `content.items` is
    the list of posts in the thread, each item keeping its tweet at
    `item.itemContent.tweet_results.result`, one level shallower than a top-level entry's
    `content.itemContent`. The module also carries the post being replied to, the focal post,
    the replies, and a bottom cursor.
  - `TimelinePinEntry`, whose `entry` is the focal post, the one whose page is open.
  - A second `TimelineAddEntries` with the next page of replies and its own bottom cursor.
- The focal post is named in the module's own entry id: `conversationthread-<focalTweetId>`.
- The rule the adapter follows, and what the tests assert: the focal post and anything above it
  (the thread it replies to) keep the position X gave them. Only the replies below the focal
  post are scored and moved, and only inside their own run, so a reply can never be lifted
  above the post it answers.
- Whether X's live payload uses these exact field names and this instruction mix is
  **unverified**. The adapter treats any unrecognised shape as "leave it alone and hand X back
  exactly what it sent", so a mismatch degrades rather than breaks.

## Sources

- [FeedMonitor](https://github.com/StanfordHCI/FeedMonitor) (`BrowserExtension/manifest.json`, `launcher.js`, `injected.js`, `logic.js`, `libs/client.js`, `events.js`, `Backend/main.py`, `Backend/feed_logic.py`)
- [Prosocial Ranking Challenge](https://github.com/HumanCompatibleAI/ranking-challenge) (`docs/api_reference.md`, `module/src/ranking_challenge/request.py`, `response.py`)
- [FeedMonitor methods paper](https://arxiv.org/html/2406.19571v2), section 5.1
- [Prosocial Ranking Challenge paper](https://arxiv.org/html/2603.19626v1), supplementary text
- [Trekhleb, API design of the X home timeline](https://trekhleb.dev/blog/2024/api-design-x-home-timeline/)
- [twitter-web-exporter](https://github.com/prinsss/twitter-web-exporter) (`src/utils/api.ts`, `src/types/index.ts`)

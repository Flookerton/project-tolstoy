# Project Tolstoy

Tolstoy is a free, open-source browser extension that uses an AI running locally on your computer to make social media calmer and more compassionate. It also replaces your browser's new tab page with Tolstoy Home, a personal homepage that collects the best of what you already follow. Everything runs on your computer: no feed content ever leaves your device.

## Seven principles

1. **Local only.** Feed content and history never leave your computer. The only network use is downloading the extension and the AI model.
2. **No ads, ever, inside anyone's feed.** No advertising is injected into your social feeds, ever.
3. **Open source.** All code is public so anyone can verify these promises.
4. **Lower, never delete.** Tolstoy only reorders or softly blurs. You can always see what was moved and why.
5. **Tone, not opinion.** Tolstoy scores how something is said (hostility, dehumanizing language), never which view it holds.
6. **User in control and opt-in.** You choose your settings and can turn any feature off.
7. **A feed that ends.** No engagement mechanics that reward screen time in anything Tolstoy builds.

## Status

Status: early build, version 0.2.0. Two things work today.

**Tolstoy Home** replaces the new tab page with a calm page of sample content: a story for the day, four small delights, and six saved posts. The content is still fictional sample text, not real saved posts.

**The calm feed** works on x.com. Tolstoy reads each timeline batch before X draws it, scores each post with a short list of published rules, moves the heated ones to the end of their batch, and says so in a small banner near the bottom left. Nothing is deleted. "Show them" lists every post that moved, with the reason, and a link back to the post.

Still to come: the local AI model, the temperature control, the blur mode, settings, the welcome page, storing anything, and Tolstoy Home using real posts.

## What it asks for

- `search`, so the search bar on the new tab page can hand your words to your own default search engine, the same way the address bar does.
- Access to `https://x.com/*`, so the calm feed can read the timeline.

Nothing else. Tolstoy makes no network request of its own, keeps no user id, and stores nothing. Moved posts live in the page's memory and are forgotten when you close the tab.

## How to load the extension

1. On the repository page on GitHub, click the green **Code** button, then **Download ZIP**.
2. Open your Downloads folder, right-click the ZIP file, choose **Extract All**, then click **Extract**.
3. In Chrome, type `chrome://extensions` in the address bar and press Enter.
4. Turn on **Developer mode** (top right).
5. Click **Load unpacked**, open the extracted folder, select the **extension** folder inside it, and click **Select Folder**.
6. Open a new tab. If Chrome asks whether to keep the change, choose **Keep it**.

To try the calm feed, open **x.com/home** and scroll slowly for a minute. The banner appears near the bottom left. If you already had Tolstoy loaded, click the circular **reload** arrow on its card in `chrome://extensions` first. Chrome may now say the extension can "read and change your data on x.com": that is how Tolstoy reads the timeline, and it is the only site it touches.

## The rules are public

Every rule Tolstoy uses to score a post is in [`extension/scoring/rules.js`](extension/scoring/rules.js), and [`docs/scoring-rules.md`](docs/scoring-rules.md) explains all of them in plain words, including what they get wrong. No rule mentions a party, a politician, an ideology, a country, a religion, or a political question.

## Other documents

- [`docs/design-system.md`](docs/design-system.md): how Tolstoy looks and sounds.
- [`docs/research-notes.md`](docs/research-notes.md): how the research tools read a feed, and what Tolstoy does differently.
- [`tests/`](tests): the scorer and the reranker. Run them with `node --test` from the repository root, on Node 18 or later. No dependencies.

## License

GPL-3.0. See the [LICENSE](LICENSE) file for the full text.

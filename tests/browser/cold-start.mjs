// Cold start: the first screen, with nothing warmed and nothing downloaded.
//
// Two runs, both on a fresh profile with the extension loaded and the model that comes
// inside it, and neither waiting for the model before navigating:
//
//   1. straight in, which is what a person does
//   2. ?falseStatus=1, which tells the page "the model is not here" just before the
//      first timeline arrives. A half-woken service worker looks exactly like that, and
//      a single such answer used to silence the model for the whole visit. This is the
//      case that must be queued rather than dropped.
//
// In both, within five seconds of the first screen, the posts the model calls hostile
// must be softened where they stand or listed in Show them, and the footer must credit
// the model.
//
// Run with the node that ships with Hermes, from C:/Users/adama/tolstoy-tools:
//   node C:/Users/adama/project-tolstoy/tests/browser/cold-start.mjs
//
// Playwright is not a dependency of this repository, so it is resolved from the
// tooling folder instead (override with TOLSTOY_TOOLS).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const toolsDir = process.env.TOLSTOY_TOOLS || 'C:/Users/adama/tolstoy-tools';
const require = createRequire(toolsDir.replace(/\/?$/, '/') + 'noop.js');
const { chromium } = require('playwright');

const REPO = 'C:/Users/adama/project-tolstoy';
const EXT = REPO + '/extension';
const CALIBRATION = 0.8;
const LINE = 0.5;

const fixtureText = fs.readFileSync(REPO + '/tests/fixtures/ai-only-timeline.json', 'utf8');
const posts = JSON.parse(fixtureText).aiOnly.posts;
const pageHtml = fs.readFileSync(REPO + '/tests/pages/banner-test.html', 'utf8');
const pageJs = fs.readFileSync(REPO + '/tests/pages/banner-test.js', 'utf8');

// Each round of the fixture is a fresh screen of posts with its own ids. Without that
// a second batch is a batch of posts the page has already decided about, no model ask
// is made at all, and there is no queue to test.
function freshRound(base, round) {
  if (!round) {
    return base;
  }
  const json = JSON.parse(base);
  const add = json.data.home.home_timeline_urt.instructions.find((i) => i.type === 'TimelineAddEntries');
  for (const entry of add.entries || []) {
    if (!entry.entryId || entry.entryId.indexOf('tweet-') !== 0) continue;
    entry.entryId = entry.entryId + '-r' + round;
    const res = entry.content && entry.content.itemContent && entry.content.itemContent.tweet_results && entry.content.itemContent.tweet_results.result;
    if (res && res.rest_id) res.rest_id = res.rest_id + '-r' + round;
    if (res && res.legacy && res.legacy.id_str) res.legacy.id_str = res.legacy.id_str + '-r' + round;
  }
  return JSON.stringify(json);
}

let failed = 0;
function check(name, ok, detail) {
  if (!ok) failed += 1;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  [' + detail + ']' : ''));
}

async function coldRun(query) {
  let round = 0;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tolstoy-coldtest-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: { width: 1280, height: 1000 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  const extId = new URL(sw.url()).host;
  const outside = [];
  ctx.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith('chrome-extension://') && !u.startsWith('data:') && !u.startsWith('blob:') && u.indexOf('x.com') === -1) {
      outside.push(u);
    }
  });

  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname !== 'x.com') return route.continue();
    if (u.pathname.endsWith('/banner-test.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: pageJs });
    if (u.pathname === '/tolstoy-test') return route.fulfill({ status: 200, contentType: 'text/html', body: pageHtml });
    if (u.pathname.includes('/i/api/graphql/')) return route.fulfill({ status: 200, contentType: 'application/json', body: freshRound(fixtureText, round) });
    return route.continue();
  });

  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  PAGE ERROR:', String(e.message).slice(0, 200)));
  await page.goto('https://x.com/tolstoy-test' + query);
  await page.waitForFunction(() => window.tolstoyTest && window.tolstoyTest.ready, null, { timeout: 20000 });

  // Watch for up to five seconds from the first screen, writing down the moment each of
  // the five is dealt with. Nothing asks the model anything here: asking would warm it
  // and there would be no cold start left to test. Which of the five the model calls
  // hostile is settled afterwards, when the model is warm and the answer costs nothing.
  const started = Date.now();
  const dealtAt = {};
  let state = null;
  while (Date.now() - started < 5000) {
    const snap = await page.evaluate(() => {
      const host = document.querySelector('[data-tolstoy="banner"]');
      const root = host && host.shadowRoot;
      return {
        veiled: Array.from(document.querySelectorAll('[data-tolstoy-veil]')).map((v) => v.getAttribute('data-tolstoy-veil')),
        listed: root ? Array.from(root.querySelectorAll('.row .text')).map((r) => r.textContent || '') : [],
        state: window.__tolstoyState ? window.__tolstoyState() : null
      };
    });
    state = snap.state;
    const veiled = new Set(snap.veiled);
    for (const post of posts) {
      if (dealtAt[post.entryId]) {
        continue;
      }
      const isDealt = veiled.has(post.entryId.replace('tweet-', '')) ||
        snap.listed.some((row) => row.indexOf(post.text.slice(0, 40)) !== -1);
      if (isDealt) {
        dealtAt[post.entryId] = Date.now() - started;
      }
    }
    if (Object.keys(dealtAt).length === posts.length) {
      break;
    }
    await page.waitForTimeout(250);
  }
  const elapsed = Date.now() - started;

  // Now, and only now, ask the model which of the five it calls hostile.
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${extId}/panel/panel.html`);
  await panel.bringToFront();
  const verdicts = await panel.evaluate((texts) => new Promise((resolve) => {
    chrome.runtime.sendMessage({ source: 'tolstoy', type: 'score', texts: texts }, resolve);
  }), posts.map((p) => p.text));
  const hostile = posts.filter((p) => {
    const raw = verdicts && verdicts.scores ? verdicts.scores[p.text] : undefined;
    return typeof raw === 'number' && raw * CALIBRATION >= LINE;
  });
  const dealt = hostile.filter((p) => dealtAt[p.entryId] !== undefined);

  // The queue, on purpose: say the model is not here, then ask for another batch. The
  // batch must be remembered rather than dropped, and must still be scored when the
  // model answers. This is the shape of the bug the orchestrator found, made repeatable.
  let queued = null;
  if (query) {
    round = 1;
    await page.evaluate(() => {
      window.tolstoyTest.sayModelIsAbsent();
      return window.tolstoyTest.anotherBatch();
    });
    await page.waitForTimeout(300);
    queued = await page.evaluate(() => window.__tolstoyState());
    await page.waitForTimeout(2500);
    const after = await page.evaluate(() => window.__tolstoyState());
    queued = { atOnce: queued, afterFlush: after };
  }

  const final = await page.evaluate(() => {
    const host = document.querySelector('[data-tolstoy="banner"]');
    const root = host && host.shadowRoot;
    const show = root ? root.querySelector('.show') : null;
    if (show && show.hidden === false) show.click();
    return {
      veils: Array.from(document.querySelectorAll('[data-tolstoy-veil]')).map((v) => ({
        id: v.getAttribute('data-tolstoy-veil'),
        reason: v.shadowRoot && v.shadowRoot.querySelector('.reason') ? v.shadowRoot.querySelector('.reason').textContent : ''
      })),
      listed: root ? Array.from(root.querySelectorAll('.row .text')).map((r) => r.textContent || '') : [],
      scoredBy: root && root.querySelector('.scored-by') ? root.querySelector('.scored-by').textContent.trim() : null,
      lateLine: root && root.querySelector('.late') && !root.querySelector('.late').hidden ? root.querySelector('.late').textContent.trim() : null,
      state: window.__tolstoyState ? window.__tolstoyState() : null
    };
  });

  await ctx.close();
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {}
  return { query, hostile, dealt, dealtAt, elapsed, final, state, outside, queued };
}

const label = (r) => (r.query ? 'with a false "not here" first' : 'straight in, nothing warmed');

for (const query of ['', '?falseStatus=1']) {
  const run = await coldRun(query);
  const state = run.final.state || {};
  console.log('\n' + label(run) + ':');
  console.log('  the model calls ' + run.hostile.length + ' of the five hostile');
  console.log('  dealt with: ' + run.dealt.length + ' of ' + run.hostile.length +
    ' (' + run.hostile.map((p) => p.entryId + ' at ' + run.dealtAt[p.entryId] + 'ms').join(', ') + ')');
  console.log('  veils: ' + JSON.stringify(run.final.veils.map((v) => v.id + ' ' + v.reason.slice(0, 18))));
  console.log('  footer: ' + JSON.stringify(run.final.scoredBy));
  console.log('  late line: ' + JSON.stringify(run.final.lateLine));
  console.log('  state: ' + JSON.stringify({
    coverage: state.coverage, askedBatches: state.askedBatches, queuedBatches: state.queuedBatches,
    queuedNow: state.queuedNow, deadlineFallbacks: state.deadlineFallbacks, lateCaught: state.lateCaught
  }));

  const slowest = Math.max(0, ...run.hostile.map((p) => run.dealtAt[p.entryId] || 0));
  check(label(run) + ': every post the model calls hostile is dealt with within five seconds',
    run.hostile.length > 0 && run.dealt.length === run.hostile.length,
    run.dealt.length + ' of ' + run.hostile.length + ', the last at ' + slowest + 'ms');
  check(label(run) + ': the footer credits the model', /rules and the on-device model/.test(run.final.scoredBy || ''), run.final.scoredBy);
  check(label(run) + ': the late catch did the work', (state.lateCaught || 0) > 0, 'lateCaught ' + state.lateCaught);
  check(label(run) + ': nothing left the computer', run.outside.length === 0, String(run.outside.length));
  if (query) {
    const atOnce = run.queued && run.queued.atOnce ? run.queued.atOnce : {};
    const afterFlush = run.queued && run.queued.afterFlush ? run.queued.afterFlush : {};
    console.log('  the queue, made to happen on purpose: at once ' + JSON.stringify({
      queuedBatches: atOnce.queuedBatches, queuedNow: atOnce.queuedNow, askedBatches: atOnce.askedBatches
    }) + ', after the flush ' + JSON.stringify({
      queuedBatches: afterFlush.queuedBatches, queuedNow: afterFlush.queuedNow,
      askedBatches: afterFlush.askedBatches, flushTries: afterFlush.flushTries
    }));
    check(label(run) + ': a batch asked about while the model looks absent is queued, not dropped',
      (atOnce.queuedBatches || 0) > 0, 'queuedBatches ' + atOnce.queuedBatches + ', waiting ' + atOnce.queuedNow);
    check(label(run) + ': the queued batch is sent once the model answers',
      (afterFlush.queuedNow || 0) === 0 && (afterFlush.flushedBatches || 0) > 0,
      'flushedBatches ' + afterFlush.flushedBatches + ', still waiting ' + afterFlush.queuedNow);
    // Every batch either needed no ask, was asked, or is still waiting.
    const sums = [atOnce, afterFlush].map((x) => ({
      batches: x.batches, known: x.knownBatches, asked: x.askedBatches, waiting: x.queuedNow,
      adds: (x.knownBatches || 0) + (x.askedBatches || 0) + (x.queuedNow || 0)
    }));
    check(label(run) + ': the counters add up',
      sums.every((x) => x.batches === x.adds),
      JSON.stringify(sums));
  }
}

console.log('\n' + (failed ? failed + ' checks failed' : 'all checks passed'));
await fs.promises.writeFile(toolsDir + '/cold-start-test-report.json', JSON.stringify({ failed }, null, 2));
process.exit(failed ? 1 : 0);
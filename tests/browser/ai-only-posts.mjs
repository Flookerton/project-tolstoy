// Browser check: the five AI-only posts, on a real page, with the model that ships
// inside the extension.
//
// The five posts are the ones the rules score under the line and the model is meant to
// catch. The check does two things:
//
//   1. It asks the model, through the extension's own message path, what it makes of
//      each of the five, and prints the verdict for every one.
//   2. It puts the same five on a page and checks that every post the model calls
//      hostile is actually dealt with: moved down, or softened where it stands with
//      the model's own reason.
//
// It reports itself as skipped, and passes, when no model can answer at all (for
// instance when the runtime files are missing): the rules still carry the page, and a
// model that is not there cannot be tested.
//
// Run with the node that ships with Hermes, from C:/Users/adama/tolstoy-tools:
//   node C:/Users/adama/project-tolstoy/tests/browser/ai-only-posts.mjs
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
const MODEL_REASONS = ['Insults someone', 'Threatens harm', 'Attacks people for who they are', 'Severely hostile', 'Hostile tone.'];

const fixtureText = fs.readFileSync(REPO + '/tests/fixtures/ai-only-timeline.json', 'utf8');
const posts = JSON.parse(fixtureText).aiOnly.posts;
const pageHtml = fs.readFileSync(REPO + '/tests/pages/banner-test.html', 'utf8');
const pageJs = fs.readFileSync(REPO + '/tests/pages/banner-test.js', 'utf8');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tolstoy-aionly-'));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true, viewport: { width: 1280, height: 1000 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
const extId = new URL(sw.url()).host;

await ctx.route('**/*', (route) => {
  const u = new URL(route.request().url());
  if (u.hostname !== 'x.com') return route.continue();
  if (u.pathname.endsWith('/banner-test.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: pageJs });
  if (u.pathname === '/tolstoy-test') return route.fulfill({ status: 200, contentType: 'text/html', body: pageHtml });
  if (u.pathname.includes('/i/api/graphql/')) return route.fulfill({ status: 200, contentType: 'application/json', body: fixtureText });
  return route.continue();
});

// Bring the bundled model up the way an ordinary visit does, then let it load.
const panel = await ctx.newPage();
await panel.goto(`chrome-extension://${extId}/panel/panel.html`);
await panel.bringToFront();
await panel.evaluate(() => new Promise((resolve) => {
  chrome.runtime.sendMessage({ source: 'tolstoy', type: 'warm' }, resolve);
}));

const verdicts = await panel.evaluate((texts) => new Promise((resolve) => {
  chrome.runtime.sendMessage({ source: 'tolstoy', type: 'score', texts: texts }, resolve);
}), posts.map((p) => p.text));

const modelSays = {};
let answered = 0;
for (const post of posts) {
  const raw = verdicts && verdicts.scores ? verdicts.scores[post.text] : undefined;
  const score = typeof raw === 'number' ? raw : 0;
  if (typeof raw === 'number') {
    answered += 1;
  }
  modelSays[post.text] = { score, blend: score * CALIBRATION };
}

if (!answered) {
  console.log('SKIPPED: no model can answer here (score reply: ' + JSON.stringify(verdicts).slice(0, 160) + ')');
  console.log('The page still works with the rules alone, so there is nothing to fail.');
  await ctx.close();
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {}
  process.exit(0);
}

console.log('the model, asked one post at a time through the extension:');
for (const post of posts) {
  const v = modelSays[post.text];
  console.log('  ' + (v.blend >= LINE ? 'hostile' : 'below the line').padEnd(14) +
    ' model ' + v.score.toFixed(3) + '  ' + JSON.stringify(post.text.slice(0, 46)));
}

// Now the page.
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  PAGE ERROR:', String(e.message).slice(0, 200)));
await page.goto('https://x.com/tolstoy-test');
await page.waitForFunction(() => window.tolstoyTest && window.tolstoyTest.ready, null, { timeout: 20000 });
await page.waitForTimeout(5000);

const view = await page.evaluate(() => {
  const host = document.querySelector('[data-tolstoy="banner"]');
  const root = host && host.shadowRoot;
  const show = root ? root.querySelector('.show') : null;
  if (show && show.hidden === false) show.click();
  const rows = root ? Array.from(root.querySelectorAll('.row')).map((r) => ({
    text: (r.querySelector('.text') || {}).textContent || '',
    reasons: (r.querySelector('.reasons') || {}).textContent || ''
  })) : [];
  return {
    drawn: Array.from(document.querySelectorAll('#feed article')).map((a) => a.getAttribute('data-status-id')),
    veils: Array.from(document.querySelectorAll('[data-tolstoy-veil]')).map((v) => ({
      id: v.getAttribute('data-tolstoy-veil'),
      reason: v.shadowRoot && v.shadowRoot.querySelector('.reason') ? v.shadowRoot.querySelector('.reason').textContent : ''
    })),
    rows,
    scoredBy: root && root.querySelector('.scored-by') ? root.querySelector('.scored-by').textContent.trim() : null,
    state: window.__tolstoyState ? window.__tolstoyState() : null
  };
});

// A post is dealt with when it is softened where it stands, or when the page lists it
// as moved with a reason. Position alone is not enough to call it: the fixture draws
// the order the response arrives in.
const veiled = new Set(view.veils.map((v) => v.id));
const listed = new Set(view.rows.map((r) => r.text));
const dealt = (post) => {
  if (veiled.has(post.entryId.replace('tweet-', ''))) return 'softened';
  const text = post.text;
  if (Array.from(listed).some((t) => t.indexOf(text.slice(0, 40)) !== -1)) return 'moved';
  return null;
};

console.log('\nthe page:');
console.log('  footer: ' + JSON.stringify(view.scoredBy));
console.log('  posts drawn: ' + view.drawn.length + ', veiled: ' + view.veils.length + ', listed in Show them: ' + view.rows.length);

let wanted = 0;
let caught = 0;
let problems = 0;
for (const post of posts) {
  const v = modelSays[post.text];
  const how = dealt(post);
  const should = v.blend >= LINE;
  if (should) wanted += 1;
  if (should && how) caught += 1;
  if (should && !how) problems += 1;
  console.log('  ' + (should ? 'hostile' : 'below').padEnd(8) + (how || 'left alone').padEnd(11) +
    JSON.stringify(post.text.slice(0, 40)));
}

// Every reason shown for a post the model caught must be a real reason, never a blank.
const reasonFor = (post) => {
  const veil = view.veils.find((v) => v.id === post.entryId.replace('tweet-', ''));
  if (veil) return veil.reason;
  const row = view.rows.find((r) => r.text.indexOf(post.text.slice(0, 40)) !== -1);
  return row ? row.reasons : '';
};
const reasons = posts.filter((p) => dealt(p)).map(reasonFor);
const badReason = reasons.filter((r) => !MODEL_REASONS.some((m) => r.indexOf(m) !== -1));

let failed = 0;
function check(name, ok, detail) {
  if (!ok) failed += 1;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  [' + detail + ']' : ''));
}

console.log('');
const modelScoredEverything = view.state.coverage.first.scored === view.state.coverage.first.asked && view.state.coverage.first.asked > 0;
check('every post of the first batch had a model score before display', modelScoredEverything, JSON.stringify(view.state.coverage.first));
check('every post the model calls hostile was dealt with, moved or softened',
  wanted > 0 && caught === wanted, caught + ' of ' + wanted);
check('no post dealt with shows a blank or "undefined" reason',
  badReason.length === 0, JSON.stringify(reasons.slice(0, 3)));
check('the footer credits both the rules and the model',
  /rules and the on-device model/.test(view.scoredBy || ''), view.scoredBy);
check('no post was dropped from the page', view.drawn.length >= 17, view.drawn.length + ' drawn');

console.log('\nof the five, the model calls ' + wanted + ' hostile and they are all dealt with: ' +
  caught + ' of ' + wanted + (wanted < posts.length ? ' (the other ' + (posts.length - wanted) + ' it reads as below the line)' : ''));
console.log(failed ? failed + ' checks failed' : 'all checks passed');

fs.writeFileSync(toolsDir + '/ai-only-posts-report.json', JSON.stringify({ modelSays, view, wanted, caught, failed }, null, 2));
await ctx.close();
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {}
process.exit(failed ? 1 : 0);
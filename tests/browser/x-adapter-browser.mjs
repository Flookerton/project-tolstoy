// Browser check for the X adapter and the banner.
//
// Loads the extension in Chromium, serves the synthetic fixture to a local test
// page over the x.com origin (so the content scripts match, with no real
// account and no network), then reads what the page received and what the
// banner says. Day and night screenshots of the banner and the open panel.
//
// Run with the node that ships with Hermes, from C:/Users/adama/tolstoy-tools:
//   node C:/Users/adama/project-tolstoy/tests/browser/x-adapter-browser.mjs
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
const SHOTS = REPO + '/docs/screenshots';

const fixtureText = fs.readFileSync(REPO + '/tests/fixtures/home-timeline.json', 'utf8');
const pageHtml = fs.readFileSync(REPO + '/tests/pages/banner-test.html', 'utf8');
const pageJs = fs.readFileSync(REPO + '/tests/pages/banner-test.js', 'utf8');
const otherQuery = '{"data":{"untouched":true}}';

// The same fixture with the four heated posts removed, for the "nothing moved"
// branch of the banner text.
const calmOnly = (() => {
  const json = JSON.parse(fixtureText);
  const heated = new Set(['1002', '1005', '1008', '1016']);
  const instruction = json.data.home.home_timeline_urt.instructions.find((i) => i.type === 'TimelineAddEntries');
  instruction.entries = instruction.entries.filter((entry) => !heated.has(entry.entryId.replace('tweet-', '')));
  return JSON.stringify(json);
})();

const out = {};
const lines = [];
function log(...args) { lines.push(args.join(' ')); console.log(...args); }

function srgbToLin(c) { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
function luminance([r, g, b]) { return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b); }
function contrast(a, b) { const la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
function hexToRgb(hex) { return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); }

async function open({ scheme, timeline, viewport = { width: 1280, height: 900 }, darkHost = false }) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tolstoy-x-'));
  const html = darkHost ? pageHtml.replace('<body>', '<body style="background:#0B0B0B;color:#EEEEEE">') : pageHtml;
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    colorScheme: scheme,
    viewport,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  await ctx.route('**/*', (route) => {
    const raw = route.request().url();
    let parsed;
    try {
      parsed = new URL(raw);
    } catch (error) {
      return route.continue();
    }
    const onX = parsed.hostname === 'x.com';
    if (onX && parsed.pathname.endsWith('/banner-test.js')) {
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: pageJs });
    }
    if (onX && parsed.pathname === '/tolstoy-test') {
      return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    }
    if (onX && parsed.pathname.includes('/i/api/graphql/')) {
      if (parsed.pathname.endsWith('/OtherQuery')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: otherQuery });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: timeline });
    }
    return route.continue();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('https://x.com/tolstoy-test');
  await page.waitForFunction(() => window.tolstoyTest && window.tolstoyTest.entryIds.length > 0, null, { timeout: 20000 });
  await page.waitForTimeout(1200);
  return { ctx, page, profile, errors };
}

const bannerState = (page) => page.evaluate(() => {
  const host = document.querySelector('[data-tolstoy="banner"]');
  if (!host || !host.shadowRoot) return null;
  const root = host.shadowRoot;
  const strip = root.querySelector('.strip');
  const show = root.querySelector('.show');
  const wrap = root.querySelector('.panel-wrap');
  const rows = Array.from(root.querySelectorAll('.row')).map((row) => ({
    handle: row.querySelector('.handle')?.textContent || '',
    text: row.querySelector('.text')?.textContent || '',
    flag: row.querySelector('.flag')?.textContent || '',
    reasons: row.querySelector('.reasons')?.textContent || '',
    link: row.querySelector('.open')?.getAttribute('href') || '',
  }));
  return {
    stripText: strip ? strip.textContent.replace(/\s+/g, ' ').trim() : '',
    showVisible: show ? !show.hidden : false,
    panelOpen: wrap ? !wrap.hidden : false,
    panelTitle: root.querySelector('.panel h2')?.textContent || '',
    rows,
    fonts: strip ? getComputedStyle(strip).fontFamily : '',
    glass: strip ? getComputedStyle(strip).backgroundColor : '',
    radius: strip ? getComputedStyle(strip).borderRadius : '',
    shadow: strip ? getComputedStyle(strip).boxShadow : '',
    panelRadius: root.querySelector('.panel') ? getComputedStyle(root.querySelector('.panel')).borderRadius : '',
  };
});

// ---------------------------------------------------------------- day, with heated posts
{
  const { ctx, page, profile, errors } = await open({ scheme: 'light', timeline: fixtureText });
  const received = await page.evaluate(() => ({
    ids: window.tolstoyTest.entryIds,
    sortIndexes: window.tolstoyTest.sortIndexes,
    passthrough: document.getElementById('passthrough').textContent,
    parseError: window.tolstoyTest.parseError,
  }));
  out.receivedOrder = received.ids;
  out.passthrough = received.passthrough;
  log('entries the page received:', received.ids.length);
  log('order:', received.ids.join(', '));
  log('other query:', received.passthrough);
  if (received.parseError) log('PARSE ERROR:', received.parseError);

  const calmIds = ['tweet-1001', 'tweet-1003', 'tweet-1004', 'tweet-1006', 'tweet-1007', 'tweet-1009', 'tweet-1010',
    'tweet-1011', 'tweet-1012', 'tweet-1013', 'tweet-1014', 'tweet-1015', 'tweet-1017'];
  const heatedIds = ['tweet-1002', 'tweet-1005', 'tweet-1008', 'tweet-1016'];
  const lastCalm = Math.max(...calmIds.map((id) => received.ids.indexOf(id)));
  const firstHeated = Math.min(...heatedIds.map((id) => received.ids.indexOf(id)));
  out.heatedAfterCalm = firstHeated > lastCalm;
  out.promotedIndex = received.ids.indexOf('promoted-tweet-5555-abcd');
  out.cursors = [received.ids[0], received.ids[received.ids.length - 1]];
  const descending = received.sortIndexes.map(BigInt);
  out.sortIndexDescending = descending.every((v, i) => i === 0 || descending[i - 1] > v);
  log('heated after calm:', out.heatedAfterCalm, '| promoted at index:', out.promotedIndex, '| cursors:', out.cursors.join(' / '), '| sortIndex descends:', out.sortIndexDescending);

  out.bannerDay = await bannerState(page);
  log('banner:', out.bannerDay.stripText);
  log('show pill visible:', out.bannerDay.showVisible, '| glass:', out.bannerDay.glass, '| radius:', out.bannerDay.radius);
  await page.screenshot({ path: path.join(SHOTS, 'banner-day.png'), clip: { x: 0, y: 796, width: 720, height: 104 } });

  // Keyboard: open the panel with Enter on the pill, check rows, Escape to close.
  await page.evaluate(() => {
    const host = document.querySelector('[data-tolstoy="banner"]');
    host.shadowRoot.querySelector('.show').focus();
  });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const openState = await bannerState(page);
  out.panelDay = openState;
  log('panel open:', openState.panelOpen, '| title:', openState.panelTitle, '| rows:', openState.rows.length);
  for (const row of openState.rows) log('   row:', row.handle, '|', row.reasons, '|', row.link, '|', row.text.slice(0, 40));
  out.panelFocus = await page.evaluate(() => {
    const host = document.querySelector('[data-tolstoy="banner"]');
    return host.shadowRoot.activeElement ? host.shadowRoot.activeElement.id || host.shadowRoot.activeElement.tagName : 'none';
  });
  log('focus inside panel:', out.panelFocus);
  await page.screenshot({ path: path.join(SHOTS, 'banner-panel-day.png') });

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const closed = await bannerState(page);
  out.panelClosed = !closed.panelOpen;
  out.focusAfterEscape = await page.evaluate(() => {
    const host = document.querySelector('[data-tolstoy="banner"]');
    const el = host.shadowRoot.activeElement;
    return el ? el.className || el.tagName : 'none';
  });
  log('panel closed by Escape:', out.panelClosed, '| focus back on:', out.focusAfterEscape);
  out.errors = errors;
  log('console errors:', errors.length ? errors.join(' | ') : 'none');
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });
}

// ---------------------------------------------------------------- night
{
  const { ctx, page, profile } = await open({ scheme: 'dark', timeline: fixtureText });
  out.bannerNight = await bannerState(page);
  log('night banner:', out.bannerNight.stripText, '| glass:', out.bannerNight.glass);
  await page.screenshot({ path: path.join(SHOTS, 'banner-night.png'), clip: { x: 0, y: 796, width: 720, height: 104 } });
  await page.evaluate(() => {
    const host = document.querySelector('[data-tolstoy="banner"]');
    host.shadowRoot.querySelector('.show').focus();
  });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  out.panelNight = await bannerState(page);
  await page.screenshot({ path: path.join(SHOTS, 'banner-panel-night.png') });
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });
}

// ---------------------------------------------------------------- calm batch only
{
  const { ctx, page, profile } = await open({ scheme: 'light', timeline: calmOnly });
  await page.waitForTimeout(600);
  const state = await bannerState(page);
  out.bannerCalm = state;
  log('calm-only banner:', state.stripText, '| show pill visible:', state.showVisible);
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });
}

// ------------------------------------------------- day glass over a dark host page
// X's dark theme is the case the alpha was chosen for, so measure it: sample the
// real rendered pixel under the count text with the text hidden.
{
  const { ctx, page, profile } = await open({ scheme: 'light', timeline: fixtureText, darkHost: true });
  const geom = await page.evaluate(() => {
    const host = document.querySelector('[data-tolstoy="banner"]');
    const root = host.shadowRoot;
    const count = root.querySelector('.count');
    const r = count.getBoundingClientRect();
    root.querySelector('style').textContent += '\n* { color: transparent !important; }';
    return {
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
      pageBackground: getComputedStyle(document.body).backgroundColor,
    };
  });
  const shot = path.join(os.tmpdir(), 'tolstoy-banner-darkhost.png');
  await page.screenshot({ path: shot });
  const b64 = fs.readFileSync(shot).toString('base64');
  const probe = await ctx.newPage();
  await probe.setContent('<html><body></body></html>');
  const pixel = await probe.evaluate(async ({ b64, x, y }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    const c = cv.getContext('2d');
    c.drawImage(img, 0, 0);
    const d = c.getImageData(x, y, 1, 1).data;
    return [d[0], d[1], d[2]];
  }, { b64, x: geom.x, y: geom.y });
  await probe.close();
  out.dayGlassOverDarkHost = {
    pageBackground: geom.pageBackground,
    sampled: `rgb(${pixel.join(', ')})`,
    inkContrast: Math.round(contrast(hexToRgb('#2B2117'), pixel) * 100) / 100,
  };
  log('day glass over a dark host page:', geom.pageBackground, '-> sampled rgb(' + pixel.join(', ') + '), ink contrast',
    out.dayGlassOverDarkHost.inkContrast + ':1');
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });
}

fs.writeFileSync('C:/Users/adama/tolstoy-tools/x-adapter-browser-report.json', JSON.stringify({ out, lines }, null, 2));
console.log('\nwritten to C:/Users/adama/tolstoy-tools/x-adapter-browser-report.json');

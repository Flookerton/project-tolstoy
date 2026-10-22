// Browser check for the X adapter: the banner, blur mode, the settings bridge,
// and the three XHR shapes.
//
// Loads the extension in Chromium, serves the synthetic fixture to a local test
// page over the x.com origin (so the content scripts match, with no real account
// and no network), then reads what the page received, what the banner says, and
// which posts were veiled.
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

const HEATED_IDS = ['tweet-1002', 'tweet-1005', 'tweet-1008', 'tweet-1016'];
const CALM_IDS = ['tweet-1001', 'tweet-1003', 'tweet-1004', 'tweet-1006', 'tweet-1007', 'tweet-1009',
  'tweet-1010', 'tweet-1011', 'tweet-1012', 'tweet-1013', 'tweet-1014', 'tweet-1015', 'tweet-1017'];

// The order the fixture itself uses, for the blur-mode comparison.
const originalOrder = (() => {
  const json = JSON.parse(fixtureText);
  const add = json.data.home.home_timeline_urt.instructions.find((i) => i.type === 'TimelineAddEntries');
  return add.entries.map((entry) => entry.entryId);
})();

const out = {};
const lines = [];
function log(...args) { lines.push(args.join(' ')); console.log(...args); }

function srgbToLin(c) { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
function luminance([r, g, b]) { return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b); }
function contrast(a, b) { const la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
function hexToRgb(hex) { return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); }

async function setStorage(ctx, value) {
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  await sw.evaluate((v) => chrome.storage.local.set({ tolstoySettings: v }), value);
}

async function open({ scheme, timeline, viewport = { width: 1280, height: 900 }, darkHost = false, storage = null }) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tolstoy-x-'));
  const html = darkHost ? pageHtml.replace('<body>', '<body style="background:#0B0B0B;color:#EEEEEE">') : pageHtml;
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    colorScheme: scheme,
    viewport,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  if (storage) await setStorage(ctx, storage);
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
  await page.waitForFunction(() => window.tolstoyTest && window.tolstoyTest.ready, null, { timeout: 20000 });
  // The strip is built on load, so this only guards against a slow start.
  await page.waitForFunction(() => !!document.querySelector('[data-tolstoy="banner"]'), null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(900);
  return { ctx, page, profile, errors };
}

const bannerState = (page) => page.evaluate(() => {
  const host = document.querySelector('[data-tolstoy="banner"]');
  if (!host || !host.shadowRoot) return null;
  const root = host.shadowRoot;
  var strip = root.querySelector('.strip');
  // innerText leaves out hidden elements, so a hidden pill does not show up in
  // the recorded banner text.
  var rawText = strip ? (strip.innerText || strip.textContent) : '';
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
    stripText: rawText.replace(/\s+/g, ' ').trim(),
    temperatureLabel: root.querySelector('.temp')?.textContent || '',
    showVisible: show ? !show.hidden : false,
    panelOpen: wrap ? !wrap.hidden : false,
    panelTitle: root.querySelector('.panel h2')?.textContent || '',
    rows,
    fonts: strip ? getComputedStyle(strip).fontFamily : '',
    background: strip ? (getComputedStyle(strip).backgroundImage || getComputedStyle(strip).backgroundColor) : '',
    radius: strip ? getComputedStyle(strip).borderRadius : '',
    shadow: strip ? getComputedStyle(strip).boxShadow : '',
    panelRadius: root.querySelector('.panel') ? getComputedStyle(root.querySelector('.panel')).borderRadius : '',
  };
});

const veilState = (page) => page.evaluate(() => {
  const veils = Array.from(document.querySelectorAll('[data-tolstoy-veil]'));
  return veils.map((veil) => {
    const post = veil.parentElement;
    const link = post ? post.querySelector('a[href*="/status/"]') : null;
    const root = veil.shadowRoot;
    const rect = veil.getBoundingClientRect();
    const style = getComputedStyle(veil);
    const labelEl = root ? root.querySelector('.label') : null;
    return {
      id: veil.getAttribute('data-tolstoy-veil'),
      postLink: link ? link.getAttribute('href') : null,
      label: labelEl ? labelEl.textContent : '',
      reason: root && root.querySelector('.reason') ? root.querySelector('.reason').textContent : '',
      buttons: root ? Array.from(root.querySelectorAll('button')).map((b) => b.textContent) : [],
      labelWeight: labelEl ? getComputedStyle(labelEl).fontWeight : '',
      background: style.backgroundColor,
      backdrop: style.backdropFilter || style.webkitBackdropFilter || '',
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      postWidth: post ? Math.round(post.getBoundingClientRect().width) : 0,
    };
  });
});

// ---------------------------------------------------------------- day, heated batch
{
  const { ctx, page, profile, errors } = await open({ scheme: 'light', timeline: fixtureText });

  const received = await page.evaluate(() => ({
    ids: window.tolstoyTest.entryIds,
    sortIndexes: window.tolstoyTest.sortIndexes,
    messages: window.tolstoyTest.messages,
    parseError: window.tolstoyTest.parseError,
  }));
  out.receivedOrder = received.ids;
  const lastCalm = Math.max(...CALM_IDS.map((id) => received.ids.indexOf(id)));
  const firstHeated = Math.min(...HEATED_IDS.map((id) => received.ids.indexOf(id)));
  out.heatedAfterCalm = firstHeated > lastCalm;
  out.promotedIndex = received.ids.indexOf('promoted-tweet-5555-abcd');
  out.cursors = [received.ids[0], received.ids[received.ids.length - 1]];
  const descending = received.sortIndexes.map(BigInt);
  out.sortIndexDescending = descending.every((v, i) => i === 0 || descending[i - 1] > v);
  log('entries the page received:', received.ids.length);
  log('order:', received.ids.join(', '));
  log('heated after calm:', out.heatedAfterCalm, '| promoted at index:', out.promotedIndex, '| cursors:', out.cursors.join(' / '), '| sortIndex descends:', out.sortIndexDescending);
  if (received.parseError) log('PARSE ERROR:', received.parseError);

  // Did the settings beat the first batch? Counts the messages that describe a
  // real batch, not the zero-total reply to a listener that started late.
  const firstSettings = received.messages.findIndex((m) => m.type === 'settings');
  const before = firstSettings === -1 ? [] : received.messages.slice(0, firstSettings);
  out.settingsBridge = {
    messages: received.messages,
    firstSettingsAt: firstSettings === -1 ? null : received.messages[firstSettings].at,
    countsBeforeSettings: before.filter((m) => m.type === 'counts' && !m.totals).length,
    totalsRepliesBeforeSettings: before.filter((m) => m.type === 'counts' && m.totals).length,
    firstBatchAt: (received.messages.find((m) => m.type === 'counts' && !m.totals && m.checked > 0) || {}).at || null,
  };
  log('settings bridge: first settings message at', out.settingsBridge.firstSettingsAt,
    'ms | real batches counted before it:', out.settingsBridge.countsBeforeSettings,
    '| first batch counted at', out.settingsBridge.firstBatchAt, 'ms');

  out.bannerDay = await bannerState(page);
  log('banner:', out.bannerDay.stripText);
  log('temperature label:', out.bannerDay.temperatureLabel, '| show pill:', out.bannerDay.showVisible,
    '| radius:', out.bannerDay.radius, '| shadow:', out.bannerDay.shadow || 'none', '| fonts:', out.bannerDay.fonts);
  log('strip background:', out.bannerDay.background);
  await page.screenshot({ path: path.join(SHOTS, 'banner-day.png'), clip: { x: 0, y: 790, width: 620, height: 110 } });

  // Keyboard: Enter on the pill opens the panel, Escape closes it and returns focus.
  await page.evaluate(() => {
    const host = document.querySelector('[data-tolstoy="banner"]');
    host.shadowRoot.querySelector('.show').focus();
  });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const openState = await bannerState(page);
  out.panelDay = openState;
  log('panel open:', openState.panelOpen, '| title:', openState.panelTitle, '| rows:', openState.rows.length);
  for (const row of openState.rows) log('   row:', row.handle, '|', row.reasons, '|', row.link, '|', row.text.slice(0, 44));
  out.panelFocus = await page.evaluate(() => {
    const host = document.querySelector('[data-tolstoy="banner"]');
    const el = host.shadowRoot.activeElement;
    return el ? el.id || el.tagName : 'none';
  });
  log('focus inside panel:', out.panelFocus);
  await page.screenshot({ path: path.join(SHOTS, 'banner-panel-day.png') });

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  out.panelClosed = !(await bannerState(page)).panelOpen;
  out.focusAfterEscape = await page.evaluate(() => {
    const host = document.querySelector('[data-tolstoy="banner"]');
    const el = host.shadowRoot.activeElement;
    return el ? el.className || el.tagName : 'none';
  });
  log('panel closed by Escape:', out.panelClosed, '| focus back on:', out.focusAfterEscape);

  // Turn blur on from the settings side, with no reload: the veils should appear
  // on the posts already on screen, and the next batch should not be reordered.
  await setStorage(ctx, { temperature: 'balanced', blur: true });
  await page.waitForFunction(
    () => window.tolstoyTest.messages.filter((m) => m.type === 'settings').length > 1,
    null,
    { timeout: 10000 },
  );
  await page.waitForTimeout(900);
  out.veilsDay = await veilState(page);
  out.bannerBlurDay = await bannerState(page);
  const newBatchOrder = await page.evaluate(async () => {
    const body = await window.tolstoyTest.anotherBatch();
    const json = JSON.parse(body);
    const add = json.data.home.home_timeline_urt.instructions.find((i) => i.type === 'TimelineAddEntries');
    return add.entries.map((entry) => entry.entryId);
  });
  out.blurBatchOrder = newBatchOrder;
  // In blur mode the batch must come back exactly as X sent it, so compare it
  // with the fixture's own order, not with the reranked order.
  out.blurBatchUnchanged = JSON.stringify(newBatchOrder) === JSON.stringify(originalOrder);
  log('blur mode: veils on', out.veilsDay.length, 'posts | banner:', out.bannerBlurDay.stripText,
    '| temperature:', out.bannerBlurDay.temperatureLabel);
  log('a fresh batch in blur mode came back in X\'s own order:', out.blurBatchUnchanged);
  if (out.veilsDay[0]) {
    log('   veil:', out.veilsDay[0].id, '|', out.veilsDay[0].label, '|', out.veilsDay[0].reason, '|',
      out.veilsDay[0].buttons.join('/'), '|', out.veilsDay[0].background, out.veilsDay[0].backdrop,
      '| covers', out.veilsDay[0].width + 'x' + out.veilsDay[0].height, 'of a', out.veilsDay[0].postWidth + 'px post');
  }

  const veilRect = await page.evaluate(async () => {
    const veil = document.querySelector('[data-tolstoy-veil]');
    if (!veil) return null;
    veil.scrollIntoView({ block: 'center' });
    await new Promise((resolve) => setTimeout(resolve, 350));
    const r = veil.getBoundingClientRect();
    const left = Math.max(0, Math.round(r.left) - 8);
    const top = Math.max(0, Math.round(r.top) - 8);
    const width = Math.min(Math.round(r.width) + 16, window.innerWidth - left);
    const height = Math.min(Math.round(r.height) + 16, window.innerHeight - top);
    if (width < 8 || height < 8) return null;
    return { x: left, y: top, width, height };
  });
  if (veilRect) {
    await page.screenshot({ path: path.join(SHOTS, 'veil-day.png'), clip: veilRect });
  } else {
    log('no veil in view to photograph');
  }

  // A veil must follow its post: recycle the node under it and draw a new node
  // for the same post, the way X does as you scroll.
  out.recycle = await page.evaluate(async () => {
    const veil = document.querySelector('[data-tolstoy-veil]');
    const id = veil.getAttribute('data-tolstoy-veil');
    const oldPost = veil.parentElement;
    const oldLink = oldPost.querySelector('a[href*="/status/"]');
    oldLink.setAttribute('href', '/someone/status/1001');
    const fresh = document.createElement('article');
    fresh.setAttribute('data-testid', 'tweet');
    fresh.setAttribute('data-status-id', id);
    fresh.className = 'recycled-in';
    fresh.innerHTML = '<p class="post-handle">@moved</p><p class="post-text">the same heated post, drawn again</p>' +
      '<a class="post-time" href="/moved/status/' + id + '">2h</a>';
    document.getElementById('feed').appendChild(fresh);
    await new Promise((resolve) => setTimeout(resolve, 900));
    return {
      id,
      recycledNodeHasVeil: !!oldPost.querySelector('[data-tolstoy-veil]'),
      freshNodeHasVeil: !!fresh.querySelector('[data-tolstoy-veil]'),
      veilCount: document.querySelectorAll('[data-tolstoy-veil]').length,
    };
  });
  log('recycling: the reused node kept a veil:', out.recycle.recycledNodeHasVeil,
    '| the post drew a fresh node and got a veil:', out.recycle.freshNodeHasVeil,
    '| veils now:', out.recycle.veilCount);

  // "Show anyway" reveals one post and it stays revealed.
  out.showAnyway = await page.evaluate(async () => {
    const veil = document.querySelector('[data-tolstoy-veil]');
    const id = veil.getAttribute('data-tolstoy-veil');
    veil.shadowRoot.querySelector('.show').click();
    await new Promise((resolve) => setTimeout(resolve, 700));
    return {
      id,
      gone: !document.querySelector('[data-tolstoy-veil="' + id + '"]'),
      veilsLeft: document.querySelectorAll('[data-tolstoy-veil]').length,
    };
  });
  log('Show anyway revealed', out.showAnyway.id, ':', out.showAnyway.gone, '| veils left:', out.showAnyway.veilsLeft);

  log('console errors:', errors.length ? errors.join(' | ') : 'none');
  out.errors = errors;
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });
}

// ------------------------------------------------- the three XHR shapes
// Run in their own visit, in the default Balanced setting, because blur mode
// deliberately does not reorder anything.
{
  const { ctx, page, profile, errors } = await open({ scheme: 'light', timeline: fixtureText });
  await page.evaluate(() => window.tolstoyTest.runXhrCases());
  await page.waitForFunction(() => window.tolstoyTest.extraDone, null, { timeout: 20000 });
  await page.waitForTimeout(800);
  const extra = await page.evaluate(() => ({
    xhr: window.tolstoyTest.xhr,
    other: window.tolstoyTest.otherQuery,
    latestOrder: window.tolstoyTest.latestOrder,
    passthrough: document.getElementById('passthrough').textContent,
  }));
  out.xhr = extra.xhr;
  out.otherQuery = extra.other;
  out.latestOrder = extra.latestOrder;
  log('other query came back as:', extra.passthrough, '| unchanged:', extra.other === otherQuery);
  for (const shape of ['readystatechange', 'load', 'json']) {
    const ids = extra.xhr[shape] || [];
    const lastCalmHere = Math.max(...CALM_IDS.map((id) => ids.indexOf(id)));
    const firstHeatedHere = Math.min(...HEATED_IDS.map((id) => ids.indexOf(id)));
    const ok = ids.length > 0 && firstHeatedHere > lastCalmHere;
    out['xhr_' + shape + '_reranked'] = ok;
    log('   xhr ' + shape + ': ' + ids.length + ' entries, handler saw the reranked order:', ok);
  }
  const latestLastCalm = Math.max(...CALM_IDS.map((id) => extra.latestOrder.indexOf(id)));
  const latestFirstHeated = Math.min(...HEATED_IDS.map((id) => extra.latestOrder.indexOf(id)));
  out.latestReranked = extra.latestOrder.length > 0 && latestFirstHeated > latestLastCalm;
  log('HomeLatestTimeline was reranked too:', out.latestReranked);
  out.xhrErrors = errors;
  log('console errors in the xhr visit:', errors.length ? errors.join(' | ') : 'none');
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });
}

// ---------------------------------------------------------------- night, blurred
{
  const { ctx, page, profile } = await open({ scheme: 'dark', timeline: fixtureText });
  out.bannerNight = await bannerState(page);
  log('night banner:', out.bannerNight.stripText, '| radius:', out.bannerNight.radius, '| background:', out.bannerNight.background);
  await page.screenshot({ path: path.join(SHOTS, 'banner-night.png'), clip: { x: 0, y: 790, width: 620, height: 110 } });

  await page.evaluate(() => {
    const host = document.querySelector('[data-tolstoy="banner"]');
    host.shadowRoot.querySelector('.show').focus();
  });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  out.panelNight = await bannerState(page);
  await page.screenshot({ path: path.join(SHOTS, 'banner-panel-night.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  await setStorage(ctx, { temperature: 'balanced', blur: true });
  await page.waitForFunction(
    () => window.tolstoyTest.messages.filter((m) => m.type === 'settings').length > 1,
    null,
    { timeout: 10000 },
  );
  await page.waitForTimeout(1100);
  out.veilsNight = await veilState(page);
  log('night blur mode: veils on', out.veilsNight.length, 'posts | banner:', (await bannerState(page)).stripText);
  const nightRect = await page.evaluate(async () => {
    const veil = document.querySelector('[data-tolstoy-veil]');
    if (!veil) return null;
    veil.scrollIntoView({ block: 'center' });
    await new Promise((resolve) => setTimeout(resolve, 350));
    const r = veil.getBoundingClientRect();
    const left = Math.max(0, Math.round(r.left) - 8);
    const top = Math.max(0, Math.round(r.top) - 8);
    const width = Math.min(Math.round(r.width) + 16, window.innerWidth - left);
    const height = Math.min(Math.round(r.height) + 16, window.innerHeight - top);
    if (width < 8 || height < 8) return null;
    return { x: left, y: top, width, height };
  });
  if (nightRect) {
    await page.screenshot({ path: path.join(SHOTS, 'veil-night.png'), clip: nightRect });
  }
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

// ---------------------------------------------------------------- unfiltered
{
  const { ctx, page, profile } = await open({
    scheme: 'light',
    timeline: fixtureText,
    storage: { temperature: 'unfiltered', blur: false },
  });
  const ids = await page.evaluate(() => window.tolstoyTest.entryIds);
  const state = await bannerState(page);
  out.bannerUnfiltered = state;
  out.unfilteredOrder = ids;
  out.unfilteredOrderUnchanged = JSON.stringify(ids) === JSON.stringify(originalOrder);
  out.veilsUnfiltered = (await veilState(page)).length;
  log('unfiltered banner:', state.stripText, '| temperature:', state.temperatureLabel,
    '| show pill visible:', state.showVisible, '| order unchanged:', out.unfilteredOrderUnchanged, '| veils:', out.veilsUnfiltered);
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });
}

// ------------------------------------------------- ink contrast on the day strip
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
  out.dayStripOverDarkHost = {
    pageBackground: geom.pageBackground,
    sampled: `rgb(${pixel.join(', ')})`,
    inkContrast: Math.round(contrast(hexToRgb('#2B2117'), pixel) * 100) / 100,
  };
  log('day strip over a dark host page:', geom.pageBackground, '-> sampled rgb(' + pixel.join(', ') + '), ink contrast',
    out.dayStripOverDarkHost.inkContrast + ':1');
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });
}

fs.writeFileSync(toolsDir + '/x-adapter-browser-report.json', JSON.stringify({ out, lines }, null, 2));
console.log('\nwritten to ' + toolsDir + '/x-adapter-browser-report.json');

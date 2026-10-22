// Screenshots of the calm feed, next to mockup 4.
//
// The host site is a neutral stand-in; only the Tolstoy strip and the veils are
// ours. Day and night in moved-down mode, plus a day shot of blur mode.
//
//   node C:/Users/adama/project-tolstoy/tests/browser/calm-feed-shots.mjs
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

async function setStorage(ctx, value) {
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  await sw.evaluate((v) => chrome.storage.local.set({ tolstoySettings: v }), value);
}

async function open(scheme) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tolstoy-feed-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    colorScheme: scheme,
    viewport: { width: 1280, height: 1025 },
    deviceScaleFactor: 1,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  await ctx.route('**/*', (route) => {
    const parsed = new URL(route.request().url());
    if (parsed.hostname !== 'x.com') return route.continue();
    if (parsed.pathname.endsWith('/banner-test.js')) {
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: pageJs });
    }
    if (parsed.pathname === '/tolstoy-test') {
      return route.fulfill({ status: 200, contentType: 'text/html', body: pageHtml });
    }
    if (parsed.pathname.includes('/i/api/graphql/')) {
      if (parsed.pathname.endsWith('/OtherQuery')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{"untouched":true}}' });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: fixtureText });
    }
    return route.continue();
  });
  const page = await ctx.newPage();
  await page.goto('https://x.com/tolstoy-test');
  await page.waitForFunction(() => window.tolstoyTest && window.tolstoyTest.ready, null, { timeout: 20000 });
  await page.waitForTimeout(1200);
  return { ctx, page, profile };
}

// Put the heated block in view: in moved-down mode they sit at the end of the
// batch, which is the point of the screen.
async function scrollToHeated(page) {
  await page.evaluate(() => {
    const posts = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    const target = posts[posts.length - 2] || posts[0];
    if (target) target.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(500);
}

{
  const { ctx, page, profile } = await open('light');
  await scrollToHeated(page);
  await page.screenshot({ path: path.join(SHOTS, 'calm-feed-day.png') });
  console.log('calm-feed-day.png:', (await page.evaluate(() => {
    const host = document.querySelector('[data-tolstoy="banner"]');
    return host.shadowRoot.querySelector('.strip').innerText.replace(/\s+/g, ' ').trim();
  })));
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });
}

{
  const { ctx, page, profile } = await open('dark');
  await scrollToHeated(page);
  await page.screenshot({ path: path.join(SHOTS, 'calm-feed-night.png') });
  console.log('calm-feed-night.png:', (await page.evaluate(() => {
    const host = document.querySelector('[data-tolstoy="banner"]');
    return host.shadowRoot.querySelector('.strip').innerText.replace(/\s+/g, ' ').trim();
  })));
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });
}

{
  const { ctx, page, profile } = await open('light');
  await setStorage(ctx, { temperature: 'balanced', blur: true });
  await page.waitForFunction(
    () => window.tolstoyTest.messages.filter((m) => m.type === 'settings').length > 1,
    null,
    { timeout: 10000 },
  );
  await page.waitForTimeout(1200);
  await scrollToHeated(page);
  await page.screenshot({ path: path.join(SHOTS, 'calm-feed-blur-day.png') });
  console.log('calm-feed-blur-day.png:', (await page.evaluate(() => {
    const host = document.querySelector('[data-tolstoy="banner"]');
    const veils = document.querySelectorAll('[data-tolstoy-veil]').length;
    return host.shadowRoot.querySelector('.strip').innerText.replace(/\s+/g, ' ').trim() + ' | veils: ' + veils;
  })));
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });
}

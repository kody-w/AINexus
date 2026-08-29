// A live manifest grows while the viewer is open. At the edge it advances; after a person
// scrubs back it stays put until LIVE is pressed, and a missing next image never blanks the old.
const { createRequire } = require('module');
const _req = (() => {
  for (const base of [process.env.PLAYWRIGHT_DIR, require('path').join(process.env.HOME || '', 'Documents/GitHub/aaa-fps')]) {
    if (!base) continue;
    try { const r = createRequire(require('path').join(base, 'package.json')); r.resolve('playwright'); return r; } catch (e) {}
  }
  return require;
})();
const { chromium } = _req('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const WEBP = fs.readFileSync(path.join(ROOT, 'recordings', 'latest', 'wanderer', '0000.webp'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.webp': 'image/webp' };

(async () => {
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
let frames = 1;
let delayFrameOne = false;
let releaseFrameOne;
let frameOneGate = new Promise(resolve => { releaseFrameOne = resolve; });
const errors = [];
await context.route('https://kody-w.github.io/AINexus/**', async route => {
  const url = new URL(route.request().url());
  const relative = decodeURIComponent(url.pathname).replace(/^\/AINexus\//, '');
  if (relative === 'test/live/manifest.json') {
    const ticks = Array.from({ length: frames }, (_, index) => ({
      id: 'tick-' + index,
      capturedAt: new Date(Date.UTC(2026, 7, 29, 0, index * 5)).toISOString()
    }));
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        version: 2,
        live: true,
        frames,
        ticks,
        players: [{
          id: 'wanderer',
          label: 'AI wanderer',
          shots: ticks.map((_, index) => `frame-${index}.webp`),
          doing: ticks.map((_, index) => 'tick-' + index),
          epochs: []
        }]
      })
    });
  }
  if (/^test\/live\/frame-\d+\.webp$/.test(relative)) {
    if (relative === 'test/live/frame-1.webp' && delayFrameOne) await frameOneGate;
    return route.fulfill({ status: 200, contentType: 'image/webp', body: WEBP });
  }
  const file = path.join(ROOT, relative);
  if ((file !== ROOT && !file.startsWith(ROOT + path.sep)) ||
      !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return route.fulfill({ status: 404, body: 'no' });
  }
  return route.fulfill({
    status: 200,
    contentType: TYPES[path.extname(file)] || 'application/octet-stream',
    body: fs.readFileSync(file)
  });
});

const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
await page.goto('https://kody-w.github.io/AINexus/views.html' +
  '?manifest=test/live/manifest.json&live=0&poll=100&fps=20', { timeout: 45000 });
await page.waitForFunction(() => window.__viewsReady);
await page.waitForFunction(() => /frame-0\.webp/.test(document.querySelector('.cell img').src));

const checks = [];
async function check(name, condition) {
  const passed = await condition();
  checks.push(passed);
  console.log((passed ? '  ok ' : '  not ok ') + name);
}

await check('starts on the live edge', async () => {
  const state = await page.evaluate(() => window.__viewsState());
  return state.frames === 1 && state.frame === 0 && state.followingLive;
});

delayFrameOne = true;
frames = 2;
await page.waitForFunction(() => {
  const state = window.__viewsState();
  return state.frames === 2 && state.frame === 1;
});
await page.locator('#scrub').evaluate(input => {
  input.value = '0';
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
releaseFrameOne();
await page.waitForTimeout(150);
await check('a late live image cannot visually undo a scrub', async () => {
  const state = await page.evaluate(() => window.__viewsState());
  const source = await page.locator('.cell img').getAttribute('src');
  return state.frame === 0 && !state.followingLive && state.tick === 'tick-0' &&
    /frame-0\.webp/.test(source || '');
});

await page.locator('#live').click();
await page.waitForFunction(() => /frame-1\.webp/.test(document.querySelector('.cell img').src));
await check('LIVE returns to the newest frame and swaps it in', async () => {
  const state = await page.evaluate(() => window.__viewsState());
  return state.frame === 1 && state.followingLive && state.tick === 'tick-1';
});

delayFrameOne = false;
frames = 3;
await page.waitForFunction(() => window.__viewsState().frame === 2);
await check('the next tick continues forward instead of looping', async () => {
  const state = await page.evaluate(() => window.__viewsState());
  return state.frames === 3 && state.tick === 'tick-2';
});

console.log('page errors:', errors);
await browser.close();
if (errors.length || checks.some(passed => !passed)) process.exit(1);
})();

// The sealed line, from the outside. A views line built by the real sealer (tests/views_fixture.py
// drives tools/views_seal.py) is served at the published addresses (raw.githubusercontent.com,
// intercepted, so nothing here depends on anybody's server) and then attacked. At the live edge
// every hash, link, anchor and view must verify with only the head fetched; an older tick is proven
// by walking back only when somebody looks at it; a tick from before the line began says so; a view
// whose bytes changed is refused and never painted, not even before its seal is known; a scrub that
// leaves a load behind never strands a verified view; a history rewritten with valid hashes stops
// being proven; a spine tick that is not the spine's is caught; a HEAD that names another frame
// breaks the line; a capture that can never be sealed is not shown as awaiting one; a line read from
// anywhere but its published address is never shown as the published line; and a line that grows
// while the page is open is verified as it grows.
const { createRequire } = require('module');
const _req = (() => {
  for (const base of [process.env.PLAYWRIGHT_DIR, require('path').join(process.env.HOME || '', 'Documents/GitHub/aaa-fps')]) {
    if (!base) continue;
    try { const r = createRequire(require('path').join(base, 'package.json')); r.resolve('playwright'); return r; } catch (e) {}
  }
  return require;
})();
const { chromium } = _req('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.jsonl': 'application/x-ndjson', '.webp': 'image/webp' };

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'views-sealed-'));
const fx = JSON.parse(execFileSync('python3', [path.join(ROOT, 'tests', 'views_fixture.py'), out], { encoding: 'utf8' }));
const DIRS = { live: fx.feed, chain: fx.chain, spine: fx.spine };
// where each part of the line is published, and where the tests' own copy is mounted instead
const PUBLISHED = {
  'https://raw.githubusercontent.com/kody-w/AINexus/dogg-live/recordings/live/': 'live',
  'https://raw.githubusercontent.com/kody-w/AINexus/main/views/': 'chain',
  'https://raw.githubusercontent.com/kody-w/dogg/main/ticks/': 'spine'
};
const MOUNTED = { 'test/live/': 'live', 'test/chain/': 'chain', 'test/spine/': 'spine' };
const PUBLISHED_PAGE = 'https://kody-w.github.io/AINexus/views.html?poll=250&fps=20&autoplay=0';
const MOUNTED_PAGE = 'https://kody-w.github.io/AINexus/views.html?manifest=test/live/manifest.json&live=0' +
  '&chain=test/chain/&spine=test/spine/&poll=250&fps=20&autoplay=0';

const checks = [];
function check(name, passed, detail) {
  checks.push(!!passed);
  console.log((passed ? '  ok ' : '  not ok ') + name + (!passed && detail ? '\n      ' + detail : ''));
}
const flipped = file => {
  const bytes = Buffer.from(fs.readFileSync(path.join(fx.feed, file)));
  bytes[bytes.length >> 1] ^= 0x01;
  return bytes;
};
const read = (...parts) => fs.readFileSync(path.join(fx.root, ...parts));
const fileOf = (capture, id) => capture.players.find(player => player.id === id).file;

(async () => {
const browser = await chromium.launch();
const errors = [];

// overrides: { 'live/<rel>' | 'chain/<rel>' | 'spine/<rel>': Buffer | string | null (404) | { gate, body } }
async function open(overrides, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const requests = [];
  const serve = async (route, part, rel) => {
    const key = part + '/' + rel;
    requests.push(key);
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      let body = overrides[key];
      if (body && body.gate) {
        await body.gate;
        body = body.body;
      }
      if (body === null) return route.fulfill({ status: 404, body: 'no' });
      return route.fulfill({ status: 200, contentType: TYPES[path.extname(rel)] || 'application/octet-stream', body });
    }
    const root = DIRS[part];
    const file = path.join(root, rel);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return route.fulfill({ status: 404, body: 'no' });
    }
    return route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream',
      body: fs.readFileSync(file) });
  };
  await context.route('https://raw.githubusercontent.com/**', route => {
    const url = route.request().url().replace(/[?#].*$/, '');
    const prefix = Object.keys(PUBLISHED).find(base => url.startsWith(base));
    if (!prefix) return route.fulfill({ status: 404, body: 'not part of this test' });
    return serve(route, PUBLISHED[prefix], decodeURIComponent(url.slice(prefix.length)));
  });
  await context.route('https://kody-w.github.io/AINexus/**', route => {
    const relative = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/AINexus\//, '');
    const mount = Object.keys(MOUNTED).find(prefix => relative.startsWith(prefix));
    if (mount) return serve(route, MOUNTED[mount], relative.slice(mount.length));
    const file = path.join(ROOT, relative);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return route.fulfill({ status: 404, body: 'no' });
    }
    return route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream',
      body: fs.readFileSync(file) });
  });
  // every picture any cell is ever given, so "never painted" is a fact about the whole visit
  await context.addInitScript(() => {
    window.__srcLog = [];
    new MutationObserver(records => {
      for (const record of records) {
        if (record.target.tagName === 'IMG' && record.attributeName === 'src') {
          window.__srcLog.push({ who: record.target.alt, src: record.target.getAttribute('src') || '' });
        }
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['src'] });
  });
  const page = await context.newPage();
  if (options.now) await page.clock.setFixedTime(options.now);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(options.mounted ? MOUNTED_PAGE : PUBLISHED_PAGE, { timeout: 45000 });
  await page.waitForFunction(() => window.__viewsReady);
  return { context, page, requests };
}

const state = page => page.evaluate(() => window.__viewsState());
const until = (page, verdict, seq) => page.waitForFunction(([want, at]) => {
  const seal = window.__viewsState().seal;
  return seal.verdict === want && (at === null || seal.seq === at);
}, [verdict, seq === undefined ? null : seq], { timeout: 20000 }).catch(() => null);
const scrub = (page, index) => page.locator('#scrub').evaluate((input, value) => {
  input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}, index);
const cells = page => page.$$eval('.cell', all => all.map(cell => ({
  tag: cell.querySelector('.tag').textContent,
  src: cell.querySelector('img').getAttribute('src') || '',
  forged: cell.classList.contains('forged')
})));

{
  const { context, page, requests } = await open({});
  await until(page, 'sealed');
  let s = (await state(page)).seal;
  check('the published live edge is sealed: its frame, its link to the head, its spine anchor and all four views verify',
    s.verdict === 'sealed' && s.published && s.seq === 1 && s.spineTick === fx.anchors[1] && s.anchor === true &&
    s.views.sealed === 4 && s.expected === 4 && s.head === 2, JSON.stringify(s));
  const shown = await cells(page);
  check('every sealed view is painted from the very bytes that were hashed',
    shown.length === 4 && shown.every(cell => cell.src.startsWith('blob:') && cell.tag.endsWith(' ✓')), JSON.stringify(shown));
  const badge = await page.locator('#seal');
  const text = await badge.textContent();
  check('the HUD says what was proven, in green, and makes no claim about a line elsewhere',
    /sealed/.test(text) && text.includes('spine tick ' + fx.anchors[1]) && text.includes('4/4') &&
    !text.includes('not the published') && await badge.getAttribute('class') === 'ok', text);
  check('the live edge cost the head alone: no older frame was fetched to prove it',
    requests.includes('chain/1.json') && !requests.includes('chain/0.json'), requests.filter(r => r.startsWith('chain/')).join(' '));

  await scrub(page, 1);
  await until(page, 'sealed', 0);
  s = (await state(page)).seal;
  check('an older tick is proven by walking back from the head, once somebody looks at it',
    s.verdict === 'sealed' && s.seq === 0 && s.spineTick === fx.anchors[0] && s.genesis && s.proven === 2 &&
    requests.includes('chain/0.json'), JSON.stringify(s));

  await scrub(page, 0);
  await until(page, 'unsealed');
  await page.waitForFunction(() => [...document.querySelectorAll('.cell img')]
    .every(img => img.getAttribute('src') && !img.getAttribute('src').startsWith('blob:')), null, { timeout: 20000 }).catch(() => null);
  s = (await state(page)).seal;
  const legacy = await cells(page);
  check('a tick from before the line began is shown as unsealed, not as proven',
    s.verdict === 'unsealed' && /before the line began/.test(s.reason) &&
    legacy.every(cell => !cell.src.startsWith('blob:') && !cell.tag.endsWith(' ✓')), JSON.stringify({ s, legacy }));
  await context.close();
}

{
  const greeter = fileOf(fx.second, 'greeter');
  const { context, page } = await open({ ['live/' + greeter]: flipped(greeter) });
  await until(page, 'forged');
  await page.waitForFunction(() => window.__viewsState().seal.views.sealed === 3, null, { timeout: 20000 }).catch(() => null);
  const s = (await state(page)).seal;
  const bad = (await cells(page)).find(cell => cell.tag.startsWith('🤖 greeter'));
  const log = await page.evaluate(() => window.__srcLog.filter(entry => entry.who === "greeter's view"));
  check('one changed byte in one view is caught, and the other three still verify',
    s.verdict === 'forged' && s.views.forged === 1 && s.views.sealed === 3, JSON.stringify(s));
  check('the refused bytes never reach the screen, not even before the seal was known',
    bad && bad.forged && bad.src === '' && bad.tag.endsWith(' ✗') && log.every(entry => entry.src === ''),
    JSON.stringify({ bad, log }));
  await scrub(page, 1);
  await until(page, 'sealed', 0);
  await scrub(page, 2);
  await until(page, 'forged');
  const back = (await cells(page)).find(cell => cell.tag.startsWith('🤖 greeter'));
  check('and coming back to that tick, the previous tick\'s picture does not stand in for it',
    back && back.forged && back.src === '', JSON.stringify(back));
  await context.close();
}

{
  // t1's views are held back until the page has already scrubbed away from them again
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const overrides = {};
  for (const player of fx.first.players) {
    overrides['live/' + player.file] = { gate, body: fs.readFileSync(path.join(fx.feed, player.file)) };
  }
  const { context, page, requests } = await open(overrides);
  await until(page, 'sealed', 1);
  await scrub(page, 1);
  await page.waitForFunction(() => window.__viewsState().seal.seq === 0, null, { timeout: 20000 }).catch(() => null);
  const heldLoads = () => requests.filter(r => fx.first.players.some(player => r === 'live/' + player.file)).length;
  for (let i = 0; i < 50 && heldLoads() < 4; i++) await page.waitForTimeout(100);
  await scrub(page, 2);
  release();
  await page.waitForTimeout(600);
  const s = (await state(page)).seal;
  const shown = await cells(page);
  check('a scrub that leaves loads behind never strands a verified view as pending',
    s.verdict === 'sealed' && s.seq === 1 && s.views.sealed === 4 && s.views.pending === 0 &&
    shown.every(cell => cell.src.startsWith('blob:') && cell.tag.endsWith(' ✓')), JSON.stringify({ s, shown }));
  await context.close();
}

{
  const { context, page } = await open({ 'chain/0.json': read('forged', 'chain-0.json') });
  await until(page, 'sealed', 1);
  await scrub(page, 1);
  await until(page, 'unproven');
  const s = (await state(page)).seal;
  check('a history rewritten with valid hashes stops being proven where its link breaks',
    s.verdict === 'unproven' && /does not name frame 0 as its parent/.test(s.reason), JSON.stringify(s));
  await context.close();
}

{
  const { context, page } = await open({ 'spine/2.json': read('forged', 'spine-2.json') });
  await until(page, 'forged');
  const s = (await state(page)).seal;
  check('a spine tick that is not the spine\'s own is caught at the anchor',
    s.verdict === 'forged' && s.anchor === false && /spine tick 2/.test(s.reason), JSON.stringify(s));
  await context.close();
}

{
  const head = JSON.parse(fs.readFileSync(path.join(fx.chain, 'HEAD.json'), 'utf8'));
  head.head_frame = '0'.repeat(64);
  const { context, page } = await open({ 'chain/HEAD.json': JSON.stringify(head) });
  await until(page, 'broken');
  const s = (await state(page)).seal;
  check('a HEAD that names another frame breaks the line instead of vouching for it',
    s.verdict === 'broken' && /HEAD\.json does not name the newest frame/.test(s.reason), JSON.stringify(s));
  await context.close();
}

{
  const newest = { 'live/manifest.json': read('extra', 'manifest-4.json') };
  let { context, page } = await open(newest);
  await until(page, 'unsealed');
  let s = await state(page);
  check('a capture made while its spine tick was already sealed says it will stay unsealed, not that a seal is coming',
    s.tick === fx.ticks[3] && s.seal.verdict === 'unsealed' && /already sealed/.test(s.seal.reason), JSON.stringify(s));
  await context.close();
  ({ context, page } = await open(Object.assign({
    'spine/HEAD.json': read('extra', 'spine-HEAD-4.json'),
    'spine/3.json': read('extra', 'spine-3.json')
  }, newest), { now: new Date(Date.parse(fx.third.captured_utc) + 60000) }));
  await until(page, 'awaiting');
  s = await state(page);
  check('once the spine has moved on, a capture moments old is shown as awaiting its seal',
    s.tick === fx.ticks[3] && s.seal.verdict === 'awaiting', JSON.stringify(s));
  await context.close();
}

{
  const { context, page } = await open({}, { mounted: true });
  await until(page, 'sealed');
  const s = (await state(page)).seal;
  const badge = page.locator('#seal');
  const text = await badge.textContent();
  check('a line read from anywhere but its published address is verified but never shown as the published line',
    s.verdict === 'sealed' && s.published === false && text.includes('not the published line') &&
    await badge.getAttribute('class') !== 'ok', JSON.stringify({ s, text }));
  await context.close();
}

{
  const overrides = {
    'chain/HEAD.json': read('HEAD-1.json'),
    'live/manifest.json': read('manifest-2.json'),
    'chain/1.json': null
  };
  const { context, page } = await open(overrides);
  await until(page, 'sealed', 0);
  const before = (await state(page)).seal;
  for (const key of Object.keys(overrides)) delete overrides[key];
  await until(page, 'sealed', 1);
  const after = await state(page);
  check('a line that grows while the page is open is verified as it grows, and the edge follows it',
    before.head === 1 && after.seal.head === 2 && after.seal.spineTick === fx.anchors[1] &&
    after.frames === 3 && after.frame === 2 && after.followingLive, JSON.stringify({ before, after: after.seal }));
  await context.close();
}

console.log('page errors:', errors);
await browser.close();
fs.rmSync(out, { recursive: true, force: true });
if (errors.length || checks.some(passed => !passed)) process.exit(1);
})().catch(error => {
  console.log('  not ok the suite could not run: ' + (error && error.stack || error));
  process.exit(1);
});

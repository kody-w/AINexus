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
  if (options.install) await page.clock.install({ time: options.install });
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

{
  const doings = page => page.$$eval('.cell', all => Object.fromEntries(all.map(cell => [
    cell.querySelector('.tag').textContent.replace(/^🤖 /, '').replace(/ [✓✗]$/, ''),
    { text: cell.querySelector('.doing').textContent, title: cell.querySelector('.doing').title,
      bad: cell.querySelector('.doing').classList.contains('bad') }])));
  const mindsSettled = page => page.waitForFunction(() => {
    const minds = window.__viewsState().seal.minds;
    return minds && minds.thoughts && !minds.pending;
  }, null, { timeout: 20000 }).catch(() => null);
  const wanderer = fx.minds.wanderer, pilgrim = fx.minds.pilgrim;

  let { context, page } = await open({});
  await until(page, 'sealed', 1);
  let s = (await state(page)).seal;
  let said = await doings(page);
  const hud = await page.locator('#seal').textContent();
  check('a sealed thought is shown with its words, and only after every word was derived again from its evidence',
    s.minds && s.minds.thoughts === 2 && s.minds.ok === 2 && hud.includes('🧠 2/2 thoughts ✓') &&
    said.wanderer.text === '🧠 claude-sonnet-5 “Hello, greeter! 👋” ✓' &&
    said.pilgrim.text === '🧠 gpt-5-mini-2026-08-07 “Heading for the portals.” ✓', JSON.stringify({ s, said, hud }));
  check('its reasons, the model that answered and what it cost are one hover away; a rest says why; a script says what it did',
    said.wanderer.title.includes('the greeter is off to my right') && said.wanderer.title.includes('answered by claude-sonnet-5') &&
    said.wanderer.title.includes('1× premium') && said.pilgrim.title.includes('aim (failed) — I want to see where it leads') &&
    said.greeter.text === '↻ default routine: wait, look, wait, look' &&
    said.greeter.title.includes('resting between thoughts') && said.greeter.title.includes("the world's default routine") &&
    said.wanderer.title.includes('left its body a new routine: walk forward 1200ms') && said.watcher.text === 'wander',
    JSON.stringify(said));
  await context.close();

  const evidence = read('live', wanderer.exchange.file).toString('utf8');
  ({ context, page } = await open({ ['live/' + wanderer.exchange.file]:
    evidence.replace('the greeter is off to my right', 'the greeter is off to my left') }));
  await until(page, 'forged', 1);
  await mindsSettled(page);
  s = (await state(page)).seal;
  said = await doings(page);
  check('a thought whose evidence changed is refused, while the four views still verify',
    s.verdict === 'forged' && s.minds.forged === 1 && s.minds.ok === 1 && s.views.sealed === 4 &&
    said.wanderer.bad && said.wanderer.text.startsWith('✗ thought refused: its evidence is not the one sealed'),
    JSON.stringify({ s, said }));
  await context.close();

  ({ context, page } = await open({ 'chain/1.json': read('forged', 'chain-1-said.json'),
                                   'chain/HEAD.json': read('forged', 'HEAD-said.json') }));
  await until(page, 'forged', 1);
  await mindsSettled(page);
  s = (await state(page)).seal;
  said = await doings(page);
  check('words a model never said are caught against its evidence, when every hash and link in the line is right',
    s.line === 'ok' && s.verdict === 'forged' && s.minds.forged === 1 && s.anchor === true &&
    said.wanderer.text === '✗ thought refused: the frame says what its evidence does not' &&
    !Object.values(said).some(d => d.text.includes('I was never here')), JSON.stringify({ s, said }));
  await context.close();

  ({ context, page } = await open({ 'chain/1.json': read('forged', 'chain-1-routine.json'),
                                   'chain/HEAD.json': read('forged', 'HEAD-routine.json') }));
  await until(page, 'forged', 1);
  await mindsSettled(page);
  s = (await state(page)).seal;
  said = await doings(page);
  const bodyRan = s.verdict === 'forged' && s.minds.forged === 1 &&
    said.pilgrim.text === '✗ thought refused: the frame says what its evidence does not' && !said.wanderer.bad;
  await context.close();
  ({ context, page } = await open({ 'chain/1.json': read('forged', 'chain-1-routine-only.json'),
                                   'chain/HEAD.json': read('forged', 'HEAD-routine-only.json') }));
  await until(page, 'forged', 1);
  await mindsSettled(page);
  const bare = (await state(page)).seal;
  const bareSaid = await doings(page);
  check('a routine a thought never set is refused, whether its body is said to run it or the claim stands alone',
    bodyRan && bare.verdict === 'forged' && bare.minds.forged === 1 &&
    bareSaid.pilgrim.text === '✗ thought refused: the frame says what its evidence does not',
    JSON.stringify({ s, said, bare, bareSaid }));
  await context.close();

  ({ context, page } = await open({ ['live/' + pilgrim.saw.file]: read('live', wanderer.saw.file) }));
  await until(page, 'forged', 1);
  await mindsSettled(page);
  said = await doings(page);
  check('a picture that is not the one the model was shown is refused',
    said.pilgrim.text === '✗ thought refused: its picture is not the one it was shown', JSON.stringify(said));
  await context.close();

  ({ context, page } = await open({ ['live/' + wanderer.exchange.file]: null }));
  await until(page, 'sealed', 1);
  s = (await state(page)).seal;
  said = await doings(page);
  const rolled = await page.locator('#seal').textContent();
  check('a thought whose evidence has rolled out of the feed is not a lie: the frame still names its hash',
    s.minds.gone === 1 && s.minds.ok === 1 && rolled.includes('(1 rolled out)') &&
    said.wanderer.text === '🧠 claude-sonnet-5 “Hello, greeter! 👋”' && said.wanderer.title.includes('rolled out'),
    JSON.stringify({ s, said, rolled }));
  await context.close();
}

// ── the dimension: the newest frame played forward here, and met again when the next arrives ──
{
  const P = require(path.join(ROOT, 'ai', 'playout.js'));
  const frame1 = JSON.parse(read('chain', '1.json'));
  const frameMs = Date.parse(frame1.payload.views.captured_utc);
  const minded = frame1.payload.views.players.filter(q => q.mind);
  const dimension = page => page.evaluate(() => window.__viewsState().dimension);
  const settled = (page, n) => page.waitForFunction(k => {
    const d = window.__viewsState().dimension;
    return d.seq !== null && Object.keys(d.bodies).length === k;
  }, n, { timeout: 20000 }).catch(() => null);

  const T = frameMs + 7 * 60000;
  let { context, page } = await open({}, { now: new Date(T) });
  await settled(page, minded.length);
  let d = await dimension(page);
  const expected = Object.fromEntries(minded.map(q => [q.id, P.stateAt(q, frameMs, T)]));
  check('between frames, this page plays the newest frame forward to exactly where the capture would put every body',
    Object.keys(d.bodies).length === 3 && minded.every(q => JSON.stringify(d.bodies[q.id].pose) === JSON.stringify(expected[q.id].pose) &&
      d.bodies[q.id].met && !d.bodies[q.id].asleep) &&
    JSON.stringify(d.bodies.wanderer.pose) !== JSON.stringify(minded.find(q => q.id === 'wanderer').at) &&
    /^☀️ Tokyo 21:30 · ▶ routine 7m in$/.test(d.bodies.wanderer.note) &&
    await page.locator('#dimension').isVisible(), JSON.stringify({ d, expected }));
  await context.close();

  const N = frameMs + 12 * 3600000;             // 01:23 in London (BST), 09:23 in Tokyo: the pilgrim is asleep
  ({ context, page } = await open({}, { now: new Date(N) }));
  await settled(page, minded.length);
  d = await dimension(page);
  const woke = P.stateAt(minded.find(q => q.id === 'wanderer'), frameMs, N);
  check('where its clock says night a body sleeps in its bed; one that slept since its frame wakes there into its routine',
    d.bodies.pilgrim.asleep && JSON.stringify(d.bodies.pilgrim.pose) === JSON.stringify(P.bed('pilgrim')) &&
    /^🌙 asleep · London 01:23$/.test(d.bodies.pilgrim.note) && !d.bodies.wanderer.asleep &&
    JSON.stringify(d.bodies.wanderer.pose) === JSON.stringify(woke.pose) &&
    // it woke at 07:00 in Tokyo, on the clock's own five-minute marks
    woke.since === Date.parse('2026-09-23T22:00:00.000Z'),
    JSON.stringify({ d, woke }));
  await context.close();

  // A new frame arrives while the page is open: nothing snaps, and each body walks to meet its twin.
  const overrides = {};
  ({ context, page } = await open(overrides, { install: frameMs + 8 * 60000 }));
  await settled(page, minded.length);
  const before = (await dimension(page)).bodies.wanderer.pose;
  Object.assign(overrides, {
    'chain/HEAD.json': read('later', 'HEAD-3.json'), 'chain/2.json': read('later', 'chain-2.json'),
    'spine/HEAD.json': read('extra', 'spine-HEAD-4.json'), 'spine/3.json': read('extra', 'spine-3.json'),
    'live/manifest.json': read('later', 'manifest-5.json')
  });
  await page.waitForFunction(() => window.__viewsState().dimension.seq === 2, null, { timeout: 20000 }).catch(() => null);
  const arrived = (await dimension(page)).bodies.wanderer;
  const gap = (a, b) => Math.hypot(a.x_cm - b.x_cm, a.z_cm - b.z_cm);
  const trail = [];
  for (let i = 0; i < 120; i++) {
    const w = (await dimension(page)).bodies.wanderer;
    trail.push({ pose: w.pose, gap: gap(w.pose, w.twin), met: w.met });
    if (w.met) break;
    await page.waitForTimeout(250);
  }
  const last = trail[trail.length - 1];
  const leaps = trail.slice(1).map((t, i) => gap(t.pose, trail[i].pose));
  const finalState = await dimension(page);
  check('when the next frame arrives nothing snaps: each body walks from where it was until it meets its twin, and is then the new frame\'s',
    arrived && !arrived.met && gap(arrived.pose, before) < 200 && gap(arrived.pose, arrived.twin) > 500 &&
    /^↝ meeting its twin in views #2$/.test(arrived.note) &&
    last.met && JSON.stringify(finalState.bodies.wanderer.pose) === JSON.stringify(finalState.bodies.wanderer.twin) &&
    trail.length > 2 && Math.max(...leaps.slice(0, -1)) < 1500 && Object.values(finalState.bodies).length === 3,
    JSON.stringify({ before, arrived, steps: trail.length, leaps: leaps.map(Math.round), last }));
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

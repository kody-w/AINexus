/* record_views.cjs - run a herd for real and keep what every player SAW.
 *
 * Each player gets its own page, so these are genuinely different points of view rather than
 * one camera relabelled. A finite run still writes recordings/<stamp> plus recordings/latest.
 * Passing --stream appends the run as immutable ticks in a cumulative DOGG manifest.
 *
 *   node tools/record_views.cjs [--players 4] [--seconds 30] [--fps 4]
 *   node tools/record_views.cjs --seconds 1 --fps 1 --stream recordings/live \
 *     --output-root /path/to/public-feed --max-frames 2016 --tick-seconds 300
 */
const { createRequire } = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { appendCapture } = require('./dogg_stream.cjs');

function loadPlaywright() {
  const bases = [
    process.env.PLAYWRIGHT_DIR,
    path.join(process.env.HOME || '', 'Documents/GitHub/aaa-fps')
  ].filter(Boolean);
  for (const base of bases) {
    const candidate = createRequire(path.join(base, 'package.json'));
    for (const packageName of ['playwright', 'playwright-core']) {
      try {
        candidate.resolve(packageName);
        return candidate(packageName);
      } catch (error) {}
    }
  }
  for (const packageName of ['playwright', 'playwright-core']) {
    try {
      return require(packageName);
    } catch (error) {}
  }
  throw new Error('playwright or playwright-core is required');
}

const { chromium } = loadPlaywright();
const ROOT = path.resolve(__dirname, '..');
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.py': 'text/plain',
  '.webp': 'image/webp'
};

const arg = (key, fallback) => {
  const index = process.argv.indexOf('--' + key);
  return index > 0 ? process.argv[index + 1] : fallback;
};
const positive = (name, fallback) => {
  const value = Number(arg(name, fallback));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be positive`);
  return value;
};
const N = Math.floor(positive('players', 4));
const SECONDS = positive('seconds', 24);
const FPS = positive('fps', 4);
const WIDTH = Math.floor(positive('width', 480));
const QUALITY = Number(arg('quality', .72));
const WORLD = arg('world', 'index.html');
const STREAM = arg('stream', '');
const OUTPUT_ROOT = path.resolve(arg('output-root', ROOT));
const MAX_FRAMES = Math.floor(positive('max-frames', 2016));
const TICK_SECONDS = Number(arg('tick-seconds', 0));
const BROWSER_CHANNEL = arg('browser-channel', '');
const NAMES = ['wanderer', 'greeter', 'pilgrim', 'watcher', 'scribe', 'runner', 'herald', 'tinker'];
if (!Number.isFinite(QUALITY) || QUALITY <= 0 || QUALITY > 1) throw new Error('--quality must be between 0 and 1');
if (!Number.isFinite(TICK_SECONDS) || TICK_SECONDS < 0) throw new Error('--tick-seconds must be zero or positive');

function inside(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    return candidate;
  }
  throw new Error(`${label} escapes ${root}`);
}

(async () => {
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
const outDir = STREAM
  ? fs.mkdtempSync(path.join(os.tmpdir(), 'dogg-capture-'))
  : path.join(OUTPUT_ROOT, 'recordings', stamp);
fs.mkdirSync(outDir, { recursive: true });

const launchOptions = BROWSER_CHANNEL
  ? { channel: BROWSER_CHANNEL, args: ['--disable-dev-shm-usage'] }
  : {};
const browser = await chromium.launch(launchOptions);
const context = await browser.newContext({ viewport: { width: 900, height: 620 } });
await context.route('https://kody-w.github.io/AINexus/**', route => {
  const url = new URL(route.request().url());
  const file = path.join(ROOT, decodeURIComponent(url.pathname).replace(/^\/AINexus/, ''));
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

// Pages publish where they stand and paint the others as projections, so the herd can still see
// itself even when its members occupy different worlds.
console.log(`opening ${N} players in ${WORLD}...`);
const players = [];
for (let index = 0; index < N; index++) {
  const id = NAMES[index % NAMES.length] + (index >= NAMES.length ? '-' + index : '');
  const page = await context.newPage();
  page.on('pageerror', error => console.log('  ! ' + id + ': ' + error.message.slice(0, 80)));
  await page.goto('https://kody-w.github.io/AINexus/' + WORLD +
    '#as=' + encodeURIComponent('AI ' + id), { timeout: 60000 });
  await page.addScriptTag({ url: 'https://kody-w.github.io/AINexus/ai/autodrive.js' }).catch(() => {});
  await page.addScriptTag({ url: 'https://kody-w.github.io/AINexus/ai/holo.js' }).catch(() => {});
  await page.waitForFunction(() => !!window.__autodrive && !!window.NexusHolo,
    { timeout: 30000 }).catch(() => {});
  await page.evaluate(who => {
    window.NexusHolo.publish({ id: who, name: '🤖 ' + who });
    window.NexusHolo.attach();
  }, id).catch(() => {});
  await page.evaluate(async (position, count) => {
    const drive = window.__autodrive;
    if (!drive) return;
    await drive.look(Math.round((360 / count) * position * 2.2), 0);
    await drive.walk('forward', 420);
    await drive.look(180 * 2.2, 0);
  }, index, N).catch(() => {});
  players.push({ id, label: '🤖 ' + id, page, shots: [], doing: [], epochs: [] });
  console.log('  ' + id + ' is in');
}

await new Promise(resolve => setTimeout(resolve, 1500));
for (const player of players) {
  const seen = await player.page.evaluate(() =>
    window.NexusHolo.present().map(item => item.name + (item.painted ? '' : '(unpainted)'))
  ).catch(() => []);
  console.log('  ' + player.id + ' sees ' + (seen.length ? seen.join(', ') : 'nobody'));
}

const intents = ['wander', 'hold', 'go', 'wander'];
const total = Math.max(1, Math.round(SECONDS * FPS));
const ticks = [];
console.log(`recording ${total} frames at ${FPS}fps...`);
for (let frame = 0; frame < total; frame++) {
  ticks[frame] = {
    id: `${stamp}:${String(frame).padStart(4, '0')}`,
    capturedAt: new Date().toISOString()
  };
  for (let index = 0; index < players.length; index++) {
    const player = players[index];
    if (frame % Math.max(1, Math.round(FPS)) === 0) {
      const intent = intents[(index + Math.floor(frame / FPS)) % intents.length];
      player.doing[frame] = intent;
      await player.page.evaluate(async value => {
        const drive = window.__autodrive;
        if (!drive) return;
        if (value === 'wander') {
          await drive.look((Math.random() * 90 - 45) | 0, 0);
          await drive.walk('forward', 260);
        } else if (value === 'go') {
          await drive.look(60, 0);
        }
      }, intent).catch(() => {});
    } else {
      player.doing[frame] = player.doing[frame - 1] || '';
    }
    const shot = await player.page.evaluate(options => {
      const drive = window.__autodrive;
      if (!drive) return null;
      const seen = drive.see({
        width: options.width,
        format: 'image/webp',
        quality: options.quality,
        send: false
      });
      return seen && !seen.blank ? seen.uri : null;
    }, { width: WIDTH, quality: QUALITY }).catch(() => null);
    if (shot) {
      const directory = path.join(outDir, player.id);
      fs.mkdirSync(directory, { recursive: true });
      const file = String(frame).padStart(4, '0') + '.webp';
      fs.writeFileSync(path.join(directory, file), Buffer.from(shot.split(',')[1], 'base64'));
      player.shots[frame] = player.id + '/' + file;
    } else {
      player.shots[frame] = player.shots[frame - 1] || null;
    }
  }
  if (frame % Math.max(1, Math.round(FPS * 4)) === 0) {
    process.stdout.write('  ' + frame + '/' + total + '\r');
  }
}

console.log('\nwriting manifest...');
const missingPlayers = players.filter(player => !player.shots.some(Boolean)).map(player => player.id);
if (missingPlayers.length) throw new Error('no frame captured for: ' + missingPlayers.join(', '));
const manifest = {
  recorded: new Date().toISOString(),
  world: WORLD,
  fps: FPS,
  frames: total,
  ticks,
  players: players.map(player => ({
    id: player.id,
    label: player.label,
    shots: player.shots,
    doing: player.doing,
    epochs: player.epochs
  }))
};
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest));
await browser.close();

const sizeKb = directory => {
  let bytes = 0;
  for (const file of fs.readdirSync(directory, { recursive: true })) {
    const candidate = path.join(directory, file);
    try {
      if (fs.statSync(candidate).isFile()) bytes += fs.statSync(candidate).size;
    } catch (error) {}
  }
  return Math.round(bytes / 1024);
};

if (STREAM) {
  const streamDir = inside(OUTPUT_ROOT, path.resolve(OUTPUT_ROOT, STREAM), 'stream');
  const live = appendCapture({
    streamDir,
    captureDir: outDir,
    captureManifest: manifest,
    maxFrames: MAX_FRAMES,
    tickSeconds: TICK_SECONDS
  });
  fs.rmSync(outDir, { recursive: true, force: true });
  console.log(`\n${players.length} views · ${total} new ticks · ${live.frames} retained`);
  console.log('  ' + streamDir + ` (${sizeKb(streamDir)}KB)`);
  return;
}

const latest = path.join(OUTPUT_ROOT, 'recordings', 'latest');
fs.rmSync(latest, { recursive: true, force: true });
fs.cpSync(outDir, latest, { recursive: true });
console.log(`\n${players.length} views · ${total} frames each · ${sizeKb(outDir)}KB`);
console.log('  ' + path.relative(OUTPUT_ROOT, outDir));
console.log('  open views.html?manifest=recordings/latest/manifest.json&live=0');
})();

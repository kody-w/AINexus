/* record_views.cjs - run a herd for real and keep what every player SAW.
 *
 * Each player gets its own page, so these are genuinely different points of view rather than
 * one camera relabelled. A finite run still writes recordings/<stamp> plus recordings/latest.
 * Passing --stream appends the run as immutable ticks in a cumulative DOGG manifest, and
 * --receipt writes what the newest tick shows for tools/views_seal.py to seal.
 *
 *   node tools/record_views.cjs [--players 4] [--seconds 30] [--fps 4]
 *   node tools/record_views.cjs --seconds 1 --fps 1 --stream recordings/live \
 *     --output-root /path/to/public-feed --max-frames 2016 --tick-seconds 300 \
 *     --receipt /tmp/receipt.json
 */
const { createRequire } = require('module');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { appendCapture, captureReceipt } = require('./dogg_stream.cjs');

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
const RECEIPT = arg('receipt', '');
const MINDS = arg('minds', '');
const LINE = path.resolve(arg('line', path.join(ROOT, 'views')));
const JOURNAL = arg('journal', '') ? path.resolve(arg('journal', '')) : '';
const NAMES = ['wanderer', 'greeter', 'pilgrim', 'watcher', 'scribe', 'runner', 'herald', 'tinker'];
if (!Number.isFinite(QUALITY) || QUALITY <= 0 || QUALITY > 1) throw new Error('--quality must be between 0 and 1');
if (!Number.isFinite(TICK_SECONDS) || TICK_SECONDS < 0) throw new Error('--tick-seconds must be zero or positive');
if (RECEIPT && !STREAM) throw new Error('--receipt describes a stream tick, so it needs --stream');
// With --minds, what each player does is decided by a model (or it rests, and says why) instead of
// by the scripted rotation. A capture thinks once, on its first frame: one tick, one thought.
const minds = MINDS ? require('./minds.cjs') : null;
const worldMind = MINDS ? require('./world_mind.cjs') : null;
const SEAT = MINDS && process.env.NEXUS_MIND_TOKEN && process.env.NEXUS_MIND_API
  ? { token: process.env.NEXUS_MIND_TOKEN, api: process.env.NEXUS_MIND_API } : null;
const PERSONAS = {
  wanderer: 'wanderer, a curious visitor who looks before moving, greets whoever is here, and drifts between portals',
  greeter: 'greeter, who stays near the centre, watches who arrives, and talks to the people here',
  pilgrim: 'pilgrim, who walks toward portals, looks before stepping close, and reports what it finds',
  watcher: 'watcher, who keeps to the edge of the ring, watches the others, and says what it notices',
};

function inside(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    return candidate;
  }
  throw new Error(`${label} escapes ${root}`);
}

// Which build of the world the players stood in: the commit, when there is one to name.
function sourceCommit() {
  if (/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA || '')) return process.env.GITHUB_SHA;
  try {
    const head = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return /^[0-9a-f]{40}$/.test(head) ? head : '';
  } catch (error) {
    return '';
  }
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
// THE MOMENT THIS TICK IS. With minds, every body is placed where the last frame's routines have
// taken it by now, played forward exactly as every viewer plays it, and the frame is dated to that
// same moment, so a viewer that has been playing along arrives at the state this tick starts from.
const TICK_AT = Date.now();
let thinking = null, world = null;
if (minds) {
  const config = JSON.parse(fs.readFileSync(path.resolve(MINDS), 'utf8'));
  // With a `mind` in the config, one mind directs every body, and no body thinks for itself.
  const one = config.mind && typeof config.mind === 'object' ? config.mind : null;
  thinking = minds.prepare(config, LINE, { seat: !!SEAT && !one, journal: JOURNAL, now: TICK_AT,
                                            seatWhy: one ? 'the one mind directs it' : process.env.NEXUS_MIND_UNAVAILABLE || '' });
  if (one) {
    world = await worldMind.think({ planned: thinking, frames: minds.readLine(LINE, 36), root: path.dirname(LINE),
                                    now: TICK_AT, mind: one, journal: JOURNAL });
    if (!world) console.log('the one mind: everyone in the hub is asleep, so nobody is directed and nobody is asked');
  }
  if (world) {
    fs.writeFileSync(path.join(outDir, 'world-mind.json'), JSON.stringify(world.evidence, null, 1) + '\n');
    const told = Object.entries(world.directive).map(([id, t]) => id + ': ' + Object.keys(t).join('+'));
    console.log(world.by === 'rules' ? `the one mind: rules write this tick (${world.why})`
      : `the one mind: ${world.by} answered in ${(world.evidence.ms / 1000).toFixed(1)} s`
        + (told.length ? ' · ' + told.join(' · ') : ' · everyone carries on'));
  }
  console.log(`minds: ${thinking.spent_x100 / 100} of ${thinking.cap_x100 / 100} premium requests spent in the last day`
    + ` (${thinking.on_line_x100 / 100} on the line, ${thinking.journaled_x100 / 100} in this machine's journal)`);
  console.log(`  the hub's clock, which every body in it keeps: ${thinking.local}`);
  for (const [id, planned] of Object.entries(thinking.players)) {
    console.log(`  ${id}: ${planned.think ? 'thinks on ' + planned.model
      : planned.sleep ? planned.why : 'runs ' + minds.routineLine(planned.routine) + ' (' + planned.why + ')'}`);
  }
}
console.log(`opening ${N} players in ${WORLD}...`);
const players = [];
for (let index = 0; index < N; index++) {
  const id = NAMES[index % NAMES.length] + (index >= NAMES.length ? '-' + index : '');
  const planned = thinking && thinking.players[id] || null;
  const page = await context.newPage();
  page.on('pageerror', error => console.log('  ! ' + id + ': ' + error.message.slice(0, 80)));
  await page.goto('https://kody-w.github.io/AINexus/' + WORLD +
    '#as=' + encodeURIComponent('AI ' + id), { timeout: 120000 });
  await page.addScriptTag({ url: 'https://kody-w.github.io/AINexus/ai/autodrive.js' }).catch(() => {});
  await page.addScriptTag({ url: 'https://kody-w.github.io/AINexus/ai/holo.js' }).catch(() => {});
  if (planned) {
    await page.addScriptTag({ url: 'https://kody-w.github.io/AINexus/ai/frames.js' }).catch(() => {});
    await page.addScriptTag({ url: 'https://kody-w.github.io/AINexus/ai/vbrainstem.js' }).catch(() => {});
  }
  await page.waitForFunction(minded => !!window.__autodrive && !!window.NexusHolo && (!minded || !!window.NexusBrainstem),
    !!planned, { timeout: 90000 }).catch(() => {});
  await page.evaluate(who => {
    window.NexusHolo.publish({ id: who, name: '🤖 ' + who });
    window.NexusHolo.attach();
  }, id).catch(() => {});
  // A minded body stands where the night and its routine have taken it; any other takes its place
  // in the ring.
  const restored = planned ? await minds.restorePose(page, planned.start) : false;
  // a body that cannot be put where the line says it is would be sealed somewhere the line never took it
  if (planned && !restored) throw new Error(id + ': its world never became ready, so its body could not be placed');
  if (!planned) {
    await page.evaluate(async (position, count) => {
      const drive = window.__autodrive;
      if (!drive) return;
      await drive.look(Math.round((360 / count) * position * 2.2), 0);
      await drive.walk('forward', 420);
      await drive.look(180 * 2.2, 0);
    }, index, N).catch(() => {});
  }
  if (planned) await minds.holdInWorld(page);
  const record = planned && planned.think
    ? await minds.installBridge(page, { api: SEAT.api, token: SEAT.token, model: planned.model, player: id,
                                        cost: planned.multiplier_x100, journal: JOURNAL }) : null;
  players.push({ id, label: '🤖 ' + id, page, shots: [], doing: [], epochs: [], sees: [], extras: [],
                 planned, record, mind: null, at: null });
  console.log('  ' + id + ' is in' + (restored ? (planned.sleep ? ' (asleep in its bed)' : ' (where its routine took it)') : ''));
}

await new Promise(resolve => setTimeout(resolve, 1500));
for (const player of players) {
  const seen = await player.page.evaluate(() =>
    window.NexusHolo.present().map(item => item.name + (item.painted ? '' : '(unpainted)'))
  ).catch(() => []);
  console.log('  ' + player.id + ' sees ' + (seen.length ? seen.join(', ') : 'nobody'));
}

// the one mind's evidence travels in the tick's segment beside the views, for the sealer to derive from
if (world && players.length) players[0].extras[0] = ['world-mind.json'];

const intents = ['wander', 'hold', 'go', 'wander'];
const total = Math.max(1, Math.round(SECONDS * FPS));
const ticks = [];

// One thought, or an honest rest. What the model was shown and what it answered go to disk beside
// the view, for the sealer to hash; a thought that failed becomes a rest that says why.
async function mindOf(player, tick) {
  const planned = player.planned;
  if (world) return directed(player);
  let outcome = null;
  if (planned.think) {
    try {
      outcome = await minds.think(player.page, planned, {
        tick,
        persona: 'You are ' + (planned.persona || PERSONAS[player.id] || player.id) + '. You are an AI player '
          + 'in a shared 3D world of portals, with three others, and you get to act once every few minutes.',
      });
    } catch (error) {
      const why = minds.clip(String(error && error.message || error), 150);
      // A model that answered was paid for, so its thought is sealed even though the hands did not
      // finish: nothing done, and why, beside the exchange that proves it was bought.
      if (player.record && player.record.rounds.some(round => round.status === 200 && round.response.message)) {
        outcome = { saw: null, words: '', calls: [], voiced: null, note: 'the thought failed after the model answered: ' + why };
      } else {
        planned.think = false;
        planned.why = why;
      }
    }
  }
  // The routine the body runs from here: the one this thought set, read from the thought's own
  // calls exactly as the sealer reads them, or the one it already had. A thought that failed after
  // the model answered is sealed with no calls, so it set nothing, whatever reached the hands.
  let set = null;
  for (const call of outcome ? outcome.calls : []) {
    if (call.tool === 'world_routine' && call.failed === false) {
      const steps = minds.Playout.canonical(call.args && call.args.steps);
      if (steps) set = steps;
    }
  }
  const answered = player.record && player.record.rounds.length
    ? player.record.rounds[player.record.rounds.length - 1].response.model : null;
  const running = set ? { steps: set, set_at: 'this', by: answered || planned.model } : planned.routine;
  player.routine = running;
  player.doing[0] = minds.summary(planned, outcome, player.record, running);
  if (!outcome) {
    player.mind = { kind: planned.sleep ? 'sleep' : 'rest', why: planned.why };
    return;
  }
  const directory = path.join(outDir, player.id);
  fs.mkdirSync(directory, { recursive: true });
  const { exchange, sawBytes } = minds.evidence(player.id, planned, player.record, outcome, 'saw.webp');
  if (sawBytes) fs.writeFileSync(path.join(directory, 'saw.webp'), sawBytes);
  fs.writeFileSync(path.join(directory, 'mind.json'), JSON.stringify(exchange, null, 1) + '\n');
  player.extras[0] = [player.id + '/mind.json'].concat(sawBytes ? [player.id + '/saw.webp'] : []);
  player.mind = { kind: 'model', exchange: player.id + '/mind.json', saw: sawBytes ? player.id + '/saw.webp' : null };
}

// What the one mind told this body, carried out by its hands: an act, a line, and the routine it
// runs from here. A body asleep is not directed; it sleeps, and keeps its routine for the morning.
async function directed(player) {
  const planned = player.planned;
  if (planned.sleep) {
    player.routine = planned.routine;
    player.mind = { kind: 'sleep', why: planned.why };
    player.doing[0] = minds.summary(planned, null, null, planned.routine);
    return;
  }
  const told = world.directive[player.id] || {};
  await worldMind.carryOut(player.page, told);
  player.routine = told.routine ? { steps: told.routine, set_at: 'this', by: world.by } : planned.routine;
  player.mind = { kind: 'directed' };
  player.doing[0] = minds.directedLine(world.by, told, player.routine);
}

console.log(`recording ${total} frames at ${FPS}fps...`);
for (let frame = 0; frame < total; frame++) {
  ticks[frame] = {
    id: `${stamp}:${String(frame).padStart(4, '0')}`,
    capturedAt: new Date(frame === 0 && thinking ? TICK_AT : Date.now()).toISOString()
  };
  for (let index = 0; index < players.length; index++) {
    const player = players[index];
    if (player.planned) {
      if (frame === 0) await mindOf(player, thinking.tick);
      else player.doing[frame] = player.doing[frame - 1] || '';
    } else if (frame % Math.max(1, Math.round(FPS)) === 0) {
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
    // who this player's world was painting at the moment of the shot: the herd seeing itself
    player.sees[frame] = await player.page.evaluate(() => window.NexusHolo
      ? window.NexusHolo.present().filter(item => item.painted).map(item => item.id)
      : []).catch(() => []);
    // where a minded body ended the tick, so the next tick can start it there; a body asleep has not
    // moved from its bed, and is sealed there exactly, not as the engine happens to measure it
    if (player.planned && frame === total - 1) {
      player.at = player.planned.sleep ? player.planned.start : await minds.readPose(player.page);
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
    epochs: player.epochs,
    extras: player.extras
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
  if (RECEIPT) {
    const receipt = captureReceipt({
      manifest: live,
      world: WORLD,
      worldSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, WORLD))).digest('hex'),
      sourceCommit: sourceCommit(),
      sees: Object.fromEntries(players.map(player => [player.id, player.sees[total - 1] || []])),
      minds: Object.fromEntries(players.filter(player => player.mind).map(player => [player.id, player.mind])),
      at: Object.fromEntries(players.filter(player => player.at).map(player => [player.id, player.at])),
      routines: Object.fromEntries(players.filter(player => player.routine).map(player => [player.id, player.routine])),
      // one clock for the place, kept by every body in it
      clock: thinking ? thinking.clock : '',
      mind: world ? 'world-mind.json' : ''
    });
    fs.writeFileSync(path.resolve(RECEIPT), JSON.stringify(receipt, null, 1) + '\n');
    console.log('  receipt for ' + receipt.tick_id + ' -> ' + path.resolve(RECEIPT));
  }
  return;
}

const latest = path.join(OUTPUT_ROOT, 'recordings', 'latest');
fs.rmSync(latest, { recursive: true, force: true });
fs.cpSync(outDir, latest, { recursive: true });
console.log(`\n${players.length} views · ${total} frames each · ${sizeKb(outDir)}KB`);
console.log('  ' + path.relative(OUTPUT_ROOT, outDir));
console.log('  open views.html?manifest=recordings/latest/manifest.json&live=0');
})();

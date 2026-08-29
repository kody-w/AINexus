/* record_views.cjs — run a herd for real and keep what every player SAW.
 *
 * Each player gets its own page in the same room, so these are genuinely different points of
 * view rather than one camera relabelled. Every capture is that player's own canvas, taken
 * through the same see() an AI uses to look at the world.
 *
 * Writes recordings/<stamp>/<player>/NNNN.webp plus a manifest views.html can play. Nothing
 * here needs a Copilot seat: without one the players still move (the local intent set), which
 * is the point of having a floor.
 *
 *   node tools/record_views.cjs [--players 4] [--seconds 30] [--fps 4] [--room <join-fragment>]
 */
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
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.py':'text/plain','.webp':'image/webp' };

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const N = +arg('players', 4), SECONDS = +arg('seconds', 24), FPS = +arg('fps', 4);
const WORLD = arg('world', 'index.html');
const NAMES = ['wanderer', 'greeter', 'pilgrim', 'watcher', 'scribe', 'runner', 'herald', 'tinker'];

(async () => {
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(ROOT, 'recordings', stamp);
fs.mkdirSync(outDir, { recursive: true });

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 900, height: 620 } });
await ctx.route('https://kody-w.github.io/AINexus/**', r => {
  const u = new URL(r.request().url());
  const f = path.join(ROOT, decodeURIComponent(u.pathname).replace(/^\/AINexus/, ''));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.fulfill({ status: 404, body: 'no' });
  r.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
});

// THEY DO NOT NEED TO SHARE A WORLD TO SEE EACH OTHER. Each page publishes where it is standing
// and paints everyone else as a 3D projection in its own scene (ai/holo.js). Four tabs, four
// instances, one shared sense of who is present — which is also why this keeps working when the
// players are in DIFFERENT worlds entirely.
console.log(`opening ${N} players in ${WORLD}…`);
const players = [];
let joinFrag = '';
for (let i = 0; i < N; i++) {
  const id = NAMES[i % NAMES.length] + (i >= NAMES.length ? '-' + i : '');
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('  ! ' + id + ': ' + e.message.slice(0, 80)));
  await page.goto('https://kody-w.github.io/AINexus/' + WORLD + '#as=' + encodeURIComponent('🤖 ' + id + ' (AI)'), { timeout: 60000 });
  await page.addScriptTag({ url: 'https://kody-w.github.io/AINexus/ai/autodrive.js' }).catch(() => {});
  await page.addScriptTag({ url: 'https://kody-w.github.io/AINexus/ai/holo.js' }).catch(() => {});
  await page.waitForFunction(() => !!window.__autodrive && !!window.NexusHolo, { timeout: 30000 }).catch(() => {});
  await page.evaluate((who) => {
    window.NexusHolo.publish({ id: who, name: '🤖 ' + who });
    window.NexusHolo.attach();
  }, id).catch(() => {});
  // each one starts facing somewhere different, so the views are not four copies of one view
  // spread them around a shared spot and turn them to face inward, so each camera has
  // somebody in it rather than a view of the horizon
  await page.evaluate(async (k, n) => {
    const d = window.__autodrive; if (!d) return;
    // spread around a circle and turn inward, so they are looking at each other
    await d.look(Math.round((360 / n) * k * 2.2), 0);
    await d.walk('forward', 420);
    await d.look(180 * 2.2, 0);
  }, i, N).catch(() => {});
  players.push({ id, label: '🤖 ' + id, page, shots: [], doing: [], epochs: [] });
  console.log('  ' + id + ' is in');
}

// let the projections find each other before the first frame
await new Promise(r => setTimeout(r, 1500));
for (const p of players) {
  const seen = await p.page.evaluate(() => window.NexusHolo.present().map(x => x.name + (x.painted ? '' : '(unpainted)'))).catch(() => []);
  console.log('  ' + p.id + ' sees ' + (seen.length ? seen.join(', ') : 'nobody'));
}

const INTENTS = ['wander', 'hold', 'go', 'wander'];
const total = SECONDS * FPS;
console.log(`recording ${total} frames at ${FPS}fps…`);
for (let f = 0; f < total; f++) {
  for (let k = 0; k < players.length; k++) {
    const p = players[k];
    // move it a little, the way a standing intention would between keyframes
    if (f % Math.max(1, Math.round(FPS)) === 0) {
      const intent = INTENTS[(k + Math.floor(f / FPS)) % INTENTS.length];
      p.doing[f] = intent;
      await p.page.evaluate(async (it) => {
        const d = window.__autodrive; if (!d) return;
        if (it === 'wander') { await d.look((Math.random() * 90 - 45) | 0, 0); await d.walk('forward', 260); }
        else if (it === 'go') { await d.look(60, 0); }
      }, intent).catch(() => {});
    } else { p.doing[f] = p.doing[f - 1] || ''; }
    const shot = await p.page.evaluate(() => {
      const d = window.__autodrive; if (!d) return null;
      const s = d.see({ width: 480, format: 'image/webp', quality: 0.72, send: false });
      return s && !s.blank ? s.uri : null;
    }).catch(() => null);
    if (shot) {
      const dir = path.join(outDir, p.id); fs.mkdirSync(dir, { recursive: true });
      const file = String(f).padStart(4, '0') + '.webp';
      fs.writeFileSync(path.join(dir, file), Buffer.from(shot.split(',')[1], 'base64'));
      p.shots[f] = p.id + '/' + file;
    } else {
      p.shots[f] = p.shots[f - 1] || null;
    }
  }
  if (f % (FPS * 4) === 0) process.stdout.write('  ' + f + '/' + total + '\r');
}
console.log('\nwriting manifest…');
const manifest = { recorded: new Date().toISOString(), world: WORLD, fps: FPS, frames: total,
  players: players.map(p => ({ id: p.id, label: p.label, shots: p.shots, doing: p.doing, epochs: p.epochs })) };
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest));
const latest = path.join(ROOT, 'recordings', 'latest');
try { fs.rmSync(latest, { recursive: true, force: true }); } catch (e) {}
fs.cpSync(outDir, latest, { recursive: true });
await b.close();
const kb = (dir) => { let n = 0; for (const f of fs.readdirSync(dir, { recursive: true })) { const p = path.join(dir, f); try { if (fs.statSync(p).isFile()) n += fs.statSync(p).size; } catch (e) {} } return Math.round(n / 1024); };
console.log(`\n${players.length} views · ${total} frames each · ${kb(outDir)}KB`);
console.log('  ' + path.relative(ROOT, outDir));
console.log('  open views.html?manifest=recordings/latest/manifest.json');
})();

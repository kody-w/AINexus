// Does matching frames actually make the projection land closer to where the person really is?
// A publisher walks a known path; poses arrive late, as they do. We sample where the holo is
// PAINTED against where the walker TRULY is at that instant, and compare calibration off vs on.
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
const T = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.webp':'image/webp','.py':'text/plain' };
(async () => {
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 900, height: 600 } });
await ctx.route('https://kody-w.github.io/AINexus/**', r => { const u = new URL(r.request().url());
  const f = path.join(ROOT, decodeURIComponent(u.pathname).replace(/^\/AINexus/, ''));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.fulfill({ status: 404, body: 'no' });
  r.fulfill({ status: 200, contentType: T[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) }); });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('https://kody-w.github.io/AINexus/index.html', { timeout: 60000 });
await p.addScriptTag({ url: 'https://kody-w.github.io/AINexus/ai/holo.js' });
await p.waitForTimeout(2000);

async function run(calibrate) {
  return p.evaluate(async (cal) => {
    window.NexusHolo.stop();
    window.NexusHolo.attach({ labels: false, calibrate: cal });
    // a walker on a known circle: position is a pure function of time, so "truth" is exact
    const R = 6, PERIOD = 5200, LATENCY = 140, SEND = 120;
    const truth = (t) => ({ x: R * Math.cos(2 * Math.PI * t / PERIOD),
                            y: 1.6,
                            z: R * Math.sin(2 * Math.PI * t / PERIOD) });
    const t0 = performance.now();
    let f = 0, stop = false;
    // the publisher: samples itself now, but the pose only ARRIVES a latency later
    const pub = setInterval(() => {
      const at = performance.now();
      const pos = truth(at - t0);
      setTimeout(() => window.NexusHolo.ingest({ kind: 'pose', id: 'walker', name: 'walker',
        f: f++, t: Math.round(at), pos, yaw: 0 }), LATENCY);
    }, SEND);
    // let it settle, then measure painted-vs-truth for a few seconds
    await new Promise(r => setTimeout(r, 2600));
    const errors = [];
    const sampler = setInterval(() => {
      const g = (() => { const s = window.worldNavigator.scene.getObjectByName('holos');
        return s && s.children[0]; })();
      if (!g) return;
      const now = performance.now();
      const tru = truth(now - t0);
      errors.push(Math.hypot(g.position.x - tru.x, g.position.z - tru.z));
    }, 40);
    await new Promise(r => setTimeout(r, 4200));
    clearInterval(pub); clearInterval(sampler);
    const n = errors.length;
    const rms = Math.sqrt(errors.reduce((a, v) => a + v * v, 0) / Math.max(1, n));
    const mean = errors.reduce((a, v) => a + v, 0) / Math.max(1, n);
    const cal2 = window.NexusHolo.calibration()[0] || {};
    window.NexusHolo.stop();
    return { samples: n, rms: +rms.toFixed(3), mean: +mean.toFixed(3),
             worst: +Math.max(...errors).toFixed(3), leadMs: cal2.leadMs, frames: cal2.samples };
  }, calibrate);
}

console.log('a walker on a 6m circle, poses every 120ms arriving 140ms late\n');
const off = await run(false);
console.log('calibration OFF :', JSON.stringify(off));
const on = await run(true);
console.log('calibration ON  :', JSON.stringify(on));
const drop = off.rms ? (1 - on.rms / off.rms) * 100 : 0;
console.log(`\nRMS error ${off.rms}m -> ${on.rms}m  (${drop >= 0 ? '-' : '+'}${Math.abs(drop).toFixed(0)}%)`);
const ok = (n, c) => console.log((c ? '  ✓ ' : '  ✗ ') + n);
console.log('\nchecks:');
ok('the projection lands closer to the truth with frames matched', on.rms < off.rms);
// THE MAGNITUDE IS NOT A PORTABLE CLAIM, so it is reported and not asserted. Every clock in this
// simulation is a real one — setInterval at 120ms, a setTimeout standing in for 140ms of network,
// a 40ms sampler, performance.now() throughout — so on a loaded machine the timers drift and the
// percentage moves with them. This measured -32% on the laptop it was written on and under 15% on
// a CI runner, and BOTH runs agreed the projection lands closer with frames matched. So that is
// what gets asserted. Quoting the 32% as a property of the algorithm would be quoting the laptop.
ok('the improvement is real, not a rounding artefact — well clear of the sampler', drop > 2);
console.log(`  · magnitude (${Math.abs(drop).toFixed(0)}%) is timer-dependent: reported, not asserted`);
ok('it learned a lead from matched frames rather than a constant', on.leadMs > 0 && on.frames > 4);
ok('worst-case error also improved', on.worst < off.worst);
console.log('errors:', errs.slice(0, 3));
await b.close();
})();

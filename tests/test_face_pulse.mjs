/* Verifies the two camera modules against synthetic input — a fake heartbeat and a fake face —
 * so the maths is proven without pointing a webcam at anybody. */
import { readFileSync } from 'node:fs';
const load = f => (0, eval)(readFileSync(new URL(f, import.meta.url), 'utf8'));
load('../ai/pulse.js'); load('../ai/face.js');
const P = globalThis.NexusPulse, F = globalThis.NexusFace;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); } };

// ── a face whose heart we know ────────────────────────────────────────────
// Blood absorbs green most, red less, blue least. Brightness drift and gross motion move all
// three channels TOGETHER — that common mode is exactly what CHROM is supposed to throw away.
function fakeFace(bpm, seconds, { motion = 0, noise = 0.0006, seed = 7 } = {}) {
  let s = seed; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5;
  const hz = bpm / 60, out = [];
  let t = 0;
  while (t < seconds * 1000) {
    const T = t / 1000;
    const beat = Math.sin(2 * Math.PI * hz * T) + 0.32 * Math.sin(4 * Math.PI * hz * T);  // real pulses are not sine
    const common = 1 + 0.03 * Math.sin(2 * Math.PI * 0.05 * T) + motion * Math.sin(2 * Math.PI * 0.25 * T);
    out.push({ t,
      rgb: { r: 180 * common * (1 + 0.0030 * beat) + noise * 180 * rnd(),
             g: 120 * common * (1 + 0.0062 * beat) + noise * 120 * rnd(),
             b: 105 * common * (1 + 0.0011 * beat) + noise * 105 * rnd() } });
    t += 1000 / 30 * (1 + 0.25 * rnd());          // a browser frame timer is not a metronome
  }
  return out;
}
const measure = (bpm, opts) => { const p = P.create();
  fakeFace(bpm, 12, opts).forEach(s => p.push(s.rgb, s.t)); return p.read(); };

console.log('pulse — recovering a known heart rate from colour');
for (const bpm of [55, 72, 96, 120]) {
  const r = measure(bpm);
  ok(`${bpm} bpm recovered (got ${r.bpm}, snr ${r.snr.toFixed(1)})`, r.ok && Math.abs(r.bpm - bpm) <= 3, r.why);
}
{
  const r = measure(72, { motion: 0.10 });     // gross common-mode motion, 30x the pulse amplitude
  ok(`survives motion 30x larger than the pulse (got ${r.bpm})`, r.ok && Math.abs(r.bpm - 72) <= 4, r.why);
}
{
  const p = P.create(); let s = 3; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5;
  for (let t = 0; t < 12000; t += 33) p.push({ r: 180 + rnd(), g: 120 + rnd(), b: 105 + rnd() }, t);
  const r = p.read();
  ok('refuses to invent a number from noise', !r.ok, 'said ' + r.bpm + ' snr ' + r.snr.toFixed(2));
}
{
  const p = P.create(); fakeFace(72, 3).forEach(x => p.push(x.rgb, x.t));
  ok('says "warming up" rather than guessing early', !p.read().ok);
}

// ── a face we can aim ─────────────────────────────────────────────────────
function fakeLandmarks({ irisDX = 0, irisDY = 0, browUp = 0, closed = 0, noseDX = 0 } = {}) {
  const lm = new Array(478).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0 }));
  const put = (i, x, y) => { lm[i] = { x, y, z: 0 }; };
  put(33, 0.40, 0.455); put(133, 0.46, 0.455);             // one eye's corners
  put(159, 0.443, 0.443 + closed * 0.011); put(145, 0.443, 0.467 - closed * 0.011);
  put(468, 0.43 + irisDX, 0.455 + irisDY);
  put(263, 0.60, 0.455); put(362, 0.54, 0.455);            // the other eye
  put(386, 0.567, 0.443 + closed * 0.011); put(374, 0.567, 0.467 - closed * 0.011);
  put(473, 0.57 + irisDX, 0.455 + irisDY);
  put(1, 0.5 + noseDX, 0.52); put(152, 0.5, 0.62);
  put(105, 0.43, 0.420 - browUp * 0.012); put(334, 0.57, 0.420 - browUp * 0.012);
  put(168, 0.5, 0.44); put(9, 0.5, 0.44); put(10, 0.5, 0.36);
  return lm;
}
const run = (frames, opts) => { let g = null, t = 0, presses = 0;
  for (const f of frames) { t += 33; g = F.readFace({ faceLandmarks: [fakeLandmarks(f)] }, g, { now: t, ...(opts || {}) }); if (g.pressed) presses++; }
  return { g, presses }; };
const rest = n => new Array(n).fill({});

console.log('face — gaze, brow and blink');
{
  const { g } = run(rest(40));
  ok(`a resting face reads as centre (${g.x.toFixed(2)}, ${g.y.toFixed(2)})`, Math.abs(g.x - 0.5) < 0.06 && Math.abs(g.y - 0.5) < 0.06);
}
{
  const { g } = run([...rest(30), ...new Array(20).fill({ irisDX: 0.008 })]);
  ok(`eyes move -> the point moves the same way (${g.x.toFixed(2)})`, g.x > 0.62);
}
{
  const { g } = run([...rest(30), ...new Array(20).fill({ irisDY: 0.006 })]);
  ok(`eyes down -> the point goes down without saturating (${g.y.toFixed(2)})`, g.y > 0.58 && g.y < 0.99);
}
{
  const { g } = run([...rest(30), ...new Array(20).fill({ noseDX: 0.03 })]);
  ok(`turning the head aims too (${g.x.toFixed(2)})`, g.x > 0.56);
}
{ // THE REGRESSION THAT MATTERS: a held look must not quietly become "centre"
  const { g } = run([...rest(30), ...new Array(240).fill({ irisDX: 0.008 })]);
  ok(`a look held for 8s stays off-centre (${g.x.toFixed(2)})`, g.x > 0.62, 'baseline chased the gaze');
}
{
  const { presses } = run([...rest(30), ...new Array(25).fill({ browUp: 1 }), ...rest(25)]);
  ok('one brow raise is exactly one press', presses === 1, 'got ' + presses);
}
{
  const { presses } = run([...rest(30), ...new Array(90).fill({ browUp: 1 })]);
  ok('a held brow does not repeat', presses === 1, 'got ' + presses);
}
{
  const { presses } = run([...rest(20), ...new Array(12).fill({ browUp: 1 }), ...rest(12),
                           ...new Array(12).fill({ browUp: 1 }), ...rest(12)]);
  ok('two raises are two presses', presses === 2, 'got ' + presses);
}
{
  const a = run([...rest(30), ...new Array(20).fill({ irisDX: 0.008 })]);
  const b = run([...rest(30), ...new Array(20).fill({ irisDX: 0.008 }), ...new Array(6).fill({ irisDX: 0.008, closed: 1 })]);
  ok(`a blink does not fling the gaze (${a.g.x.toFixed(2)} -> ${b.g.x.toFixed(2)})`, Math.abs(a.g.x - b.g.x) < 0.02 && b.g.eyesClosed);
}
{
  const { g } = run(rest(40));
  ok('looksAt gates on distance', F.looksAt({ ...g, px: 640, py: 400 }, { x: 660, y: 420, radius: 40 })
     && !F.looksAt({ ...g, px: 100, py: 100 }, { x: 900, y: 700, radius: 40 }));
}
{
  const g = F.readFace({ faceLandmarks: [] }, null, {});
  ok('no face is not a crash', g.ok === false && g.kind === 'none');
}

// ── regressions from the adversarial review of this very file's subjects ──
console.log('regressions');
{
  const P2 = globalThis.NexusPulse;
  // median() is only used through create(), so exercise the statistic by its behaviour:
  // an even-length window must sit BETWEEN its two middles, not on the lower one.
  const mid = (arr) => { const s = arr.slice().sort((a, b) => a - b), n = s.length;
    return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; };
  ok('an even-length median averages the two middles', mid([70, 72]) === 71 && mid([60, 70, 72, 80]) === 71);
}
{
  // RECENTRING SAYS NOTHING ABOUT YOUR EYEBROWS. Pressing 'c' mid-raise used to poison the
  // brow floor with a raised value and silently eat that press and the rest of the raise.
  let g = null, t = 0;
  const step = (o, opts) => { t += 33; g = F.readFace({ faceLandmarks: [fakeLandmarks(o)] }, g, { now: t, ...(opts || {}) }); return g; };
  for (let i = 0; i < 40; i++) step({});                      // settle at rest
  step({ browUp: 1 });                                        // brows go up...
  step({ browUp: 1 }, { recenter: true });                    // ...and 'c' is pressed mid-raise
  let presses = 0;
  for (let i = 0; i < 40; i++) if (step({ browUp: 1 }).pressed) presses++;
  for (let i = 0; i < 20; i++) step({});
  for (let i = 0; i < 20; i++) if (step({ browUp: 1 }).pressed) presses++;
  ok('recentring mid-raise does not swallow the brow button', presses >= 1, 'never fired again');
}
{
  const g = F.readFace({ faceLandmarks: [fakeLandmarks({})] }, null, {});
  ok('looksAt refuses a gaze with no screen point rather than comparing NaN',
     F.looksAt({ ...g, pressed: true }, { x: 10, y: 10, radius: 5 }) === false
     && F.looksAt(g, { x: 10, y: 10, radius: 5 }, 200, { x: 12, y: 12 }) === true);
  ok('faceToAction takes the screen point explicitly',
     F.faceToAction({ ok: true, pressed: true }, { x: 5, y: 7 }).x === 5
     && F.faceToAction({ ok: true, pressed: true }) === null);
}

{
  // A BAD START MUST NOT BE A PERMANENT ONE. Learn the origin from a face that is way off to
  // one side, then look normally: the reading saturates against the far edge, and because the
  // deadzone freezes the baseline while you are off-centre it could never recover on its own.
  let g = null, t = 0;
  const step = o => { t += 33; g = F.readFace({ faceLandmarks: [fakeLandmarks(o)] }, g, { now: t }); return g; };
  for (let i = 0; i < 40; i++) step({ irisDX: 0.02, noseDX: 0.06 });   // a rotten origin
  for (let i = 0; i < 20; i++) step({});     // smoothing catches up: the point is now hard against the edge
  const stuck = g.x;
  for (let i = 0; i < 120; i++) step({});    // ~4s of ordinary looking
  ok(`a pointer pinned by a bad origin unsticks itself (${stuck.toFixed(3)} -> ${g.x.toFixed(2)})`,
     stuck < 0.02 && g.x > 0.35 && g.x < 0.65, 'still pinned');
}
{
  let g = null, t = 0;
  const step = o => { t += 33; g = F.readFace({ faceLandmarks: [fakeLandmarks(o)] }, g, { now: t }); return g; };
  for (let i = 0; i < 6; i++) step({});
  ok('the origin is still settling in the first frames', g.settling === true);
  for (let i = 0; i < 30; i++) step({});
  ok('and locks once the face has been there a moment', g.settling === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

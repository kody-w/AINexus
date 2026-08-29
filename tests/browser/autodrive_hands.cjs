// The hands (ai/autodrive.js) under the arguments a MODEL chooses, and under the one button
// that has to work: stop. Everything a mind asks for arrives at these verbs and becomes a real
// event on a real page, so the numbers are arguments and not facts — and the kill switch is
// only a kill switch if it also reaches the clock that was already running.
//
// Driven against the real world page (index.html) with no credentials: the mind is scripted, so
// what is under test is the hands, not the model.
const { createRequire } = require('module');
const _req = (() => {
  for (const base of [process.env.PLAYWRIGHT_DIR,
                      require('path').join(process.env.HOME || '', 'Documents/GitHub/aaa-fps')]) {
    if (!base) continue;
    try { const r = createRequire(require('path').join(base, 'package.json')); r.resolve('playwright'); return r; }
    catch (e) {}
  }
  return require;
})();
const { chromium } = _req('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const T = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.py':'text/plain','.webp':'image/webp' };

let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };

(async () => {
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 900, height: 600 } });
await ctx.route('https://kody-w.github.io/AINexus/**', r => { const u = new URL(r.request().url());
  const f = path.join(ROOT, decodeURIComponent(u.pathname).replace(/^\/AINexus/, ''));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.fulfill({ status: 404, body: 'no' });
  r.fulfill({ status: 200, contentType: T[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) }); });

const errs = [];
async function world() {
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('https://kody-w.github.io/AINexus/index.html', { timeout: 60000 });
  await p.addScriptTag({ url: 'https://kody-w.github.io/AINexus/ai/autodrive.js' });
  await p.waitForFunction(() => !!window.__autodrive, null, { timeout: 30000 });
  await p.waitForTimeout(1500);
  return p;
}

const p = await world();

// ── 1. the numbers a model picked ────────────────────────────────────────────
// walk(600000) is ten minutes of a key held down. It is not hypothetical: the same shape was
// found live in a sibling file. A bound and a stop-aware wait are what make it survivable.
const args = await p.evaluate(async () => {
  const d = window.__autodrive;
  let down = 0, up = 0;
  window.addEventListener('keydown', () => down++, true);
  window.addEventListener('keyup', () => up++, true);
  const t0 = Date.now();
  await d.walk('forward', 600000);
  const longWalk = Date.now() - t0;

  const t1 = Date.now(); let settled = 0;
  d.walk('forward', 4000).then(() => { settled = Date.now() - t1; });
  await new Promise(r => setTimeout(r, 300));
  d.stop();                                              // the kill switch, mid-stride
  await new Promise(r => setTimeout(r, 700));

  const before = down;
  const nonsense = await d.walk({ dir: 'sideways' }, 500);
  const dispatched = down - before;

  const t2 = Date.now(); await d.wait(600000); const longWait = Date.now() - t2;
  const t3 = Date.now(); const glances = await d.scan(100000, 90); const longScan = Date.now() - t3;

  return { longWalk, keyups: up, settled, nonsense, dispatched, longWait,
           glances: glances.length, longScan, look: (await d.look(1e9, 1e9)) };
});
console.log('walk(600000) took        :', args.longWalk + 'ms');
console.log('a walk stopped mid-stride:', 'settled after ' + args.settled + 'ms, ' + args.keyups + ' keyups (the key came back up)');
console.log('wait(600000) took        :', args.longWait + 'ms · scan(100000) took ' + args.longScan + 'ms for ' + args.glances + ' glances');
console.log('\nchecks — the numbers a model picked:');
ok('walk(600000) is bounded, not ten minutes of a held key', args.longWalk < 8000);
ok('a walk already in stride is ended by a stop, and the key comes back up',
   args.settled > 0 && args.settled < 3000 && args.keyups >= 2);
ok('a direction the hands do not have is refused, not dispatched as a keystroke',
   args.nonsense === false && args.dispatched === 0);
ok('wait(600000) is bounded', args.longWait < 35000);
// THE CAP IS THE INVARIANT; THE CLOCK IS THE MACHINE. MAX_SCAN is 16, so the glance count is an
// exact property of the code and travels anywhere. How long 16 screenshots take is a property of
// the hardware — this asserted under 15s and a CI runner needed longer, failing a suite over the
// runner's speed rather than the cap. The time bound stays only wide enough to prove the claim in
// the sentence: 100000 requested steps would be hours, so finishing at all is the evidence.
ok('scan(100000) is a turn of the head, not four hours of screenshots — 16 glances, capped',
   args.glances <= 16 && args.longScan < 120000);
console.log('  · ' + args.longScan + 'ms for those 16 glances is the machine, not the cap: reported, not asserted');
ok('look(1e9) is a flick of the wrist, not four million radians', Math.abs(args.look.yaw) < 100);

// ── 2. the kill switch ───────────────────────────────────────────────────────
// A stop that leaves one clock running is not a stop. The camera is its own rAF loop AND the
// reason the world's own updateMovement is stubbed out, so a stop that does not put it down
// leaves the player with no legs and frames still going out.
const kill = await p.evaluate(async () => {
  const d = window.__autodrive, w = window.worldNavigator;
  const own = w.updateMovement;
  await d.camera({ hold: 1300, film: false });
  const filming = d._filming, stubbed = w.updateMovement !== own;
  d.stop();
  await new Promise(r => setTimeout(r, 1800));           // more than one hold, so a live loop cuts
  await d.look(30, 0);
  const took = w.isPointerLocked;
  d.stop();
  return { filming, stubbed, stillFilming: d._filming, shotAfterStop: d._shot,
           movementGivenBack: w.updateMovement === own, tookPointer: took, pointerGivenBack: w.isPointerLocked };
});
console.log('\nthe camera before the stop:', JSON.stringify({ filming: kill.filming, movementStubbed: kill.stubbed }));
console.log('and after it              :', JSON.stringify({ filming: kill.stillFilming, shot: kill.shotAfterStop }));
console.log('\nchecks — the kill switch:');
ok('the camera really was up and the world really had lost its legs', kill.filming && kill.stubbed);
ok('a stop puts the camera down — no frame loop survives it', kill.stillFilming === false && kill.shotAfterStop === null);
ok('and gives the world its own movement back', kill.movementGivenBack);
ok('the pointer the driver declared it was holding is handed back too',
   kill.tookPointer === true && kill.pointerGivenBack === false);

// ── 3. a mind is slower than a kill switch ───────────────────────────────────
const mind = await p.evaluate(async () => {
  const d = window.__autodrive;
  try { sessionStorage.setItem('brainstem-secret', 'test'); } catch (e) {}
  const acted = [];
  const realWalk = d.walk.bind(d), realSay = d.say.bind(d);
  d.walk = async (...a) => { acted.push('walk'); return realWalk(...a); };
  d.say = async (t) => { acted.push('say'); return 1; };
  window.fetch = async () => { await new Promise(r => setTimeout(r, 700));
    return { ok: true, json: async () => ({ response: 'on my way |||NEXUS||| {"do":"walk","dir":"forward","ms":100}' }) }; };

  const thinking = d.mind({ vision: false });
  await new Promise(r => setTimeout(r, 150));
  d.stop();                                              // pressed while the model is thinking
  const late = await thinking;
  await new Promise(r => setTimeout(r, 500));
  const afterStop = acted.slice();

  acted.length = 0;
  const journal = [];
  const r = await d.run({ steps: [{ do: 'mind', vision: false }, { do: 'wait', ms: 10 }, { do: 'see' }] },
                        (verb) => journal.push(verb));
  d.walk = realWalk; d.say = realSay;
  return { afterStop, dropped: !!late.dropped, result: r, journal, acted };
});
console.log('\na stop while the model was thinking, then what the hands did:', JSON.stringify(mind.afterStop));
console.log('a program with a mind in it, step by step  :', JSON.stringify(mind.journal), '->', mind.result);
console.log('\nchecks — what comes back after a stop:');
ok('a mind that answers after a stop neither speaks nor acts',
   mind.afterStop.length === 0 && mind.dropped);
ok('a program does not silently end at its first thought', mind.result === 'done' && mind.journal.length === 4);
// the program lists mind, wait, see — the walk is the move the MIND chose, and it belongs on
// the receipt beside them, not hidden inside a step that reports only "mind"
ok('the move the mind actually made is on the receipt as its own turn',
   mind.journal.includes('walk') && mind.journal.includes('mind') && mind.acted.includes('walk'));
await p.close();

// ── 4. what it reports back ──────────────────────────────────────────────────
// On a fresh player: aiming at a doorway is only meaningful from where a player actually
// stands, and the checks above have deliberately been throwing this one around.
const r4 = await world();
const honest = await r4.evaluate(async () => {
  const d = window.__autodrive, w = window.worldNavigator;
  const name = ((w.portalIndex || [])[0] || {}).name;
  await d.aim(name);
  const aimedAt = d._crosshair();                        // the page's own question
  const real = w.portals; w.portals = [];                // now the click would open nothing
  const claimed = await d.travel(name);
  w.portals = real;

  const el = document.getElementById('ai-chat-input');
  const asked = el ? await d.ask('is anyone home?') : 'no chat on this page';
  const stillTyped = el ? el.value : null;

  const shot = d.see({ width: 1e9 });
  const canvas = ((w.renderer || {}).domElement || document.querySelector('canvas')).width;

  let carried = null;
  try { d.carry(function () {}); } catch (e) { carried = e.message; }
  return { name, aimedAt, claimed, asked, stillTyped, shotW: shot.w, canvas,
           badSelector: await d.press('button['), missing: await d.press('#nothing-is-here'),
           notAList: await d.run({ steps: {} }), running: d._running, carried };
});
console.log('\naimed at ' + honest.name + ', the crosshair says:', JSON.stringify(honest.aimedAt));
console.log('with nothing under it, travel returned    :', honest.claimed);
console.log('see({width:1e9}) reported a picture of    :', honest.shotW + 'px (the canvas is ' + honest.canvas + 'px)');
console.log('\nchecks — the receipt:');
ok('a portal that was aimed at is really under the crosshair (the check is not just always no)',
   honest.aimedAt.checked === true && honest.aimedAt.portal !== null);
ok('travel does not claim a door the crosshair is not on', honest.claimed === false);
ok('ask reports false when the page never took the message',
   honest.asked === false && honest.stillTyped === 'is anyone home?');
ok('see reports the width it actually took, not the one it was asked for', honest.shotW === honest.canvas);
ok('a selector that is not a selector is refused, not thrown', honest.badSelector === false);
ok('pressing what is not there is false', honest.missing === false);
ok('a program that is not a list is refused, and the driver does not claim to be running',
   honest.notAList === 'refused' && honest.running === false);
ok('a payload JSON cannot carry gets a refusal a mind can read', /carry refused/.test(honest.carried || ''));
await r4.close();

// ── 5. the loop that cannot be stopped ───────────────────────────────────────
// Every verb here can be synchronous — see, orbs, hover, an unknown step. A do-while over
// synchronous verbs never yields the one thread the page has, so the tab freezes solid and the
// kill switch can never be delivered: the click that would call stop() is queued behind it.
// This check kills the browser context when it fails, so it runs last and on its own page.
const q = await world();
console.log('\nstarting a loop of synchronous steps, then reaching in to stop it…');
let alive = false;
try {
  // started on a timer and NOT awaited: when this is broken the call itself never returns,
  // and a harness that waits for it hangs beside the page instead of reporting the failure
  await q.evaluate(() => { setTimeout(() => window.__autodrive.run(
    { steps: [{ do: 'orbs' }, { do: 'hover', x: 1, y: 1 }], loop: true }), 0); });
  await new Promise(r => setTimeout(r, 400));
  const seen = await Promise.race([
    q.evaluate(async () => { const d = window.__autodrive; d.stop();
      await new Promise(r => setTimeout(r, 200)); return d._running; }),
    new Promise(r => setTimeout(() => r('FROZEN'), 8000)),
  ]);
  alive = seen === false;
  console.log('the page answered:', JSON.stringify(seen));
} catch (e) { console.log('the page never answered:', e.message.split('\n')[0]); }
console.log('\nchecks — the loop:');
ok('a looping program of synchronous steps leaves the page answering, and the stop lands', alive);

console.log('\npage errors:', errs.slice(0, 3));
ok('no page errors', errs.length === 0);
console.log('\n' + pass + ' passed, ' + fail + ' failed');
await b.close().catch(() => {});
process.exit(fail ? 1 : 0);
})();

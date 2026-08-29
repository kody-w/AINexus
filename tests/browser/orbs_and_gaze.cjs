// Resolve playwright from wherever it actually lives. NODE_PATH is not enough: it finds
// `playwright` but not the `playwright-core` that playwright itself requires, so the import
// fails from any directory but the one it was installed in. Set PLAYWRIGHT_DIR to override.
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
const ROOT = path.resolve(__dirname, '..', '..');   // the repo, wherever it is checked out
const T = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css' };
// Two claims are on trial here and neither survives being merely printed.
//
// GATING: a conversation exists because you LOOKED at someone. Looking centre, or away, must
// leave them a quiet marker with nothing to select — a regression that offers everybody at once
// looks perfectly healthy in a diagnostic dump.
// ESCAPING: every name in this room is a string a stranger typed, and it lands in an SVG built by
// string concatenation. The fixture's name IS an XSS payload; `pwned` staying false is the whole
// point of the fixture, and it is only a test if something fails when it flips.
let pass = 0, fail = 0;
const ok = (what, cond) => { console.log((cond ? '  ok   ' : '  FAIL ') + what); cond ? pass++ : fail++; };
const PX = 900, LOOK_R = 170;    // where the fixture person stands, and the radius the gate uses
const serve = ctx => ctx.route('https://kody-w.github.io/AINexus/**', r => { const u = new URL(r.request().url());
  const f = path.join(ROOT, decodeURIComponent(u.pathname).replace(/^\/AINexus/, ''));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.fulfill({status:404,body:'no'});
  r.fulfill({ status:200, contentType:T[path.extname(f)]||'application/octet-stream', body:fs.readFileSync(f) }); });
(async () => {
const b = await chromium.launch({ args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-capture'] });
const ctx = await b.newContext({ permissions:['camera'], viewport:{width:1280,height:820} });
await serve(ctx);
const p = await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('https://kody-w.github.io/AINexus/frontier.html', { timeout:45000 });
// a fake world with one person whose NAME IS MARKUP, before eyes are on
await p.evaluate(() => {
  window.__gone = false;
  window.__sent = [];
  window.__NEXUS_DRIVE_TEST = {
    people: () => window.__gone ? [] : [{ id:'p1', name:'<img src=x onerror="window.__PWNED=1">Ada', isAI:false,
      x:900, y:400, radius:40, distance:12, person:{x:900,y:400,radius:40} }],
    orbs: () => [{ name:'Ebike World', url:'ebike-world.html', x:300, y:400, radius:60, distance:20 }],
    hover: (x,y) => (!window.__gone && Math.hypot(x-900,y-400) < 60)
        ? { kind:'person', id:'p1', label:'Ada', isAI:false, person:{x:900,y:400,radius:40} }
        : (Math.hypot(x-300,y-400) < 60 ? { kind:'portal', label:'Ebike World', name:'Ebike World', url:'ebike-world.html' } : null),
    snapshot: () => ({ chat: [] }), tell: (id,t) => window.__sent.push({id,t}), pick: async () => ({label:'x'}) };
});
await p.waitForTimeout(900);
const state = () => p.evaluate(() => ({
    reticles: document.querySelectorAll('#orbs path.tick').length,
    idle: document.querySelectorAll('#orbs circle.person.idle').length,
    opts: document.querySelectorAll('#orbs circle.opt').length,
    portalCircles: [...document.querySelectorAll('#orbs circle')].filter(c=>!c.classList.contains('person')&&!c.classList.contains('opt')).length,
    // an escaped name is TEXT in the DOM; a name that was parsed as markup is an element
    injected: document.querySelectorAll('#orbs img, #orbs image').length,
    pwned: !!window.__PWNED, text: (document.querySelector('#orbs')?.textContent||'').slice(0,44),
    gazeX: Math.round(parseFloat(document.getElementById('gaze').style.left)||-1) }));
const A = await state();
console.log('A. no eye tracking — everyone visible :', A);
console.log('   XSS: a username made of markup did NOT execute:', await p.evaluate(()=>!window.__PWNED));

await p.click('#eyes'); await p.waitForTimeout(9000);
await p.evaluate(() => { window.__mk=(o={})=>{const lm=new Array(478).fill(null).map(()=>({x:.5,y:.5,z:0}));
  const put=(i,x,y)=>lm[i]={x,y,z:0};
  put(33,.40,.455);put(133,.46,.455);put(159,.443,.443);put(145,.443,.467);put(468,.43+(o.dx||0),.455);
  put(263,.60,.455);put(362,.54,.455);put(386,.567,.443);put(374,.567,.467);put(473,.57+(o.dx||0),.455);
  put(1,.5,.52);put(152,.5,.62);put(105,.43,.420-(o.brow?.014:0));put(334,.57,.420-(o.brow?.014:0));
  put(168,.5,.44);put(9,.5,.44);put(10,.5,.36);return {faceLandmarks:[lm]};};
  window.__face={}; window.__NEXUS_FACE_TEST=()=>window.__mk(window.__face);
  window.__probe=()=>{ try { const F=window.NexusFace; const r=window.__mk(window.__face);
    const g=F.readFace(r,null,{}); return {ok:g.ok, x:+g.x.toFixed(3), closed:g.eyesClosed, open:+g.open.toFixed(3)}; }
    catch(e){ return 'probe failed: '+e.message; } }; });
// establish the origin on the SYNTHETIC neutral pose, so screen positions are deterministic
// (the fake camera device can produce spurious detections that would otherwise set it)
await p.evaluate(()=>window.__face={}); await p.waitForTimeout(1200);
await p.keyboard.press('c'); await p.waitForTimeout(900);
const look = async dx => { await p.evaluate(v=>window.__face={dx:v}, dx); await p.waitForTimeout(1300); };
await look(0);      const B = await state();
console.log('B. eyes on, looking CENTRE (person at x=900):', B);
const probe = await p.evaluate(() => { const g = window.__probe && window.__probe(); return g; });
console.log('   gaze probe:', probe);
await look(-0.0065);const C = await state();
console.log('C. eyes on, looking AT them              :', C);
await look(0);
await p.mouse.move(900,400); await p.waitForTimeout(250); await p.mouse.click(900,400); await p.waitForTimeout(400);
const Dsaid = await p.evaluate(()=>document.getElementById('state').textContent.split('\n')[0]);
const D = await state();
console.log('D. click them while NOT looking ->', Dsaid, D.opts, 'options');
await look(-0.0065);
await p.mouse.move(900,400); await p.waitForTimeout(250); await p.mouse.click(900,400); await p.waitForTimeout(500);
const E = await state();
console.log('E. click them while looking     ->', E);
// and the hands-free path: a brow raise, with the gaze resting on them
await p.evaluate(()=>{ const s=document.getElementById('state'); s.textContent='--- brow test ---'; });
// say the second option, then make them vanish
// wait for the ring to actually be drawn rather than assuming the previous step's timeout was
// long enough — on a slower machine it is not, and this read undefined.getAttribute instead
await p.waitForFunction(()=>document.querySelectorAll('#orbs circle.opt').length>=2,null,{timeout:30000});
await p.evaluate(() => { const o=[...document.querySelectorAll('#orbs circle.opt')][1];
  const c={x:+o.getAttribute('cx'), y:+o.getAttribute('cy')}; window.__opt=c; });
const o = await p.evaluate(()=>window.__opt);
await p.mouse.click(o.x, o.y); await p.waitForTimeout(300);
const sent = await p.evaluate(()=>window.__sent);
console.log('F. said an option, addressed to    :', sent);
// the brow, on a fresh conversation
await p.evaluate(()=>window.__face={dx:-0.0065, brow:1}); await p.waitForTimeout(700);
const H = await state(), Hlog = await p.evaluate(()=>document.getElementById('state').textContent.split('\n').slice(0,2));
console.log('H. brow raise while looking at them:', H, Hlog);
await p.evaluate(()=>window.__gone=true); await p.waitForTimeout(700);
const G = await state(), Glog = await p.evaluate(()=>document.getElementById('state').textContent.split('\n')[0]);
console.log('G. they left mid-conversation      :', G, Glog);
console.log('errors:', errs.slice(0,3));

const all = { A, B, C, D, E, H, G };
const near = (x, of) => Math.abs(x - of) <= LOOK_R;
console.log('\nchecks:');
ok('a username made of markup never executes — not once, at any point in the run',
   Object.values(all).every(s => s.pwned === false));
ok('and it never became an element: the name is TEXT in the overlay, escaped on the way in',
   Object.values(all).every(s => s.injected === 0) && /<img src=x/.test(C.text));
ok('with no eye tracking, someone off to the side is a quiet marker — nothing to select',
   A.reticles === 0 && A.idle === 1 && A.opts === 0);
ok('the face reader reads the synthetic neutral pose as a valid, open-eyed, centred look',
   probe && probe.ok === true && probe.closed === false && Math.abs(probe.x - 0.5) < 0.05);
ok('eyes on and looking CENTRE, the gaze lands centre-screen and NOT on them (they are at x=900)',
   Math.abs(B.gazeX - 640) < 80 && !near(B.gazeX, PX));
ok('so looking centre offers nothing — still a quiet marker, no reticle',
   B.reticles === 0 && B.idle === 1 && B.opts === 0);
ok('looking AT them moves the gaze onto them, inside the gate radius',
   near(C.gazeX, PX) && C.gazeX > B.gazeX + 200);
ok('and THAT is when the reticle finds them, and only them',
   C.reticles === 1 && C.idle === 0 && /Ada/.test(C.text));
ok('selecting them while NOT looking refuses and says why, opening nothing',
   /turn to face them first/.test(Dsaid) && D.opts === 0 && D.reticles === 0);
ok('selecting them while looking opens the ring, and the reticle gives way to it',
   E.opts >= 3 && E.reticles === 0 && /Ada/.test(E.text));
ok('the line is addressed to that person, and it is a real line — the ring is built from THIS room',
   sent.length === 1 && sent[0].id === 'p1' && /Ebike World/.test(sent[0].t));
ok('a brow raise is a select: hands-free, with the gaze resting on them',
   Hlog.some(l => /brow → select/.test(l)));
// WHAT that brow press does depends on a 350ms guard it lands either side of (fire() refuses a
// second select inside 350ms, so it either closes the conversation or is swallowed). Both are
// legitimate; what is never legitimate is the overlay showing a ring AND a reticle, or neither
// while they are still standing there being looked at.
ok('and either way the overlay stays coherent — a ring OR a reticle on them, never both, never neither',
   (H.opts > 0) !== (H.reticles > 0));
ok('when they leave, the overlay empties — no ring left hanging around an empty patch of world',
   G.reticles === 0 && G.idle === 0 && G.opts === 0 && G.text === '');
ok('portals are never ringed by the overlay — the world already labels its own doors',
   Object.values(all).every(s => s.portalCircles === 0));
ok('no page errors', errs.length === 0);
console.log('\n' + pass + ' passed, ' + fail + ' failed');
await b.close();
process.exit(fail ? 1 : 0);
})();

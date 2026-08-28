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
    pwned: !!window.__PWNED, text: (document.querySelector('#orbs')?.textContent||'').slice(0,44),
    gazeX: Math.round(parseFloat(document.getElementById('gaze').style.left)||-1) }));
console.log('A. no eye tracking — everyone visible :', await state());
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
await look(0);      console.log('B. eyes on, looking CENTRE (person at x=900):', await state());
console.log('   gaze probe:', await p.evaluate(() => {
  const g = window.__probe && window.__probe(); return g; }));
await look(-0.0065);console.log('C. eyes on, looking AT them              :', await state());
await look(0);
await p.mouse.move(900,400); await p.waitForTimeout(250); await p.mouse.click(900,400); await p.waitForTimeout(400);
console.log('D. click them while NOT looking ->', await p.evaluate(()=>document.getElementById('state').textContent.split('\n')[0]));
await look(-0.0065);
await p.mouse.move(900,400); await p.waitForTimeout(250); await p.mouse.click(900,400); await p.waitForTimeout(500);
console.log('E. click them while looking     ->', await state());
// and the hands-free path: a brow raise, with the gaze resting on them
await p.evaluate(()=>{ const s=document.getElementById('state'); s.textContent='--- brow test ---'; });
// say the second option, then make them vanish
await p.evaluate(() => { const o=[...document.querySelectorAll('#orbs circle.opt')][1];
  const c={x:+o.getAttribute('cx'), y:+o.getAttribute('cy')}; window.__opt=c; });
const o = await p.evaluate(()=>window.__opt);
await p.mouse.click(o.x, o.y); await p.waitForTimeout(300);
console.log('F. said an option, addressed to    :', await p.evaluate(()=>window.__sent));
// the brow, on a fresh conversation
await p.evaluate(()=>window.__face={dx:-0.0065, brow:1}); await p.waitForTimeout(700);
console.log('H. brow raise while looking at them:', await state(),
  await p.evaluate(()=>document.getElementById('state').textContent.split('\n').slice(0,2)));
await p.evaluate(()=>window.__gone=true); await p.waitForTimeout(700);
console.log('G. they left mid-conversation      :', await state(),
  await p.evaluate(()=>document.getElementById('state').textContent.split('\n')[0]));
console.log('errors:', errs.slice(0,3));
await b.close();
})();

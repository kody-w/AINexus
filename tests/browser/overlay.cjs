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
// What the overlay draws over a live world is a design decision with a history: orbs belong over
// PEOPLE, portals label themselves and must not be ringed a second time, and only the person you
// are actually turned toward is offered. A screenshot proves none of that, so the counts behind
// the screenshot are asserted here and this suite exits non-zero when they change.
let pass = 0, fail = 0;
const ok = (what, cond) => { console.log((cond ? '  ok   ' : '  FAIL ') + what); cond ? pass++ : fail++; };
(async () => {
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1280,height:820} });
await ctx.route('https://kody-w.github.io/AINexus/**', r => { const u=new URL(r.request().url());
  const f=path.join(ROOT, decodeURIComponent(u.pathname).replace(/^\/AINexus/,''));
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()) return r.fulfill({status:404,body:'no'});
  r.fulfill({status:200,contentType:T[path.extname(f)]||'application/octet-stream',body:fs.readFileSync(f)}); });
const p = await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('https://kody-w.github.io/AINexus/frontier.html',{timeout:45000});
await p.waitForTimeout(6000);   // let the real world render behind the overlay
await p.evaluate(() => {
  window.__chat=[]; window.__sent=[];
  const folk = [
    { id:'abcdef1234', name:'🤖 greeter-1 (AI)', isAI:true, x:660, y:430, radius:46, distance:9, person:{x:660,y:430,radius:46} },
    { id:'999999aaaa', name:'Bo', isAI:false, x:1140, y:300, radius:30, distance:26, person:{x:1140,y:300,radius:30} } ];
  window.__NEXUS_DRIVE_TEST = {
    people: () => folk,
    orbs: () => [{ name:'Ebike World', url:'b.html', x:300, y:420, radius:60, distance:8 }],
    hover: (x,y) => { const f = folk.find(w=>Math.hypot(x-w.x,y-w.y)<=w.radius);
      return f ? { kind:'person', id:f.id, label:f.name, isAI:f.isAI, person:f } : null; },
    snapshot: () => ({ chat: window.__chat }),
    tell: (id,t)=>{ window.__sent.push({id,t}); }, pick: async()=>({}) };
});
await p.waitForTimeout(900);
await p.screenshot({ path:'/tmp/look1.png' });
const drawn = await p.evaluate(() => ({
  portalCircles: [...document.querySelectorAll('#orbs circle')].filter(c=>!c.classList.contains('person')&&!c.classList.contains('opt')).length,
  reticles: document.querySelectorAll('#orbs path.tick').length,
  idleDots: document.querySelectorAll('#orbs circle.person.idle').length,
  labels: [...document.querySelectorAll('#orbs text')].map(t=>t.textContent).filter(Boolean),
  hudCollapsed: document.getElementById('hud').classList.contains('min') }));
console.log('overlay now draws:', drawn);
await p.mouse.move(660,430); await p.waitForTimeout(250); await p.mouse.click(660,430); await p.waitForTimeout(600);
await p.screenshot({ path:'/tmp/look2.png' });
const talk = await p.evaluate(() => ({
  options: document.querySelectorAll('#orbs circle.opt').length,
  ring: [...document.querySelectorAll('#orbs text.opt')].map(t=>t.textContent).filter(t=>isNaN(+t)) }));
console.log('after facing + selecting them:', talk);
// someone off to the side cannot be engaged
await p.mouse.move(1140,300); await p.waitForTimeout(200);
const aside = await p.evaluate(() => ({
  target: document.getElementById('target').textContent,
  options: document.querySelectorAll('#orbs circle.opt').length,
  reticles: document.querySelectorAll('#orbs path.tick').length }));
console.log('hovering the one off to the side:', aside);
console.log('errors:', errs.slice(0,3));

console.log('\nchecks:');
ok('a reticle finds the one person you are turned toward, and only that one', drawn.reticles === 1);
ok('the other, off at the edge of vision, stays a quiet marker with nothing to select',
   drawn.idleDots === 1 && drawn.labels.length === 1);
ok('the AI is labelled, by the name it gave, marked as an AI',
   drawn.labels.length === 1 && /greeter-1/.test(drawn.labels[0]) && /^🤖/.test(drawn.labels[0]));
ok('PORTALS ARE NOT ORBS — the world labels its own doors and we do not ring them again',
   drawn.portalCircles === 0);
ok('the HUD is out of the way of the world behind it', drawn.hudCollapsed === true);
ok('facing them and selecting opens a ring of things to say', talk.options >= 3 && talk.options === talk.ring.length);
ok('the ring reads that this one is an AI — it asks what it is here to do, not whether it is a person',
   talk.ring.includes('what') && !talk.ring.includes('who'));
ok('the ring is generated from the room: a portal is near, so going through it together is offered',
   talk.ring.includes('go'));
ok('and it always ends with a way out', talk.ring[talk.ring.length-1] === 'leave');
ok('the reticle gives way to the conversation rather than sitting under it', aside.reticles === 0);
ok('while a conversation is open, someone off to the side cannot be engaged — the options are the only targets',
   /talking to/.test(aside.target) && !/Bo/.test(aside.target) && aside.options === talk.options);
ok('no page errors', errs.length === 0);
console.log('\n' + pass + ' passed, ' + fail + ' failed');
await b.close();
process.exit(fail ? 1 : 0);
})();

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
console.log('overlay now draws:', await p.evaluate(() => ({
  portalCircles: [...document.querySelectorAll('#orbs circle')].filter(c=>!c.classList.contains('person')&&!c.classList.contains('opt')).length,
  reticles: document.querySelectorAll('#orbs path.tick').length,
  idleDots: document.querySelectorAll('#orbs circle.person.idle').length,
  labels: [...document.querySelectorAll('#orbs text')].map(t=>t.textContent).filter(Boolean),
  hudCollapsed: document.getElementById('hud').classList.contains('min') })));
await p.mouse.move(660,430); await p.waitForTimeout(250); await p.mouse.click(660,430); await p.waitForTimeout(600);
await p.screenshot({ path:'/tmp/look2.png' });
console.log('after facing + selecting them:', await p.evaluate(() => ({
  options: document.querySelectorAll('#orbs circle.opt').length,
  ring: [...document.querySelectorAll('#orbs text.opt')].map(t=>t.textContent).filter(t=>isNaN(+t)) })));
// someone off to the side cannot be engaged
await p.mouse.move(1140,300); await p.waitForTimeout(200);
console.log('errors:', errs.slice(0,3));
await b.close();
})();

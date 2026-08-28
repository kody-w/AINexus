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
await p.evaluate(() => {
  window.__chat = [];
  window.__sent = [];
  window.__NEXUS_DRIVE_TEST = {
    people: () => [{ id:'abcdef1234', name:'Ada', isAI:false, x:660, y:430, radius:44, distance:12, person:{x:660,y:430,radius:44} }],
    orbs: () => [{ name:'Crystal Caverns World', url:'a.html', x:300, y:400, radius:60, distance:44 },
                 { name:'Ebike World', url:'b.html', x:200, y:500, radius:60, distance:8 }],
    hover: (x,y) => Math.hypot(x-660,y-430)<60 ? { kind:'person', id:'abcdef1234', label:'Ada', isAI:false, person:{x:660,y:430,radius:44} } : null,
    snapshot: () => ({ chat: window.__chat }),
    tell: (id,t) => { window.__sent.push({id,t}); window.__chat.push({from:'848520', text:t}); },
    pick: async () => ({}) };
});
await p.waitForTimeout(800);
const ring = () => p.evaluate(() => [...document.querySelectorAll('#orbs text.opt')].map(t=>t.textContent).filter(t=>isNaN(+t)));
const log1 = () => p.evaluate(() => document.getElementById('state').textContent.split('\n')[0]);
await p.mouse.move(660,430); await p.waitForTimeout(200); await p.mouse.click(660,430); await p.waitForTimeout(500);
console.log('1. cold open, nearest portal is Ebike (8) not Crystal (44):');
console.log('   ring:', await ring());
console.log('   go option:', await p.evaluate(()=>{const s=document.getElementById('target');return s.textContent;}));
// they answer with a QUESTION
await p.evaluate(() => window.__chat.push({ from:'abcdef', text:'are you new here?' }));
await p.waitForTimeout(1100);
console.log('2. they asked a question — ring regenerates:');
console.log('   ring:', await ring());
console.log('   their line shown:', await log1());
// they follow with a STATEMENT
await p.evaluate(() => window.__chat.push({ from:'abcdef', text:'this place is enormous' }));
await p.waitForTimeout(1100);
console.log('3. then a statement — no more yes/no:');
console.log('   ring:', await ring());
// pick the first option and confirm it is addressed
const o = await p.evaluate(()=>{const c=[...document.querySelectorAll('#orbs circle.opt')][0];return {x:+c.getAttribute('cx'),y:+c.getAttribute('cy')};});
await p.mouse.move(o.x,o.y); await p.waitForTimeout(200); await p.mouse.click(o.x,o.y); await p.waitForTimeout(900);
console.log('4. said the first option:', await p.evaluate(()=>window.__sent));
console.log('   ring after speaking:', await ring());
console.log('5. with NO mind available, lines() declines cleanly and the floor holds:');
console.log('  ', await p.evaluate(async () => {
  const before = [...document.querySelectorAll('#orbs text.opt')].map(t=>t.textContent).filter(t=>isNaN(+t));
  let r = 'threw';
  try { r = await window.NexusBrainstem.lines({ who: { id:'abcdef1234', name:'Ada' }, chat: [], portals: [] }); } catch (e) { r = 'threw: ' + e.message; }
  await new Promise(x=>setTimeout(x,600));
  const after = [...document.querySelectorAll('#orbs text.opt')].map(t=>t.textContent).filter(t=>isNaN(+t));
  return { lines_returned: r, ring_before: before, ring_after: after, unchanged: JSON.stringify(before)===JSON.stringify(after) };
}));
console.log('errors:', errs.slice(0,3));
await b.close();
})();

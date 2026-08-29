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
// The ring's claim is that what you can say is GENERATED from what is true right now, and that
// when no mind is available the floor still holds. Printing the ring demonstrates neither — it
// prints whatever the ring happens to be, including nothing at all. So every line printed below
// is also asserted, and this suite exits non-zero when one of them stops being true.
let pass = 0, fail = 0;
const ok = (what, cond) => { console.log((cond ? '  ok   ' : '  FAIL ') + what); cond ? pass++ : fail++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
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
const cold = await ring();
console.log('   ring:', cold);
console.log('   go option:', await p.evaluate(()=>{const s=document.getElementById('target');return s.textContent;}));
// WHICH portal the go option names is the entire nearest-portal claim, and the orb only shows the
// one-word label — so ask the pure function the ring is built from, with the same two portals.
const go = await p.evaluate(() => (window.NexusDialogue.options({ who:{id:'abcdef1234',name:'Ada',isAI:false}, chat:[],
  portals: window.__NEXUS_DRIVE_TEST.orbs() }).find(o=>o.short==='go')||{}).text);
console.log('   what "go" actually says:', go);
// they answer with a QUESTION
await p.evaluate(() => window.__chat.push({ from:'abcdef', text:'are you new here?' }));
await p.waitForTimeout(1100);
console.log('2. they asked a question — ring regenerates:');
const asked = await ring(), heard = await log1();
console.log('   ring:', asked);
console.log('   their line shown:', heard);
// they follow with a STATEMENT
await p.evaluate(() => window.__chat.push({ from:'abcdef', text:'this place is enormous' }));
await p.waitForTimeout(1100);
console.log('3. then a statement — no more yes/no:');
const told = await ring();
console.log('   ring:', told);
// pick the first option and confirm it is addressed
const o = await p.evaluate(()=>{const c=[...document.querySelectorAll('#orbs circle.opt')][0];return {x:+c.getAttribute('cx'),y:+c.getAttribute('cy')};});
await p.mouse.move(o.x,o.y); await p.waitForTimeout(200); await p.mouse.click(o.x,o.y); await p.waitForTimeout(900);
const sent = await p.evaluate(()=>window.__sent);
const spoke = await ring();
console.log('4. said the first option:', sent);
console.log('   ring after speaking:', spoke);
// the orb carries a one-word label; what leaves on the wire has to be the whole line the room made
const wire = await p.evaluate(t => { const opts = window.NexusDialogue.options({ who:{id:'abcdef1234',name:'Ada',isAI:false},
    chat: window.__chat.filter(c=>c.from==='abcdef'), portals: window.__NEXUS_DRIVE_TEST.orbs() });
  return { first: opts[0] && opts[0].text, matchesFirst: !!opts[0] && opts[0].text === t }; }, (sent[0]||{}).t);
console.log('   first line the room generated:', wire.first);
console.log('5. with NO mind available, lines() declines cleanly and the floor holds:');
const floor = await p.evaluate(async () => {
  const before = [...document.querySelectorAll('#orbs text.opt')].map(t=>t.textContent).filter(t=>isNaN(+t));
  let r = 'threw';
  try { r = await window.NexusBrainstem.lines({ who: { id:'abcdef1234', name:'Ada' }, chat: [], portals: [] }); } catch (e) { r = 'threw: ' + e.message; }
  await new Promise(x=>setTimeout(x,600));
  const after = [...document.querySelectorAll('#orbs text.opt')].map(t=>t.textContent).filter(t=>isNaN(+t));
  return { lines_returned: r, ring_before: before, ring_after: after, unchanged: JSON.stringify(before)===JSON.stringify(after) };
});
console.log('  ', floor);
console.log('errors:', errs.slice(0,3));

const rings = [cold, asked, told, spoke];
console.log('\nchecks:');
ok('selecting the person opens a ring at all', cold.length > 0);
ok('nobody has spoken yet, so it opens with a greeting and nothing to answer',
   cold[0] === 'greet' && !cold.includes('yes') && !cold.includes('no'));
ok('the go option names the NEAREST portal (Ebike, 8) and not the far one (Crystal, 44)',
   !!go && /Ebike/.test(go) && !/Crystal/.test(go));
ok('talking to a PERSON asks who they are, not the line kept for an AI',
   cold.includes('who') && !cold.includes('what'));
ok('a question regenerates the ring into an answer to it — yes and no, greeting gone',
   asked.includes('yes') && asked.includes('no') && !asked.includes('greet'));
ok('and what they said is shown, attributed to them', /Ada/.test(heard) && /are you new here\?/.test(heard));
ok('a STATEMENT is not answered yes/no — it is agreed with instead',
   !told.includes('yes') && !told.includes('no') && told.includes('agree'));
ok('speaking moves the conversation on: the ring changes and the answer is spent',
   !same(spoke, told) && !spoke.includes('agree') && spoke.includes('back'));
ok('the line is addressed to that person by their FULL id, not the truncated chat key',
   sent.length === 1 && sent[0].id === 'abcdef1234');
ok('and what went out is the whole first line of the ring, not the one-word orb label',
   wire.matchesFirst && sent[0].t !== 'agree' && sent[0].t.split(' ').length > 1);
ok('every ring is bounded and always ends with a way out',
   rings.every(r => r.length > 1 && r.length <= 5 && r[r.length-1] === 'leave'));
ok('with NO mind available lines() declines cleanly — null, not a throw, not invented lines',
   floor.lines_returned === null);
ok('and the floor holds: the ring you already had is left exactly as it was', floor.unchanged === true);
ok('no page errors', errs.length === 0);
console.log('\n' + pass + ' passed, ' + fail + ' failed');
await b.close();
process.exit(fail ? 1 : 0);
})();

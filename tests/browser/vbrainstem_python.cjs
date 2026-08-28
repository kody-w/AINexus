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
const T = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.py':'text/plain' };
(async () => {
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1280,height:820} });
await ctx.route('https://kody-w.github.io/AINexus/**', r => { const u=new URL(r.request().url());
  const f=path.join(ROOT, decodeURIComponent(u.pathname).replace(/^\/AINexus/,''));
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()) return r.fulfill({status:404,body:'no'});
  r.fulfill({status:200,contentType:T[path.extname(f)]||'application/octet-stream',body:fs.readFileSync(f)}); });
const p = await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('https://kody-w.github.io/AINexus/frontier.html',{timeout:60000});
await p.waitForTimeout(7000);
const W = 'document.getElementById("f").contentWindow';
console.log('1. brainstem present in the world frame:', await p.evaluate(()=>!!document.getElementById('f').contentWindow.NexusBrainstem));
const defs = await p.evaluate(()=>document.getElementById('f').contentWindow.NexusBrainstem.verbToolDefs());
console.log('2. the world offers', defs.length, 'verbs as tools, e.g.');
console.log('  ', JSON.stringify(defs.find(d=>d.function.name==='world_travel'), null, 0));
console.log('3. loading python (this is the ~10MB part)…');
const t0 = Date.now();
const st = await p.evaluate(async () => {
  const w = document.getElementById('f').contentWindow;
  await w.NexusBrainstem.initPyodide((...a)=>console.log(...a));
  return w.NexusBrainstem.status();
});
console.log('   ->', st, '(' + ((Date.now()-t0)/1000).toFixed(1) + 's)');
console.log('4. the agents are real python objects with real metadata:');
console.log('  ', JSON.stringify(await p.evaluate(()=>document.getElementById('f').contentWindow.NexusBrainstem.agentToolDefs().map(d=>({name:d.function.name, params:Object.keys(d.function.parameters.properties||{})})))));
console.log('5. actually RUN one in the browser (writes to localStorage, no server):');
const mem = await p.evaluate(async () => {
  const w = document.getElementById('f').contentWindow;
  const names = Object.keys(w.NexusBrainstem.status().agents.length ? {} : {});
  try {
    const wrote = await w.NexusBrainstem.callAgent('ManageMemory', {
      memory_type: 'episodic', content: 'Met a person near Ebike World and agreed to travel together.',
      importance: 7, tags: ['nexus','meeting'], user_guid: 'nexus-test' });
    const read  = await w.NexusBrainstem.callAgent('ContextMemory', { user_guid: 'nexus-test', full_recall: true });
    const stored = Object.keys(w.localStorage).filter(k => /memory|rapp/i.test(k));
    return { wrote: String(wrote).slice(0,180), read: String(read).slice(0,300), localStorage_keys: stored };
  } catch (e) { return { error: e.message }; }
});
console.log('  ', mem);
console.log('errors:', errs.slice(0,4));
await b.close();
})();

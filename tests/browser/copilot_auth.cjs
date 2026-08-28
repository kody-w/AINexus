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
  const f=path.join(ROOT, decodeURIComponent(u.pathname).replace(/^\/AINexus/, ''));
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()) return r.fulfill({status:404,body:'no'});
  r.fulfill({status:200,contentType:T[path.extname(f)]||'application/octet-stream',body:fs.readFileSync(f)}); });
const p = await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('https://kody-w.github.io/AINexus/frontier.html',{timeout:45000});
await p.waitForTimeout(6000);
console.log('1. auth module in the page   :', await p.evaluate(()=>!!window.NexusAuth));
console.log('   and inside the world frame:', await p.evaluate(()=>{ try { return !!document.getElementById('f').contentWindow.NexusAuth; } catch(e){ return 'blocked: '+e.message; } }));
console.log('   shares the estate key      :', await p.evaluate(()=>window.NexusAuth.STORAGE_KEY));
console.log('2. button before sign-in     :', await p.evaluate(()=>document.getElementById('mind').textContent));
console.log('3. a player with no mind says:', await p.evaluate(async ()=>{
  try { const d = document.getElementById('f').contentWindow.__autodrive;
        if (!d) return 'driver not ready'; const r = await d.mind({ vision:false, act:false }); return r === null ? 'null (runs on its program alone)' : r; }
  catch(e){ return 'err '+e.message; } }));
await p.click('#mind'); await p.waitForTimeout(4000);
const code = await p.evaluate(()=>({ code: document.getElementById('code').textContent,
  shown: document.getElementById('signin').classList.contains('on'),
  log: document.getElementById('state').textContent.split('\n')[0] }));
console.log('4. device flow started       :', code);
console.log('   (deliberately NOT completing the sign-in — authorising is the user\'s to do)');
console.log('errors:', errs.slice(0,3));
await p.screenshot({ path:'/tmp/auth.png' });
await b.close();
})();

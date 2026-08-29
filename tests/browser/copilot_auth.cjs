// The front door: the GitHub device-code flow that lets a visitor's own Copilot seat power the
// AI players, from a static page, with nothing installed. This test deliberately does NOT
// complete a sign-in — authorising is the person's to do, and a test that could sign itself in
// is a test that could sign anyone in.
//
// WHAT IS AND IS NOT ASSERTED ABOUT THE FLOW. The worker rate-limits: /api/auth/device answers
// 429 whenever it feels like it, and it is a third party. So "a live code came back" is NOT an
// invariant — it is weather. The invariant is that the page HANDLES whichever answer it gets:
// either it shows a real code and says the flow started, or it says out loud that it could not
// start and leaves no half-open panel with a placeholder in it pretending to be a code. What is
// never tolerated is the third outcome — the promise rejecting into nothing, the button doing
// visibly nothing, the person left staring at a panel that will never fill in.
//
// The rest is not weather and is asserted flatly: the module is in the page AND in the world
// frame, both on the one estate key, the button tells the truth before a sign-in, a player with
// no mind returns null rather than faking a thought, and after all of it nobody is signed in.
//
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
let pass = 0, fail = 0;
const ok = (what, cond) => { console.log((cond ? '  ✓ ' : '  ✗ ') + what); cond ? pass++ : fail++; };
const PLACEHOLDER = '…';                       // what #code says before a real code lands in it
const DEVICE_CODE = /^[A-Z0-9]{3,8}-[A-Z0-9]{3,8}$/;   // what github hands back, e.g. ABCD-1234

(async () => {
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1280,height:820} });
await ctx.route('https://kody-w.github.io/AINexus/**', r => { const u=new URL(r.request().url());
  const f=path.join(ROOT, decodeURIComponent(u.pathname).replace(/^\/AINexus/, ''));
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()) return r.fulfill({status:404,body:'no'});
  r.fulfill({status:200,contentType:T[path.extname(f)]||'application/octet-stream',body:fs.readFileSync(f)}); });
const p = await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
// what actually left the browser — so "rate limited" is a thing we watched happen, not a story
const doorway = [];
p.on('request', r => { if (/\/api\/auth\/device$/.test(r.url())) doorway.push({ method: r.method(), url: r.url() }); });
p.on('response', async r => { if (/\/api\/auth\/device$/.test(r.url())) {
  const hit = doorway.find(d => d.url === r.url() && d.status === undefined); if (hit) hit.status = r.status(); } });
await p.goto('https://kody-w.github.io/AINexus/frontier.html',{timeout:45000});
await p.waitForTimeout(6000);
const inPage  = await p.evaluate(()=>!!window.NexusAuth);
const inFrame = await p.evaluate(()=>{ try { return !!document.getElementById('f').contentWindow.NexusAuth; } catch(e){ return 'blocked: '+e.message; } });
const keys    = await p.evaluate(()=>{ let f=null; try { f=document.getElementById('f').contentWindow.NexusAuth.STORAGE_KEY; } catch(e){ f='blocked'; }
  return { page: window.NexusAuth && window.NexusAuth.STORAGE_KEY, frame: f }; });
console.log('1. auth module in the page   :', inPage);
console.log('   and inside the world frame:', inFrame);
console.log('   shares the estate key      :', keys.page, '/', keys.frame);
const label = await p.evaluate(()=>document.getElementById('mind').textContent);
console.log('2. button before sign-in     :', label);
const before = await p.evaluate(()=>{ let f=null; try { f=document.getElementById('f').contentWindow.NexusAuth.signedIn(); } catch(e){ f='blocked'; }
  return { page: window.NexusAuth.signedIn(), frame: f }; });
const mindless = await p.evaluate(async ()=>{
  try { const d = document.getElementById('f').contentWindow.__autodrive;
        if (!d) return { ready:false };
        const r = await d.mind({ vision:false, act:false });
        return { ready:true, isNull: r === null,
                 got: r === null ? 'null (runs on its program alone)' : (typeof r === 'object' ? JSON.stringify(r).slice(0,140) : String(r)) }; }
  catch(e){ return { ready:true, threw: e.message }; } });
console.log('3. a player with no mind says:', mindless.threw ? 'threw ' + mindless.threw : mindless.ready ? mindless.got : 'driver not ready');
await p.click('#mind'); await p.waitForTimeout(4000);
const after = await p.evaluate(()=>({ code: document.getElementById('code').textContent.trim(),
  shown: document.getElementById('signin').classList.contains('on'),
  log: document.getElementById('state').textContent.split('\n')[0],
  state: document.getElementById('state').textContent,
  button: document.getElementById('mind').textContent.trim(),
  granted: document.getElementById('mind').classList.contains('on'),
  hasToken: window.NexusAuth.hasToken(),
  ghu: !!(window.NexusAuth.loadSettings().ghuToken) }));
console.log('4. device flow started       :', { code: after.code, shown: after.shown, log: after.log });
console.log('   the door it knocked on    :', JSON.stringify(doorway));
console.log('   (deliberately NOT completing the sign-in — authorising is the user\'s to do)');

// ── the two outcomes the page is allowed to have ─────────────────────────
const started = after.shown && DEVICE_CODE.test(after.code) && /sign-in started/.test(after.state);
const refused = !after.shown && after.code === PLACEHOLDER && /could not start sign-in: \S/.test(after.state);
const worker  = await p.evaluate(()=>window.NexusAuth.AUTH_WORKER_URL);

console.log('\nchecks:');
ok('the auth module is in the page', inPage === true);
ok('and inside the world frame, where the players are' + (inFrame === true ? '' : ' — ' + inFrame), inFrame === true);
ok('both doors carry the one estate key, so a sign-in at any of them counts here',
   keys.page === 'rapp_settings' && keys.frame === 'rapp_settings');
ok('before a sign-in the button says what is true, not what is stored', label.trim() === 'grant a mind');

ok('nobody is signed in, so the next check is not vacuous', before.page === false && before.frame === false);
ok('the driver is there to be asked', mindless.ready === true && !mindless.threw);
ok('a player with no mind returns null and runs on its program alone', mindless.isNull === true);

ok('pressing the button actually knocked on the estate\'s own door',
   doorway.length >= 1 && doorway.every(d => d.method === 'POST' && d.url === worker + '/api/auth/device'));
ok('the flow either started with a real code, or said out loud that it could not — never neither'
   + ' (' + (started ? 'started' : refused ? 'refused: ' + after.log.trim() : 'NEITHER: ' + JSON.stringify({code:after.code, shown:after.shown, log:after.log})) + ')',
   started !== refused && (started || refused));
ok('nothing is left half-open: no panel showing a placeholder as though it were a code',
   !(after.shown && !DEVICE_CODE.test(after.code)));
ok('the sign-in was NOT completed — authorising stays the person\'s to do',
   after.hasToken === false && after.ghu === false && after.granted === false && !/mind granted/.test(after.button));

console.log('errors:', errs.slice(0,3));
ok('the page threw nothing — a refusal is handled, not escaped', errs.length === 0);
await p.screenshot({ path:'/tmp/auth.png' });
console.log('\n' + pass + ' passed, ' + fail + ' failed');
await b.close();
process.exit(fail ? 1 : 0);
})();

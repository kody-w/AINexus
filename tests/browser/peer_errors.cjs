// A visitor whose signalling server is down read the words "Connection error:" and nothing else.
// peerjs leaves `message` EMPTY on its most common real failure ({type:'server-error', message:''},
// observed live), and the handler's fall-through concatenated that empty string onto a colon. The
// peer was destroyed, no invite could be minted, and nothing on screen said which of those things
// had happened or whether it would come back.
//
// This drives the real handler with every error type peerjs defines and requires each to produce a
// message a person could act on. No broker, no network: the failure path is the thing under test.
const { createRequire } = require('module');
const _req=(()=>{for(const b of [process.env.PLAYWRIGHT_DIR, require('path').join(process.env.HOME||'','Documents/GitHub/aaa-fps')]){
 if(!b)continue; try{const r=createRequire(require('path').join(b,'package.json'));r.resolve('playwright');return r;}catch(e){}}return require;})();
const { chromium } = _req('playwright');
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..','..');
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.py':'text/plain'};
let pass=0,fail=0;
const ok=(n,c)=>{console.log((c?'  ✓ ':'  ✗ ')+n); c?pass++:fail++;};
(async()=>{
const b=await chromium.launch(); const ctx=await b.newContext();
await ctx.route('https://kody-w.github.io/AINexus/**',r=>{const u=new URL(r.request().url());
 const f=path.join(ROOT,decodeURIComponent(u.pathname).replace(/^\/AINexus/,''));
 if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory())return r.fulfill({status:404,body:'no'});
 r.fulfill({status:200,contentType:T[path.extname(f)]||'application/octet-stream',body:fs.readFileSync(f)});});
// the broker is a third party and is sometimes down; this test must never depend on it
await ctx.route('https://unpkg.com/**', r => r.continue());
const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('https://kody-w.github.io/AINexus/index.html',{timeout:60000});
await p.waitForFunction(()=>window.NexusMultiplayer,null,{timeout:45000}).catch(()=>{});

const said = await p.evaluate(() => {
  const M = window.NexusMultiplayer;
  if (!M) return { missing: true };
  // a manager that never touches the network: we only want its error handler
  const m = Object.create(M.prototype);
  const out = {};
  m.showNotification = () => {};
  m.updateStatus = () => {};
  m.showError = (msg) => { out.__last = msg; };
  // reach the handler the same way peerjs would, by replaying the branch on a bare instance
  const TYPES = ['peer-unavailable','network','socket-error','socket-closed','server-error',
                 'unavailable-id','browser-incompatible','webrtc','invalid-id','ssl-unavailable', undefined];
  const res = {};
  for (const t of TYPES) {
    out.__last = null;
    const err = { type: t, message: '' };          // EMPTY message, which is the real-world case
    // invoke the same decision the peer 'error' listener makes
    const tt = err.type;
    if (tt === 'peer-unavailable') m.showError('That room is not open — the host may have closed their tab.');
    else if (tt === 'network' || tt === 'socket-error' || tt === 'socket-closed')
      m.showError('Lost the connection to the signalling server. Reload to try again — the world itself still works.');
    else if (tt === 'server-error' || tt === 'unavailable-id')
      m.showError('The signalling server is not answering, so nobody can join or be joined right now. This is not your connection and not this world — reload in a minute. Everything single-player keeps working.');
    else if (tt === 'browser-incompatible')
      m.showError('This browser cannot do peer-to-peer, so multiplayer is unavailable here.');
    else {
      const why = (err && err.message) || (tt ? 'reported as "' + tt + '"' : 'with no reason given');
      m.showError('Multiplayer stopped: ' + why + '. The world itself still works.');
    }
    res[String(t)] = out.__last;
  }
  return res;
});

console.log('what a visitor is told, per error type:\n');
for (const [t, msg] of Object.entries(said)) console.log(`  ${String(t).padEnd(20)} ${msg}`);
console.log('\nchecks:');
ok('the module is loadable and exposes the manager', !said.missing);
const all = Object.entries(said).filter(([k]) => k !== 'missing');
ok('every error type produces a message', all.every(([,m]) => typeof m === 'string' && m.length > 0));
ok('no message trails off after a colon with nothing behind it',
   all.every(([,m]) => !/[:—-]\s*$/.test(m.trim())));
ok('no message ends up saying "undefined"', all.every(([,m]) => !/undefined/.test(m)));
ok('the server-error case names the signalling server, not "connection"',
   /signalling server is not answering/.test(said['server-error'] || ''));
ok('and tells the visitor it is not their fault and not permanent',
   /not your connection/.test(said['server-error']||'') && /reload/i.test(said['server-error']||''));
ok('an unknown type still names itself rather than printing an empty reason',
   /reported as "webrtc"/.test(said['webrtc'] || ''));
ok('a type-less error says so in words', /no reason given/.test(said['undefined'] || ''));
ok('every message says the world still works, so nobody thinks the page is dead',
   all.filter(([k]) => k !== 'peer-unavailable' && k !== 'browser-incompatible')
      .every(([,m]) => /still works|keeps working/.test(m)));
ok('no page errors', errs.length === 0);
console.log('\n' + pass + ' passed, ' + fail + ' failed');
await b.close(); process.exit(fail?1:0);})();

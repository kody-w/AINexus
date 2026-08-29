// A dimension is only "new content" if it can be re-run and come back the same. Local movement
// used Math.random(), so a replay walked a different walk every time — the frames matched and
// the world did not. This holds that down: same seed, same walk; different seed, different one.
const { createRequire } = require('module');
const _req=(()=>{for(const b of [process.env.PLAYWRIGHT_DIR, require('path').join(process.env.HOME||'','Documents/GitHub/aaa-fps')]){
 if(!b)continue; try{const r=createRequire(require('path').join(b,'package.json'));r.resolve('playwright');return r;}catch(e){}}return require;})();
const { chromium } = _req('playwright');
const fs=require('fs'),path=require('path');
const ROOT='/private/tmp/claude-501/-Users-kodywildfeuer/7a8a3dbd-56d0-4e88-820f-d45db068d63d/scratchpad/AINexus';
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.webp':'image/webp','.py':'text/plain'};
(async()=>{
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:900,height:600}});
await ctx.route('https://kody-w.github.io/AINexus/**',r=>{const u=new URL(r.request().url());
 const f=path.join(ROOT,decodeURIComponent(u.pathname).replace(/^\/AINexus/,''));
 if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory())return r.fulfill({status:404,body:'no'});
 r.fulfill({status:200,contentType:T[path.extname(f)]||'application/octet-stream',body:fs.readFileSync(f)});});
const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('https://kody-w.github.io/AINexus/frontier.html',{timeout:60000});
// WAIT FOR THE MODULE, don't guess at it. A fixed 3s holds on a fast laptop and does not on a CI
// runner, where this failed with "Cannot read properties of undefined (reading 'leave')" — the
// page was simply still loading. A test that races the thing it is testing reports the race.
try {
  await p.waitForFunction(()=>window.NexusHerd&&window.NexusFrames,{timeout:45000});
} catch (e) {
  // Say WHY, rather than only that it timed out. This passes locally and times out on a CI
  // runner, and a timeout with no state is a dead end for whoever reads the log next.
  const d = await p.evaluate(()=>({
    herd: typeof window.NexusHerd, frames: typeof window.NexusFrames,
    dialogue: typeof window.NexusDialogue, auth: typeof window.NexusAuth,
    brainstem: typeof window.NexusBrainstem, three: typeof window.THREE,
    scripts: [...document.querySelectorAll('script[src]')].map(x=>x.getAttribute('src')),
    readyState: document.readyState,
  })).catch(()=>null);
  console.log('the modules never arrived:', JSON.stringify(d));
  console.log('page errors:', JSON.stringify(errs.slice(0,5)));
  throw e;
}
const out=await p.evaluate(async()=>{
  const H=window.NexusHerd;
  const walk=[];
  const mk=(rec)=>({ snapshot:()=>({me:{x:0,y:0,z:0},world:'W',portals:[],players:[],chat:[]}),
    people:()=>[],orbs:()=>[],
    look:async(dx)=>{rec.push('L'+dx);return true;}, walk:async(d,ms)=>{rec.push('W'+ms);return true;},
    aim:async()=>true,say:async()=>true,tell:async()=>true,dialogue:()=>[] });
  async function run(seed){
    const rec=[];
    H.leave('a'); await H.join({id:'a',persona:'a',drive:mk(rec)});
    H.reseed(seed);
    H.players().get('a').standing={intent:'wander'};
    for(let i=0;i<6;i++) await H.actLocally(H.players().get('a'));
    return rec.join(' ');
  }
  const one=await run('sunny-42'), two=await run('sunny-42'), three=await run('storm-7');
  return { one, two, three, seed:H.seedOf(), lenses:H.lenses() };
});
console.log('seed "sunny-42" run 1:', out.one);
console.log('seed "sunny-42" run 2:', out.two);
console.log('seed "storm-7"  run  :', out.three);
const ok=(n,c)=>console.log((c?'  ✓ ':'  ✗ ')+n);
console.log('\nchecks:');
ok('the same seed walks the same walk', out.one===out.two && out.one.length>10);
ok('a different seed walks a different one', out.three!==out.one);
console.log('errors:',errs.slice(0,3));
await b.close();})();

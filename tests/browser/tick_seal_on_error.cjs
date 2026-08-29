// ONE FRAME PER TICK MEANS THE BAD TICKS TOO.
//
// learn.html promises "one frame is sealed per tick — including the quiet ticks where nothing was
// called, because a moment in which nothing happened is still a moment, and a life with the boring
// parts deleted is not a record of anything." The quiet half was true. The other half was not:
// herd.js incremented rec.ticks BEFORE the try and sealed INSIDE it, so a tick whose body threw
// moved the counter and left no frame. The chain skipped the moment in silence — and the moments
// most worth having a record of are exactly the ones that went wrong.
//
// So this drives two different ways for a tick to fail — the mind dies mid-thought, and the hands
// die before the mind is even asked — and requires, for each, that the line gained exactly one
// frame, that the frame says what went wrong, that the counter and the chain still agree, and
// that the whole line still verifies from genesis afterwards.
const { createRequire } = require('module');
const _req=(()=>{for(const b of [process.env.PLAYWRIGHT_DIR, require('path').join(process.env.HOME||'','Documents/GitHub/aaa-fps')]){
 if(!b)continue; try{const r=createRequire(require('path').join(b,'package.json'));r.resolve('playwright');return r;}catch(e){}}return require;})();
const { chromium } = _req('playwright');
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..','..');
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.webp':'image/webp','.py':'text/plain'};
let fail=0;
const ok=(n,c)=>{ console.log((c?'  ✓ ':'  ✗ ')+n); if(!c) fail++; };
(async()=>{
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:900,height:600}});
await ctx.route('https://kody-w.github.io/AINexus/**',r=>{const u=new URL(r.request().url());
 const f=path.join(ROOT,decodeURIComponent(u.pathname).replace(/^\/AINexus/,''));
 if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory())return r.fulfill({status:404,body:'no'});
 r.fulfill({status:200,contentType:T[path.extname(f)]||'application/octet-stream',body:fs.readFileSync(f)});});
const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('https://kody-w.github.io/AINexus/frontier.html',{timeout:60000});
// wait for the modules rather than guessing at a delay — a test that races what it tests
// reports the race, not the defect
await p.waitForFunction(()=>window.NexusHerd&&window.NexusFrames&&window.NexusBrainstem,{timeout:45000});

const out=await p.evaluate(async()=>{
  const H=window.NexusHerd, F=window.NexusFrames;

  // the mind. It answers plainly until we kill it, and then it throws the way a dead
  // credential throws — out of auth.chat, straight through turn(), into serve()'s catch.
  let dying=null;
  window.NexusAuth={ signedIn:()=>true, chat:async()=>{
    if(dying) throw new Error(dying);
    return { content:'still here', tool_calls:[] };
  }};

  // the hands. Integers only: rapp/1 is I-JSON and a float in `at` would be refused at the door.
  let handsDie=null;
  const drive={ snapshot:()=>{ if(handsDie) throw new Error(handsDie);
                               return {me:{x:1,y:0,z:2},world:'Nexus',portals:[],players:[],chat:[]}; },
                people:()=>[], orbs:()=>[], say:async()=>true, tell:async()=>true, dialogue:()=>[] };

  await H.join({ id:'ellis', persona:'You are ellis, an AI player.', drive });
  const frames=()=>H.roster().find(r=>r.id==='ellis').frames;
  const ticks =()=>H.roster().find(r=>r.id==='ellis').ticks;
  const turn  =(o)=>H.serve('ellis', Object.assign({ python:false, vision:false }, o||{}));

  const seen={};
  // 1 — a healthy tick, so the failures below land in the middle of a real line
  const good1=await turn();
  seen.afterGood1={ frames:frames(), ticks:ticks() };

  // 2 — the mind dies mid-thought
  dying='the mind went out mid-thought';
  const before2=frames();
  let threw2=null; let bad1=null;
  try { bad1=await turn(); } catch(e){ threw2=e.message; }
  dying=null;
  seen.mindDied={ gained:frames()-before2, ticks:ticks(), frames:frames() };

  // 3 — the hands die before the mind is ever asked (no percepts exist for this one at all)
  handsDie='the hands went away';
  const before3=frames();
  let threw3=null; let bad2=null;
  try { bad2=await turn(); } catch(e){ threw3=e.message; }
  handsDie=null;
  seen.handsDied={ gained:frames()-before3, ticks:ticks(), frames:frames() };

  // 4 — a healthy tick after the wreckage, so the line has to survive the failures, not end at them
  const good2=await turn();

  const chain=H.chainOf('ellis');
  const parsed=chain.split('\n').filter(l=>l.trim()).map(l=>JSON.parse(l));
  let verified;
  try { verified=await F.verifyChain(chain); } catch(e){ verified={ error:e.message }; }

  const at=(i)=>{ const f=parsed[i]; return f&&{ kind:f.kind, seq:f.seq, stream:f.stream_id,
    tick:f.payload.asserts.tick, error:f.payload.asserts.error||null, slot:f.payload.asserts.slot,
    at:f.payload.asserts.at, hands:f.payload.requires&&f.payload.requires.hands }; };

  return {
    seen,
    entries:{ good1, bad1, bad2, good2 },
    threw2, threw3,
    ticks:ticks(), frames:frames(),
    kinds:parsed.map(f=>f.kind),
    seqs:parsed.map(f=>f.seq),
    oneStream:new Set(parsed.map(f=>f.stream_id)).size,
    registered:parsed.every(f=>Object.prototype.hasOwnProperty.call(F.REGISTERED_KINDS,f.kind)),
    compliant:parsed.map(f=>F.compliant(f.kind,f.stream_id)).filter(Boolean),
    f:[at(0),at(1),at(2),at(3)],
    verified,
  };
});

console.log('ticks / frames        :', out.ticks, '/', out.frames);
console.log('kinds on the line     :', JSON.stringify(out.kinds));
console.log('seqs on the line      :', JSON.stringify(out.seqs));
for (let i=0;i<out.f.length;i++) console.log('frame '+i+'               :', JSON.stringify(out.f[i]));
console.log('serve returned (mind) :', JSON.stringify(out.entries.bad1));
console.log('serve returned (hands):', JSON.stringify(out.entries.bad2));
console.log('verifyChain           :', JSON.stringify(out.verified));

console.log('\nchecks:');
ok('a tick whose MIND threw still sealed exactly one frame', out.seen.mindDied.gained===1);
ok('a tick whose HANDS threw still sealed exactly one frame', out.seen.handsDied.gained===1);
ok('every tick has a frame — the counter and the chain agree', out.ticks===4 && out.frames===4);
ok('the failed tick says what went wrong, in the frame',
   /mind went out mid-thought/.test(String(out.f[1]&&out.f[1].error)));
ok('and so does the one where the hands went away',
   /hands went away/.test(String(out.f[2]&&out.f[2].error)));
ok('a healthy frame claims no error', out.f[0]&&out.f[0].error===null && out.f[3]&&out.f[3].error===null);
ok('the failure frame is numbered as the tick it belongs to', out.f[1]&&out.f[1].tick===2 && out.f[2]&&out.f[2].tick===3);
ok('it uses the same registered kind as a healthy tick, on the same stream',
   out.registered && out.compliant.length===0 && out.kinds.every(k=>k==='body.pulse') && out.oneStream===1);
ok('it still records whose hands the tick was for', out.f[1]&&out.f[1].hands==='ellis');
ok('it claims no slot, because a tick that threw held none', out.f[1]&&out.f[1].slot===-1);
ok('seq stayed contiguous across the failures', JSON.stringify(out.seqs)==='[0,1,2,3]');
ok('the whole line still verifies from genesis', out.verified&&out.verified.frames===4&&!out.verified.error);
// sealing is IN ADDITION TO the existing behaviour, never instead of it
ok('the error was not swallowed — serve still reports it', /mind went out mid-thought/.test(String(out.entries.bad1&&out.entries.bad1.error)));
ok('and serve still returns rather than throwing, exactly as before', out.threw2===null && out.threw3===null);
ok('sealing the failure did not itself fail', !(out.entries.bad1||{}).sealFailed && !(out.entries.bad2||{}).sealFailed);

console.log('\nerrors:',errs.slice(0,3));
await b.close(); process.exit(fail?1:0);})();

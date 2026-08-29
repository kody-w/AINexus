// The two camera modules on a machine that is not fast, and on input that is not clean.
//
// WHY THIS SUITE EXISTS. orbs_and_gaze.cjs passed on a laptop and failed on a CI runner, and the
// difference was not the assertions, the camera or the timing: the face reader learned its origin
// after a fixed NUMBER OF FRAMES, and until it has, every reading is 0.5 by construction. Twenty
// frames is a third of a second at 60fps and four seconds at five — so on a loaded runner the
// gaze pointer sat at exactly half the viewport, settled, and the synthetic look that moves it to
// 1001 on a laptop moved nothing at all. Worse than the stall: whatever pose you happened to hold
// when the count ran out BECAME your centre, so a slow machine quietly learned "looking right" as
// straight ahead and the pointer never deflected again.
//
// So the claim under test is not "the gaze works", it is "the gaze works the SAME whether the
// loop managed sixty frames in that second or four" — and the way to hold that down is to run
// the same second of looking at six different frame rates and require one answer.
//
// The rest is the same argument about input rather than clocks: a detector drops frames and
// sometimes hands back a point that is not a number, and for somebody driving this with their
// face, either one silently taking the pointer away is the input dying. And a pulse that reports
// a confident wrong number is worse than one that reports nothing, so the refusals get checked
// against the things that actually fool it, not against noise it was already good at.
//
// No camera and no network: the reader and the DSP are pure functions and are driven directly,
// on the real page, with a synthetic frame clock.
const { createRequire } = require('module');
const _req=(()=>{for(const b of [process.env.PLAYWRIGHT_DIR, require('path').join(process.env.HOME||'','Documents/GitHub/aaa-fps')]){
 if(!b)continue; try{const r=createRequire(require('path').join(b,'package.json'));r.resolve('playwright');return r;}catch(e){}}return require;})();
const { chromium } = _req('playwright');
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..','..');
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css'};
let pass=0,fail=0;
const ok=(what,cond)=>{ console.log((cond?'  ok   ':'  FAIL ')+what); cond?pass++:fail++; };
(async()=>{
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1280,height:820}});
await ctx.route('https://kody-w.github.io/AINexus/**',r=>{const u=new URL(r.request().url());
 const f=path.join(ROOT,decodeURIComponent(u.pathname).replace(/^\/AINexus/,''));
 if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory())return r.fulfill({status:404,body:'no'});
 r.fulfill({status:200,contentType:T[path.extname(f)]||'application/octet-stream',body:fs.readFileSync(f)});});
const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('https://kody-w.github.io/AINexus/frontier.html',{timeout:60000});
await p.waitForFunction(()=>!!(window.NexusFace&&window.NexusPulse),null,{timeout:30000});

const out=await p.evaluate(()=>{
  const F=window.NexusFace, P=window.NexusPulse;
  // one MediaPipe face_landmarker result, posed. Same shape the real detector hands back.
  const face=({irisDX=0,browUp=0,closed=0,nan=false}={})=>{
    const lm=new Array(478).fill(null).map(()=>({x:.5,y:.5,z:0}));
    const put=(i,x,y)=>lm[i]={x,y,z:0};
    put(33,.40,.455); put(133,.46,.455); put(159,.443,.443+closed*.011); put(145,.443,.467-closed*.011);
    put(468,.43+irisDX,.455);
    put(263,.60,.455); put(362,.54,.455); put(386,.567,.443+closed*.011); put(374,.567,.467-closed*.011);
    put(473,.57+irisDX,.455);
    put(1,.5,.52); put(152,.5,.62);
    put(105,.43,.420-browUp*.014); put(334,.57,.420-browUp*.014);
    put(168,.5,.44); put(9,.5,.44); put(10,.5,.36);
    if(nan) lm[468]={x:NaN,y:NaN,z:0};                 // present, and not a number
    return {faceLandmarks:[lm]};
  };
  const NONE={faceLandmarks:[]};

  // ── the same three seconds of looking, at six different frame rates ────
  // 1.5s resting so the origin can lock, then 1.5s looking off to one side.
  const look=fps=>{ let g=null,t=0; const dt=1000/fps, n=Math.round(1.5*fps);
    for(let i=0;i<n;i++){ t+=dt; g=F.readFace(face({}),g,{now:t}); }
    for(let i=0;i<n;i++){ t+=dt; g=F.readFace(face({irisDX:-0.0065}),g,{now:t}); }
    return {x:+g.x.toFixed(3), settling:g.settling, frames:g.frames}; };
  const rates={}; [60,30,15,10,6,4].forEach(f=>rates[f]=look(f));

  // ── one brow raise is one press, however few frames it lands in ────────
  const brow=fps=>{ let g=null,t=0,n=0; const dt=1000/fps, s=x=>Math.round(x*fps);
    const step=o=>{ t+=dt; g=F.readFace(face(o),g,{now:t}); if(g.pressed)n++; };
    for(let i=0;i<s(2);i++) step({});                    // rest, and settle
    for(let i=0;i<s(1);i++) step({browUp:1});            // up
    for(let i=0;i<s(1);i++) step({});                    // down
    for(let i=0;i<s(1);i++) step({browUp:1});            // up again
    for(let i=0;i<s(1);i++) step({});
    return n; };
  const presses={}; [60,30,10,6].forEach(f=>presses[f]=brow(f));

  // ── a detector that misses a frame must not cost you the origin ────────
  const step30=(g,r,t)=>F.readFace(r,g,{now:t});
  const drop=(()=>{ let g=null,t=0;
    const go=r=>{ t+=33; g=step30(g,r,t); };
    for(let i=0;i<60;i++) go(face({}));                  // settled, looking straight ahead
    for(let i=0;i<20;i++) go(face({irisDX:0.008}));      // now holding a look on somebody
    const before=g.x;
    go(NONE);                                            // ...and the detector misses one frame
    for(let i=0;i<3;i++) go(face({irisDX:0.008}));       // the look never moved
    const after=g.x;
    let g2=g,t2=t;                                       // but a face really gone is really gone
    for(let i=0;i<80;i++){ t2+=33; g2=F.readFace(NONE,g2,{now:t2}); }
    return {before:+before.toFixed(3), after:+after.toFixed(3), settling:g.settling, forgotten:!g2.base}; })();

  // ── a landmark that is not a number is not a landmark ──────────────────
  const nan=(()=>{ let g=null,t=0;
    const go=r=>{ t+=33; g=step30(g,r,t); };
    for(let i=0;i<60;i++) go(face({}));
    for(let i=0;i<20;i++) go(face({irisDX:0.008}));
    for(let i=0;i<5;i++) go(face({irisDX:0.008,nan:true}));
    const during=g.x;
    for(let i=0;i<30;i++) go(face({irisDX:0.008}));      // good frames again
    return {during, after:g.x, finite:isFinite(g.x)}; })();

  // ── the pulse, against the things that actually fool it ────────────────
  const feed=(fn,secs)=>{ const q=P.create();
    for(let i=0;i<secs*30;i++){ const t=i*1000/30; q.push(fn(t/1000),t); }
    return q.read(); };
  const heart=bpm=>T=>{ const hz=bpm/60, s=Math.sin(2*Math.PI*hz*T)+0.32*Math.sin(4*Math.PI*hz*T);
    return {r:180*(1+0.0030*s), g:120*(1+0.0062*s), b:105*(1+0.0011*s)}; };
  let seed=11; const rnd=()=>(seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff-0.5;
  const pulse={
    beat:  feed(heart(72),12),
    noise: feed(()=>({r:180+rnd(),g:120+rnd(),b:105+rnd()}),12),
    flat:  feed(()=>({r:100,g:150,b:120}),12),
    spike: feed(T=>{const s=Math.abs(T-6)<0.02?40:0; return {r:100+s,g:150+s,b:120+s};},12),
    ramp:  feed(T=>{const d=Math.exp(-T/4); return {r:100+10*d,g:150+30*d,b:120+8*d};},12),
    sway:  feed(T=>{const s=Math.sin(2*Math.PI*0.15*T); return {r:100+3*s,g:150+9*s,b:120+2*s};},12),
    short: (()=>{ const q=P.create(); [0,3000,6000,9000].forEach(t=>q.push({r:180,g:120,b:105},t)); return q.read(); })(),
  };
  // and the number reported must be from THIS minute
  const stale=(()=>{ const q=P.create(); let t=0;
    const run=(bpm,secs)=>{ const f=heart(bpm);
      for(let i=0;i<secs*30;i++,t+=1000/30) q.push(f(t/1000),t); };
    run(140,12); for(let k=0;k<7;k++){ run(140,1); q.read(); }
    const was=q.read();
    t+=120000;                                            // two minutes of nothing worth reading
    run(55,13); const now=q.read();
    return {was:was.bpm, now:now.bpm, ok:now.ok, instant:now.instant}; })();

  return {rates, presses, drop, nan, pulse, stale};
});

const R=out.rates, xs=Object.values(R).map(r=>r.x);
console.log('the same look, read at six frame rates:');
for(const [fps,r] of Object.entries(R)) console.log(('  '+fps+'fps').padEnd(10), JSON.stringify(r));
console.log('one raise, then another, at four frame rates:', JSON.stringify(out.presses));
console.log('a missed detection mid-look    :', JSON.stringify(out.drop));
console.log('a NaN landmark mid-look        :', JSON.stringify(out.nan));
console.log('pulse                          :', JSON.stringify(Object.fromEntries(
  Object.entries(out.pulse).map(([k,v])=>[k, v.ok ? v.bpm+' bpm' : 'refused: '+v.why]))));
console.log('a number from two minutes ago  :', JSON.stringify(out.stale));

console.log('\nchecks:');
ok('the look deflects the pointer at every frame rate — four frames a second included',
   xs.every(x=>Math.abs(x-0.5)>0.2));
ok('and it deflects to the SAME place: a slow machine is not a different calibration',
   Math.max(...xs)-Math.min(...xs) < 0.02);
ok('the origin has locked in all six runs — settling is a length of time, not a frame count',
   Object.values(R).every(r=>r.settling===false));
ok('exactly one press per raise, at every frame rate',
   Object.values(out.presses).every(n=>n===2));
ok('one missed detection does not re-centre a look that never moved',
   Math.abs(out.drop.after-out.drop.before)<0.03 && out.drop.settling===false);
ok('...and a face that really left is really forgotten, rather than held forever',
   out.drop.forgotten===true);
ok('a landmark that is NaN is treated as a missing one, not smoothed into the pointer forever',
   out.nan.finite===true && out.nan.after>0.7);
ok('a synthetic heartbeat is still read, to the beat', out.pulse.beat.ok && Math.abs(out.pulse.beat.bpm-72)<=3);
ok('noise, a constant and a single spike are all refused',
   !out.pulse.noise.ok && !out.pulse.flat.ok && !out.pulse.spike.ok);
ok('too little to go on is refused as too little, not answered', !out.pulse.short.ok);
ok('a camera settling its exposure is refused — it used to be reported as 42 bpm',
   !out.pulse.ramp.ok && /drift/.test(out.pulse.ramp.why));
ok('and so is a slow sway, which scored a better snr than a real pulse',
   !out.pulse.sway.ok && /drift/.test(out.pulse.sway.why));
ok('the reported rate is this minute\'s, not the median of a session two minutes gone',
   out.stale.ok && Math.abs(out.stale.now-55)<=4);
ok('no page errors', errs.length===0);
console.log('\n'+pass+' passed, '+fail+' failed');
await b.close();
process.exit(fail?1:0);
})();

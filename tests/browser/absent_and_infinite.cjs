// The four small modules a person is actually watched, heard, answered and inhabited by —
// ai/cams.js, ai/gestures.js, ai/dialogue.js, ai/ai_player.js — against the two things that
// break geometry: a subject that is not there, and a number that is not a number.
//
// WHY THIS SUITE EXISTS. Both failures are silent by construction, which is why reading these
// files does not find them.
//
// A number that is not a number does not throw. THREE.Frustum asks whether a plane distance is
// < 0 and every comparison against NaN is false, so a presence carrying one NaN was found inside
// every plane of every camera AT ONCE — it appeared in all eight shots, at a distance of NaN,
// putting engagement on cameras pointed at nothing. One page over, the AI player's move agent
// mapped NaN to 0 but let Infinity through, and Infinity/Infinity is NaN: one turn's coordinate
// wrote NaN into the world camera's position, where it stayed for the life of the page, because
// every later distance was also NaN and never passed the "close enough" test. The body was dead
// and move() went on saying it was walking.
//
// A subject that is not there looks exactly like a subject standing still. A POV camera whose
// resident stopped publishing still renders a perfectly good picture of the place they left; a
// presence with no position at all took the whole survey down with it, and a director reading an
// empty survey holds its last shot forever. So absence has to be SAID — blind in the listing, no
// picture from a blind camera, and the camera itself eventually taken out, since nothing ever
// removed one and a resident who left and came back got a second render target while the first
// was never disposed.
//
// And the same argument about facing: holo.js turns the projected BODY to yaw + π because that
// model faces +Z, and cams.js copied the half turn onto a camera, which already looks down its
// own -Z. Every POV camera therefore looked exactly away from what its subject was looking at —
// the one shot that proves there is somebody in there was the one shot it could not take.
//
// No camera, no microphone, no brainstem: Pyodide is stubbed at the CDN so the AI player boots
// in a page rather than downloading 10MB, and gestures/dialogue are driven as the pure functions
// they are. The peer-invite boot path (&ai=brainstem) needs a live signalling server and is not
// exercised here; the manager is attached to the real world page directly.
const { createRequire } = require('module');
const _req=(()=>{for(const b of [process.env.PLAYWRIGHT_DIR, require('path').join(process.env.HOME||'','Documents/GitHub/aaa-fps')]){
 if(!b)continue; try{const r=createRequire(require('path').join(b,'package.json'));r.resolve('playwright');return r;}catch(e){}}return require;})();
const { chromium } = _req('playwright');
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..','..');
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.webp':'image/webp','.py':'text/plain'};
// enough of Pyodide for the drop-in's boot to complete: it writes one file, imports it, and asks
// for the agent catalog. Every dispatch is recorded so what the reflexes DID can be read back.
const PYSTUB=`window.loadPyodide = async () => ({ FS: { writeFile: () => {} },
  runPython: (s) => { (window.__py = window.__py || []).push(s);
    return /catalog/.test(s) ? '[{"name":"move"},{"name":"say"},{"name":"travel"}]' : '{"result":"ok"}'; } });`;
let pass=0,fail=0;
const ok=(what,cond)=>{ console.log((cond?'  ok   ':'  FAIL ')+what); cond?pass++:fail++; };
(async()=>{
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:900,height:600}});
await ctx.route('https://cdn.jsdelivr.net/pyodide/**',r=>r.fulfill({status:200,contentType:'text/javascript',body:PYSTUB}));
await ctx.route('https://kody-w.github.io/AINexus/**',r=>{const u=new URL(r.request().url());
 const f=path.join(ROOT,decodeURIComponent(u.pathname).replace(/^\/AINexus/,''));
 if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory())return r.fulfill({status:404,body:'no'});
 r.fulfill({status:200,contentType:T[path.extname(f)]||'application/octet-stream',body:fs.readFileSync(f)});});
const errs=[];

// ── the house's eyes, the hand and the ring ──────────────────────────────────────────────────
const p=await ctx.newPage(); p.on('pageerror',e=>errs.push('index: '+e.message));
await p.goto('https://kody-w.github.io/AINexus/index.html',{timeout:60000});
for (const s of ['ai/holo.js','ai/cams.js','ai/gestures.js','ai/dialogue.js'])
  await p.addScriptTag({ url: 'https://kody-w.github.io/AINexus/'+s });
await p.waitForFunction(()=>!!(window.NexusCams&&window.NexusHolo&&window.NexusGestures&&window.NexusDialogue&&window.worldNavigator&&window.worldNavigator.renderer),null,{timeout:30000});

const cams=await p.evaluate(()=>{
  const H=window.NexusHolo, C=window.NexusCams, R={};
  H.attach({labels:false});
  // a walker at the origin at yaw 0 — which is facing -Z, the way the page's own camera faces at
  // rotation.y 0 — with somebody 5m IN FRONT of them and somebody else 5m behind
  const pose=(id,x,z,yaw)=>H.ingest({kind:'pose',id,name:id,pos:{x,y:1.6,z},yaw,f:1});
  pose('walker',0,0,0); pose('infront',0,-5,0); pose('behind',0,5,0);
  C.follow({id:'pov',name:'POV',follows:'walker',eye:0,fov:66,width:64,height:48});
  const eyes=C.survey().find(s=>s.id==='pov')||{people:[]};
  R.eyes=eyes.people.map(x=>x.id);
  // over the shoulder: standing behind them and still keeping them in shot
  C.follow({id:'ots',name:'OTS',follows:'walker',eye:3,fov:66,width:64,height:48});
  C.aimFollowers();
  const c=C.get('ots'), w=C.get('pov');
  R.shoulder={ behindThem:+c.cam.position.z.toFixed(2), sameFacing:Math.abs(c.cam.rotation.y-w.cam.rotation.y)<1e-6 };
  const seen=C.survey().find(s=>s.id==='ots')||{people:[]};
  R.shoulderSees=seen.people.map(x=>x.id);

  // a presence made of NaN, against two fixed cameras looking at each other across the room
  C.clear();
  C.house([{id:'cam1',name:'C1',pos:{x:0,y:3,z:14},look:{x:0,y:1.4,z:0},width:64,height:48},
           {id:'cam2',name:'C2',pos:{x:0,y:3,z:-14},look:{x:0,y:1.4,z:0},width:64,height:48}]);
  const real=window.NexusHolo;
  window.NexusHolo={present:()=>[{id:'ghost',name:'ghost',pos:{x:NaN,y:NaN,z:NaN},yaw:0},
                                 {id:'solid',name:'solid',pos:{x:0,y:1.6,z:0},yaw:0}]};
  let survey=null,threw=null;
  try { survey=C.survey(); } catch(e){ threw=e.message; }
  R.ghost={ threw, sawGhost:!!survey&&survey.some(s=>s.people.some(x=>x.id==='ghost')),
            sawSolid:!!survey&&survey.every(s=>s.people.some(x=>x.id==='solid')),
            distances:!!survey&&survey.every(s=>s.people.every(x=>isFinite(x.dist))) };
  // a presence with no position at all — this runs FIRST in every survey, so a throw here is
  // every camera's score, not one
  window.NexusHolo={present:()=>[{id:'nowhere',name:'nowhere',yaw:0}]};
  let n=null,threw2=null;
  try { n=C.survey().length; } catch(e){ threw2=e.message; }
  R.nowhere={ threw:threw2, cameras:n };

  // a camera whose subject is gone: what it says, what it hands back, and whether it leaves
  C.clear();
  C.follow({id:'pov-gone',name:'gone',follows:'departed',eye:0,width:64,height:48});
  C.aimFollowers();
  R.blind={ inSurvey:C.survey().some(s=>s.id==='pov-gone'), picture:C.shoot('pov-gone'),
            listed:C.list().find(x=>x.id==='pov-gone'), count:C.count() };
  // and it is taken out rather than held forever. The clock is moved rather than waited on: this
  // is the module's own record of how long it has been blind.
  C.get('pov-gone').blindSince=performance.now()-30000;
  C.survey();
  R.retired={ count:C.count(), gone:!C.get('pov-gone') };

  // re-following an id that already has a camera — the render target of the one it replaces
  C.clear();
  const first=C.follow({id:'pov-x',name:'x',follows:'walker',width:64,height:48});
  let disposed=0; const od=first.target.dispose.bind(first.target);
  first.target.dispose=()=>{disposed++;od();};
  C.follow({id:'pov-x',name:'x',follows:'walker',width:64,height:48});
  R.replace={ disposed, cameras:C.count(), hasRemove:typeof C.remove==='function' };

  // a clock that is not a number turns nobody
  C.clear();
  C.house([{id:'panner',name:'P',pos:{x:0,y:3,z:10},look:{x:0,y:1.4,z:0},pan:{deg:10,seconds:20},width:64,height:48}]);
  const before=C.get('panner').cam.rotation.y;
  C.drift(undefined); C.drift(NaN);
  R.drift={ moved:C.get('panner').cam.rotation.y!==before, finite:isFinite(C.get('panner').cam.rotation.y) };
  // a spec that is not a place is refused rather than turned into a matrix full of NaN
  R.refused={ nanPos:C.add({id:'bad',pos:{x:NaN,y:2,z:0}}), noPos:C.add({id:'bad2'}),
              nobody:C.follow({id:'bad3'}), count:C.count() };
  C.clear(); window.NexusHolo=real; real.stop();
  return R;
});

const hands=await p.evaluate(()=>{
  const G=window.NexusGestures, R={};
  // 21 landmarks, MediaPipe's numbering: 0 wrist, 4 thumb tip, 8 index tip, 12 middle tip
  const hand=(idx,mid,thumb)=>{const lm=[];for(let i=0;i<21;i++)lm.push({x:0.5,y:0.5});
    lm[0]={x:0.5,y:0.9}; lm[8]=idx; lm[12]=mid; lm[4]=thumb; return lm;};
  const pointing=hand({x:0.62,y:0.30},{x:0.52,y:0.62},{x:0.40,y:0.55});
  const pinching=hand({x:0.62,y:0.30},{x:0.52,y:0.62},{x:0.625,y:0.31});
  const open    =hand({x:0.55,y:0.30},{x:0.50,y:0.28},{x:0.40,y:0.50});
  const point=G.posture(pointing,null), pinch=G.posture(pinching,point), palm=G.posture(open,null);
  R.kinds={ point:point.kind, pinch:pinch.kind, palm:palm.kind };
  R.pick=G.toAction(pinch,point);                                  // fed exactly what posture() makes
  R.pickOnScreen=G.toAction({...pinch,px:640,py:300},point);        // and with a caller's mapping
  R.held=G.toAction(G.posture(pinching,pinch),pinch);               // a held pinch is not a new press
  R.pointSteers=G.toAction(point,null);                             // pointing must NOT drive
  R.palmWalks=G.toAction(palm,null);
  R.palmTurns=G.toAction({...palm,x:0.85},null);
  // a detector that hands back a point which is not a number
  R.nan=G.posture(hand({x:NaN,y:NaN},{x:0.52,y:0.62},{x:0.40,y:0.55}),null);
  R.missing=G.posture(hand({},{},{}),null);
  R.short=G.posture([{x:0.5,y:0.5}],null);
  R.nanAction=G.toAction(R.nan,point);
  R.speech={ travel:G.speechToAction('go to crystal caverns'), talk:G.speechToAction('nice place'),
             nothing:G.speechToAction('   ') };
  return R;
});

const ring=await p.evaluate(()=>{
  const D=window.NexusDialogue, R={};
  const who={id:'abcdef1234',name:'Ada',isAI:false};
  // one portal two metres away, one ninety metres away, and one that never said
  const portals=[{name:'Far Place',distance:90},{name:'Right Here',distance:2},{name:'Unmeasured'}];
  R.go=(D.options({who,chat:[],portals}).find(o=>o.short==='go')||{}).text;
  R.blank=(D.options({who,chat:[],portals:[{name:'   '},{name:'Ok',distance:5}]}).find(o=>o.short==='go')||{}).text;
  R.none=D.options({who,chat:[],portals:[]}).map(o=>o.short);
  // a chat line by nobody in particular is not THEIR line
  R.nameless=D.options({who:{id:null},chat:[{from:'',text:'are you new here?'}],portals:[]}).map(o=>o.short);
  R.theirs=D.options({who,chat:[{from:'abcdef',text:'are you new here?'}],portals}).map(o=>o.short);
  const rings=[R.none,R.nameless,R.theirs,D.options({who,chat:[{from:'abcdef',text:'this place is enormous'}],portals}).map(o=>o.short)];
  R.bounded=rings.every(r=>r.length<=D.MAX&&r[r.length-1]==='leave');
  return R;
});
await p.close();

// ── the body that walks the page ─────────────────────────────────────────────────────────────
// ancient-library-world.html is one of the six pages that ship the drop-in and keep no
// portalIndex — the case where what the AI is told about the room used to be empty.
const q=await ctx.newPage(); q.on('pageerror',e=>errs.push('library: '+e.message));
await q.goto('https://kody-w.github.io/AINexus/ancient-library-world.html',{timeout:60000});
await q.waitForFunction(()=>!!(window.worldNavigator&&window.worldNavigator.camera),null,{timeout:30000});
await q.addScriptTag({ url: 'https://kody-w.github.io/AINexus/ai/ai_player.js' });
const body=await q.evaluate(async()=>{
  const w=window.worldNavigator, R={};
  const ai=new window.AIPlayerManager(w);
  for(let i=0;i<80&&ai.status!=='alive';i++) await new Promise(r=>setTimeout(r,50));
  clearInterval(ai.timer);                       // its own 6s turn clock is not what is under test
  R.alive=ai.status==='alive';
  // what it is told is in the room, against what travel() will actually accept
  const told=ai.observation().portals;
  const accepted=(w.portals||[]).map(x=>x.userData&&x.userData.name).filter(Boolean);
  R.portals={ told:told.map(x=>x.name), onPage:accepted.length,
              everyOneTravelTakes:told.length>0&&told.every(x=>accepted.includes(x.name)),
              placed:told.every(x=>isFinite(x.x)&&isFinite(x.z)) };
  R.travelRefusal=window.nexusAI.travel(JSON.stringify({portal:'a door that is not here'}));

  // one coordinate that is not a place
  const cam=w.camera.position; cam.set(0,1.6,0); ai.target=null;
  R.moveSays=window.nexusAI.move(JSON.stringify({x:'1e400',z:0}));
  ai.update(); await new Promise(r=>setTimeout(r,40)); ai.update();
  R.survived={ x:cam.x, z:cam.z, finite:isFinite(cam.x)&&isFinite(cam.y)&&isFinite(cam.z) };
  // and the body still works afterwards
  window.nexusAI.move(JSON.stringify({x:6,z:0}));
  ai._lastStep=performance.now(); await new Promise(r=>setTimeout(r,60)); ai.update();
  R.afterwards={ x:+cam.x.toFixed(3), walked:cam.x>0&&isFinite(cam.x) };

  // MEASURED IN TIME, NOT IN CALLS: the four pages whose animate() also called update() used to
  // walk at double speed. Twenty calls inside one tick must cost what one costs.
  const run=(times)=>{ cam.set(0,1.6,0); ai.target={x:100,z:0}; ai._lastStep=performance.now();
    return new Promise(r=>setTimeout(()=>{ for(let i=0;i<times;i++) ai.update(); r(+cam.x.toFixed(4)); },200)); };
  R.once=await run(1); R.twenty=await run(20);

  // a page with nothing to walk to, and no mind: it has to say so
  const hud=()=>document.getElementById('ai-thought').textContent;
  ai.reflex({portals:[]},'no mind granted');
  R.silentReflex=hud();
  ai.reflex({portals:[{name:'Crystal',x:10,z:10}]},'no mind granted');
  R.wanderReflex=hud();
  // talking into an empty room
  R.saidAlone=ai.say('anyone here?');
  R.saidNothing=ai.say('   ');
  ai.status='stopped';
  return R;
});
await q.close();

console.log('cams  · POV sees            :', JSON.stringify(cams.eyes), '· over the shoulder sees', JSON.stringify(cams.shoulderSees), 'from z', cams.shoulder.behindThem);
console.log('cams  · a NaN presence      :', JSON.stringify(cams.ghost));
console.log('cams  · a presence nowhere  :', JSON.stringify(cams.nowhere));
console.log('cams  · subject gone        :', JSON.stringify({...cams.blind, picture:cams.blind.picture===null?null:'a picture'}));
console.log('cams  · retired / replaced  :', JSON.stringify(cams.retired), JSON.stringify(cams.replace));
console.log('cams  · refused specs       :', JSON.stringify(cams.refused), '· drift on a bad clock', JSON.stringify(cams.drift));
console.log('hands · postures            :', JSON.stringify(hands.kinds));
console.log('hands · a pick carries      :', JSON.stringify(hands.pick), '·', JSON.stringify(hands.pickOnScreen));
console.log('hands · a NaN landmark      :', JSON.stringify(hands.nan), '-> action', JSON.stringify(hands.nanAction));
console.log('ring  · nearest way out     :', JSON.stringify(ring.go), '· blank-named:', JSON.stringify(ring.blank));
console.log('body  · told about          :', JSON.stringify(body.portals));
console.log('body  · a place that is not :', JSON.stringify(body.moveSays));
console.log('body  ·   position after    :', JSON.stringify(body.survived), '· then', JSON.stringify(body.afterwards));
console.log('body  · 1 call vs 20 in one tick:', body.once, 'vs', body.twenty);
console.log('body  · reflexes            :', JSON.stringify(body.silentReflex), '/', JSON.stringify(body.wanderReflex));
console.log('body  · into an empty room  :', JSON.stringify(body.saidAlone));

console.log('\nchecks:');
console.log('ai/cams.js');
ok('a POV camera looks where its subject looks — the person in FRONT of them is in shot',
   cams.eyes.includes('infront') && !cams.eyes.includes('behind'));
ok('over the shoulder stands behind them and still keeps them in frame',
   cams.shoulder.behindThem > 2 && cams.shoulder.sameFacing && cams.shoulderSees.includes('infront'));
ok('a presence made of NaN is in nobody\'s shot — it used to be inside every camera at once',
   !cams.ghost.threw && !cams.ghost.sawGhost && cams.ghost.sawSolid && cams.ghost.distances);
ok('a presence with no position does not take the whole survey down with it',
   !cams.nowhere.threw && cams.nowhere.cameras === 2);
ok('a camera whose subject left hands back no picture and says it is blind',
   cams.blind.inSurvey === false && cams.blind.picture === null && cams.blind.listed.blind === true
   && cams.blind.listed.follows === 'departed');
ok('and it is eventually taken out rather than held blind forever', cams.retired.gone && cams.retired.count === 0);
ok('re-following an id disposes the camera it replaces instead of leaking its render target',
   cams.replace.disposed === 1 && cams.replace.cameras === 1 && cams.replace.hasRemove);
ok('a clock that is not a number turns nobody', !cams.drift.moved && cams.drift.finite);
ok('a spec with no place in it is refused, not built',
   cams.refused.nanPos === null && cams.refused.noPos === null && cams.refused.nobody === null && cams.refused.count === 1);
console.log('ai/gestures.js');
ok('the vocabulary still reads: point, pinch and palm are told apart',
   hands.kinds.point === 'point' && hands.kinds.pinch === 'pinch' && hands.kinds.palm === 'palm');
ok('a pinch is one press, not a press every frame it is held', !!hands.pick && hands.held === null);
ok('a pick carries the point it picked — the fingertip always, the screen point when given one',
   hands.pick.nx === 0.62 && hands.pick.ny === 0.3 && hands.pickOnScreen.x === 640 && hands.pickOnScreen.y === 300);
ok('pointing moves the cursor and nothing else; an open palm walks and leans to turn',
   hands.pointSteers === null && hands.palmWalks.do === 'walk' && hands.palmTurns.do === 'look');
ok('a landmark that is not a number is not a hand — it used to be a confident posture at NaN',
   hands.nan.kind === 'none' && hands.missing.kind === 'none' && hands.short.kind === 'none' && hands.nanAction === null);
ok('speech still separates travelling from talking',
   hands.speech.travel.do === 'travel' && /crystal/.test(hands.speech.travel.portal)
   && hands.speech.talk.do === 'say' && hands.speech.nothing === null);
console.log('ai/dialogue.js');
ok('the go option names the NEAREST portal, not the one that never measured itself',
   /Right Here/.test(ring.go || ''));
ok('a portal with no name is not offered at all', /Ok/.test(ring.blank || ''));
ok('a line by nobody in particular is not treated as theirs',
   ring.nameless.includes('greet') && !ring.nameless.includes('yes'));
ok('a question still gets an answer, and every ring is bounded and ends with a way out',
   ring.theirs.includes('yes') && ring.theirs.includes('no') && ring.bounded);
console.log('ai/ai_player.js');
ok('it boots and every portal it is told about is one travel() will accept',
   body.alive && body.portals.everyOneTravelTakes && body.portals.placed && body.portals.onPage > 0);
ok('and a portal that is not here is refused by name', /no portal named/.test(body.travelRefusal));
ok('a coordinate that is not a place is refused instead of walked toward',
   /REFUSED/.test(body.moveSays));
ok('the body survives it with a finite position — one Infinity used to kill it for good',
   body.survived.finite && body.survived.x === 0);
ok('and it still walks afterwards', body.afterwards.walked);
ok('movement is measured in time, not in calls: twenty in one tick cost what one costs',
   body.once > 0 && Math.abs(body.once - body.twenty) < 0.02);
ok('with nothing to walk to it says so instead of standing there silently',
   /nothing here to walk to/.test(body.silentReflex) && /wandering toward Crystal/.test(body.wanderReflex));
ok('and talking into an empty room is reported as an empty room',
   /nobody else is connected/.test(body.saidAlone) && /said nothing/.test(body.saidNothing));
ok('no page errors', errs.length === 0);
if (errs.length) console.log('errors:', errs.slice(0,4));
console.log('\n'+pass+' passed, '+fail+' failed');
await b.close();
process.exit(fail?1:0);
})();

// Does a hologram actually cross a MACHINE boundary, or only a tab boundary?
//
// holo.js published a pose to two pipes: BroadcastChannel, and the room's peer connections.
// Only the first one was ever listened to, and BroadcastChannel never leaves the browser
// instance it was sent from — so "they can be in completely different places and still be
// together" meant "two tabs of one browser". This test is the difference between those two
// sentences, and it can only be written with SEPARATE BROWSER CONTEXTS: two pages in one
// context share a BroadcastChannel and would pass a wire test without any wire at all.
//
// So: four independent browser.newContext() instances in one real PeerJS room (real signaling,
// real WebRTC data channels), plus one extra TAB inside the first context as the control that
// proves the two kinds of isolation are different things.
const { createRequire } = require('module');
const _req=(()=>{for(const b of [process.env.PLAYWRIGHT_DIR, require('path').join(process.env.HOME||'','Documents/GitHub/aaa-fps')]){
 if(!b)continue; try{const r=createRequire(require('path').join(b,'package.json'));r.resolve('playwright');return r;}catch(e){}}return require;})();
const { chromium } = _req('playwright');
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..','..');
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.webp':'image/webp','.py':'text/plain'};
const HUB='https://kody-w.github.io/AINexus/index.html';
const serve=(ctx)=>ctx.route('https://kody-w.github.io/AINexus/**',r=>{const u=new URL(r.request().url());
 const f=path.join(ROOT,decodeURIComponent(u.pathname).replace(/^\/AINexus/,''));
 if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory())return r.fulfill({status:404,body:'no'});
 r.fulfill({status:200,contentType:T[path.extname(f)]||'application/octet-stream',body:fs.readFileSync(f)});});

let fail=0;
const ok=(n,c)=>{ console.log((c?'  ✓ ':'  ✗ ')+n); if(!c) fail++; };
const errs={};

(async()=>{
const b=await chromium.launch();
// one context per MACHINE. Separate contexts have separate storage partitions, so they do not
// share a BroadcastChannel — which is the whole point of using them here.
const mk=async(tag)=>{ const c=await b.newContext({viewport:{width:800,height:500}}); await serve(c);
  const p=await c.newPage(); errs[tag]=[]; p.on('pageerror',e=>errs[tag].push(e.message)); return {c,p}; };
const A=await mk('A'), B=await mk('B'), C=await mk('C'), D=await mk('D');

await A.p.goto(HUB,{timeout:60000});
const room=await A.p.waitForFunction(()=>{const m=window.worldNavigator&&window.worldNavigator.multiplayer;
  return m&&m.roomId&&m.roomSecret?m.roomId+'.'+m.roomSecret:null;},null,{timeout:45000})
  .then(h=>h.jsonValue()).catch(()=>null);
if(!room){ console.log('  ✗ a real PeerJS room could open — the signaling server was unreachable');
  console.log('\n(this suite needs the network: it holds a REAL peer room, not a simulated one)');
  await b.close(); process.exit(1); }
console.log('room:', room.split('.')[0], '\n');

await B.p.goto(HUB+'#join='+room,{timeout:60000});
await C.p.goto(HUB+'#join='+room,{timeout:60000});
const two=await A.p.waitForFunction(()=>window.worldNavigator.multiplayer.connections.size>=2,null,{timeout:60000})
  .then(()=>true).catch(()=>false);
for(const x of [A,B,C]) await x.p.addScriptTag({url:'https://kody-w.github.io/AINexus/ai/holo.js'});
for(const x of [A,B,C]) await x.p.evaluate(()=>window.NexusHolo.attach({labels:true}));

// ── the wire is real, and it already carried something ───────────────────────
// A chat frame is the control: it uses the same connections, and it has always had a receive
// case. If chat crosses and a pose does not, the pipe is not the problem.
await A.p.evaluate(()=>window.worldNavigator.multiplayer.connections.forEach(c=>c.send({type:'chat',message:'ping'})));
await B.p.waitForTimeout(1200);
const chat=await B.p.evaluate(()=>(window.worldNavigator.multiplayer.chatLog||[]).map(x=>x.text));

// ── two tabs are not two machines ────────────────────────────────────────────
// A second TAB in A's context, and a whole separate context, hear the same BroadcastChannel
// post differently. That is the fact the page's claim rests on.
const A2=await A.c.newPage(); await A2.goto(HUB,{timeout:60000});
await A2.addScriptTag({url:'https://kody-w.github.io/AINexus/ai/holo.js'});
await A2.evaluate(()=>window.NexusHolo.attach({labels:false}));
await A.p.evaluate(()=>new BroadcastChannel('nexus:presence').postMessage(
  {kind:'pose',id:'bus-only',name:'bus only',pos:{x:5,y:1.6,z:5},yaw:0,f:0}));
await A.p.waitForTimeout(800);
const busTab=await A2.evaluate(()=>window.NexusHolo.present().map(p=>p.id));
const busCtx=await B.p.evaluate(()=>window.NexusHolo.present().map(p=>p.id));

// ── the pose itself, over the wire ───────────────────────────────────────────
await A.p.evaluate(()=>window.NexusHolo.publish({id:'A-machine',name:'A machine'}));
await B.p.waitForTimeout(2000);
const atB=await B.p.evaluate(()=>({ present:window.NexusHolo.present(),
  // painted for real: a mesh under the scene's 'holos' group, standing where the pose said
  meshes:(()=>{const g=window.worldNavigator.scene.getObjectByName('holos');
    return g?g.children.map(c=>({x:+c.position.x.toFixed(2),z:+c.position.z.toFixed(2)})):[];})() }));

// ── a joiner can see a joiner ────────────────────────────────────────────────
// B and C are wired only to the host. Without a relay they are invisible to each other, and a
// three-person room is two private conversations.
await C.p.evaluate(()=>window.NexusHolo.publish({id:'C-machine',name:'C machine'}));
await B.p.waitForTimeout(2500);
const relay=await B.p.evaluate(()=>window.NexusHolo.present().map(p=>p.id));

// ── junk from a peer is dropped, not thrown ──────────────────────────────────
// Everything here arrived from another machine. A throw inside the painter's frame loop would
// stop the whole room being painted, not just the liar.
await A.p.evaluate(()=>{const cs=[...window.worldNavigator.multiplayer.connections.values()];
  const junk=[null,5,'x',{},{kind:'pose'},{kind:'pose',id:''},{kind:'not-a-pose',id:'nope'},
    {kind:'pose',id:'junk-pos',pos:'nope'},{kind:'pose',id:'junk-num',pos:{x:'boom',y:null,z:[]},yaw:'sideways'},
    {kind:'pose',id:{a:1}}];
  junk.forEach(j=>cs.forEach(c=>{try{c.send({type:'holo',pose:j});}catch(e){}}));});
await B.p.waitForTimeout(1200);
const afterJunk=await B.p.evaluate(()=>window.NexusHolo.present().map(p=>({id:p.id,
  finite:Object.values(p.pos).every(v=>typeof v==='number'&&isFinite(v))})));

// ── a name from a stranger is not markup ─────────────────────────────────────
// house.html:102 drops a presence's name into innerHTML twice, once as text and once inside a
// quoted attribute. That sink is not this file's to fix; what IS this file's job is never to
// hand it anything that could survive the trip.
await A.p.evaluate(()=>window.NexusHolo.publish({id:'A-evil',name:'<img src=x onerror="window.top.__pwned=1">'}));
await B.p.waitForTimeout(1800);
const evil=await B.p.evaluate(()=>{
  const p=window.NexusHolo.present().find(x=>x.id==='A-evil');
  if(!p) return {found:false};
  // the exact shape of house.html's rail, built here so the real page is not touched
  const el=document.createElement('div'); el.style.display='none';
  el.innerHTML='<span class="lbl">POV · '+String(p.name).toUpperCase().slice(0,14)+'</span>'+
               '<img alt="POV · '+String(p.name).toUpperCase().slice(0,14)+'">';
  document.body.appendChild(el);
  return { found:true, name:p.name, imgs:el.querySelectorAll('img').length,
           handlers:el.innerHTML.toLowerCase().includes('onerror'), pwned:!!window.__pwned };
});
await B.p.waitForTimeout(400);
const pwned=await B.p.evaluate(()=>!!window.__pwned);

// ── an unproven channel is not a presence ────────────────────────────────────
// The new ear listens on accepted connections only. A peer that dials the host and starts
// projecting itself without ever presenting the invite must not appear in the room.
await D.p.goto(HUB,{timeout:60000});
await D.p.waitForFunction(()=>window.worldNavigator&&window.worldNavigator.multiplayer&&window.worldNavigator.multiplayer.peer&&window.worldNavigator.multiplayer.peer.id,null,{timeout:45000}).catch(()=>{});
await D.p.evaluate((rid)=>{window.__gate={opened:false,sent:0};
  const p2=new Peer();                                  // a stranger's own peer, not the room's
  p2.on('open',()=>{ const c=p2.connect(rid,{reliable:true,serialization:'json'});
    c.on('open',()=>{ window.__gate.opened=true; let n=0; const iv=setInterval(()=>{
      try{c.send({type:'holo',pose:{kind:'pose',id:'gatecrasher',name:'gatecrasher',
        pos:{x:2,y:1.6,z:2},yaw:0,f:n++}}); window.__gate.sent++;}catch(e){}
      if(n>40) clearInterval(iv); },120); }); });
  }, room.split('.')[0]);
// sample while its frames are still flowing: the host shuts an unproven door after 8s, and a
// closed channel would prove nothing about what the ear does with an open one
await A.p.waitForTimeout(5000);
const gate=await D.p.evaluate(()=>window.__gate);      // the refusal must not be a dead channel
const atHost=await A.p.evaluate(()=>window.NexusHolo.present().map(p=>p.id));

console.log('checks:');
ok('two separate browser contexts hold one real peer room', two && chat.includes('ping'));
ok('a BroadcastChannel pose reaches another TAB of the same browser', busTab.includes('bus-only'));
ok('the same pose does NOT reach another browser context — tabs are not machines', !busCtx.includes('bus-only'));
ok('a published pose DOES reach the other context, so it crossed the wire', atB.present.some(p=>p.id==='A-machine'));
ok('and it is painted there: a holo mesh stands in the scene', atB.present.some(p=>p.id==='A-machine'&&p.painted) && atB.meshes.length>0);
ok('a joiner sees another joiner, relayed by the host', relay.includes('C-machine'));
ok('malformed poses from a peer are ignored, and nothing throws', errs.B.length===0 && !afterJunk.some(p=>p.id==='')&&!afterJunk.some(p=>!p.finite));
ok('a name made of markup arrives inert and cannot become a tag', evil.found && !/[<>&"']/.test(evil.name) && evil.imgs===1 && !evil.handlers && !pwned);
ok('a peer that never presented the invite is never painted — on an OPEN channel it really sent down',
   gate.opened && gate.sent > 0 && !atHost.includes('gatecrasher'));

console.log('\nseen at B:', JSON.stringify(relay), '\nseen at the host:', JSON.stringify(atHost),
            '\ngatecrasher:', JSON.stringify(gate));
console.log('page errors:', JSON.stringify(errs));
await b.close();
process.exit(fail?1:0);
})().catch(e=>{ console.error('harness error:', e && e.message); process.exit(1); });

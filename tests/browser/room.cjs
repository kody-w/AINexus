// The room, under a member who lies and a member who goes quiet.
//
// holo_wire.cjs proved a pose crosses a real wire. This one is about what the peer layer
// (net/multiplayer.js) does with what comes back down that wire once somebody is INSIDE the
// room — the part the invite handshake has nothing more to say about. Every payload below
// arrived from another machine, and the room has to survive all of them:
//
//   · a position made of strings — one of them poisons a THREE matrix permanently, because
//     lerp() folds NaN back in on every later frame and the body never returns
//   · a peer that simply stops talking for five seconds, which a backgrounded tab does by itself
//   · a second channel from a member the host already has, which is what a signalling reconnect
//     produces — and which used to close carrying the LIVE member's peer id
//   · a chat the host is asked to fan out to everybody, at any length and any rate
//   · an invite the host refuses, and what the refused joiner is then told happened
//
// Four independent browser contexts, one real PeerJS room. Two tabs of one browser would share
// too much to prove anything here (see holo_wire.cjs for why that distinction is load-bearing).
//
// ONE MEASUREMENT NOTE, LEARNED THE HARD WAY: a ~20,000 character message does not merely fail
// to arrive, it takes the SENDER'S data channel down with it (Chrome refuses the SCTP message
// and the channel goes with it), which then makes every later check in the file fail for a
// reason that has nothing to do with the code under test. The oversize probe below is 4,000 —
// eight times the relay's cap, and measured to cross intact on this wire.
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
const swallowed={};   // console.error('Error handling peer data') — a caught throw is not a decision

// Every status line the page ever showed, in order. A status that was true for half a second
// and was then replaced is still something a person read.
const WATCH=()=>{ window.__status=[]; setInterval(()=>{ const t=document.getElementById('status-text');
  const v=t&&t.textContent; if(v&&window.__status[window.__status.length-1]!==v) window.__status.push(v); },60); };

(async()=>{
const b=await chromium.launch();
const mk=async(tag)=>{ const c=await b.newContext({viewport:{width:800,height:500}}); await serve(c);
  const p=await c.newPage(); errs[tag]=[]; swallowed[tag]=[];
  p.on('pageerror',e=>errs[tag].push(e.message));
  p.on('console',m=>{ if(m.type()==='error'&&/Error handling peer data/.test(m.text())) swallowed[tag].push(m.text()); });
  await p.addInitScript(WATCH); return {c,p}; };
const A=await mk('A'), B=await mk('B'), C=await mk('C'), D=await mk('D');

await A.p.goto(HUB,{timeout:60000});
const room=await A.p.waitForFunction(()=>{const m=window.worldNavigator&&window.worldNavigator.multiplayer;
  return m&&m.roomId&&m.roomSecret?m.roomId+'.'+m.roomSecret:null;},null,{timeout:45000})
  .then(h=>h.jsonValue()).catch(()=>null);
if(!room){ console.log('  ✗ a real PeerJS room could open — the signaling server was unreachable');
  console.log('\n(this suite needs the network: it holds a REAL peer room, not a simulated one)');
  await b.close(); process.exit(1); }
const roomId=room.split('.')[0];
console.log('room:', roomId, '\n');

await B.p.goto(HUB+'#join='+room,{timeout:60000});
await C.p.goto(HUB+'#join='+room,{timeout:60000});
const two=await A.p.waitForFunction(()=>window.worldNavigator.multiplayer.connections.size>=2,null,{timeout:60000})
  .then(()=>true).catch(()=>false);
const bid=await B.p.evaluate(()=>window.worldNavigator.multiplayer.peer.id);
const cid=await C.p.evaluate(()=>window.worldNavigator.multiplayer.peer.id);

// what the host can see of one member, from the outside
const look=(id)=>A.p.evaluate((pid)=>{ const mp=window.worldNavigator.multiplayer, pl=mp.players.get(pid);
  if(!pl) return {present:false, counted:mp.connections.has(pid), shown:mp.connections.size+1};
  const p=pl.avatar.position, r=pl.avatar.rotation.y;
  return { present:true, counted:mp.connections.has(pid), name:pl.username,
           pos:{x:p.x,y:p.y,z:p.z}, rot:r, age:Date.now()-pl.lastUpdate,
           finite:[p.x,p.y,p.z,r].every(v=>typeof v==='number'&&isFinite(v)),
           sprites:pl.avatar.children.filter(c=>c.type==='Sprite').length,
           shown:mp.connections.size+1 }; }, id);

// B stops its own frame-loop broadcasts for the middle of this file, so the only thing moving
// that avatar or claiming that name is what the test sends. Otherwise a real camera and a real
// username fight every assertion.
const hush=(on)=>B.p.evaluate((v)=>{window.worldNavigator.multiplayer.updateInterval=v;}, on?1e9:50);
const drive=async(msgs,gap)=>{ await B.p.evaluate(async({msgs,gap})=>{
  const mp=window.worldNavigator.multiplayer;
  for(const m of msgs){ mp.connections.forEach(c=>{try{c.send(m);}catch(e){}});
    await new Promise(r=>setTimeout(r,gap)); } },{msgs,gap}); };
const say=(m)=>B.p.evaluate((m)=>window.worldNavigator.multiplayer.connections
  .forEach(c=>{try{c.send(m);}catch(e){}}), m);
const good=(n)=>Array.from({length:n},()=>({type:'playerUpdate',position:{x:11,y:2,z:-7},rotation:{y:0.5}}));

// ── a position is five numbers from a stranger ───────────────────────────────
await hush(true);
await drive(good(22),25);
const settled=await look(bid);
await drive([
  {type:'playerUpdate',position:{x:'boom',y:'boom',z:'boom'},rotation:{y:'sideways'}},
  {type:'playerUpdate',position:{x:[],y:{},z:true},rotation:{y:[]}},
  {type:'playerUpdate',position:null,rotation:null},
  {type:'playerUpdate'},
  {type:'playerUpdate',position:{x:1,y:2},rotation:{}},
],40);
await drive(good(22),25);
const afterJunk=await look(bid);

// ── junk that is not even a message ──────────────────────────────────────────
await B.p.evaluate(()=>{const mp=window.worldNavigator.multiplayer;
  [null,5,'x',[],{},true,{type:'nonsense'},{type:'chat'},{type:'worldSync'},{type:'ai_companion'},
   {type:'playerUpdate',username:{}},{type:'chat',message:'private',to:{evil:1}}]
    .forEach(j=>mp.connections.forEach(c=>{try{c.send(j);}catch(e){}}));});
await A.p.waitForTimeout(700);

// ── 'interaction' has been dispatched to a method that never existed ─────────
await say({type:'interaction',target:'the crystal door'});
await A.p.waitForTimeout(500);
const interacted=await A.p.evaluate(()=>(window.worldNavigator.multiplayer.interactions||[]).map(i=>i.target));

// ── a rename replaces the label, it does not hang a second one beside it ─────
await A.p.waitForTimeout(1200);            // a rename is allowed once a second, and the junk used one
await say({type:'playerUpdate',username:'Renamed One',position:{x:11,y:2,z:-7},rotation:{y:0.5}});
await A.p.waitForTimeout(600);
const renamed=await look(bid);

// ── a name made of markup, on the way to a notification ──────────────────────
// This file has no innerHTML sink of its own — every place a peer's words land is textContent
// or canvas fillText. That is a claim worth a check, because it is one edit away from being
// false and this estate has already had exactly this XSS once, in an overlay label.
await A.p.waitForTimeout(1100);
await say({type:'playerUpdate',username:'<img src=x onerror="window.__p=1">',position:{x:11,y:2,z:-7},rotation:{y:0.5}});
await A.p.waitForTimeout(300);
await say({type:'chat',message:'hello room'});
await A.p.waitForTimeout(700);
const markup=await A.p.evaluate(()=>{ const n=[...document.querySelectorAll('.multiplayer-notification')];
  const hit=n.find(e=>/img src=x/.test(e.textContent||''));
  return { found:!!hit, imgs:hit?hit.querySelectorAll('img').length:-1,
           text:hit?hit.textContent.slice(0,60):'', pwned:!!window.__p };});

// ── the host is the amplifier: one message in, one per member out ────────────
await C.p.evaluate(()=>{ const mp=window.worldNavigator.multiplayer; window.__chat={n:0,max:0,last:''};
  const orig=mp.handlePeerData.bind(mp);
  mp.handlePeerData=function(pid,d,cn){ if(d&&typeof d==='object'&&d.type==='chat'){
    const m=String(d.message==null?'':d.message);
    window.__chat.n++; window.__chat.max=Math.max(window.__chat.max,m.length); window.__chat.last=m; }
    return orig(pid,d,cn); };});
await say({type:'chat',message:'y'.repeat(4000)});
await B.p.waitForTimeout(800);
await say({type:'chat',message:'a short line that must survive'});
await C.p.waitForTimeout(900);
const relayed=await C.p.evaluate(()=>window.__chat);

await C.p.evaluate(()=>{window.__chat.n=0;});
await B.p.evaluate(()=>{const mp=window.worldNavigator.multiplayer;
  for(let i=0;i<60;i++) mp.connections.forEach(c=>{try{c.send({type:'chat',message:'flood '+i});}catch(e){}});});
await C.p.waitForTimeout(1500);
const flood=await C.p.evaluate(()=>window.__chat.n);

// ── a second channel from a member the host already has ──────────────────────
// This is what a signalling reconnect produced. The host cannot admit it (the peer is already a
// member, so its hello is ignored), and when it closes it closes carrying C's peer id.
const beforeDup=await look(cid);
await C.p.evaluate((rid)=>new Promise(res=>{ const mp=window.worldNavigator.multiplayer;
  const dup=mp.peer.connect(rid,{reliable:true,serialization:'json'});
  dup.on('open',()=>{ setTimeout(()=>{ try{dup.close();}catch(e){} res(true); },300); });
  setTimeout(()=>res(false),8000); }), roomId);
await A.p.waitForTimeout(1200);
const afterDup=await look(cid);
await C.p.evaluate(()=>window.worldNavigator.multiplayer.connections
  .forEach(c=>{try{c.send({type:'chat',message:'still here'});}catch(e){}}));
await A.p.waitForTimeout(600);
const stillHeard=await A.p.evaluate(()=>(window.worldNavigator.multiplayer.chatLog||[]).some(x=>x.text==='still here'));

// ── an unproven channel that gets displaced is not simply forgotten ──────────
// `pending` is keyed by peer id, so a stranger's second channel evicted its own first one out of
// the map — and the evicted one then belonged to nobody: its timer found somebody else's
// connection under its key, declined to act, and left it open for the life of the room.
// The snapshot is taken BEFORE this stranger tears its own peer down: destroy() closes its
// connections synchronously and would have answered the question with the test's own hand. It is
// also taken at six seconds, inside the doorway's eight — so what is being measured is the host
// letting go of a channel it displaced, not the timer eventually shutting the door on the survivor.
const displaced=await C.p.evaluate((rid)=>new Promise(res=>{ const out={one:false,oneClosed:false,two:false};
  const p2=new Peer();
  p2.on('open',()=>{ const c1=p2.connect(rid,{reliable:true,serialization:'json'});
    c1.on('open',()=>{ out.one=true; c1.on('close',()=>{out.oneClosed=true;});
      const c2=p2.connect(rid,{reliable:true,serialization:'json'});
      c2.on('open',()=>{out.two=true;}); }); });
  setTimeout(()=>{ res(Object.assign({},out)); setTimeout(()=>{try{p2.destroy();}catch(e){}},100); },6000); }), roomId);

// ── five seconds of silence is not absence ───────────────────────────────────
// Nothing in this class builds an avatar after the handshake, so reaping a peer whose channel is
// still open was a one-way door: every message it sent afterwards returned early, forever.
await hush(false);
await A.p.waitForTimeout(1200);
await hush(true);
await A.p.waitForTimeout(6800);
const afterSilence=await look(bid);
await hush(false);
await A.p.waitForTimeout(1500);
const afterSpeaking=await look(bid);

// ── the socket coming back is not a reason to dial again ─────────────────────
// peerjs 1.5.2: reconnect() re-initialises the socket and the server's OPEN runs
// `this.emit("open", this.id)` a second time — the same handler that schedules the dial. That
// re-emission is exactly what is done here; on the old code it opened a duplicate channel, which
// is the input to the check three above.
const statusB=await B.p.evaluate(()=>window.__status.slice());
const dials=await B.p.evaluate(async()=>{ const mp=window.worldNavigator.multiplayer; let n=0;
  const oc=mp.peer.connect.bind(mp.peer); mp.peer.connect=function(...a){n++;return oc(...a);};
  const held=mp.connections.has(mp.roomId);
  mp.peer.emit('open',mp.peer.id);
  await new Promise(r=>setTimeout(r,2200)); return {n,held}; });

// ── a refused invite is not a host who closed their tab ──────────────────────
await D.p.goto(HUB+'#join='+roomId+'.notthetokenatall',{timeout:60000});
await D.p.waitForTimeout(9000);
const statusD=await D.p.evaluate(()=>window.__status.slice());
const doorway=await A.p.evaluate(()=>window.worldNavigator.multiplayer.pending.size);

console.log('settled at        :', JSON.stringify(settled));
console.log('after junk        :', JSON.stringify(afterJunk));
console.log('after rename      :', JSON.stringify(renamed));
console.log('markup name       :', JSON.stringify(markup));
console.log('B status          :', JSON.stringify(statusB));
console.log('D status          :', JSON.stringify(statusD));
console.log('relayed chat      :', JSON.stringify(relayed), '· flood delivered', flood, 'of 60');
console.log('duplicate channel :', JSON.stringify(afterDup), '· heard after:', stillHeard);
console.log('displaced channel :', JSON.stringify(displaced));
console.log('after 6.8s silence:', JSON.stringify(afterSilence));
console.log('after speaking    :', JSON.stringify(afterSpeaking));
console.log('re-dial           :', JSON.stringify(dials));

console.log('\nchecks:');
ok('two separate browser contexts hold one real peer room, and the host sees a body where it was told',
   two && settled.present && Math.abs(settled.pos.x-11)<0.5 && Math.abs(settled.pos.z+7)<0.5);
ok('a position made of strings, arrays and nulls never reaches the matrix — the body stays finite AND stays put',
   afterJunk.present && afterJunk.finite && Math.abs(afterJunk.pos.x-11)<0.5 &&
   Math.abs(afterJunk.pos.y-2)<0.5 && Math.abs(afterJunk.pos.z+7)<0.5 && Math.abs(afterJunk.rot-0.5)<0.01);
ok('null, a number, a bare string and a typeless object are decided about, not thrown over',
   swallowed.A.length===0);
ok("an 'interaction' from a peer finally runs instead of throwing into a catch",
   interacted.includes('the crystal door'));
ok('a rename replaces the one label above their head', renamed.present && renamed.sprites===1 && renamed.name==='Renamed One');
ok('a name made of markup arrives inert: it is text in the notification, never a tag',
   markup.found && markup.imgs===0 && !markup.pwned && /img src=x/.test(markup.text));
ok('the relay carries a bounded line — 4,000 characters in, at most 500 out',
   relayed.max>0 && relayed.max<=500);
ok('and a real line still crosses it whole', relayed.last==='a short line that must survive');
ok('sixty chats in one burst do not become sixty relayed messages', flood>0 && flood<=20);
ok('a duplicate channel from a member closes without taking that member with it',
   beforeDup.present && afterDup.present && afterDup.counted && stillHeard);
ok('an unproven channel displaced out of the doorway is closed, not abandoned',
   displaced.one && displaced.two && displaced.oneClosed);
ok('a member who goes quiet on an open channel keeps their body and their place in the count',
   afterSilence.present && afterSilence.counted && afterSilence.age>5000 && afterSilence.shown===3);
ok('and the host is listening again the moment they speak', afterSpeaking.present && afterSpeaking.age<1500);
ok('the signalling socket re-opening does not dial the host a second time', dials.held && dials.n===0);
ok('a joiner is told "Connected" only once the host has actually said something',
   statusB.includes('Proving invite...') && statusB.includes('Connected') &&
   statusB.indexOf('Proving invite...') < statusB.indexOf('Connected'));
ok('a refused invite says it was refused — never that the host closed their tab',
   statusD.includes('Invite refused') && !statusD.some(s=>/Host left/.test(s)) && !statusD.includes('Connected'));
ok('and the refused channel is not still sitting in the doorway', doorway===0);
// A literal `null` never reaches this file at all: peerjs 1.5.2's own JSON connection does
// `const p = parse(...).__peerData` before it emits 'data', so a peer that sends null throws an
// uncaught TypeError inside the RECEIVER's peerjs. Nothing in net/multiplayer.js can prevent
// that, and the room survives it — but it is the one uncaught error this room is allowed, and
// pinning it here means a NEW one cannot arrive unnoticed.
ok('the only uncaught error in the room is peerjs parsing a peer\'s literal null, and the room outlives it',
   errs.A.every(e=>/__peerData/.test(e)) && errs.B.length===0 && errs.C.length===0 && errs.D.length===0
   && afterSpeaking.present);

console.log('\npage errors:', JSON.stringify(errs));
console.log('swallowed throws:', JSON.stringify(swallowed.A.slice(0,3)));
await b.close();
process.exit(fail?1:0);
})().catch(e=>{ console.error('harness error:', e && e.message); process.exit(1); });

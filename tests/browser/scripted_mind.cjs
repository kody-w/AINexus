// A mind is a contract, not a service. This drives the WHOLE machinery with a scripted one —
// an NPC — and requires that everything downstream of the answer is the real thing: the verbs the
// hands actually have, the refusal when they do not have one, the rapp/1 frames, the receipts, and
// the budget. The only substituted part is what the mind says.
//
// It is also the answer to a gap this estate carried for a long time: no model call had ever run
// here, so every path past the mind was unexercised. provenSource() threw on every call for weeks
// because nothing ever asked for a tool that did not exist. A scripted mind can ask on purpose.
//
// What this does NOT prove: that a model can drive the world. Nothing here buys a thought.
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
// NOTHING may reach a model endpoint. If anything does, this test is lying about what it proved.
let bought = 0;
await ctx.route('https://**/chat/completions*', r => { bought++; r.abort(); });
await ctx.route('https://rapp-auth.kwildfeuer.workers.dev/**', r => { bought++; r.abort(); });
const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('https://kody-w.github.io/AINexus/frontier.html',{timeout:60000});
await p.waitForFunction(()=>window.NexusHerd&&window.NexusFrames&&window.NexusMind,null,{timeout:45000});

const out = await p.evaluate(async () => {
  const H = window.NexusHerd, F = window.NexusFrames, M = window.NexusMind;
  const acted = [];
  const drive = {
    snapshot: () => ({ me:{x:0,y:1.6,z:0}, world:'Frontier', room:'r',
                       portals:[{name:'Ebike World'},{name:'Brainstormer'}], players:[], chat:[] }),
    people: () => [], orbs: () => [], dialogue: () => [],
    look: async (dx) => { acted.push('look:'+dx); return true; },
    walk: async (dir,ms) => { acted.push('walk:'+dir+':'+ms); return true; },
    travel: async (name) => { acted.push('travel:'+name); return true; },
    say: async (t) => { acted.push('say:'+t); return true; },
    tell: async () => true, aim: async () => true,
  };

  // THE SCRIPT. A character with lines and moves — and one deliberate mistake, a verb the hands
  // do not have, so the refusal path is exercised rather than assumed.
  const npc = M.scripted([
    { say: 'evening.',        do: [{ verb: 'look', args: { dx: 0.2 } }],                 then: 'settled.' },
    { say: 'this way, then.', do: [{ verb: 'travel', args: { portal: 'Ebike World' } }], then: 'arrived.' },
    { say: 'watch this.',     do: [{ verb: 'levitate', args: {} }],                      then: 'ah. no.' },
  ], { name: 'the doorman' });

  await H.join({ id: 'doorman', persona: 'You keep the door.', drive, mind: npc, python: false });

  const turns = [];
  for (let i = 0; i < 3; i++) {
    const r = await H.serve('doorman', { python: false }).catch(e => ({ error: e.message }));
    turns.push({ said: r && r.words, calls: (r && r.calls || []).map(c => c.tool + (c.failed ? ' ✗' : '')),
                 frame: !!(r && r.frame), error: r && r.error || null });
  }

  // the same script, run again from a fresh player, must produce the same words and the same moves
  const acted2 = [];
  const drive2 = Object.assign({}, drive, {
    look: async (dx)=>{acted2.push('look:'+dx);return true;}, walk: async(d,m)=>{acted2.push('walk:'+d+':'+m);return true;},
    travel: async(name)=>{acted2.push('travel:'+name);return true;}, say: async(t)=>{acted2.push('say:'+t);return true;} });
  const npc2 = M.scripted([
    { say: 'evening.',        do: [{ verb: 'look', args: { dx: 0.2 } }],                 then: 'settled.' },
    { say: 'this way, then.', do: [{ verb: 'travel', args: { portal: 'Ebike World' } }], then: 'arrived.' },
    { say: 'watch this.',     do: [{ verb: 'levitate', args: {} }],                      then: 'ah. no.' },
  ], { name: 'the doorman' });
  await H.join({ id: 'doorman2', persona: 'You keep the door.', drive: drive2, mind: npc2, python: false });
  const turns2 = [];
  for (let i = 0; i < 3; i++) {
    const r = await H.serve('doorman2', { python: false }).catch(e => ({ error: e.message }));
    turns2.push({ said: r && r.words, calls: (r && r.calls || []).map(c => c.tool + (c.failed ? ' ✗' : '')) });
  }

  // the frames the run actually sealed
  const line = String(H.chainOf('doorman') || '').trim().split('\n').filter(Boolean).map(JSON.parse);
  let verified = null;
  try { verified = await F.verifyChain(line.map(f => JSON.stringify(f)).join('\n')); }
  catch (e) { verified = { error: e.message }; }

  // WHAT A MIND ASKS FOR IS A REQUEST, NOT A FACT. A look used to go through `a.dx | 0`, so a
  // small turn became no turn at all and a large one wrapped its sign. Ask for both on purpose.
  const swung = [];
  const drive3 = Object.assign({}, drive, { look: async (dx, dy) => { swung.push(dx); return true; } });
  const npc3 = M.scripted([
    { say: 'a nudge.',   do: [{ verb: 'look', args: { dx: 0.6 } }] },
    { say: 'a glance.',  do: [{ verb: 'look', args: { dx: 12 } }] },
    { say: 'hard right.',do: [{ verb: 'look', args: { dx: 2147483648 } }] },
    { say: 'nonsense.',  do: [{ verb: 'look', args: { dx: 'over there' } }] },
  ]);
  await H.join({ id: 'swinger', drive: drive3, mind: npc3, python: false });
  for (let i = 0; i < 4; i++) await H.serve('swinger', { python: false }).catch(()=>{});

  return { turns, turns2, acted, acted2, swung, cost: H.cost(),
           frames: line.map(f => ({ kind: f.kind, seq: f.seq, tick: f.payload.asserts.tick,
                                    said: f.payload.asserts.said,
                                    called: f.payload.asserts.called })),
           verified, scripted: npc.isScripted, describes: npc.describe() };
});

console.log('what the NPC did, tick by tick:\n');
out.turns.forEach((t,i)=>console.log(`  ${i+1}. said ${JSON.stringify(t.said)}  called ${JSON.stringify(t.calls)}  frame:${t.frame}`));
console.log('\nthe hands actually moved   :', JSON.stringify(out.acted));
console.log('frames sealed              :', JSON.stringify(out.frames));
console.log('chain verifies             :', JSON.stringify(out.verified).slice(0,110));
console.log('cost                       :', JSON.stringify(out.cost));

console.log('\nchecks:');
ok('a scripted mind satisfies the contract and says so', out.scripted === true && /scripted mind/.test(out.describes));
ok('nothing bought a thought — no model endpoint was reached', bought === 0);
ok('the NPC spoke its written lines, in order',
   out.turns[0].said === 'settled.' && out.turns[1].said === 'arrived.' && out.turns[2].said === 'ah. no.');
ok('and its moves reached the real hands', out.acted.join('|') === 'look:0|travel:Ebike World');
ok('a verb the hands do not have is REFUSED, not silently performed',
   out.turns[2].calls.some(c => /levitate/.test(c) && / ✗$/.test(c)) && !/levitate/.test(out.acted.join('|')));
ok('every tick sealed exactly one frame', out.turns.every(t => t.frame) && out.frames.length === 3);
ok('the frames are body.pulse on one line, numbered 0,1,2',
   out.frames.every(f => f.kind === 'body.pulse') && out.frames.map(f=>f.seq).join(',') === '0,1,2');
ok('the frames record what was said and what was called',
   out.frames[0].said === 'settled.' && String(out.frames[2].called).includes('levitate'));
ok('the whole line verifies as a rapp/1 chain from genesis', out.verified && out.verified.frames === 3);
ok('the run cost no model calls, and says so in the ledger', out.cost.calls === 0);
ok('the same script runs the same way twice — an NPC is deterministic',
   JSON.stringify(out.turns.map(t=>[t.said,t.calls])) === JSON.stringify(out.turns2.map(t=>[t.said,t.calls]))
   && out.acted.join('|') === out.acted2.join('|'));
console.log('\nwhat the hands were asked to swing:', JSON.stringify(out.swung));
ok('a small turn is a turn, not nothing — 0.6 no longer truncates to 0', out.swung[0] === 1);
ok('an ordinary turn passes through unchanged', out.swung[1] === 12);
ok('a turn past int32 is clamped, never wrapped into the opposite direction',
   out.swung[2] > 0 && out.swung[2] <= 20000);
ok('a turn that is not a number becomes no turn, rather than NaN reaching the hands',
   out.swung[3] === 0);
ok('no page errors', errs.length === 0);
console.log('\n' + pass + ' passed, ' + fail + ' failed');
await b.close(); process.exit(fail?1:0);})();

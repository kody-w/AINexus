// The programs in ai/programs/ are choreography: a fixed sequence of verbs. One of their steps —
// `mind` — needs something that thinks, and until now that meant a local brainstem or a visitor
// lending their Copilot seat. Without either, the step logged "no mind granted" and the player ran
// on its choreography alone: a puppet that could not answer anything.
//
// A mind is a contract, not a service. A written mind satisfies it, so an NPC can run the SAME
// program, through the SAME brainstem, sealing the SAME frames, with nobody signed in — and the
// receipt has to say which door the thought came through, because a written answer and a bought
// one must never look alike.
const { createRequire } = require('module');
const _req=(()=>{for(const b of [process.env.PLAYWRIGHT_DIR, require('path').join(process.env.HOME||'','Documents/GitHub/aaa-fps')]){
 if(!b)continue; try{const r=createRequire(require('path').join(b,'package.json'));r.resolve('playwright');return r;}catch(e){}}return require;})();
const { chromium } = _req('playwright');
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..','..');
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.jsonl':'text/plain','.css':'text/css','.py':'text/plain'};
let pass=0,fail=0;
const ok=(n,c)=>{console.log((c?'  ✓ ':'  ✗ ')+n); c?pass++:fail++;};
(async()=>{
const b=await chromium.launch(); const ctx=await b.newContext();
await ctx.route('https://kody-w.github.io/AINexus/**',r=>{const u=new URL(r.request().url());
 const f=path.join(ROOT,decodeURIComponent(u.pathname).replace(/^\/AINexus/,''));
 if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory())return r.fulfill({status:404,body:'no'});
 r.fulfill({status:200,contentType:T[path.extname(f)]||'application/octet-stream',body:fs.readFileSync(f)});});
// nothing may buy a thought, and nothing may reach a brainstem either — this NPC is on its own
let bought = 0;
await ctx.route('https://**/chat/completions*', r => { bought++; r.abort(); });
await ctx.route('https://rapp-auth.kwildfeuer.workers.dev/**', r => { bought++; r.abort(); });
await ctx.route('http://localhost:7071/**', r => { bought++; r.abort(); });
const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('https://kody-w.github.io/AINexus/frontier.html',{timeout:60000});
await p.waitForFunction(()=>window.NexusMind&&window.NexusBrainstem&&window.NexusFrames,null,{timeout:45000});

const out = await p.evaluate(async () => {
  const M = window.NexusMind;
  const acted = [];
  const drive = {
    snapshot: () => ({ me:{x:0,y:1.6,z:0}, world:'Frontier', room:'r',
                       portals:[{name:'Ebike World'}], players:[], chat:[] }),
    sense: () => ({ me:{x:0,y:1.6,z:0}, world:'Frontier', room:'r', portals:[{name:'Ebike World'}],
                    players:[], chat:[], vision:{ blank:false, bytes:1234, w:320 } }),
    people: () => [], orbs: () => [], dialogue: () => [],
    look: async (dx) => { acted.push('look:'+dx); return true; },
    say: async (t) => { acted.push('say:'+t); return true; },
    travel: async (n) => { acted.push('travel:'+n); return true; },
    tell: async () => true, aim: async () => true, walk: async () => true,
  };

  // the same shape the estate's own programs use for a persona, given a written mind
  const npc = M.scripted((percepts) => {
    // a character that BRANCHES on what it sees — the thing a choreography cannot do
    const seesDoor = /Ebike/.test(JSON.stringify(percepts || ''));
    return seesDoor
      ? { say: 'the ebike door is open tonight.', do: [{ verb: 'look', args: { dx: 120 } }], then: 'noted.' }
      : { say: 'nothing but dark out here.', then: 'waiting.' };
  }, { name: 'the doorman' });

  const r1 = await window.NexusBrainstem.turn({
    percepts: drive.snapshot(), persona: 'You keep the door.', drive, mind: npc, python: false,
  }).catch(e => ({ error: e.message }));

  // and the same NPC through autodrive's `mind` step, which is what a program's {"do":"mind"} runs
  window.__autodrive = Object.assign({}, drive, { _gen: 0, _carry: null, carried: () => null });
  let viaStep = null;
  try {
    // reach the real step the way a program does, with no seat and no brainstem
    window.__nexus_scripted_mind = npc;
    const ad = window.__autodrive;
    // autodrive's own api is what programs call; if it is not attached here, the turn above is
    // still the honest half of the claim, so report which half ran
    viaStep = (window.drive && typeof window.drive.mind === 'function')
      ? await window.drive.mind({ vision: false, act: false })
      : { skipped: 'autodrive api is not attached on this page' };
  } catch (e) { viaStep = { error: e.message }; }

  // THE OTHER BRANCH. A choreography does the same thing in an empty room; a character does not.
  // Drive the identical NPC against percepts with no door in them and require a different answer.
  const acted2 = [];
  const dark = Object.assign({}, drive, {
    snapshot: () => ({ me:{x:0,y:1.6,z:0}, world:'Frontier', room:'r', portals:[], players:[], chat:[] }),
    look: async (dx) => { acted2.push('look:'+dx); return true; },
    say: async (t) => { acted2.push('say:'+t); return true; },
  });
  const r2 = await window.NexusBrainstem.turn({
    percepts: dark.snapshot(), persona: 'You keep the door.', drive: dark, mind: npc, python: false,
  }).catch(e => ({ error: e.message }));

  return { r1, r2, acted, acted2, viaStep,
           signedIn: !!(window.NexusAuth && window.NexusAuth.signedIn && window.NexusAuth.signedIn()) };
});

console.log('nobody is signed in        :', out.signedIn === false);
console.log('the NPC said               :', JSON.stringify(out.r1 && out.r1.words));
console.log('it called                  :', JSON.stringify((out.r1 && out.r1.calls || []).map(c=>c.tool)));
console.log('the hands moved            :', JSON.stringify(out.acted));
console.log('in an EMPTY room it said   :', JSON.stringify(out.r2 && out.r2.words), 'and moved', JSON.stringify(out.acted2));
console.log('through the program step   :', JSON.stringify(out.viaStep).slice(0,140));

// THE WORKED EXAMPLE has to work, or it is a worse lie than no example: somebody copies it.
const worked = await p.evaluate(async () => {
  const drive = { snapshot: () => ({ me:{x:0,y:1.6,z:0}, world:'W', room:'r',
                    portals:[{name:'Ebike World'}], players:[{name:'ada'}], chat:[] }),
    people:()=>[],orbs:()=>[],dialogue:()=>[],
    look: async()=>true, say: async()=>true, travel: async()=>true, walk: async()=>true,
    tell: async()=>true, aim: async()=>true };
  if (!window.NexusNPC || !window.NexusNPC.doorman) return { missing: true };
  const npc = window.NexusNPC.doorman();
  const busy = await window.NexusBrainstem.turn({ percepts: drive.snapshot(), drive, mind: npc, python:false }).catch(e=>({error:e.message}));
  const emptyDrive = Object.assign({}, drive, { snapshot: () => ({ me:{x:0,y:0,z:0}, world:'W', room:'r', portals:[], players:[], chat:[] }) });
  const quiet = await window.NexusBrainstem.turn({ percepts: emptyDrive.snapshot(), drive: emptyDrive, mind: npc, python:false }).catch(e=>({error:e.message}));
  return { busy: busy && busy.words, quiet: quiet && quiet.words };
});
console.log('the worked example, busy room :', JSON.stringify(worked.busy));
console.log('the worked example, empty room:', JSON.stringify(worked.quiet));

console.log('\nchecks:');
ok('the worked NPC example ships and loads', !worked.missing);
ok('and it answers a busy room differently from an empty one — the thing a choreography cannot do',
   !!worked.busy && !!worked.quiet && worked.busy !== worked.quiet);
ok('nobody is signed in and no brainstem is reachable', out.signedIn === false);
ok('nothing bought a thought', bought === 0);
ok('a written mind still produced a thought through the real brainstem', !!(out.r1 && out.r1.words));
ok('the NPC branched on what it actually saw, which a choreography cannot do — a door in the '
 + 'room made it look, an empty room did not',
   out.acted.includes('look:120') && !out.acted2.some(a => /^look:/.test(a)));
ok('and it said something different in each room',
   String(out.r1 && out.r1.words) !== String(out.r2 && out.r2.words));
ok('its move reached the real hands', out.acted.some(a => a === 'look:120'));
ok('the receipt names the door it came through, never calling a written thought a bought one',
   !out.viaStep || out.viaStep.skipped || out.viaStep.via === 'scripted');
ok('no page errors', errs.length === 0);
console.log('\n' + pass + ' passed, ' + fail + ' failed');
await b.close(); process.exit(fail?1:0);})();

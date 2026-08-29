// Two things go through an agent and a third comes out. The claim is that the third can be
// COMPLETELY different from either — and a blend dressed as emergence is the most flattering
// mistake available, so this measures instead of admiring: traits neither parent had, and
// numbers outside the range both parents span.
const { createRequire } = require('module');
const _req=(()=>{for(const b of [process.env.PLAYWRIGHT_DIR, require('path').join(process.env.HOME||'','Documents/GitHub/aaa-fps')]){
 if(!b)continue; try{const r=createRequire(require('path').join(b,'package.json'));r.resolve('playwright');return r;}catch(e){}}return require;})();
const { chromium } = _req('playwright');
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..','..');
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.py':'text/plain','.webp':'image/webp'};
(async()=>{
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:900,height:600}});
await ctx.route('https://kody-w.github.io/AINexus/**',r=>{const u=new URL(r.request().url());
 const f=path.join(ROOT,decodeURIComponent(u.pathname).replace(/^\/AINexus/,''));
 if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory())return r.fulfill({status:404,body:'no'});
 r.fulfill({status:200,contentType:T[path.extname(f)]||'application/octet-stream',body:fs.readFileSync(f)});});
const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('https://kody-w.github.io/AINexus/frontier.html',{timeout:60000});
await p.waitForTimeout(2500);

const out=await p.evaluate(async()=>{
  const H=window.NexusHerd, F=window.NexusFrames, B=window.NexusBrainstem;
  await B.initPyodide(()=>{});
  const agentReg = JSON.stringify(await (await fetch('state/agent_templates.json')).json());
  const worldReg = JSON.stringify(await (await fetch('state/worlds.json')).json());
  for (const id of ['mara','devon']) await H.join({id,persona:'You are '+id+'.'});
  const parent = await F.buildFrame({kind: 'body.pulse',streamId: 'rappid:@kody-w/ainexus:' + 'ab'.repeat(32),
    seq:0,utc:'2026-08-29T00:00:00.000Z',payload:{asserts:{directed:2},requires:{players:['mara','devon']}},prev:null});

  // parent 1: a creature grown out of a conversation
  const chat = { messages:[
    {from:'mara',text:'The greenhouse is failing and nobody wants to say it.',at:'2026-08-29T03:10:00Z'},
    {from:'devon',text:'The sensors are wrong.',at:'2026-08-29T03:10:14Z'},
    {from:'mara',text:'They were replaced in spring.',at:'2026-08-29T04:22:00Z'},
    {from:'devon',text:'Then come and look with me.',at:'2026-08-29T04:22:11Z'}]};
  const chatTile = JSON.parse(await B.callAgent('ChatTile',{chat:JSON.stringify(chat),about:'the greenhouse'}));
  const creature = JSON.parse(await B.callAgent('OrganismForge',{tile:JSON.stringify(chatTile),registry:agentReg}));

  // parent 2: a world worn out of the same record and forged
  const worldTile = await H.wear(parent,'the-greenhouse-at-four');
  const world = await H.slosh(worldTile,[{lens:'WorldForge',args:{registry:worldReg,key:'the-greenhouse-at-four'}}]);

  // the spiral: creature through world -> a third thing
  const s1 = await H.spiral(creature, world.tile, { by:'Adapt' });
  const s1b = await H.spiral(creature, world.tile, { by:'Adapt' });
  // and again, feeding the child back in against a different world
  const world2 = await H.slosh(await H.wear(parent,'the-dry-season'),
    [{lens:'LensGravity',args:{g:1.9}},{lens:'LensCataclysm',args:{degree:2}}]);
  const s2 = await H.spiral(s1.child, world2.tile, { by:'Adapt' });

  // ── many ways, then merged ──
  // the same two parents, blended along six different routes, each allowed to diverge
  const w = (key, lenses) => H.slosh(H.wear(parent, key).then ? null : null, []); // placeholder
  const mk = async (key, lenses) => (await H.slosh(await H.wear(parent, key), lenses)).tile;
  const harsh  = await mk('harsh',  [{lens:'LensGravity',args:{g:2.4}}]);
  const light  = await mk('light',  [{lens:'LensGravity',args:{g:0.12}}]);
  const night  = await mk('night',  [{lens:'LensDayNight',args:{hour:'night'}}]);
  const ruined = await mk('ruined', [{lens:'LensCataclysm',args:{degree:3}}]);
  const ways = [
    { name:'straight',        through:[{with:world.tile}] },
    { name:'heavy-first',     through:[{with:harsh},{with:world.tile}] },
    { name:'weightless',      through:[{with:light}] },
    { name:'by-night',        through:[{with:night},{with:world.tile}] },
    { name:'through-the-end', through:[{with:ruined},{with:harsh}] },
    { name:'reversed',        reverse:true, through:[{with:world.tile},{with:night}] },
  ];
  // EACH STEP DECLARES ITS OWN TRANSFORM. What goes through what, and which agent does the
  // pouring, is a property of the step — so one route can run a world through a lens while
  // another runs a creature through a world, inside the same blend.
  // INVERT THE TWO. Same pair, same spiral, opposite subject: once the creature is what goes
  // through the world, once the world is what goes through — and the two outputs are different
  // KINDS of thing, which is the whole point of the orientation being a property of the step.
  const mixed = [
    { name:'creature-through-world', through:[{ with: world.tile, by:'Adapt' }] },
    { name:'world-through-lens', reverse:true,
      through:[{ with: creature, by:'LensCataclysm', opts:{ aKey:'tile', bKey:'unused', args:{ degree:2 } } }] },
  ];
  const mixedKids = await H.braid(creature, world.tile, mixed);
  const kids = await H.braid(creature, world.tile, ways);
  const m = H.plait(kids, [creature, world.tile]);
  const best = Math.max(...kids.map(k=>k.novelty.novelMilli));

  return {
    mixed: mixedKids.map(k=>({ way:k.way,
      kind: k.child.world ? 'a world' : k.child.traits ? 'a creature' : 'something else',
      tell: k.child.world ? ('ruin: ' + k.child.world.ruin + ', ' + (k.child.world.called||''))
                          : ('gait: ' + (k.child.traits && k.child.traits.gait)) })),
    ways: kids.map(k=>({way:k.way, novel:k.novelty.novelMilli})),
    bestSingle: best, mergedNovelty: m.novelty, contributed: m.merged.contributed,
    mergedTraits: m.merged.traits, mergeNote: m.note,
    creature:{called:creature.called, traits:creature.traits, wake:creature.traits.wakefulness},
    world:{called:world.tile.world.called, premise:world.tile.world.premise, g:world.tile.world.gravity_milli},
    gen1:{ novelty:s1.novelty, traits:s1.child.traits, shapedBy:(s1.child.shaped_by||[]).length },
    gen2:{ novelty:s2.novelty, traits:s2.child.traits, shapedBy:(s2.child.shaped_by||[]).length },
    repeatable: JSON.stringify(s1.child)===JSON.stringify(s1b.child),
  };
});
console.log('parent 1 (from a 3am conversation):', out.creature.called, '·', out.creature.wake);
console.log('  ', JSON.stringify(out.creature.traits));
console.log('parent 2 (a world worn from the record):', out.world.called, '· gravity', out.world.g);
console.log('  ', out.world.premise);
console.log('\nfirst turn of the spiral:');
console.log('  novelty  ', JSON.stringify(out.gen1.novelty));
console.log('  traits   ', JSON.stringify(out.gen1.traits));
console.log('second turn (the child, through a harsher world):');
console.log('  novelty  ', JSON.stringify(out.gen2.novelty));
console.log('  traits   ', JSON.stringify(out.gen2.traits));
const ok=(n,c)=>console.log((c?'  ✓ ':'  ✗ ')+n);
const n1=out.gen1.novelty, n2=out.gen2.novelty;
console.log('\nchecks:');
ok('two things went in and a third came out', !!out.gen1.traits);
ok('the same two parents always make the same child', out.repeatable);
ok('the child carries traits NEITHER parent had', n1.neitherParentHad>0);
ok('and values beyond the range both parents spanned', n1.beyondBothParents>0 || n2.beyondBothParents>0);
ok('it keeps spiralling: the child fed back in is changed again', out.gen2.shapedBy>out.gen1.shapedBy);
console.log('\n  novelty of gen 1: ' + (n1.novelMilli/10).toFixed(1) + '% of its traits were not in either parent');
console.log('  novelty of gen 2: ' + (n2.novelMilli/10).toFixed(1) + '%');
console.log('\n── braiding: six routes, then plaited ──');
for (const w of out.ways) console.log('  ' + w.way.padEnd(18), (w.novel/10).toFixed(1) + '% novel');
console.log('  best single route :', (out.bestSingle/10).toFixed(1) + '%');
console.log('  BRAIDED           :', (out.mergedNovelty.novelMilli/10).toFixed(1) + '%',
            JSON.stringify(out.mergedNovelty));
console.log('  who contributed   :', JSON.stringify(out.contributed));
console.log('  merged traits     :', JSON.stringify(out.mergedTraits));
ok('a braid of six routes beats the best single route', out.mergedNovelty.novelMilli > out.bestSingle);
ok('more than one route contributed something no other did', Object.keys(out.contributed||{}).length>1);
console.log('\n── what goes through what, per step ──');
for (const m of out.mixed) console.log('  ' + m.way.padEnd(24), '->', m.kind.padEnd(16), m.tell);
ok('inverting the two in the spiral produces a different KIND of thing',
   out.mixed.length===2 && out.mixed[0].kind!==out.mixed[1].kind);
console.log('errors:',errs.slice(0,3));
await b.close();})();

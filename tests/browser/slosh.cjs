// Sloshing, both ways round. A tile poured through lenses changes the WORLD; an organism poured
// through worlds changes the CREATURE. Same machinery, opposite subject — and in both directions
// the order matters and the result is reproducible.
const { createRequire } = require('module');
const _req=(()=>{for(const b of [process.env.PLAYWRIGHT_DIR, require('path').join(process.env.HOME||'','Documents/GitHub/aaa-fps')]){
 if(!b)continue; try{const r=createRequire(require('path').join(b,'package.json'));r.resolve('playwright');return r;}catch(e){}}return require;})();
const { chromium } = _req('playwright');
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..','..');
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.webp':'image/webp','.py':'text/plain'};
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
  for(const id of ['mara','devon','kit']) await H.join({id,persona:'You are '+id+'.'});
  const parent = await F.buildFrame({ kind:'nexus.ensemble', streamId:'rappid:@kody-w/ainexus/ensemble:s',
    seq:0, utc:'2026-08-29T00:00:00.000Z',
    payload:{ asserts:{directed:3}, requires:{players:['mara','devon','kit']} }, prev:null });

  // ── forward: a world poured through lenses ──
  const t = await H.wear(parent, 'the-long-night');
  const a = await H.slosh(t, [ {lens:'LensGravity', args:{g:0.2}},
                               {lens:'LensDayNight', args:{hour:'night'}},
                               {lens:'LensCataclysm', args:{degree:3}} ]);
  const a2 = await H.slosh(t, [ {lens:'LensGravity', args:{g:0.2}},
                                {lens:'LensDayNight', args:{hour:'night'}},
                                {lens:'LensCataclysm', args:{degree:3}} ]);
  // order matters: ruin first, then gravity, is not the same world
  const bDiff = await H.slosh(t, [ {lens:'LensCataclysm', args:{degree:3}},
                                   {lens:'LensDayNight', args:{hour:'night'}},
                                   {lens:'LensGravity', args:{g:0.2}} ]);

  // ── inverted: an organism poured through worlds ──
  const moon  = await H.slosh(await H.wear(parent,'moon'),  [{lens:'LensGravity',args:{g:0.16}}]);
  const dark  = await H.slosh(await H.wear(parent,'dark'),  [{lens:'LensDayNight',args:{hour:'night'}}]);
  const dead  = await H.slosh(await H.wear(parent,'dead'),  [{lens:'LensCataclysm',args:{degree:3}}]);
  // traits in thousandths, like everything else that has to survive a hash
  const creature = { name:'kit', traits:{ reach_milli:1000, stamina_milli:1000, trust_milli:600 } };
  const evolved  = await H.sloshAgent(creature, [moon, dark, dead]);
  const evolved2 = await H.sloshAgent(creature, [moon, dark, dead]);
  const other    = await H.sloshAgent(creature, [dead, dark, moon]);

  return {
    world: a.world, steps: a.through.map(s=>s.by), orientationA: a.orientation,
    reproducible: a.hash===a2.hash, orderMatters: a.hash!==bDiff.hash,
    intents: (a.tile.cast||[]).map(c=>c.id+':'+c.standing),
    evolved: evolved.organism, gen: evolved.generation,
    evolvedRepeatable: JSON.stringify(evolved.organism)===JSON.stringify(evolved2.organism),
    evolvedOrderMatters: JSON.stringify(evolved.organism)!==JSON.stringify(other.organism),
    shapedBy: (evolved.organism.shaped_by||[]).map(s=>s.world),
    orientationB: evolved.frame && evolved.frame.payload.asserts.orientation,
  };
});
console.log('world after 3 lenses :', JSON.stringify(out.world));
console.log('  through            :', JSON.stringify(out.steps));
console.log('  cast intents after :', JSON.stringify(out.intents));
console.log('\norganism after 3 worlds:', JSON.stringify(out.evolved.traits));
console.log('  shaped by          :', JSON.stringify(out.shapedBy), '· generation', out.gen);
const ok=(n,c)=>console.log((c?'  ✓ ':'  ✗ ')+n);
console.log('\nchecks:');
ok('a tile poured through lenses changes the world', out.world && out.world.gravity_milli===200 && out.world.hour==='night' && out.world.planet===false);
ok('and takes away intents the world no longer allows', out.intents.every(i=>!/:(go|wander)$/.test(i)));
ok('the same chain gives the same world', out.reproducible);
ok('a different ORDER gives a different world', out.orderMatters);
ok('inverted: an organism poured through worlds is changed by them', out.evolved.traits.gait==='still' && out.evolved.traits.hearing_milli>1000);
ok('it remembers which worlds shaped it', out.shapedBy.length===3 && out.gen===3);
ok('the same worlds in the same order shape it the same way', out.evolvedRepeatable);
ok('a different order shapes a different creature', out.evolvedOrderMatters);
console.log('\norientations recorded  :', JSON.stringify([out.orientationA, out.orientationB]));
ok('each frame records which way it was pointing', out.orientationA==='world through lenses' && out.orientationB==='organism through worlds');
console.log('errors:',errs.slice(0,3));
await b.close();})();

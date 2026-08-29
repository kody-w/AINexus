// Forging worlds the way RAR's learn_new_agent forges agents: adapt a REAL published world,
// verify its bytes, refuse on mismatch, and let the key do every bit of the choosing — so the
// same key always forges the same world, and a different key forges a genuinely different one.
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
  const registry = await (await fetch('state/worlds.json')).json();
  const parent = await F.buildFrame({ kind:'nexus.ensemble', streamId:'rappid:@kody-w/ainexus/ensemble:f',
    seq:0, utc:'2026-08-29T00:00:00.000Z',
    payload:{ asserts:{directed:3}, requires:{players:['mara','devon','kit']} }, prev:null });

  const reg = JSON.stringify(registry);
  const forge = async (key, extra) => {
    const t = await H.wear(parent, key);
    const r = await H.slosh(t, [{ lens:'WorldForge', args: Object.assign({ registry: reg, key }, extra||{}) }]);
    return r;
  };
  const a1 = await forge('the-drowned-hall');
  const a2 = await forge('the-drowned-hall');
  const bb = await forge('a-room-with-two-moons');
  const libraryish = await forge('quiet-key', { want:'library ancient books' });
  // bytes that do not match the registry must be refused, not adapted
  const t = await H.wear(parent, 'tamper');
  const bad = await B.callAgent('WorldForge', { tile: JSON.stringify(t.frame.payload.asserts),
    registry: reg, key:'tamper', template_sha256:'0'.repeat(64) });
  // and a good check must pass
  const first = registry.worlds[0];
  const good = await B.callAgent('WorldForge', { tile: JSON.stringify(t.frame.payload.asserts),
    registry: JSON.stringify({worlds:[first]}), key:'ok', template_sha256:first.sha256 });

  const w = (r)=>r.tile.world;
  return {
    registryCount: registry.count,
    a: { called:w(a1).called, from:w(a1).descends_from, ground:w(a1).ground, sky:w(a1).sky,
         premise:w(a1).premise, rule:w(a1).house_rule, g:w(a1).gravity_milli, rooms:w(a1).rooms,
         gen:a1.tile.generator, prov:a1.tile.provenance && a1.tile.provenance.adapted_from_file },
    b: { called:w(bb).called, from:w(bb).descends_from, premise:w(bb).premise },
    same: a1.hash===a2.hash,
    differs: a1.hash!==bb.hash,
    wanted: w(libraryish).descends_from,
    refused: JSON.parse(bad),
    verified: JSON.parse(good).provenance,
  };
});
console.log('registry            :', out.registryCount, 'real published worlds, each hashed');
console.log('\nforged "the-drowned-hall":');
console.log('  ', out.a.called, '· descends from', JSON.stringify(out.a.from));
console.log('   ground', out.a.ground, '· sky', out.a.sky, '· gravity', out.a.g, '· rooms', out.a.rooms);
console.log('   premise:', out.a.premise);
console.log('   house rule:', out.a.rule);
console.log('   generator:', out.a.gen, '· adapted from', out.a.prov);
console.log('\nforged "a-room-with-two-moons":');
console.log('  ', out.b.called, '· descends from', JSON.stringify(out.b.from));
console.log('   premise:', out.b.premise);
console.log('\nasked for a library  ->', JSON.stringify(out.wanted));
console.log('tampered bytes      ->', out.refused.status, '·', String(out.refused.reason).slice(0,72)+'…');
console.log('verified bytes      ->', out.verified && out.verified.verification);
const ok=(n,c)=>console.log((c?'  ✓ ':'  ✗ ')+n);
console.log('\nchecks:');
ok('a world is adapted from a real published one, not invented', out.a.gen==='world-template-mutation' && !!out.a.prov);
ok('the same key forges byte-identical worlds', out.same);
ok('a different key forges a different world', out.differs);
ok('asking for a library lands on one', /librar|book/i.test(String(out.wanted)));
ok('bytes that fail their hash are REFUSED, not repaired', out.refused.status==='refused' && out.refused.generator==='none');
ok('and matching bytes are recorded as verified', out.verified && out.verified.sha256_verified===true);
console.log('errors:',errs.slice(0,3));
await b.close();})();

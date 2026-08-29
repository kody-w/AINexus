// A frame sharded into tiles. Each tile is a complete starting condition — who is here, where
// they stand, what they are already doing, what is already wrong — derived from the parent frame
// and an index and NOTHING else, so tile(F,7) is the same tile on every machine forever.
// That is what makes the starting points unbounded while the decisions stay finite.
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
await p.waitForTimeout(3000);

const out=await p.evaluate(async()=>{
  const H=window.NexusHerd, F=window.NexusFrames;
  const placed={};
  const mk=(id)=>({ snapshot:()=>({me:{x:0,y:0,z:0},world:'House',portals:[],players:[],chat:[]}),
    people:()=>[],orbs:()=>[],look:async()=>true,walk:async()=>true,aim:async()=>true,
    say:async()=>true,tell:async()=>true,dialogue:()=>[],
    place:(x,z)=>{placed[id]={x,z};} });
  for(const id of ['mara','devon','kit','ola','sam']) await H.join({id,persona:'You are '+id+'.',drive:mk(id)});

  // one purchased frame — the parent everything below is derived from
  const parent = await F.buildFrame({ kind:'nexus.ensemble', streamId:'rappid:@kody-w/ainexus/ensemble:test',
    seq:0, utc:'2026-08-29T00:00:00.000Z',
    payload:{ asserts:{ directed:5 }, requires:{ players:['mara','devon','kit','ola','sam'] } }, prev:null });

  const t7a = await H.wear(parent, 7);
  const t7b = await H.wear(parent, 7);              // same key, worn again
  const t8  = await H.wear(parent, 8);
  const many = await H.tiles(parent, 12);
  // ANY key, not just a number — a word is a key, and the same word wears the same tile
  const wa = await H.wear(parent, 'the-night-the-power-went');
  const wb = await H.wear(parent, 'the-night-the-power-went');
  const wc = await H.wear(parent, 'the-night-the-power-came-back');
  // and the same key against a DIFFERENT record wears a different tile
  const other = await F.buildFrame({ kind:'nexus.ensemble', streamId:'rappid:@kody-w/ainexus/ensemble:other',
    seq:0, utc:'2026-08-29T00:00:00.000Z',
    payload:{ asserts:{ directed:5 }, requires:{ players:['mara','devon','kit','ola','sam'] } }, prev:null });
  const wd = await H.wear(other, 'the-night-the-power-went');

  const entered = await H.enter(t7a);
  const standing = [...H.players().values()].filter(r=>r.standing).map(r=>r.id+':'+r.standing.intent);

  return {
    identical: t7a.hash === t7b.hash,
    sameBytes: JSON.stringify(t7a.frame) === JSON.stringify(t7b.frame),
    different: t7a.hash !== t8.hash,
    t7: { seed:t7a.seed, lens:t7a.lens, mood:t7a.mood, cast:t7a.cast.map(c=>c.id+'@'+c.at.x+','+c.at.z+' '+c.standing) },
    t8: { seed:t8.seed, lens:t8.lens, mood:t8.mood, cast:t8.cast.map(c=>c.id) },
    distinctMoods: new Set(many.map(t=>t.mood)).size,
    distinctCasts: new Set(many.map(t=>t.cast.map(c=>c.id).sort().join(','))).size,
    distinctHashes: new Set(many.map(t=>t.hash)).size,
    words: { same: JSON.stringify(wa.frame)===JSON.stringify(wb.frame), differs: wa.hash!==wc.hash,
             acrossRecords: wa.hash!==wd.hash, mood: wa.mood, cast: wa.cast.map(c=>c.id), seed: wa.seed },
    entered, standing, placed,
    verify: await F.verifyChain([t7a.frame]).then(v=>v.frames).catch(e=>'FAILED '+e.message),
  };
});
console.log('tile 7            :', JSON.stringify(out.t7));
console.log('tile 8            :', JSON.stringify(out.t8));
console.log('12 tiles          :', out.distinctHashes,'distinct ·',out.distinctCasts,'distinct casts ·',out.distinctMoods,'distinct situations');
console.log('entering tile 7   :', JSON.stringify(out.entered));
console.log('standing intents  :', JSON.stringify(out.standing));
console.log('placed in world   :', JSON.stringify(out.placed));
const ok=(n,c)=>console.log((c?'  ✓ ':'  ✗ ')+n);
console.log('\nchecks:');
ok('the same index gives byte-identical frames — deterministic, not random', out.identical && out.sameBytes);
ok('a different index gives a different tile', out.different);
ok('twelve shards of one frame are twelve distinct starting conditions', out.distinctHashes===12);
ok('they differ in who is present, not only in decoration', out.distinctCasts>1);
ok('and in what is already going on', out.distinctMoods>1);
ok('a tile is a valid rapp/1 genesis you can verify', out.verify===1);
ok('entering one actually places the cast and sets them going', out.standing.length>=2 && Object.keys(out.placed).length>=2);
console.log('\nwearing by a word :', JSON.stringify(out.words));
ok('a word is a key: the same word wears the same tile, byte for byte', out.words.same);
ok('a different word wears a different tile', out.words.differs);
ok('the same word against a different record wears a different tile', out.words.acrossRecords);
console.log('errors:',errs.slice(0,3));
await b.close();})();

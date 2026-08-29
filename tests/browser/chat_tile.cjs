// A conversation is the smallest frame there is. Wear one down into a tile, slosh it through a
// verified template, and a creature comes out shaped by what was said AND by the shape the saying
// had in time. The load-bearing claim is the second half: identical words at a different hour, or
// in a different rhythm, must make a genuinely different creature — or "time influences it" is
// just a story told about the code.
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
  const B=window.NexusBrainstem, F=window.NexusFrames;
  await B.initPyodide(()=>{});
  const reg = JSON.stringify(await (await fetch('state/agent_templates.json')).json());

  // the same eight lines, three different conversations
  const WORDS = [
    ['mara','I think the greenhouse is failing and nobody wants to say it.'],
    ['devon','It is not failing. The sensors are wrong.'],
    ['mara','The sensors were replaced in spring.'],
    ['devon','Then the calibration is wrong.'],
    ['mara','You keep moving where the problem is.'],
    ['devon','Because you keep telling me it is somewhere I already looked.'],
    ['mara','Fine. Come and look with me.'],
    ['devon','Now?'],
  ];
  const make = (startIso, gaps) => ({ messages: WORDS.map(([who,text],i)=>({
    from: who, text, at: new Date(Date.parse(startIso) + gaps.slice(0,i).reduce((a,x)=>a+x,0)*1000).toISOString() })) });

  const rushed  = make('2026-08-29T14:00:00Z', [8,7,9,6,8,7,9]);           // straight through, afternoon
  const vigil   = make('2026-08-29T14:00:00Z', [8,7,4200,6,8,7,9]);        // same words, one long silence
  const nightly = make('2026-08-29T03:00:00Z', [8,7,9,6,8,7,9]);           // same words, same rhythm, 3am
  const other   = { messages:[{from:'kit',text:'Has anyone seen the small blue notebook?',at:'2026-08-29T14:00:00Z'},
                              {from:'ola',text:'It is where you left it.',at:'2026-08-29T14:00:20Z'}] };

  const tileOf = async (chat, about) => JSON.parse(await B.callAgent('ChatTile', { chat: JSON.stringify(chat), about }));
  const forge  = async (tile, extra) => JSON.parse(await B.callAgent('OrganismForge',
    Object.assign({ tile: JSON.stringify(tile), registry: reg }, extra||{})));

  const tR = await tileOf(rushed,'the greenhouse'), tV = await tileOf(vigil,'the greenhouse'),
        tN = await tileOf(nightly,'the greenhouse'), tO = await tileOf(other,'a notebook');
  const oR = await forge(tR), oR2 = await forge(tR), oV = await forge(tV), oN = await forge(tN), oO = await forge(tO);

  // a chat-tile is a real frame: particle and wave, standing on its own
  const framed = await F.buildFrame({ kind:'nexus.tile', streamId:'rappid:@kody-w/ainexus/chat:test',
    seq:0, utc:'2026-08-29T14:00:00.000Z', payload:{ asserts:tR, requires:{} }, prev:null });
  const verified = await F.verifyChain([framed]).then(v=>v.frames).catch(e=>'FAILED '+e.message);

  // bad bytes must be refused
  const first = JSON.parse(reg).templates[0];
  const refused = await forge(tR, { template_sha256:'0'.repeat(64) });
  const good = await forge(tR, { registry: JSON.stringify({templates:[first]}), template_sha256:first.sha256 });

  return {
    shapes: { rushed:tR.shape, vigil:tV.shape, nightly:tN.shape },
    wornAway: tR.worn_away.length, residue: tR.residue_of,
    organisms: {
      rushed:{called:oR.called, traits:oR.traits, born:oR.born_of, from:oR.descends_from},
      vigil:{called:oV.called, patience:oV.traits.patience_milli, habit:oV.traits.habit},
      nightly:{called:oN.called, wake:oN.traits.wakefulness, because:oN.born_of.wakefulness_because},
      other:{called:oO.called, knows:oO.traits.knows_about},
    },
    repeatable: JSON.stringify(oR)===JSON.stringify(oR2),
    rhythmMatters: JSON.stringify(oR.traits)!==JSON.stringify(oV.traits),
    hourMatters: oR.traits.wakefulness!==oN.traits.wakefulness,
    wordsMatter: oR.chat_seed!==oO.chat_seed,
    verified, refused, goodProv: good.provenance,
  };
});
const O=out.organisms;
console.log('the same eight lines, worn three ways:');
console.log('  rushed   ', JSON.stringify(out.shapes.rushed));
console.log('  vigil    ', JSON.stringify(out.shapes.vigil));
console.log('  at 3am   ', JSON.stringify(out.shapes.nightly));
console.log('\ncreatures forged from them:');
console.log('  rushed  ->', O.rushed.called, '|', JSON.stringify(O.rushed.traits));
console.log('           descends from', JSON.stringify(O.rushed.from));
console.log('  vigil   ->', O.vigil.called, '| patience', O.vigil.patience, '|', O.vigil.habit);
console.log('  at 3am  ->', O.nightly.called, '|', O.nightly.wake, '—', O.nightly.because);
console.log('  a different conversation ->', O.other.called, '| knows about', JSON.stringify(O.other.knows));
const ok=(n,c)=>console.log((c?'  ✓ ':'  ✗ ')+n);
console.log('\nchecks:');
ok('a chat wears into a tile that says what was worn away', out.wornAway>=3 && /conversation and nothing else/.test(out.residue));
ok('and it stands as a real frame, particle and wave', out.verified===1);
ok('the same conversation always forges the same creature', out.repeatable);
ok('a different conversation forges a different one', out.wordsMatter);
ok('THE RHYTHM MATTERS: identical words, one long silence, different creature', out.rhythmMatters);
ok('THE HOUR MATTERS: identical words at 3am make something nocturnal', out.hourMatters);
ok('a template whose bytes fail its hash is refused', out.refused.status==='refused');
ok('and matching bytes are recorded as verified', out.goodProv && out.goodProv.sha256_verified===true);
console.log('errors:',errs.slice(0,3));
await b.close();})();

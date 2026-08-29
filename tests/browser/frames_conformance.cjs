// ai/frames.js is the arithmetic under every hash in this repo — every frame, every chain, the
// wearing vectors, the whole claim proof.html makes — and it had been exercised constantly and
// checked against the standard never. This test is the check.
//
// It is a DIFFERENTIAL test, which is the only kind worth having here. The expected hashes below
// were not produced by this file or by frames.js; they come from the reference implementation in
// kody-w/rapp-1 (`rapp.py`, §4 canonical + §5 H) and were confirmed identical by this repo's own
// stdlib verifier, frames/verify.py. Three implementations agreeing on ordinary data proves
// nothing — they agree on ordinary data by accident. They are pinned here on the EDGES: member
// names outside the BMP (RFC 8785 orders by UTF-16 code unit, which is not code-point order),
// the 2^53-1 integer boundary, string escaping, empty containers, null against absent, and the
// exact domain-separation tag. If frames.js ever drifts from those bytes, frames minted in this
// browser stop being readable by the rest of the estate, silently — which is the one failure a
// content-addressed system cannot survive and cannot detect from inside.
const { createRequire } = require('module');
const _req=(()=>{for(const b of [process.env.PLAYWRIGHT_DIR, require('path').join(process.env.HOME||'','Documents/GitHub/aaa-fps')]){
 if(!b)continue; try{const r=createRequire(require('path').join(b,'package.json'));r.resolve('playwright');return r;}catch(e){}}return require;})();
const { chromium } = _req('playwright');
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..','..');
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.webp':'image/webp','.py':'text/plain','.jsonl':'application/json'};

// ── vectors from kody-w/rapp-1 rapp.py (agreed byte-for-byte by frames/verify.py) ───────────
// [what it pins, the value as JSON TEXT, H("rapp/1:particle", value)]
const VECTORS = [
  ["an empty object", "{}", "00d4ee8c3964f0e289ba07982ab8457a7b820056236640bda09572f0725a265b"],
  ["an empty array", "{\"a\":[]}", "d6a7b0e378bd95a1cd86dcbadc49397911d21d6f71c67333bfb7bbb0fae4cc05"],
  ["null present, not absent", "{\"a\":null}", "2a1c4f2f8f4153ec39f997586d75f2ee7efc4ee9ab8d3815210e76a2e50541e2"],
  ["booleans", "{\"t\":true,\"f\":false}", "790b3542d385f30fe095b7f78776c1c8e3fbf49064fc8f2778727dea8d5fdddc"],
  ["ascii member names resorted", "{\"b\":1,\"B\":2,\"a\":3,\"A\":4,\"0\":5}", "7c33e6d393180ae2367ccc83e3df5444737b661889ceb69f3036f15be8b231d7"],
  ["accented member names", "{\"a\":1,\"\\u00e4\":2,\"z\":3,\"\\u00c4\":4,\"\\u00df\":5}", "0eeb4773c279d9ebff1dab32d44c63a4a073bcaec9da6b23720cab9a443d2cbb"],
  ["a non-BMP name sorts FIRST", "{\"\\uff3a\":1,\"\\ud83d\\ude00\":2,\"\\ue000\":3}", "82726b0e06de94f29c5ba1707b0e86f701fd9559dbed7c568611abe5d5436ab0"],
  ["astral against U+FFFF", "{\"\\ud7ff\":3,\"\\ud800\\udc00\":1,\"\\uffff\":2}", "7f3bc9ca936f5bbee8dbf7c90dcb4da64a91f8168fbd28d9685924169e0fed47"],
  ["the empty member name", "{\"\":3,\"a\":1,\"aa\":4,\"ab\":2}", "23c65e10ba83b4df5ea94b4e3ac608b33fbdb197259d3b3c9b8149af3b034114"],
  ["the uint53 ceiling", "{\"n\":9007199254740991}", "0f0dde164fe51ee30c2b88c56522d16c8b1a686d155ffa0282071d34a666c1d9"],
  ["the negative ceiling", "{\"n\":-9007199254740991}", "ac923d00c4d0545b026b6283cd53e27f6cfe694f4a59841eb0f2a022a260229d"],
  ["escapes and the solidus", "{\"s\":\"a\\\"b\\\\c/d\"}", "eec7e3b76e5077fa4cf28df90d8b9466ab7cad0f09f6cc4d966a8777ea5fe8da"],
  ["control characters", "{\"s\":\"\\u0000\\b\\t\\n\\f\\r\\u001f\"}", "a94d84f33a59ec6e53f75a112e4306c485c9637aa564a81343e2ca30bdab5293"],
  ["DEL is not escaped", "{\"s\":\"\\u007f\"}", "fe48f27eb802ff8937b816274cf8f706c0f0c891ff834df608eb0eb23b91c0a6"],
  ["line separators stay literal", "{\"s\":\"\\u2028\\u2029\"}", "99a5e29224d26d36fb6041d5dd48c17052fe939b0a30fb89eafeb66a435db121"],
  ["no unicode normalisation", "{\"a\":\"\\u00e9\",\"b\":\"e\\u0301\"}", "aa1c0f93103b0fb2426cee33b827aa00a3351cc477d3f8b499272c555cb44da5"],
  ["an emoji value", "{\"s\":\"\\ud83d\\ude00\"}", "986e8af81df27744abeeb44b9242733b2f6b61b39af00fa486b16acdbc445219"],
  ["nesting", "{\"a\":{\"b\":[1,{\"c\":\"d\"},[]]},\"z\":{}}", "7cceb0a87476ac8eb21477cf363bcbd73b783e4e2c8bedb289059d6cf3dc098a"],
];
// H(space, {}) for each §5 tag — a tag with one extra byte must land somewhere else entirely
const SPACES = {
  'rapp/1:particle': '00d4ee8c3964f0e289ba07982ab8457a7b820056236640bda09572f0725a265b',
  'rapp/1:wave':     'ab798cfb24baa558f2d3e954a0124aed161196aaa12a848f6c80e29e227bb81a',
  'rapp/1:rappid':   '704118087d0e68d46bbd3411912b32d0cd4c1af22a64bf9b99c9e6db9ff6f501',
};
const SPACE_WITH_TRAILING_SPACE = '30fc00364f143c0f7803f7532f32f87820a25d7f47cbe25dd799a24e709458b1';
// a whole frame built by rapp.py — same eleven keys, same two hashes, or the wire is not one wire
const REF_FRAME = {
  kind: 'body.pulse', stream_id: 'rappid:@kody-w/ainexus:' + 'ab'.repeat(32), seq: 0,
  utc: '2026-01-01T00:00:00.000Z', payload: { asserts: { note: 'audit' } }, prev: null,
  payload_hash: 'bad25b9a7fed10089fae3e7da42c76c229edaae80fa882da4c440d8806187887',
  frame_hash:   '699c8cf0aff6026781934653fb26a0538a2a17125bc45d45ada5f9fb8754be76',
};
// the §13 registry as the anchor publishes it (kody-w/rapp-1 anchor/orient.json, rev-6)
const ANCHOR_KINDS = ['body.pulse','body.re-genesis','body.reconstructed','body.twin-pulse',
  'memory.chat-turn','memory.re-genesis','memory.reconstructed','memory.save','memory.tool-call',
  'swarm.echo','swarm.guidance','swarm.re-genesis','swarm.reconstructed','swarm.telemetry'];

(async()=>{
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:900,height:600}});
await ctx.route('https://kody-w.github.io/AINexus/**',r=>{const u=new URL(r.request().url());
 const f=path.join(ROOT,decodeURIComponent(u.pathname).replace(/^\/AINexus/,''));
 if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory())return r.fulfill({status:404,body:'no'});
 r.fulfill({status:200,contentType:T[path.extname(f)]||'application/octet-stream',body:fs.readFileSync(f)});});
const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('https://kody-w.github.io/AINexus/frontier.html',{timeout:60000});
await p.waitForFunction(()=>window.NexusFrames,null,{timeout:45000});

const out=await p.evaluate(async(IN)=>{
  const F=window.NexusFrames;
  const R={};
  const refuses=async(fn)=>{ try{ await fn(); return null; }catch(e){ return e.message; } };

  // ── 1. does this browser agree with rapp.py, byte for byte, on the edges ──────────────
  R.vectors=[];
  for(const [name,text,want] of IN.VECTORS){
    const v=JSON.parse(text);
    let got=null,err=null;
    try{ got=await F.H('rapp/1:particle',v); }catch(e){ err=e.message; }
    R.vectors.push({name, ok: got===want, got, want, err, canonical: (()=>{try{return F.canonical(v);}catch(e){return null;}})()});
  }
  // the ordering vector, spelled out: UTF-16 code-unit order puts the astral name FIRST, which
  // a code-point sort (python's plain sorted(), and most people's instinct) does not.
  const ordered=F.canonical(JSON.parse(IN.VECTORS.find(v=>v[0]==='a non-BMP name sorts FIRST')[1]));
  R.utf16Order = { canonical: ordered, emojiFirst: ordered.indexOf('\ud83d\ude00') === 2 };

  // ── 2. the spaces, and that they are actually IN the pre-image ────────────────────────
  R.spaces={};
  for(const [space,want] of Object.entries(IN.SPACES)) R.spaces[space]={ ok: (await F.H(space,{}))===want };
  R.spaceIsHashed = (await F.H('rapp/1:particle ',{})) === IN.SPACE_WITH_TRAILING_SPACE;
  R.spacesDiffer = new Set(await Promise.all(Object.keys(IN.SPACES).map(s=>F.H(s,{})))).size === 3;

  // ── 3. the wave covers exactly the frame minus {frame_hash, sig} ──────────────────────
  const f0=await F.buildFrame({kind:IN.REF_FRAME.kind, streamId:IN.REF_FRAME.stream_id, seq:IN.REF_FRAME.seq,
    utc:IN.REF_FRAME.utc, payload:IN.REF_FRAME.payload, prev:IN.REF_FRAME.prev});
  R.refFrame = { payload: f0.payload_hash===IN.REF_FRAME.payload_hash,
                 frame: f0.frame_hash===IN.REF_FRAME.frame_hash, got:f0.frame_hash };
  const wave=async(f)=>{ const pre={}; for(const k of Object.keys(f)) if(k!=='frame_hash'&&k!=='sig') pre[k]=f[k]; return F.H('rapp/1:wave',pre); };
  const withSig=Object.assign({},f0,{sig:'eyJ.signature.here'});
  R.sigOutOfWave = (await wave(withSig))===f0.frame_hash;                       // sig is excluded
  const bentParticle=Object.assign({},f0,{payload_hash:'0'.repeat(64)});
  R.particleInWave = (await wave(bentParticle))!==f0.frame_hash;                // payload_hash is included
  const bentSeq=Object.assign({},f0,{seq:1});
  R.everyFieldInWave = (await wave(bentSeq))!==f0.frame_hash;

  // ── 4. the I-JSON domain, where the three implementations part company ────────────────
  R.domain={};
  R.domain['2^53-1 accepted']        = !!(await F.H('rapp/1:particle',{n:9007199254740991}));
  R.domain['2^53 refused']           = !!(await refuses(()=>F.canonical({n:9007199254740992})));
  R.domain['2^53+1 refused']         = !!(await refuses(()=>F.canonical(JSON.parse('{"n":9007199254740993}'))));
  R.domain['-2^53 refused']          = !!(await refuses(()=>F.canonical({n:-9007199254740992})));
  R.domain['float refused']          = !!(await refuses(()=>F.canonical({n:0.1})));
  R.domain['NaN refused']            = !!(await refuses(()=>F.canonical({n:NaN})));
  R.domain['Infinity refused']       = !!(await refuses(()=>F.canonical({n:Infinity})));
  R.domain['lone surrogate value']   = !!(await refuses(()=>F.canonical(JSON.parse('{"s":"\\ud800"}'))));
  R.domain['lone surrogate name']    = !!(await refuses(()=>F.canonical(JSON.parse('{"\\udfff":1}'))));
  R.domain['paired surrogate kept']  = F.canonical({s:'\ud83d\ude00'})==='{"s":"\ud83d\ude00"}';
  R.domain['array hole refused']     = !!(await refuses(()=>F.canonical({a:[1,,3]})));
  R.domain['undefined refused']      = !!(await refuses(()=>F.canonical({a:undefined})));
  R.domain['Date refused']           = !!(await refuses(()=>F.canonical({d:new Date(0)})));
  R.domain['Map refused']            = !!(await refuses(()=>F.canonical({m:new Map([['a',1]])})));
  R.domain['boxed Number refused']   = !!(await refuses(()=>F.canonical({n:new Number(5)})));
  R.domain['plain object kept']      = F.canonical(Object.assign(Object.create(null),{b:1,a:2}))==='{"a":2,"b":1}';
  // the one that has to be spelled out: a hole used to canonicalise to `[1,,3]`, which is not JSON
  R.holeText = (()=>{ try{ return F.canonical({a:[1,,3]}); }catch(e){ return 'refused'; } })();

  // ── 5. buildFrame writes what it was given ────────────────────────────────────────────
  const mk=(o)=>F.buildFrame(Object.assign({kind:'body.pulse',streamId:IN.REF_FRAME.stream_id,
    utc:'2026-01-01T00:00:00.000Z',payload:{},prev:null},o));
  R.seq={};
  for(const n of [0,1,2147483647,2147483648,4294967296,9007199254740991]){
    const f=await mk({seq:n}); R.seq[n]= f.seq===n;
  }
  R.seqRefusals={};
  for(const [label,n] of [['1.5',1.5],['-1',-1],['"3"','3'],['null',null],['undefined',undefined],['2^53',9007199254740992]])
    R.seqRefusals[label]= !!(await refuses(()=>mk({seq:n})));
  R.buildRefusals={
    'utc not the §7.4 form':   !!(await refuses(()=>mk({seq:0,utc:'2026-01-01T00:00:00Z'}))),
    'utc names no such day':   !!(await refuses(()=>mk({seq:0,utc:'2026-02-30T00:00:00.000Z'}))),
    'utc second 60':           !!(await refuses(()=>mk({seq:0,utc:'2026-01-01T00:00:60.000Z'}))),
    'payload not an object':   !!(await refuses(()=>mk({seq:0,payload:[]}))),
    'prev not null|64hex':     !!(await refuses(()=>mk({seq:0,prev:'nope'}))),
    'unregistered kind':       !!(await refuses(()=>mk({seq:0,kind:'nexus.tick'}))),
    'body kind on net:':       !!(await refuses(()=>mk({seq:0,streamId:'net:wire'}))),
  };

  // ── 6. verifyChain refuses what it must — the dangerous direction is ACCEPT ───────────
  const A=IN.REF_FRAME.stream_id, B='rappid:@kody-w/other:'+'b'.repeat(64);
  const U=(n)=>'2026-01-0'+(n+1)+'T00:00:00.000Z';
  const reseal=async(f)=>{ f.payload_hash=await F.H('rapp/1:particle',f.payload);
    const pre={}; for(const k of Object.keys(f)) if(k!=='frame_hash'&&k!=='sig') pre[k]=f[k];
    f.frame_hash=await F.H('rapp/1:wave',pre); return f; };
  const raw=(over)=>{ const f={spec:'rapp/1',kind:'body.pulse',stream_id:A,seq:0,utc:U(0),
    payload:{},payload_hash:null,prev:null,prev_wave:null,sig:null,frame_hash:null};
    for(const k of Object.keys(over)) f[k]=over[k]; return f; };
  const line=async(overs)=>{ const out=[]; let prev=null;
    for(const o of overs){ const f=raw(o);
      if(prev && !Object.prototype.hasOwnProperty.call(o,'prev')) f.prev=prev.payload_hash;
      await reseal(f); out.push(f); prev=f; } return out; };

  const good2=await line([{seq:0,prev:null,utc:U(0)},{seq:1,utc:U(1)}]);
  R.chainAccepts = await F.verifyChain(good2).then(v=>v.frames).catch(e=>'REFUSED: '+e.message);
  const hostile=[
    ['a genesis that is not seq 0',            await line([{seq:7,prev:null}])],
    ['a segment from ANOTHER stream spliced in',await line([{seq:0,prev:null,utc:U(0)},{seq:1,stream_id:B,utc:U(1)}])],
    ['a twelfth key, hashed in',               await line([{seq:0,prev:null,smuggled:'anything'}])],
    ['a frame with prev_wave removed',         await (async()=>{const f=raw({seq:0,prev:null}); delete f.prev_wave; return [await reseal(f)];})()],
    ['the legacy spec token rapp-frame/2.0',   await line([{spec:'rapp-frame/2.0',seq:0,prev:null}])],
    ['utc running backwards',                  await line([{seq:0,prev:null,utc:U(5)},{seq:1,utc:U(0)}])],
    ['a calendar that does not exist',         await line([{seq:0,prev:null,utc:'2026-13-45T25:61:61.999Z'}])],
    ['a payload that is an array',             await line([{seq:0,prev:null,payload:[]}])],
    ['a payload that is null',                 await line([{seq:0,prev:null,payload:null}])],
    ['prev_wave set off a swarm-stream',       await line([{seq:0,prev:null,prev_wave:'c'.repeat(64)}])],
    ['a negative seq',                         await line([{seq:-1,prev:null}])],
    ['prev in uppercase hex',                  await (async()=>{const c=await line([{seq:0,prev:null,utc:U(0)},{seq:1,utc:U(1)}]);
                                                  c[1].prev=c[0].payload_hash.toUpperCase(); await reseal(c[1]); return c;})()],
    ['the same genesis twice',                 await (async()=>{const c=await line([{seq:0,prev:null,utc:U(0)}]); return [c[0],c[0]];})()],
  ];
  R.hostile=[];
  for(const [name,frames] of hostile){
    let verdict; try{ await F.verifyChain(frames); verdict='ACCEPTED'; }catch(e){ verdict=e.message; }
    R.hostile.push({name, refused: verdict!=='ACCEPTED', why: verdict});
  }
  // the §7.2 family rule is opt-in, because this repo's own older lines would fail it
  const wrongFamily=await line([{seq:0,prev:null,kind:'body.pulse',stream_id:A+':generations'}]);
  R.strictKinds = { lenientAccepts: await F.verifyChain(wrongFamily).then(()=>true).catch(()=>false),
                    strictRefuses:  await F.verifyChain(wrongFamily,{kinds:true}).then(()=>false).catch(()=>true) };

  // ── 7. §6.1 / §6.1.1 grammar, lengths included ───────────────────────────────────────
  const rid=(o,s)=>'rappid:@'+o+'/'+s+':'+'a'.repeat(64);
  R.grammar={
    'owner 39 is a body-stream':   F.formOf(rid('a'.repeat(39),'s'))==='body-stream',
    'owner 40 is no form at all':  F.formOf(rid('a'.repeat(40),'s'))===null,
    'slug 100 is a body-stream':   F.formOf(rid('o','s'.repeat(100)))==='body-stream',
    'slug 101 is no form at all':  F.formOf(rid('o','s'.repeat(101)))===null,
    'instance 64 is a memory-stream': F.formOf(rid('o','s')+':'+'i'.repeat(64))==='memory-stream',
    'instance 65 is no form at all':  F.formOf(rid('o','s')+':'+'i'.repeat(65))===null,
    'two instance labels refused': F.formOf(rid('o','s')+':a:b')===null,
    '63 hex refused':              F.formOf('rappid:@o/s:'+'a'.repeat(63))===null,
    'uppercase hex refused':       F.formOf('rappid:@o/s:'+'A'.repeat(64))===null,
    'adjacent hyphen refused':     F.formOf(rid('o','a--b'))===null,
    'trailing hyphen refused':     F.formOf(rid('o','ab-'))===null,
    'net:label is a swarm-stream': F.formOf('net:wire')==='swarm-stream',
    'net: alone refused':          F.formOf('net:')===null,
    'a trailing newline refused':  F.formOf(rid('o','s')+'\n')===null,
  };
  R.mint={
    'owner 40 refused': !!(await refuses(()=>F.mintRappid('a'.repeat(40),'s'))),
    'slug 101 refused': !!(await refuses(()=>F.mintRappid('o','s'.repeat(101)))),
    'uppercase refused':!!(await refuses(()=>F.mintRappid('O','s'))),
    'a mint is grammatical, and never a name-hash':
      await (async()=>{ const a=await F.mintRappid('kody-w','ainexus'), c=await F.mintRappid('kody-w','ainexus');
        return F.formOf(a)==='body-stream' && a!==c; })(),
  };
  // §7.2's registry is EXACT match — never prefix inference
  R.registry = {
    'the table is the anchor\'s fourteen': JSON.stringify(Object.keys(F.REGISTERED_KINDS).sort())===JSON.stringify(IN.ANCHOR_KINDS),
    'body.pulse is registered':  F.compliant('body.pulse',A)===null,
    'body.pulses is not':        F.compliant('body.pulses',A)!==null,
    'body.anything is not':      F.compliant('body.anything',A)!==null,
    'body. prefix infers nothing': F.compliant('body.pulse-x',A)!==null,
  };

  // ── 8. and the line this repo actually publishes still verifies ──────────────────────
  const text=await (await fetch('frames/line.jsonl',{cache:'no-cache'})).text();
  R.published = await F.verifyChain(text).then(v=>({frames:v.frames,head:v.head,stream:v.stream_id}))
                                         .catch(e=>({error:e.message}));
  return R;
},{VECTORS,SPACES,SPACE_WITH_TRAILING_SPACE,REF_FRAME,ANCHOR_KINDS});

// ── report ───────────────────────────────────────────────────────────────────────────────
const checks=[]; const say=(ok,text)=>{checks.push({ok,text}); console.log('  '+(ok?'✓':'✗')+' '+text);};

const badVec=out.vectors.filter(v=>!v.ok);
console.log('\nagreement with the reference implementation (kody-w/rapp-1 rapp.py):');
for(const v of out.vectors) console.log('  '+(v.ok?'✓':'✗')+' '+v.name.padEnd(30)+' '+(v.canonical||'(refused)'));
console.log('');
say(badVec.length===0, out.vectors.length+' JCS vectors hash identically in this browser and in rapp.py'
    + (badVec.length? ' — DIVERGED on: '+badVec.map(v=>v.name+' (got '+v.got+' want '+v.want+(v.err?', '+v.err:'')+')').join('; ') : ''));
say(out.utf16Order.emojiFirst, 'member names order by UTF-16 code unit, not code point — the astral name sorts first: '+out.utf16Order.canonical);

console.log('\nthe §5 spaces:');
for(const [s,r] of Object.entries(out.spaces)) say(r.ok, 'H("'+s+'", {}) is the reference hash');
say(out.spacesDiffer, 'the three spaces address three different places');
say(out.spaceIsHashed, 'one extra byte in the tag lands somewhere else entirely — the tag really is in the pre-image');

console.log('\nthe frame:');
say(out.refFrame.payload && out.refFrame.frame, 'a frame built here is byte-identical to the same frame built by rapp.py');
say(out.sigOutOfWave, 'sig is outside the wave pre-image — signing does not rename the frame');
say(out.particleInWave, 'payload_hash is inside it — the wave attests the particle');
say(out.everyFieldInWave, 'and so is every other field: bending seq changes frame_hash');

console.log('\nthe I-JSON domain (where implementations silently disagree):');
for(const [k,v] of Object.entries(out.domain)) say(v, k);
say(out.holeText==='refused', 'a sparse array is refused, not written as [1,,3] — which is not JSON and was hashed anyway');

console.log('\nbuildFrame:');
for(const [n,ok] of Object.entries(out.seq)) say(ok, 'seq '+n+' survives the build (it was `o.seq | 0`, so 2147483648 became -2147483648)');
for(const [n,ok] of Object.entries(out.seqRefusals)) say(ok, 'seq '+n+' is refused rather than repaired');
for(const [k,v] of Object.entries(out.buildRefusals)) say(v, 'refuses: '+k);

console.log('\nverifyChain — a false accept is a broken line that looks sound:');
say(out.chainAccepts===2, 'a good two-frame chain verifies (got '+out.chainAccepts+')');
for(const h of out.hostile) say(h.refused, 'refuses '+h.name+(h.refused?'':' — ACCEPTED IT'));
say(out.strictKinds.lenientAccepts && out.strictKinds.strictRefuses,
    '§7.2 family/registry is opt-in: {kinds:true} refuses a body kind on a memory-stream, the default does not '
    + '(this repo\'s own older lines carry exactly that drift — see tools/check_rapp1.py)');

console.log('\nthe grammar (§6.1 lengths are normative):');
for(const [k,v] of Object.entries(out.grammar)) say(v, k);
for(const [k,v] of Object.entries(out.mint)) say(v, 'mintRappid: '+k);
for(const [k,v] of Object.entries(out.registry)) say(v, 'registry: '+k);

console.log('\nthe published line:');
say(!out.published.error && out.published.frames>0,
    'frames/line.jsonl still verifies under all of the above: '+JSON.stringify(out.published));

console.log('\nerrors:',JSON.stringify(errs));
const fail=checks.filter(c=>!c.ok).length || errs.length;
console.log('\n'+(fail?('FAILED — '+checks.filter(c=>!c.ok).length+' of '+checks.length+' checks'):('OK — '+checks.length+' checks')));
await b.close();
process.exit(fail?1:0);
})();

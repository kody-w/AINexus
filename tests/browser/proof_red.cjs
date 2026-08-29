// The proof page's whole claim is "if a number here were wrong, this page would say so about
// itself". A page that only ever goes green has not demonstrated that — it has demonstrated that
// it goes green. So: feed it lies and require it to catch them.
//
// The lie that matters most is the third one. The cards used to render from fields sitting BESIDE
// the frame rather than inside it, so a bundle could carry a verified frame and print numbers the
// frame never said, all badges green. That is the one failure mode this page cannot be allowed to
// have, and the only way to know it is gone is to try it.
const { createRequire } = require('module');
const _req=(()=>{for(const b of [process.env.PLAYWRIGHT_DIR, require('path').join(process.env.HOME||'','Documents/GitHub/aaa-fps')]){
 if(!b)continue; try{const r=createRequire(require('path').join(b,'package.json'));r.resolve('playwright');return r;}catch(e){}}return require;})();
const { chromium } = _req('playwright');
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..','..');
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.py':'text/plain'};
const BUNDLE=path.join(ROOT,'proof','latest','proof.json');
let pass=0,fail=0;
const ok=(what,cond)=>{ console.log((cond?'  ok   ':'  FAIL ')+what); cond?pass++:fail++; };
(async()=>{
if(!fs.existsSync(BUNDLE)){ console.log('no recording at proof/latest/proof.json — run tools/record_proof.cjs'); process.exit(1); }
const honest=JSON.parse(fs.readFileSync(BUNDLE,'utf8'));
const clone=()=>JSON.parse(JSON.stringify(honest));

// three lies, each aimed at a different way the page could be fooled
const lies={};
{ const a=clone(); a.worlds[0].frame.payload.asserts.world.called='Totally Invented'; lies['inside the frame']=a; }
{ const b=clone(); b.worlds[0].world.called='Totally Invented';
  if(b.worlds[0].provenance) b.worlds[0].provenance.sha256_verified=false; lies['beside the frame']=b; }
{ const c=clone(); c.worlds[1].tile.hash2='0'.repeat(64); lies['a repeatability claim the hashes do not support']=c; }

const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1000,height:800}});
await ctx.route('https://kody-w.github.io/AINexus/**',r=>{const u=new URL(r.request().url());
 const rel=decodeURIComponent(u.pathname).replace(/^\/AINexus/,'');
 const m=rel.match(/^\/proof\/latest\/__lie_(\d+)\.json$/);
 if(m) return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(Object.values(lies)[+m[1]])});
 const f=path.join(ROOT,rel);
 if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory())return r.fulfill({status:404,body:'no'});
 r.fulfill({status:200,contentType:T[path.extname(f)]||'application/octet-stream',body:fs.readFileSync(f)});});

const read=async(q)=>{ const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('https://kody-w.github.io/AINexus/proof.html?proof='+q,{timeout:60000}); await p.waitForTimeout(3500);
  const r=await p.evaluate(()=>{const bs=[...document.querySelectorAll('span.v')];
    return { green:bs.filter(x=>/\bok\b/.test(x.className)).length, red:bs.filter(x=>/\bno\b/.test(x.className)).length,
             text:document.body.innerText, first:(document.querySelector('#worlds .name')||{}).textContent };});
  await p.close(); return Object.assign(r,{errs}); };

const base=await read('proof/latest/proof.json');
console.log('\nthe honest recording:');
ok('renders without a page error', base.errs.length===0);
ok('every badge is green ('+base.green+' of '+(base.green+base.red)+')', base.red===0 && base.green>20);
ok('it prints no undefined or NaN', !/undefined|NaN/.test(base.text));

const names=Object.keys(lies);
const r0=await read('proof/latest/__lie_0.json');
const r1=await read('proof/latest/__lie_1.json');
const r2=await read('proof/latest/__lie_2.json');
console.log('\nfed a lie '+names[0]+':');
ok('the page refuses it rather than printing it quietly', r0.red>0);
ok('and names the hash that failed', /hash recomputed here/.test(r0.text));
console.log('\nfed a lie '+names[1]+':');
ok('the page is unaffected — it reads only what it verified', r1.red===0 && r1.first===base.first);
console.log('\nfed '+names[2]+':');
ok('the page checks the two recorded hashes itself and refuses', r2.red>0);

console.log('\n'+pass+' passed, '+fail+' failed');
await b.close(); process.exit(fail?1:0);})();

// "People say they can't stay signed in, so they literally don't use the application."
//
// That is a real report from real users, and this is the suite that holds the answer down. The
// cause was not one bug but a shape: the code could not tell "your credential is finished" from
// "I could not ask right now", and it resolved that ambiguity in the most expensive direction
// every time — by telling somebody their sign-in had expired. They then went and did the device
// flow again, which is itself rate limited, and that is what being unable to stay signed in feels
// like from the inside.
//
// Three questions, and the estate must answer each differently:
//   the worker is unreachable      -> say nothing about the credential; keep it
//   a proxy or WAF answers 403     -> that is the road, not the traveller; keep it, once
//   GitHub names the account       -> that is the credential; sign out
const { createRequire } = require('module');
const _req=(()=>{for(const b of [process.env.PLAYWRIGHT_DIR, require('path').join(process.env.HOME||'','Documents/GitHub/aaa-fps')]){
 if(!b)continue; try{const r=createRequire(require('path').join(b,'package.json'));r.resolve('playwright');return r;}catch(e){}}return require;})();
const { chromium } = _req('playwright');
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..','..');
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.py':'text/plain'};
const WORKER='https://rapp-auth.kwildfeuer.workers.dev/**';
let pass=0,fail=0;
const ok=(n,c)=>{console.log((c?'  ✓ ':'  ✗ ')+n); c?pass++:fail++;};

async function visit(browser, worker) {
  const ctx = await browser.newContext();
  await ctx.route('https://kody-w.github.io/AINexus/**', r => { const u=new URL(r.request().url());
    const f=path.join(ROOT,decodeURIComponent(u.pathname).replace(/^\/AINexus/,''));
    if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory())return r.fulfill({status:404,body:'no'});
    r.fulfill({status:200,contentType:T[path.extname(f)]||'application/octet-stream',body:fs.readFileSync(f)});});
  await ctx.route(WORKER, worker);
  const p = await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('https://kody-w.github.io/AINexus/frontier.html',{timeout:60000});
  await p.waitForFunction(()=>window.NexusAuth,null,{timeout:30000});
  // a RETURNING visitor: the credential was already saved by a previous session
  await p.evaluate(()=>window.NexusAuth.saveSettings({ ghuToken:'ghu_pretend', copilotToken:null, copilotExpiresAt:0 }));
  const answer = await p.evaluate(async()=>({ verdict: await window.NexusAuth.verify(),
                                              stillSignedIn: window.NexusAuth.hasToken() }));
  await ctx.close();
  return { ...answer, errs };
}

(async()=>{
const b=await chromium.launch();

const down = await visit(b, r => r.abort());
const proxy = await visit(b, r => r.fulfill({status:403, body:'<html>403 Forbidden</html>'}));
const noAccess = await visit(b, r => r.fulfill({status:403, contentType:'application/json',
  body: JSON.stringify({ error_details:{ notification_id:'no_copilot_access', message:'as somebody.' } })}));
const expired = await visit(b, r => r.fulfill({status:401, body:'{"message":"Bad credentials"}'}));

console.log('what each answer does to a saved sign-in:\n');
console.log('  worker unreachable   verify ->', JSON.stringify(down.verdict), ' still signed in:', down.stillSignedIn);
console.log('  proxy/WAF 403        verify ->', JSON.stringify(proxy.verdict), ' still signed in:', proxy.stillSignedIn);
console.log('  GitHub: no Copilot   verify ->', JSON.stringify(noAccess.verdict), ' still signed in:', noAccess.stillSignedIn);
console.log('  GitHub: 401 bad cred verify ->', JSON.stringify(expired.verdict), ' still signed in:', expired.stillSignedIn);

console.log('\nchecks:');
ok('an unreachable service says NOTHING about the credential — verify answers null, not false',
   down.verdict === null);
ok('and the sign-in survives it', down.stillSignedIn === true);
ok('a 403 from a proxy is the road, not the traveller — the sign-in survives the first one',
   proxy.verdict === null || proxy.verdict === true ? proxy.stillSignedIn === true : false);
ok('GitHub naming the account IS about the credential — that one signs out',
   noAccess.verdict === false && noAccess.stillSignedIn === false);
ok('a 401 is GitHub answering about the token itself — that signs out at once',
   expired.verdict === false && expired.stillSignedIn === false);
ok('no page errors in any of the four', [down,proxy,noAccess,expired].every(r => r.errs.length === 0));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
await b.close(); process.exit(fail?1:0);})();

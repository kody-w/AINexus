// Resolve playwright from wherever it actually lives. NODE_PATH is not enough: it finds
// `playwright` but not the `playwright-core` that playwright itself requires, so the import
// fails from any directory but the one it was installed in. Set PLAYWRIGHT_DIR to override.
const { createRequire } = require('module');
const _req = (() => {
  for (const base of [process.env.PLAYWRIGHT_DIR,
                      require('path').join(process.env.HOME || '', 'Documents/GitHub/aaa-fps')]) {
    if (!base) continue;
    try { const r = createRequire(require('path').join(base, 'package.json')); r.resolve('playwright'); return r; }
    catch (e) {}
  }
  return require;
})();
const { chromium } = _req('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');   // the repo, wherever it is checked out
const T = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.py':'text/plain' };
(async () => {
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1000,height:700} });
await ctx.route('https://kody-w.github.io/AINexus/**', r => { const u=new URL(r.request().url());
  const f=path.join(ROOT, decodeURIComponent(u.pathname).replace(/^\/AINexus/,''));
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()) return r.fulfill({status:404,body:'no'});
  r.fulfill({status:200,contentType:T[path.extname(f)]||'application/octet-stream',body:fs.readFileSync(f)}); });
const p = await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('https://kody-w.github.io/AINexus/frontier.html',{timeout:45000});
await p.waitForTimeout(4000);

const res = await p.evaluate(async () => {
  // a scripted mind: it narrates AND acts in the same breath (the normal shape), calls a verb
  // that fails, invents a verb that does not exist, then stops.
  const script = [
    { content: 'Let me see who is here.', tool_calls: [
      { id: 'a1', function: { name: 'world_people', arguments: '{}' } }] },
    { content: 'Heading over to say hello.', tool_calls: [
      { id: 'a2', function: { name: 'world_tell', arguments: '{"to":"ghost-peer","text":"hi"}' } },
      { id: 'a3', function: { name: 'world_jump', arguments: '{"height":9}' } }] },
    { content: '', tool_calls: [] },
  ];
  let i = 0;
  window.NexusAuth = { signedIn: () => true, chat: async () => script[Math.min(i++, script.length-1)] };
  const acted = [];
  window.__autodrive = {
    people: () => [{ id: 'full-peer-id-1234', name: 'Ada', isAI: false }],
    tell: async (to, text) => { acted.push(['tell', to, text]); return false; },   // peer not here
    say:  async (t) => { acted.push(['say', t]); return true; },
    orbs: () => [], snapshot: () => ({ chat: [] }), dialogue: () => [],
    run: async () => { acted.push(['run-was-used']); return 'done'; },
  };
  const r = await window.NexusBrainstem.turn({ percepts: { me: {} }, python: false, rounds: 4 });
  return { words: r.words, calls: r.calls, acted, rounds: r.rounds };
});
console.log('the player narrated while acting — words kept:', JSON.stringify(res.words));
console.log('what it was told about each call:');
for (const c of res.calls) console.log('   ' + c.tool.padEnd(13), '->', String(c.result).slice(0, 78));
console.log('driver calls actually made:', JSON.stringify(res.acted));
console.log('rounds:', res.rounds);
console.log('\nchecks:');
const say = (n, ok) => console.log((ok ? '  ✓ ' : '  ✗ ') + n);
say('a line spoken alongside a tool call is not lost', res.words === 'Heading over to say hello.');
say('a verb that returned false is reported as FAILED, not ok', /failed/.test(res.calls.find(c=>c.tool==='world_tell').result));
say('an invented verb is refused and never dispatched', /no such verb/.test(res.calls.find(c=>c.tool==='world_jump').result) && !res.acted.some(a=>a[0]==='run-was-used'));
say('a list verb returns real data, not "ok"', /full-peer-id-1234/.test(res.calls.find(c=>c.tool==='world_people').result));
say('the driver was called directly, not through run()', res.acted.some(a=>a[0]==='tell'));
console.log('\nnot exported:', await p.evaluate(()=>({ getToken: typeof window.NexusAuth?.getToken })));
console.log('errors:', errs.slice(0,3));
await b.close();
})();

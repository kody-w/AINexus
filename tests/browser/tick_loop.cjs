// The rapplication loop, in the nexus: a player ticks on its own clock and writes a line of
// rapp/1 frames as it goes. Nothing outside drives it — the harness only starts it and watches.
// Runs with NO credentials: the mind is scripted so the LOOP is what is under test.
const { createRequire } = require('module');
const _req = (() => {
  for (const base of [process.env.PLAYWRIGHT_DIR, require('path').join(process.env.HOME || '', 'Documents/GitHub/aaa-fps')]) {
    if (!base) continue;
    try { const r = createRequire(require('path').join(base, 'package.json')); r.resolve('playwright'); return r; } catch (e) {}
  }
  return require;
})();
const { chromium } = _req('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
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
await p.waitForTimeout(3500);

const out = await p.evaluate(async () => {
  let n = 0;
  window.NexusAuth = { signedIn: () => true, chat: async () => {
    n++;
    // alternate: a tick that acts, then a tick that only speaks
    return n % 2 ? { content: 'Looking around.', tool_calls: [{ id: 't'+n, function: { name: 'world_orbs', arguments: '{}' } }] }
                 : { content: 'Nice place.', tool_calls: [] };
  }};
  let pos = 0;
  window.__autodrive = {
    snapshot: () => ({ me: { x: pos++, y: 0, z: -4 }, world: 'Nexus',
                       portals: [{ name: 'Ebike World', distance: 8 }],
                       players: [{ id: 'peer-1', name: 'Ada' }], chat: [] }),
    orbs: () => [{ name: 'Ebike World', distance: 8 }],
    people: () => [{ id: 'peer-1', name: 'Ada', isAI: false }],
    say: async () => true, tell: async () => true,
  };
  const h = window.NexusBrainstem.live({ everyMs: 150, maxTicks: 6, vision: false, python: false, persona: 'You are a wanderer.' });
  await new Promise(r => setTimeout(r, 2600));
  h.stop('test over');
  const st = h.state();
  let verified = null, err = null;
  try { verified = await h.verify(); } catch (e) { err = e.message; }
  return { ticks: st.ticks, acts: st.acts, words: st.words, frames: st.chain.length,
           streamId: st.streamId, verified, err, chain: h.chain(),
           journal: st.journal.slice(0, 3).map(j => ({ tick: j.tick, words: j.words, calls: (j.calls||[]).map(c=>c.tool) })) };
});
console.log('the player ticked on its own:', out.ticks, 'ticks,', out.acts, 'tool calls,', out.words, 'lines spoken');
console.log('first journal entries:', JSON.stringify(out.journal));
console.log('stream id  :', out.streamId);
console.log('frames     :', out.frames, out.err ? '(verify failed: ' + out.err + ')' : '');
console.log('self-verify:', out.verified ? out.verified.frames + ' frames, head ' + String(out.verified.head).slice(0,12) + '…' : 'none');
fs.writeFileSync('/tmp/tick_chain.jsonl', out.chain);
const ok = (n, c) => console.log((c ? '  ✓ ' : '  ✗ ') + n);
console.log('\nchecks:');
ok('it ticked without anything outside stepping it', out.ticks >= 5);
ok('every tick sealed a frame', out.frames === out.ticks);
ok('the line verifies against its own hashes', !!out.verified && out.verified.frames === out.frames);
ok('the identity was minted, not derived from the name', /player:[0-9a-f-]{8,}/.test(out.streamId));
console.log('errors:', errs.slice(0,3));
await b.close();
})();

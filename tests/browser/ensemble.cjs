// One call directs everyone; each player then moves freely until the next frame. What it did
// while free is the slosh that feeds the next direction. No credentials — the director is scripted.
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
await p.goto('https://kody-w.github.io/AINexus/frontier.html',{timeout:60000});
await p.waitForTimeout(3000);

const out = await p.evaluate(async () => {
  const moved = {}, said = {};
  const mk = (who) => { let x = 0; return {
    snapshot: () => ({ me: { x, y: 0, z: 0 }, world: 'Nexus', portals: [{ name: 'Ebike World' }],
                       players: [{ id: 'ana' }, { id: 'bo' }, { id: 'cy' }], chat: [] }),
    people: () => [{ id: 'ana' }, { id: 'bo' }, { id: 'cy' }].filter(q => q.id !== who),
    orbs: () => [{ name: 'Ebike World', distance: 6 }],
    look: async () => true,
    walk: async () => { x += 1; moved[who] = (moved[who] || 0) + 1; return true; },
    aim: async () => true, dialogue: () => [{ short: 'hi', text: 'hey there' }],
    tell: async () => true,
    say: async (t) => { (said[who] = said[who] || []).push(t); return true; },
  }; };

  let calls = 0, seenSince = null;
  window.NexusAuth = { signedIn: () => true, chat: async (messages) => {
    calls++;
    const situation = JSON.parse(messages[1].content);
    if (calls === 2) seenSince = situation.map(s => ({ player: s.player, since_last: s.since_last }));
    return { content: '', tool_calls: [{ id: 'd', function: { name: 'direct', arguments: JSON.stringify({
      directives: calls === 1
        ? [{ player: 'ana', intent: 'wander' }, { player: 'bo', intent: 'wander' },
            { player: 'cy', intent: 'hold', say: 'I will wait here.' },
            { player: 'ghost', intent: 'wander' }]                    // a player who is not here
        : [{ player: 'ana', intent: 'hold' }, { player: 'bo', intent: 'nonsense' },
            { player: 'cy', intent: 'wander' }] }) } }] };
  }};
  await window.NexusBrainstem.initPyodide(() => {});
  const H = window.NexusHerd;
  for (const id of ['ana', 'bo', 'cy']) await H.join({ id, persona: 'You are ' + id + '.', drive: mk(id) });

  const first = await H.ensemble({ python: false });
  // now let them move freely — NO model calls at all during this
  const callsAfterDirect = calls;
  for (let i = 0; i < 4; i++) { for (const r of H.players().values()) await H.actLocally(r); }
  const callsAfterMoving = calls;

  const second = await H.ensemble({ python: false });
  const standing = [...H.players().values()].map(r => ({ id: r.id, intent: r.standing && r.standing.intent }));
  let verified = null;
  try { const txt = (window.NexusHerd.hangOut && null); } catch (e) {}
  const sync = H.inSync();
  return { first, second, calls, callsAfterDirect, callsAfterMoving, moved, said, standing, seenSince,
           sync, epoch: H.epoch() };
});
console.log('one call directed everyone :', JSON.stringify(out.first));
console.log('model calls after directing:', out.callsAfterDirect);
console.log('after four rounds of free movement:', out.callsAfterMoving, '(unchanged)');
console.log('how far each actually moved:', JSON.stringify(out.moved));
console.log('what was said              :', JSON.stringify(out.said));
console.log('slosh the 2nd call saw     :', JSON.stringify(out.seenSince));
console.log('standing intents now       :', JSON.stringify(out.standing));
const ok = (n, c) => console.log((c ? '  ✓ ' : '  ✗ ') + n);
console.log('\nchecks:');
ok('three players directed in ONE model call', out.first.players === 3 && out.first.calls === 1);
ok('a directive for a player who is not here is dropped', out.first.directives.length === 3);
ok('they moved with no further model calls', out.callsAfterMoving === out.callsAfterDirect && Object.keys(out.moved).length >= 2);
ok('a line given in the directive is said once, not every act', (out.said.cy || []).length === 1);
ok('the next call saw where they actually got to', Array.isArray(out.seenSince) && out.seenSince.some(s => (s.since_last || []).length > 0));
ok('an intent nobody has becomes holding still', out.standing.find(s => s.id === 'bo').intent === 'hold');
ok('the second direction superseded the first', out.standing.find(s => s.id === 'cy').intent === 'wander');
console.log('\nepoch                      :', out.epoch.id.slice(0,16) + '…  seq', out.epoch.seq);
console.log('virtual frames under it    :', out.epoch.virtual, '· elapsed under the previous:', out.second.virtual_elapsed);
console.log('every object in one moment :', JSON.stringify(out.sync));
ok('one keyframe put every object in the same epoch', out.sync.all && out.sync.of === 3);
ok('the free movement between keyframes was counted as virtual frames', out.second.virtual_elapsed >= 4);
ok('each keyframe starts a new epoch', out.first.epoch !== out.second.epoch);
console.log('errors:', errs.slice(0,3));
await b.close();
})();

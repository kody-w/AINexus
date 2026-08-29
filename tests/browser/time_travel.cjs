// A recorded session is a world you can start again — and running it twice is evidence.
// No credentials and, after the recording, NO model calls at all.
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
  const mk = () => { let x = 0; return {
    snapshot: () => ({ me: { x, y: 0, z: 0 }, world: 'Nexus', portals: [{ name: 'Ebike World' }],
                       players: [{ id: 'ana' }, { id: 'bo' }], chat: [] }),
    people: () => [], orbs: () => [{ name: 'Ebike World', distance: 4 }],
    look: async () => true, walk: async () => { x++; return true; }, aim: async () => true,
    say: async () => true, tell: async () => true, dialogue: () => [] }; };
  let calls = 0;
  const plan = [
    [{ player: 'ana', intent: 'wander' }, { player: 'bo', intent: 'hold' }],
    [{ player: 'ana', intent: 'hold' },   { player: 'bo', intent: 'go', target: 'Ebike World' }],
    [{ player: 'ana', intent: 'go', target: 'Ebike World' }, { player: 'bo', intent: 'wander' }],
  ];
  window.NexusAuth = { signedIn: () => true, chat: async () => ({ content: '',
    tool_calls: [{ id: 'd', function: { name: 'direct', arguments: JSON.stringify({ directives: plan[calls++ % plan.length] }) } }] }) };
  await window.NexusBrainstem.initPyodide(() => {});
  const H = window.NexusHerd;
  for (const id of ['ana', 'bo']) await H.join({ id, persona: 'You are ' + id + '.', drive: mk() });

  // ── record three keyframes ────────────────────────────────────────────
  const recorded = [];
  for (let k = 0; k < 3; k++) {
    const r = await H.ensemble({ python: false });
    recorded.push({ epoch: r.epoch, directives: r.directives.map(d => d.player + ':' + d.intent) });
    for (const rec of H.players().values()) await H.actLocally(rec);
    await new Promise(x => setTimeout(x, 40));
  }
  const history = H.history();
  const callsAfterRecording = calls;

  // ── drop a live player into an ancient frame ──────────────────────────
  const ancient = JSON.parse(history.trim().split('\n')[0]);
  const woke = H.rewind(ancient);
  const standingAfterRewind = [...H.players().values()].map(r => r.id + ':' + r.standing.intent);

  // ── replay the whole session, twice, with no model in the loop ────────
  const runA = [], runB = [];
  await new Promise(res => { const r = H.replay(history, { speed: 50, onFrame: f => runA.push(f.epoch + '|' + f.woke.map(w => w.player + ':' + w.intent).join(',')), onDone: res }); });
  await new Promise(res => { const r = H.replay(history, { speed: 50, onFrame: f => runB.push(f.epoch + '|' + f.woke.map(w => w.player + ':' + w.intent).join(',')), onDone: res }); });
  const callsAfterReplays = calls;

  return { recorded, history: history.trim().split('\n').length, callsAfterRecording, callsAfterReplays,
           woke, standingAfterRewind, runA, runB, matched: JSON.stringify(runA) === JSON.stringify(runB) };
});
console.log('recorded keyframes         :', out.history, JSON.stringify(out.recorded.map(r => r.directives)));
console.log('model calls to record      :', out.callsAfterRecording);
console.log('dropped into the first one :', JSON.stringify(out.woke.woke), '· from', out.woke.from);
console.log('standing after the rewind  :', JSON.stringify(out.standingAfterRewind));
console.log('replay A                   :', JSON.stringify(out.runA.map(x => x.split('|')[1])));
console.log('replay B                   :', JSON.stringify(out.runB.map(x => x.split('|')[1])));
console.log('model calls after 2 replays:', out.callsAfterReplays, '(unchanged)');
const ok = (n, c) => console.log((c ? '  ✓ ' : '  ✗ ') + n);
console.log('\nchecks:');
ok('a live player woke inside an ancient frame, directed as that frame directed it', out.woke.woke.length === 2 && out.standingAfterRewind.join() === 'ana:wander,bo:hold');
ok('the whole session replayed', out.runA.length === 3);
ok('replaying cost nothing — no model call at all', out.callsAfterReplays === out.callsAfterRecording);
ok('two runs of the same history matched frame for frame', out.matched);
ok('and the epochs came back the same, not re-minted', out.runA[0].split('|')[0] === out.runB[0].split('|')[0]);
console.log('errors:', errs.slice(0,3));
await b.close();
})();

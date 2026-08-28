// One brainstem, many players. Deliberately overlapping calls, because the whole risk of a
// shared runtime is that two turns interleave and one player ends up moving another's body.
// No credentials: the minds are scripted so the SHARING is what is under test.
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
  const heard = { alice: [], bob: [] };          // which body each word came out of
  const mk = (who) => ({
    snapshot: () => ({ me: { x: 0, y: 0, z: 0 }, world: 'Nexus', portals: [], players: [], chat: [] }),
    people: () => [], orbs: () => [],
    // a real await inside the call: the window where an interleave could happen
    say: async (t) => { await new Promise(r => setTimeout(r, 25)); heard[who].push(t); return true; },
  });
  // each player's mind says its OWN name, so a crossed binding is visible in the transcript
  const scripts = {};
  window.NexusAuth = { signedIn: () => true, chat: async (messages) => {
    const persona = (messages[0].content.match(/You are (\w+)/) || [])[1] || '?';
    scripts[persona] = (scripts[persona] || 0) + 1;
    return scripts[persona] % 2
      ? { content: '', tool_calls: [{ id: 'x', function: { name: 'world_say', arguments: JSON.stringify({ text: persona }) } }] }
      : { content: 'done', tool_calls: [] };
  }};
  await window.NexusBrainstem.initPyodide(() => {});

  const H = window.NexusHerd;
  await H.join({ id: 'alice', persona: 'You are alice, an AI player.', drive: mk('alice') });
  await H.join({ id: 'bob',   persona: 'You are bob, an AI player.',   drive: mk('bob') });

  // FIRE THEM AT EACH OTHER: eight turns launched at once, no ordering imposed by the caller
  const jobs = [];
  for (let i = 0; i < 4; i++) { jobs.push(H.serve('alice'), H.serve('bob')); }
  const done = await Promise.all(jobs);

  const audit = H.auditSlots();
  const roster = H.roster();
  // memory isolation: write as alice, then try to recall as bob
  const wroteA = await window.NexusBrainstem.callAgent('ManageMemory', {
    memory_type: 'episodic', content: 'alice saw a red door', importance: 5, user_guid: roster[0].guid });
  const readB  = await window.NexusBrainstem.callAgent('ContextMemory', { user_guid: roster[1].guid, full_recall: true });
  const readA  = await window.NexusBrainstem.callAgent('ContextMemory', { user_guid: roster[0].guid, full_recall: true });

  // the ceiling
  const before = window.NexusBrainstem.budget();
  window.NexusBrainstem.budget({ limit: before.calls });     // no headroom left
  let refused = null;
  try { await H.serve('alice'); } catch (e) { refused = e.message; }
  const stopped = (H.roster(), window.NexusBrainstem.budget().stopped);

  return { heard, slots: done.map(d => d.slot), audit, roster: roster.map(r => ({ id: r.id, guid: r.guid, frames: r.frames })),
           wroteA: String(wroteA).slice(0, 60), readB: String(readB).slice(0, 120), readA: String(readA).slice(0, 120),
           budget: before, refused, stopped, lines: (H.lines() || []).length };
});
console.log('slots handed out       :', out.slots.join(', '));
console.log('slot audit             :', JSON.stringify(out.audit));
console.log('alice\'s body said      :', JSON.stringify(out.heard.alice));
console.log('bob\'s body said        :', JSON.stringify(out.heard.bob));
console.log('roster                 :', JSON.stringify(out.roster));
console.log('memory: alice wrote    :', out.wroteA);
console.log('        bob recalls    :', out.readB);
console.log('        alice recalls  :', out.readA);
console.log('budget after the burst :', out.budget.calls, 'of', out.budget.limit, '· refused:', out.refused);
console.log('lines remembered       :', out.lines);
const ok = (n, c) => console.log((c ? '  ✓ ' : '  ✗ ') + n);
console.log('\nchecks:');
ok('no two turns claimed the same slot', out.audit.clean && out.audit.problems.length === 0);
ok('slots are contiguous — nothing was lost or doubled', out.audit.contiguous);
ok('alice only ever spoke through her own body', out.heard.alice.every(w => w === 'alice'));
ok('bob only ever spoke through his own body', out.heard.bob.every(w => w === 'bob'));
ok('both actually played', out.heard.alice.length > 0 && out.heard.bob.length > 0);
ok('their identities were minted, not spelled', out.roster.every(r => /nexus-[0-9a-f-]{8,}/.test(r.guid)) && out.roster[0].guid !== out.roster[1].guid);
ok("one player's memory is invisible to the other", /red door/.test(out.readA) && !/red door/.test(out.readB));
ok('the ceiling stops further spending', /budget reached/.test(String(out.refused) + String(out.stopped)));
ok('the lines outlive the tick', out.lines > 0);
console.log('errors:', errs.slice(0,3));
await b.close();
})();

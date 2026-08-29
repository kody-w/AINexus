// The world frame picks who wakes, and the players prove the hot-loading is real by saying what
// they are each carrying. One runtime, different sets, different answers. No credentials.
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
  const agentSrc = (cls, name, answer) => [
    'from agents.basic_agent import BasicAgent',
    'class ' + cls + '(BasicAgent):',
    '    def __init__(self):',
    '        self.name = "' + name + '"',
    '        self.metadata = {"name": "' + name + '", "description": "' + answer + '",',
    '                         "parameters": {"type": "object", "properties": {}, "required": []}}',
    '        super().__init__(name=self.name, metadata=self.metadata)',
    '    def perform(self, **kwargs):',
    '        return "' + answer + '"',
  ].join('\n');

  const world = { chat: [], players: [{ id: 'alice' }, { id: 'bob' }], world: 'Nexus' };
  const spoke = { alice: [], bob: [] };
  const mk = (who) => ({
    snapshot: () => ({ me: { x: 0, y: 0, z: 0 }, world: world.world, portals: [], players: world.players, chat: world.chat }),
    people: () => [], orbs: () => [],
    say: async (t) => { spoke[who].push(t); world.chat.push({ from: who.slice(0,6), text: t }); return true; },
  });

  // each player's mind asks the world what it is carrying, then says it out loud
  const asked = {};
  window.NexusAuth = { signedIn: () => true, chat: async (messages) => {
    const me = (messages[0].content.match(/You are (\w+)/) || [])[1] || '?';
    asked[me] = (asked[me] || 0) + 1;
    if (asked[me] === 1) return { content: '', tool_calls: [{ id: 'q', function: { name: 'NexusWorld', arguments: '{"action":"agents"}' } }] };
    // round 2: repeat the tool result back as speech, so it lands in the world
    const last = messages[messages.length - 1];
    return { content: 'I am carrying ' + String(last.content), tool_calls: [] };
  }};
  await window.NexusBrainstem.initPyodide(() => {});

  const H = window.NexusHerd;
  await H.join({ id: 'alice', persona: 'You are alice, an AI player.', drive: mk('alice'),
                 agents: [agentSrc('TideAgent', 'Tide', 'the tide is 2.4m')] });
  await H.join({ id: 'bob',   persona: 'You are bob, an AI player.',   drive: mk('bob'),
                 agents: [agentSrc('BeaconAgent', 'Beacon', 'the beacon is lit')] });

  // ask each directly, so the answers can be compared
  const aliceSays = await H.serve('alice');
  const bobSays   = await H.serve('bob');

  // now let the world frame decide who acts
  const c = window.NexusHerd.conduct({ everyMs: 300 });
  await new Promise(r => setTimeout(r, 1500));          // a still world
  const stillTicks = c.state().tick;
  const stillChain = c.chain().trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  const stillChose = stillChain.map(f => f.payload.asserts.chose);

  world.chat.push({ from: 'human!', text: 'hey alice, are you there?' });   // a reason, aimed at one of them
  await new Promise(r => setTimeout(r, 2200));
  const after = c.chain().trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  const picked = after.map(f => ({ chose: f.payload.asserts.chose, why: f.payload.asserts.because }))
                      .filter(x => x.chose);
  c.stop();
  let verified = null; try { verified = await window.NexusFrames.verifyChain(after); } catch (e) { verified = { error: e.message }; }

  return { aliceWords: aliceSays.words, bobWords: bobSays.words,
           aliceResident: aliceSays.resident, bobResident: bobSays.resident,
           stillTicks, stillChose, picked, worldFrames: after.length, verified,
           spoke, roster: H.roster().map(r => ({ id: r.id, agents: r.agents })) };
});
console.log('what each player carries (its own words):');
console.log('   alice:', out.aliceWords);
console.log('   bob  :', out.bobWords);
console.log('resident at call time — alice:', JSON.stringify(out.aliceResident));
console.log('                        bob  :', JSON.stringify(out.bobResident));
console.log('roster                       :', JSON.stringify(out.roster));
console.log('\nstill world: ' + out.stillTicks + ' world ticks, chose ->', JSON.stringify(out.stillChose));
console.log('after a line aimed at alice  :', JSON.stringify(out.picked));
console.log('world chain                  :', out.worldFrames, 'frames ·', JSON.stringify(out.verified).slice(0,80));
const ok = (n, c) => console.log((c ? '  ✓ ' : '  ✗ ') + n);
console.log('\nchecks:');
ok('the two players carry different agents', JSON.stringify(out.aliceResident) !== JSON.stringify(out.bobResident));
ok('alice knows she has Tide and bob does not', /Tide/.test(out.aliceWords) && !/Tide/.test(out.bobWords));
ok('bob knows he has Beacon and alice does not', /Beacon/.test(out.bobWords) && !/Beacon/.test(out.aliceWords));
ok('both still carry the shared core', /NexusWorld/.test(out.aliceWords) && /NexusWorld/.test(out.bobWords));
ok('a still world wakes nobody', out.stillChose.every(c => c === null));
ok('a line aimed at alice wakes alice', out.picked.length > 0 && out.picked[0].chose === 'alice');
ok('and it says why', /spoken to/.test((out.picked[0] || {}).why || ''));
ok('the world keeps its own verifiable chain', out.verified && out.verified.frames === out.worldFrames);
console.log('errors:', errs.slice(0,3));
await b.close();
})();

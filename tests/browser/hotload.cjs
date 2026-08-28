// The world as an agent, and hot-loading. Needs the network (Pyodide + the grail) but NO
// credentials: what is under test is the Python side, not the model.
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
  const calls = [];
  window.__autodrive = {
    people: () => [{ id: 'peer-42', name: 'Ada', isAI: false }],
    orbs: () => [{ name: 'Ebike World', distance: 8 }],
    travel: async (n) => { calls.push(['travel', n]); return false; },   // portal not there
    say: async (t) => { calls.push(['say', t]); return true; },
  };
  await window.NexusBrainstem.initPyodide(() => {});
  const st = window.NexusBrainstem.status();

  const people = await window.NexusBrainstem.callAgent('NexusWorld', { action: 'people' });
  const bad    = await window.NexusBrainstem.callAgent('NexusWorld', { action: 'travel', portal: 'Nowhere' });
  const spoke  = await window.NexusBrainstem.callAgent('NexusWorld', { action: 'say', text: 'hello' });
  const nope   = await window.NexusBrainstem.callAgent('NexusWorld', { action: 'teleport' });

  // teach the running player something it has never seen, from source, with no reload
  const SRC = [
    'from agents.basic_agent import BasicAgent',
    'class TideAgent(BasicAgent):',
    '    def __init__(self):',
    '        self.name = "Tide"',
    '        self.metadata = {"name": "Tide", "description": "How high the tide is.",',
    '                         "parameters": {"type": "object", "properties": {"port": {"type": "string"}}, "required": []}}',
    '        super().__init__(name=self.name, metadata=self.metadata)',
    '    def perform(self, **kwargs):',
    '        return "the tide at %s is 2.4m and rising" % (kwargs.get("port") or "here")',
  ].join('\n');
  const before = window.NexusBrainstem.agentToolDefs().map(d => d.function.name);
  const loaded = await window.NexusBrainstem.hotload(SRC, { file: 'tide_agent.py' });
  const after  = window.NexusBrainstem.agentToolDefs().map(d => d.function.name);
  const used   = await window.NexusBrainstem.callAgent('Tide', { port: 'Dover' });

  return { agents: st.agents, people, bad, spoke, nope, calls, loaded: loaded.name, before, after, used };
});
console.log('agents loaded at start :', out.agents);
console.log('NexusWorld.people      :', out.people);
console.log('NexusWorld.travel(bad) :', out.bad);
console.log('NexusWorld.say         :', out.spoke);
console.log('NexusWorld.teleport    :', out.nope);
console.log('what the world actually got:', JSON.stringify(out.calls));
console.log('\nhot-load: tools before ->', out.before);
console.log('           tools after  ->', out.after);
console.log('           calling it   ->', out.used);
const ok = (n, c) => console.log((c ? '  ✓ ' : '  ✗ ') + n);
console.log('\nchecks:');
ok('the world is an agent the brainstem can call', /peer-42/.test(String(out.people)));
ok('an action that failed in the world is reported as failed', /failed/.test(String(out.bad)));
ok('an action that worked is reported as ok', String(out.spoke) === 'ok');
ok('an action the hands do not have is refused', /no such action/.test(String(out.nope)));
ok('a python agent really drove the JS world', out.calls.some(c => c[0] === 'say' && c[1] === 'hello'));
ok('a brand-new agent was taught at runtime, no reload', !out.before.includes('Tide') && out.after.includes('Tide'));
ok('and the player can use it immediately', /2\.4m and rising/.test(String(out.used)));
console.log('errors:', errs.slice(0,3));
await b.close();
})();

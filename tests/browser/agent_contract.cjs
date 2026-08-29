// The eight python agents run in every visitor's browser and are called with arguments a MODEL
// chose. Their bytes are hash-verified on load, which proves nobody swapped them — and says
// nothing about whether they are correct when the arguments are wrong.
//
// What this holds down, against the REAL agents in a REAL Pyodide, never a fixture:
//
//   · THE MANIFEST IS THE TRUTH. Every parameter perform() reads is declared in the schema handed
//     to the model, and every parameter declared is one perform() reads. An undeclared parameter
//     is a capability the model cannot reach — WorldForge's sha256 refusal was exactly that, a
//     verify-or-refuse rule the caller it is written for had no slot to trigger.
//   · IT ALWAYS ANSWERS. `[]`, `5`, `null`, a word where a number belongs, a cast of strings, a
//     100k-character hour: every one of those parsed as JSON and then crashed somewhere deeper,
//     and a traceback is not something a model can act on. A string comes back or the agent is
//     broken.
//   · THE LENSES ARE PURE. The same tile and the same argument produce the same bytes, twice; and
//     nothing they emit is a float, because rapp/1 is I-JSON and a float does not canonicalise to
//     the same bytes in two languages. A world that cannot be re-derived from its key is not a
//     world you can hand anybody.
//   · A PLAYER'S MEMORY IS ITS OWN. The storage shim namespaces by player — and a key is chosen
//     by whoever is asking, so "/x" and "../x" and an explicit path to read_json must not reach
//     out of the namespace they were scoped into.
//
// Needs the network: Pyodide is ~10MB into a fresh browser context. A single timeout is more
// often the CDN than the code — re-run it before believing it.
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
const ROOT = path.resolve(__dirname, '..', '..');
const T = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.py':'text/plain' };
let pass = 0, fail = 0;
const ok = (what, cond) => { console.log((cond ? '  ✓ ' : '  ✗ ') + what); cond ? pass++ : fail++; };

// ── the manifest against the source, read from the files rather than from a copy ───────────
// Which file is which agent comes from the files themselves — every *_agent.py under ai/vb,
// keyed by the name it gives itself. A list pasted into a test asserts last month's world, and
// state/agent_templates.json cannot serve here: it stores the file stem, not the agent's name.
const VB = path.join(ROOT, 'ai', 'vb');
const FILE_OF = {};
for (const f of fs.readdirSync(VB).filter(n => /_agent\.py$/.test(n))) {
  const m = fs.readFileSync(path.join(VB, f), 'utf8').match(/self\.name\s*=\s*["']([A-Za-z0-9_]+)["']/);
  if (m) FILE_OF[m[1]] = path.join('ai', 'vb', f);
}
function paramsRead(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const body = src.slice(src.indexOf('def perform'));
  const out = new Set();
  for (const m of body.matchAll(/kwargs\.get\(\s*["']([a-z_0-9]+)["']/g)) out.add(m[1]);
  for (const m of body.matchAll(/kwargs\[\s*["']([a-z_0-9]+)["']\s*\]/g)) out.add(m[1]);
  return out;
}

// A tile with everything a lens reaches for, so the hostile version of each is a real substitution
const TILE = JSON.stringify({ seed: 'abc#tile', world: {}, mood: 'calm',
  cast: [{ id: 'mara', standing: 'go' }, { id: 'kit', standing: 'wander' }] });
const CHAT = JSON.stringify([
  { role: 'mara', content: 'is the greenhouse still standing', at: '2026-03-04T03:12:00Z' },
  { role: 'devon', content: 'half of it', at: '2026-03-04T03:12:40Z' },
  { role: 'mara', content: 'which half', at: '2026-03-04T04:41:02Z' }]);
const REG_W = JSON.stringify({ worlds: [{ file: 'crystal-caves-world.html', title: 'Crystal Caves',
                                          description: 'caves', sha256: 'a'.repeat(64) }] });
const REG_A = JSON.stringify({ templates: [{ file: 'ai/vb/adapt_agent.py', name: 'Adapt',
                                             description: 'pour', sha256: 'b'.repeat(64) }] });

// what a model can actually produce through each declared schema, including the shapes that are
// valid JSON and are not the thing that was asked for
const HOSTILE = [
  ['LensGravity',   { tile: '[]' }],
  ['LensGravity',   { tile: '5' }],
  ['LensGravity',   { tile: 'null' }],
  ['LensGravity',   { tile: 'not json at all' }],
  ['LensGravity',   { tile: '{"world":"a string"}' }],
  ['LensGravity',   { tile: '{"world":{},"lenses":"not a list"}' }],
  ['LensGravity',   { tile: TILE, g: 'abc' }],
  ['LensGravity',   { tile: TILE, g: '9'.repeat(400) }],
  ['LensDayNight',  { tile: '[]' }],
  ['LensDayNight',  { tile: '{"world":"a string"}' }],
  ['LensDayNight',  { tile: TILE, hour: 5 }],
  ['LensDayNight',  { tile: TILE, hour: 'x'.repeat(100000) }],
  ['LensCataclysm', { tile: '[]' }],
  ['LensCataclysm', { tile: '{"cast":["mara"]}', degree: 2 }],
  ['LensCataclysm', { tile: '{"cast":[1,2]}', degree: 3 }],
  ['LensCataclysm', { tile: TILE, degree: 'two' }],
  ['LensCataclysm', { tile: TILE, degree: -4 }],
  ['Adapt',         { organism: '[]', tile: TILE }],
  ['Adapt',         { organism: '{"shaped_by":"a story"}', tile: TILE }],
  ['Adapt',         { organism: '{"traits":{}}', tile: '{"world":{"gravity_milli":"low"}}' }],
  ['Adapt',         { organism: '{"traits":{"reach_milli":"far"}}', tile: '{"world":{"gravity_milli":200}}' }],
  ['Adapt',         { organism: '{"traits":{}}', tile: '{"world":{"ruin":"cracked","ruin_degree":"lots"}}' }],
  ['ChatTile',      { chat: '5' }],
  ['ChatTile',      { chat: '{"messages":{}}' }],
  ['ChatTile',      { chat: CHAT, about: 5 }],
  ['WorldForge',    { tile: '[]' }],
  ['WorldForge',    { tile: '{"world":"a string"}' }],
  ['WorldForge',    { tile: TILE, registry: '{"worlds":["a"]}' }],
  ['WorldForge',    { tile: TILE, registry: '{"worlds":{"a":{}}}' }],
  ['WorldForge',    { tile: TILE, registry: REG_W, want: 5 }],
  ['OrganismForge', { tile: '[]' }],
  ['OrganismForge', { tile: '{"kind":"chat","lines":[1,2,3]}' }],
  ['OrganismForge', { tile: '{"kind":"chat","lines":{"a":1}}' }],
  ['OrganismForge', { tile: '{"kind":"chat","lines":[],"shape":{"turns":"lots"}}' }],
  ['OrganismForge', { tile: '{"kind":"chat","lines":[],"shape":{"longest_silence":"ages"}}' }],
  ['OrganismForge', { tile: '{"kind":"chat","lines":[],"shape":{"hour_of_day":"three"}}' }],
  ['OrganismForge', { tile: '{"kind":"chat","lines":[],"shape":[]}' }],
  ['OrganismForge', { tile: '{"kind":"chat","lines":[]}', registry: '[{"name":"x"}]', want: 5 }],
  // JSON carries integers of any length, so "absurdly large" is not a number a float can hold —
  // and every one of these reached an arithmetic OverflowError rather than an answer
  ['ChatTile',      { chat: '[{"role":"a","content":"hi","at":' + '9'.repeat(400) + '}]' }],
  ['Adapt',         { organism: '{"traits":{"reach_milli":' + '9'.repeat(400) + '}}',
                      tile: '{"world":{"gravity_milli":200}}' }],
  ['OrganismForge', { tile: '{"kind":"chat","lines":[],"shape":{"turns":' + '9'.repeat(400) + '}}' }],
  ['NexusWorld',    { action: 'nonsense' }],
  ['NexusWorld',    { action: 5 }],
  ['NexusWorld',    { action: 'look', dx: 'abc' }],
  ['NexusWorld',    { action: 'walk', ms: 'soon' }],
  ['NexusWorld',    { action: 'wait', ms: 'a while' }],
];

// A readable label per call, computed here rather than in the page: the fixtures are long, and a
// label truncated mid-argument is a label no check can name.
const SHORT = { [TILE]: '<tile>', [CHAT]: '<chat>', [REG_W]: '<worlds>', [REG_A]: '<templates>' };
const LABELLED = HOSTILE.map(([name, args]) => [name, args, name + ' ' + JSON.stringify(
  Object.fromEntries(Object.entries(args).map(([k, v]) => [k,
    SHORT[v] || (typeof v === 'string' && v.length > 70 ? v.slice(0, 24) + '…' : v)])))]);
// two calls that shorten to the same label would silently overwrite each other's answer
if (new Set(LABELLED.map(x => x[2])).size !== LABELLED.length) {
  console.log('  ✗ two hostile calls share a label — shorten less, or they overwrite each other');
  process.exit(1);
}

// a probe that exercises the storage shim from inside python, where the agents live
const PROBE = [
  'import json',
  'from agents.basic_agent import BasicAgent',
  'from utils.local_storage import AzureFileStorageManager',
  'class StorageProbeAgent(BasicAgent):',
  '    def __init__(self):',
  '        self.name = "StorageProbe"',
  '        self.metadata = {"name": "StorageProbe", "description": "Exercise the storage shim.",',
  '                         "parameters": {"type": "object", "properties": {}, "required": []}}',
  '        super().__init__(name=self.name, metadata=self.metadata)',
  '    def perform(self, **kwargs):',
  '        a = AzureFileStorageManager(); a.set_memory_context("alice-probe")',
  '        b = AzureFileStorageManager(); b.set_memory_context("bob-probe")',
  '        a.write_file("notes.txt", "alice private")',
  '        a.write_json({"secret": "alice memory"})',
  '        crafted = AzureFileStorageManager(); crafted.set_memory_context("../alice-probe")',
  '        out = {"same_name": b.read_file("notes.txt"),',
  '               "absolute": b.read_file("/memory/alice-probe/notes.txt"),',
  '               "dotdot": b.read_file("../alice-probe/notes.txt"),',
  '               "shared_prefix": b.read_file("shared_memoriesXX/../memory/alice-probe/notes.txt"),',
  '               "explicit_json": b.read_json("memory/alice-probe/user_memory.json"),',
  '               "crafted_guid": crafted.read_json(),',
  '               "absent_file": b.read_file("nothing-here.txt"),',
  '               "absent_json": b.read_json(),',
  '               "absent_delete": b.delete_file("nothing-here.txt"),',
  '               "absent_exists": b.file_exists("nothing-here.txt")}',
  '        b.write_json({"planted": True}, "memory/alice-probe/user_memory.json")',
  '        b.write_file("/memory/alice-probe/notes.txt", "bob was here")',
  '        out["alice_json_after"] = a.read_json()',
  '        out["alice_file_after"] = a.read_file("notes.txt")',
  '        out["alice_sees_own"] = sorted(a.list_files(""))',
  '        out["nameless_sees"] = sorted(AzureFileStorageManager().list_files(""))',
  '        return json.dumps(out)',
].join('\n');

// hands for the world agent. It reads window.__autodrive, and a page with no driver answers
// "no hands" before it reads a single number — which would make the numeric checks vacuous.
const STUB_HANDS = `(() => { const mk = () => ({
  people: () => [{ id: 'p1', name: 'mara', isAI: false }],
  orbs: () => [{ name: 'door', distance: 3 }],
  dialogue: () => [{ short: 'yes', text: 'yes, of course' }],
  snapshot: () => ({ me: { x: 0, y: 0, z: 0 }, world: 'House', portals: [], players: [], chat: [] }),
  look: async (dx, dy) => 'look ' + dx + ',' + dy,
  walk: async (d, ms) => 'walk ' + d + ' ' + ms,
  aim: async () => true, travel: async () => true, say: async () => true, tell: async () => true,
  see: async () => 'seen', scan: async (s, d) => 'scan ' + s + ' ' + d, wait: async (ms) => 'wait ' + ms });
  window.__autodrive = mk();
  const f = document.getElementById('f');
  if (f && f.contentWindow) f.contentWindow.__autodrive = mk();
})()`;

(async () => {
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1000, height: 700 } });
await ctx.route('https://kody-w.github.io/AINexus/**', r => { const u = new URL(r.request().url());
  const f = path.join(ROOT, decodeURIComponent(u.pathname).replace(/^\/AINexus/, ''));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.fulfill({ status: 404, body: 'no' });
  r.fulfill({ status: 200, contentType: T[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) }); });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('https://kody-w.github.io/AINexus/frontier.html', { timeout: 60000 });
await p.waitForTimeout(3000);
await p.evaluate(STUB_HANDS);

console.log('loading python (the ~10MB part)…');
const t0 = Date.now();
const st = await p.evaluate(async () => {
  await window.NexusBrainstem.initPyodide(() => {});
  return window.NexusBrainstem.status();
});
console.log('  ->', JSON.stringify(st.agents), '(' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');

const out = await p.evaluate(async ([hostile, tile, chat, regW, regA, probe]) => {
  const B = window.NexusBrainstem;
  const res = { crashes: [], nonstring: [], answers: {} };
  for (const [name, args, label] of hostile) {
    try {
      const r = await B.callAgent(name, args);
      if (typeof r !== 'string') res.nonstring.push(label + ' -> ' + typeof r);
      else res.answers[label] = r.slice(0, 400);
    } catch (e) { res.crashes.push(label + ' -> ' + String(e.message).split('\n').pop()); }
  }
  // purity: the same argument twice, byte for byte
  const twice = async (name, args) => [await B.callAgent(name, args), await B.callAgent(name, args)];
  res.pure = {};
  for (const [name, args] of [['LensGravity', { tile, g: 0.2 }], ['LensDayNight', { tile, hour: 'dusk' }],
                              ['LensCataclysm', { tile, degree: 2 }], ['ChatTile', { chat, about: 'the greenhouse' }],
                              ['WorldForge', { tile, registry: regW, key: 'the-greenhouse' }]]) {
    const [a, c] = await twice(name, args);
    res.pure[name] = { same: a === c, out: a };
  }
  // a whole slosh, and then an organism poured through what came out of it
  let t = await B.callAgent('LensGravity', { tile, g: 0.16 });
  t = await B.callAgent('LensDayNight', { tile: t, hour: 'night' });
  t = await B.callAgent('LensCataclysm', { tile: t, degree: 3 });
  res.sloshed = t;
  res.organism = await B.callAgent('Adapt', { organism: '{"traits":{}}', tile: t });
  // a float-bearing tile is something a model can hand a lens; nothing may come back a float
  res.fromFloats = await B.callAgent('Adapt', {
    organism: '{"traits":{"caution_milli":10.5}}',
    tile: '{"world":{"sight":1.5,"gravity_milli":200.5,"ruin":"cracked","ruin_degree":1.5}}' });
  // the chat-tile the forge is fed, and the creature it makes
  const chatTile = await B.callAgent('ChatTile', { chat, about: 'the greenhouse' });
  res.creature = await B.callAgent('OrganismForge', { tile: chatTile, registry: regA });
  res.creatureAgain = await B.callAgent('OrganismForge', { tile: chatTile, registry: regA });
  // RULE 2, through the schema a model is actually handed
  res.refusedWorld = await B.callAgent('WorldForge', { tile, registry: regW, key: 'tamper',
                                                       template_sha256: '0'.repeat(64) });
  res.schema = B.agentToolDefs().map(d => ({ name: d.function.name,
                                             props: Object.keys(d.function.parameters.properties || {}) }));
  try {
    await B.hotload(probe, { file: 'storage_probe_agent.py' });
    res.storage = JSON.parse(await B.callAgent('StorageProbe', {}));
  } catch (e) { res.storage = { error: e.message }; }
  return res;
}, [LABELLED, TILE, CHAT, REG_W, REG_A, PROBE]);

// every number in a frame is an exact integer, at every depth
const floatsIn = (o, at = '$') => {
  if (typeof o === 'number') return Number.isInteger(o) ? [] : [at];
  if (Array.isArray(o)) return o.flatMap((v, i) => floatsIn(v, at + '[' + i + ']'));
  if (o && typeof o === 'object') return Object.entries(o).flatMap(([k, v]) => floatsIn(v, at + '.' + k));
  return [];
};
const parse = (s) => { try { return JSON.parse(s); } catch (e) { return null; } };

console.log('\nthe schema each agent hands a model:');
for (const s of out.schema) console.log('  ', s.name.padEnd(15), s.props.join(', '));

console.log('\nchecks — the manifest is the truth:');
const declared = {};
for (const s of out.schema) declared[s.name] = new Set(s.props);
let undeclaredAll = [], unreadAll = [];
for (const name of Object.keys(FILE_OF)) {
  if (!declared[name]) continue;                 // not resident in this page: nothing to compare
  const read = paramsRead(FILE_OF[name]);
  const undeclared = [...read].filter(k => !declared[name].has(k));
  const unread = [...declared[name]].filter(k => !read.has(k));
  if (undeclared.length) undeclaredAll.push(name + ':' + undeclared.join('/'));
  if (unread.length) unreadAll.push(name + ':' + unread.join('/'));
}
ok('every parameter perform() reads is one the model is told about' + (undeclaredAll.length ? ' — ' + undeclaredAll.join(' ') : ''),
   undeclaredAll.length === 0);
ok('every parameter the model is told about is one perform() reads' + (unreadAll.length ? ' — ' + unreadAll.join(' ') : ''),
   unreadAll.length === 0);
ok('WorldForge declares the bytes it verifies, so its refusal is reachable at all',
   !!declared.WorldForge && declared.WorldForge.has('template_sha256'));
const refused = parse(out.refusedWorld);
ok('and a mismatched sha256 handed through that schema is REFUSED, not repaired',
   !!refused && refused.status === 'refused' && refused.generator === 'none');

console.log('\nchecks — it always answers:');
ok('nothing a model can send crashes an agent' + (out.crashes.length ? ' — ' + out.crashes.length + ': ' + out.crashes.slice(0, 4).join(' | ') : ' (' + HOSTILE.length + ' hostile calls)'),
   out.crashes.length === 0);
ok('and every answer is a string, which is the whole contract' + (out.nonstring.length ? ' — ' + out.nonstring.join(' | ') : ''),
   out.nonstring.length === 0);
// the answer to one particular call, found by what was in it
const said = (name, needle) => {
  const hit = Object.entries(out.answers).find(([k]) => k.startsWith(name + ' ') && k.includes(needle));
  return hit ? hit[1] : '(that call was never made)';
};
ok('a tile that is not a tile is told so in words', /not a tile/.test(said('LensGravity', '"tile":"[]"')));
ok('a gravity that is not a number is told so in words', /must be a number/.test(said('LensGravity', '"g":"abc"')));
ok('an action the hands do not have is refused by name', /no such action/.test(said('NexusWorld', '"action":"nonsense"')));
ok('a chat-tile whose shape is not a shape is refused as one, not crashed through',
   /not a chat-tile/.test(said('OrganismForge', '\\"shape\\":[]')));
ok('a world whose gravity is a WORD is poured through as an ordinary one, and recorded as a number',
   (() => { const o = parse(said('Adapt', 'low'));
            return !!o && o.traits.gait === 'ordinary' && Number.isInteger(o.shaped_by[0].gravity_milli); })());

console.log('\nchecks — the lenses are pure:');
for (const [name, r] of Object.entries(out.pure)) {
  ok(name + ' returns the same bytes for the same argument, twice', r.same === true);
}
ok('OrganismForge makes the same creature from the same conversation', out.creature === out.creatureAgain);
const fl = [];
for (const [what, blob] of [['a sloshed tile', out.sloshed], ['an organism poured through it', out.organism],
                            ['a creature forged from a chat', out.creature],
                            ...Object.entries(out.pure).map(([n, r]) => [n + "'s tile", r.out])]) {
  const bad = floatsIn(parse(blob));
  if (bad.length) fl.push(what + ' ' + bad.join(','));
}
ok('no lens emits a float — rapp/1 is I-JSON and a float will not hash' + (fl.length ? ' — ' + fl.join(' | ') : ''), fl.length === 0);
const ffl = floatsIn(parse(out.fromFloats));
ok('and a tile that ARRIVES carrying floats does not pour them into an organism' + (ffl.length ? ' — ' + ffl.join(',') : ''),
   ffl.length === 0);

console.log('\nchecks — a player\'s memory is its own:');
const s = out.storage || {};
console.log('  ', JSON.stringify(s).slice(0, 400));
ok('the storage probe ran inside python at all', !s.error);
ok('another player\'s plain filename is not another player\'s file', s.same_name !== 'alice private');
ok('a leading / does not address the whole store', s.absolute !== 'alice private');
ok('.. does not walk out of the namespace', s.dotdot !== 'alice private');
ok('a key merely PREFIXED by the shared path is not the shared path', s.shared_prefix !== 'alice private');
ok('read_json with an explicit path cannot read another player',
   JSON.stringify(s.explicit_json) !== JSON.stringify({ secret: 'alice memory' }));
ok('a guid built out of path characters cannot name another player\'s namespace',
   JSON.stringify(s.crafted_guid) !== JSON.stringify({ secret: 'alice memory' }));
ok('write_json with an explicit path cannot write into another player',
   JSON.stringify(s.alice_json_after) === JSON.stringify({ secret: 'alice memory' }));
ok('write_file through an absolute key cannot overwrite another player', s.alice_file_after === 'alice private');
ok('a player with no identity cannot enumerate everyone\'s namespaces',
   Array.isArray(s.nameless_sees) && !s.nameless_sees.some(k => String(k).includes('alice-probe')));
ok('and a player can still see its own', Array.isArray(s.alice_sees_own) && s.alice_sees_own.length >= 2);
ok('a read of something absent answers rather than throwing',
   s.absent_file === null && JSON.stringify(s.absent_json) === '{}'
   && s.absent_delete === false && s.absent_exists === false);

console.log('\nerrors:', errs.slice(0, 4));
ok('the page threw nothing', errs.length === 0);
console.log('\n' + pass + ' passed, ' + fail + ' failed');
await b.close();
process.exit(fail ? 1 : 0);
})();

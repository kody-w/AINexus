// Pyodide really loads and the grail's agents really run — a memory written and read back
// through Python. This used to print all of that and assert none of it, so it passed whether
// python came up or not. What it holds down now:
//
//   · the verbs offered to a model are WELL-FORMED tool schemas, and every one of them names a
//     verb the hands in the world frame actually have (VERBS is a hand-written table in
//     vbrainstem.js; the driver is a different file — they can drift, and a model offered a verb
//     that cannot be dispatched spends a whole turn on something that never happens)
//   · the module's own core list agrees with the agents it declares, and every one of them is
//     RESIDENT — not "loaded earlier", present at the instant of the call
//   · a memory written through Python comes back out of Python, from localStorage, byte for byte
//
// A missing agent is usually a stale fingerprint: hot-loading verifies each agent's bytes
// against state/agent_templates.json and refuses on mismatch. `python3 tools/check_registries.py`
// says so in one line. Fix the fingerprint — never the test.
//
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
let pass = 0, fail = 0;
const ok = (what, cond) => { console.log((cond ? '  ✓ ' : '  ✗ ') + what); cond ? pass++ : fail++; };

// The module's OWN statement of what must be there, read from the module rather than copied
// into this file — a list pasted here would go stale the first time an agent is added and then
// quietly assert last month's world.
const SRC = fs.readFileSync(path.join(ROOT, 'ai', 'vbrainstem.js'), 'utf8');
const between = (a, b) => { const i = SRC.indexOf(a), j = SRC.indexOf(b); return (i < 0 || j < 0 || j < i) ? '' : SRC.slice(i, j); };
const CORE = (between('const CORE_AGENTS', '// ── the ceiling').match(/'([A-Za-z~0-9]+)'/g) || []).map(s => s.slice(1, -1));
const DECLARED = [...between('const AGENTS = [', 'const CORE_AGENTS').matchAll(/className:\s*'([A-Za-z]+)'/g)]
  .map(m => m[1].replace(/Agent$/, ''));
const CONTENT = 'Met a person near Ebike World and agreed to travel together.';
const GUID = 'nexus-test';
const PRIM = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array']);

// One schema checker for both kinds of tool: a verb and an agent are the same shape to a model,
// and a malformed one is the same failure either way.
function malformed(defs) {
  const bad = [];
  const seen = new Set();
  for (const d of defs || []) {
    const n = d && d.function && d.function.name;
    const say = (why) => bad.push((n || '(unnamed)') + ': ' + why);
    if (!d || d.type !== 'function' || !d.function) { say('not a function tool'); continue; }
    if (typeof n !== 'string' || !n) { say('no name'); continue; }
    if (seen.has(n)) say('offered twice'); seen.add(n);
    if (typeof d.function.description !== 'string' || !d.function.description.trim()) say('no description');
    const par = d.function.parameters;
    if (!par || par.type !== 'object' || !par.properties || typeof par.properties !== 'object') { say('parameters are not an object schema'); continue; }
    for (const [k, v] of Object.entries(par.properties)) {
      if (!v || !PRIM.has(v.type)) say('property ' + k + ' has no usable type');
      if (typeof v.description !== 'string' || !v.description.trim()) say('property ' + k + ' is undescribed');
    }
    if (par.required !== undefined) {
      if (!Array.isArray(par.required)) say('required is not a list');
      else for (const r of par.required) if (!Object.prototype.hasOwnProperty.call(par.properties, r)) say('requires "' + r + '", which it does not offer');
    }
  }
  return bad;
}

(async () => {
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1280,height:820} });
await ctx.route('https://kody-w.github.io/AINexus/**', r => { const u=new URL(r.request().url());
  const f=path.join(ROOT, decodeURIComponent(u.pathname).replace(/^\/AINexus/,''));
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()) return r.fulfill({status:404,body:'no'});
  r.fulfill({status:200,contentType:T[path.extname(f)]||'application/octet-stream',body:fs.readFileSync(f)}); });
const p = await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('https://kody-w.github.io/AINexus/frontier.html',{timeout:60000});
await p.waitForTimeout(7000);
const inFrame = await p.evaluate(()=>!!document.getElementById('f').contentWindow.NexusBrainstem);
console.log('1. brainstem present in the world frame:', inFrame);
const defs = await p.evaluate(()=>document.getElementById('f').contentWindow.NexusBrainstem.verbToolDefs());
console.log('2. the world offers', defs.length, 'verbs as tools, e.g.');
console.log('  ', JSON.stringify(defs.find(d=>d.function.name==='world_travel') || null, null, 0));
const verbNames = (defs || []).map(d => d.function.name.replace(/^world_/, ''));
// the hands, in the world frame — the surface a person drives and the surface CALL dispatches to
const handless = await p.evaluate((names) => {
  const d = document.getElementById('f').contentWindow.__autodrive;
  if (!d) return null;
  return names.filter(n => typeof d[n] !== 'function');
}, verbNames);
console.log('   verbs the hands do not have:', handless === null ? 'driver not ready' : JSON.stringify(handless));
console.log('3. loading python (this is the ~10MB part)…');
const t0 = Date.now();
const st = await p.evaluate(async () => {
  const w = document.getElementById('f').contentWindow;
  await w.NexusBrainstem.initPyodide((...a)=>console.log(...a));
  return w.NexusBrainstem.status();
});
console.log('   ->', st, '(' + ((Date.now()-t0)/1000).toFixed(1) + 's)');
console.log('4. the agents are real python objects with real metadata:');
const adefs = await p.evaluate(()=>{ try { return document.getElementById('f').contentWindow.NexusBrainstem.agentToolDefs(); } catch(e){ return []; } });
console.log('  ', JSON.stringify(adefs.map(d=>({name:d.function.name, params:Object.keys(d.function.parameters.properties||{})}))));
console.log('5. actually RUN one in the browser (writes to localStorage, no server):');
const mem = await p.evaluate(async ([content, guid]) => {
  const w = document.getElementById('f').contentWindow;
  try {
    const wrote = await w.NexusBrainstem.callAgent('ManageMemory', {
      memory_type: 'episodic', content,
      importance: 7, tags: ['nexus','meeting'], user_guid: guid });
    const read  = await w.NexusBrainstem.callAgent('ContextMemory', { user_guid: guid, full_recall: true });
    const stored = Object.keys(w.localStorage).filter(k => /memory|rapp/i.test(k));
    return { wrote: String(wrote).slice(0,180), read: String(read).slice(0,300), localStorage_keys: stored };
  } catch (e) { return { error: e.message }; }
}, [CONTENT, GUID]);
console.log('  ', mem);

// ── what all of that has to be true for ──────────────────────────────────
const residentSet = new Set(st.agents || []);
const missing = CORE.filter(n => !residentSet.has(n));
const badVerbs = malformed(defs);
const badAgents = malformed(adefs);
const offered = new Set(adefs.map(d => d.function.name));
const mm = adefs.find(d => d.function.name === 'ManageMemory');
const cm = adefs.find(d => d.function.name === 'ContextMemory');
const props = (d) => Object.keys((d && d.function.parameters.properties) || {});

console.log('\nchecks:');
ok('the world frame carries a brainstem at all', inFrame === true);
ok('this test read the module\'s own agent list rather than a copy of it (' + CORE.length + ' core, ' + DECLARED.length + ' declared)',
   CORE.length >= 2 && DECLARED.length >= 2);
ok('the core list and the agents the module declares are the same set',
   CORE.length === DECLARED.length && CORE.every(n => DECLARED.includes(n)));

ok('the verbs are offered as tools at all', Array.isArray(defs) && defs.length > 0);
ok('every verb schema is well formed' + (badVerbs.length ? ' — ' + JSON.stringify(badVerbs) : ''), badVerbs.length === 0);
ok('travel takes the portal by name and requires it', (() => {
  const t = defs.find(d => d.function.name === 'world_travel');
  return !!t && t.function.parameters.properties.portal
      && t.function.parameters.properties.portal.type === 'string'
      && JSON.stringify(t.function.parameters.required) === JSON.stringify(['portal']);
})());
ok('the hands in the world frame are reachable from the page', handless !== null);
ok('every verb offered to a model is one the hands can actually do' + (handless && handless.length ? ' — ' + JSON.stringify(handless) : ''),
   Array.isArray(handless) && handless.length === 0);

ok('python actually loaded — not "running on verbs alone"',
   st.python === true && !/unavailable|verbs only/i.test(String(st.note)));
ok('every core agent is RESIDENT' + (missing.length ? ' — missing ' + JSON.stringify(missing) + ' (stale fingerprint? python3 tools/check_registries.py)' : ' (' + CORE.length + ' of ' + CORE.length + ')'),
   missing.length === 0);
ok('every resident agent is offered to the model, and nothing else is',
   offered.size === residentSet.size && [...residentSet].every(n => offered.has(n)));
ok('every agent schema is well formed' + (badAgents.length ? ' — ' + JSON.stringify(badAgents) : ''), badAgents.length === 0);
ok('the memory agents carry the parameters they are called with',
   props(mm).includes('memory_type') && props(mm).includes('content') && props(mm).includes('user_guid')
   && props(cm).includes('user_guid'));

ok('running an agent did not throw' + (mem.error ? ' — ' + mem.error : ''), !mem.error);
ok('the write reported a store, not a failure', !!mem.wrote && !/^(failed|error)/i.test(mem.wrote) && /stored/i.test(mem.wrote));
ok('what python wrote comes back out of python, word for word', String(mem.read).includes(CONTENT));
ok('and the answer names the user it was asked about', String(mem.read).includes(GUID));
ok('it landed in localStorage — no server was involved',
   (mem.localStorage_keys || []).some(k => k.includes(GUID)));

console.log('errors:', errs.slice(0,4));
ok('the page threw nothing', errs.length === 0);
console.log('\n' + pass + ' passed, ' + fail + ' failed');
await b.close();
process.exit(fail ? 1 : 0);
})();

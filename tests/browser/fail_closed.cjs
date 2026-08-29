// THE THREE DOORS THAT WERE MADE TO FAIL CLOSED, DRIVEN THROUGH EVERY WAY A NETWORK ACTUALLY
// FAILS — not only the way that is easy to simulate. A check that refuses when it cannot verify
// is right; a check that refuses FOREVER after one bad second has quietly traded a capability
// for a property nobody can see. This suite exists to tell those two apart.
//
// The three doors:
//   1. ai/vbrainstem.js  — a hot-load refuses when state/agent_templates.json cannot be READ,
//                          not merely when a hash mismatches.
//   2. autodrive.html    — program verification routes through ai/frames.js, a <script> in the
//                          head, so a page that lost that one file can run no program at all.
//   3. ai/copilot_auth.js— the Copilot endpoint is allowlisted to *.githubcopilot.com, so an
//                          address GitHub itself sends is discarded if it is not on the list.
//
// Every dependency is failed as a 500, a 404, a connection reset, a 200 carrying truncated
// bytes, a 200 carrying HTML, a 200 carrying valid JSON of the wrong shape, and an answer that
// arrives long after anyone was still waiting for it. For each: does it refuse, does it SAY
// which thing failed, and — the question this suite was written for — does the capability come
// back when the problem goes away, or is it gone until reload?
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
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
            '.jsonl': 'application/json', '.css': 'text/css', '.py': 'text/plain', '.webp': 'image/webp' };

const TEMPLATES = 'state/agent_templates.json';
const CHAIN = 'ai/programs/PROGRAMS.chain.jsonl';

// what the server is doing to a given file right now, and how many times it was asked
const broken = {};                 // rel -> mode
const asked = {};                  // rel -> count
const bump = (rel) => { asked[rel] = (asked[rel] || 0) + 1; return asked[rel]; };
const since = {};                  // rel -> count at the last mark
const mark = (rel) => { since[rel] = asked[rel] || 0; };
const fetchesSinceMark = (rel) => (asked[rel] || 0) - (since[rel] || 0);

function serveFile(route, rel) {
  const f = path.join(ROOT, rel);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    return route.fulfill({ status: 404, body: 'no' });
  }
  return route.fulfill({ status: 200, contentType: T[path.extname(f)] || 'application/octet-stream',
                         body: fs.readFileSync(f) });
}

async function applyMode(route, rel, mode) {
  switch (mode) {
    case '500':   return route.fulfill({ status: 500, contentType: 'text/plain', body: 'boom' });
    case '404':   return route.fulfill({ status: 404, contentType: 'text/html',
                                         body: '<!DOCTYPE html><title>404</title><h1>not found</h1>' });
    case 'reset': return route.abort('connectionreset');
    case 'trunc': return route.fulfill({ status: 200, contentType: T[path.extname(rel)] || 'text/plain',
                                         body: String(fs.readFileSync(path.join(ROOT, rel))).slice(0, 300) });
    case 'html':  return route.fulfill({ status: 200, contentType: 'text/html',
                                         body: '<!doctype html><title>hello</title><p>this is not the file you asked for' });
    case 'shape': return route.fulfill({ status: 200, contentType: 'application/json',
                                         body: JSON.stringify({ schema: 'nexus-agent-templates/1', count: 0 }) });
    // accepted, then silence: the answer turns up long after anyone was waiting for it
    case 'slow':  await new Promise(r => setTimeout(r, 11000)); return serveFile(route, rel);
    // a good answer, just not an instant one — long enough for a second asker to arrive
    case 'lag':   await new Promise(r => setTimeout(r, 1500));  return serveFile(route, rel);
    default:      return serveFile(route, rel);
  }
}

// a URL-shaped hot-load of a file that IS published in the registry, so the only thing that can
// stop it is the registry itself
const PROBE_AGENT = 'https://kody-w.github.io/AINexus/ai/vb/adapt_agent.py';

let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
// A HANG MUST FAIL, NOT WAIT. The worst defect this suite found was a deadlock, and a suite that
// hangs on it reports nothing at all — which in CI is indistinguishable from a slow machine.
const within = (ms, label, work) => Promise.race([work,
  new Promise((_, rej) => setTimeout(() => rej(new Error('TIMED OUT after ' + (ms / 1000) + 's — ' + label)), ms))]);

(async () => {
const b = await chromium.launch();
// ONE context, so the 10MB Pyodide download is paid once and both python pages share the cache
const ctx = await b.newContext({ viewport: { width: 1000, height: 700 } });
await ctx.route('https://kody-w.github.io/AINexus/**', async r => {
  const rel = decodeURIComponent(new URL(r.request().url()).pathname).replace(/^\/AINexus\//, '');
  bump(rel);
  // a slow answer is fulfilled long after the page gave up on it; that fulfil is allowed to fail
  try { return await applyMode(r, rel, broken[rel]); } catch (e) { return; }
});
// the raw.githubusercontent mirror is somebody else's server; block it so the LOCAL fallback in
// autodrive's fetchEither is the one under test rather than the network's mood
await ctx.route('https://raw.githubusercontent.com/**', r => r.abort('connectionfailed'));

const wire = async (p) => {
  await p.exposeFunction('__break', (rel, mode) => { if (mode) broken[rel] = mode; else delete broken[rel]; });
  await p.exposeFunction('__mark', (rel) => { mark(rel); });
  await p.exposeFunction('__fetches', (rel) => fetchesSinceMark(rel));
};

// ══ 1. the published fingerprint list, failed every way ═════════════════════════════════════
console.log('\n── 1. state/agent_templates.json under every failure a network has ──');
// THE LIST IS DOWN BEFORE THE PAGE OPENS. A list that parsed once is cached for the life of the
// page and never fetched again — which is right, and which means a page that booted healthy can
// never exercise a single one of these failure modes. It also puts the boot in the exact state
// that used to deadlock: no python agent loaded at all when the local-agent loop starts.
broken[TEMPLATES] = '500';
const p1 = await ctx.newPage();
const errs1 = []; p1.on('pageerror', e => errs1.push(e.message));
await wire(p1);
await p1.goto('https://kody-w.github.io/AINexus/frontier.html', { timeout: 90000 });
await p1.waitForTimeout(1500);

const one = await within(180000, 'the brainstem never finished booting', p1.evaluate(async () => {
  const B = window.NexusBrainstem, out = { modes: {}, log: [] };
  const log = (...a) => out.log.push(a.join(' '));
  window.__autodrive = { people: () => [], orbs: () => [], say: async () => true };
  await B.initPyodide(log);
  out.booted = B.status().python;
  out.readyAgents = B.status().agents.slice();
  out.note = B.status().note;

  const AGENT = 'https://kody-w.github.io/AINexus/ai/vb/adapt_agent.py';
  const probe = async () => {
    // a fresh file name every time, so a previous success can never be what is being observed
    const file = 'adapt_agent.py';
    try { const r = await B.hotload(AGENT, { className: 'AdaptAgent', file, log }); return 'LOADED:' + r.name; }
    catch (e) { return e.message; }
  };
  // ORDER MATTERS. A list that parsed is never re-fetched, so the healthy run has to come last;
  // and the fetch COUNT per mode is what proves the door is still retryable rather than latched.
  for (const mode of ['500', '404', 'reset', 'trunc', 'html', 'slow', 'shape']) {
    await window.__mark('state/agent_templates.json');
    await window.__break('state/agent_templates.json', mode);
    const said = await probe();
    await window.__break('state/agent_templates.json', null);
    out.modes[mode] = { said, fetched: await window.__fetches('state/agent_templates.json') };
  }
  // TWO ASKERS, ONE FETCH. Inside `queued` the lane is already held, so hot-loads called from
  // there run directly rather than queueing — which is how two of them really do overlap in a
  // turn. The second used to read the pessimism the first raised on its way in and refuse.
  await window.__mark('state/agent_templates.json');
  await window.__break('state/agent_templates.json', 'lag');
  out.concurrent = {
    said: await B.queued(async () => Promise.all([
      B.hotload(AGENT, { className: 'AdaptAgent', file: 'adapt_agent.py' })
        .then(r => 'LOADED:' + r.name, e => e.message),
      B.hotload('https://kody-w.github.io/AINexus/ai/vb/lens_gravity_agent.py',
                { className: 'LensGravityAgent', file: 'lens_gravity_agent.py' })
        .then(r => 'LOADED:' + r.name, e => e.message),
    ])),
    fetched: await window.__fetches('state/agent_templates.json'),
  };
  await window.__break('state/agent_templates.json', null);
  await window.__mark('state/agent_templates.json');
  out.healthy = { said: await probe(), fetched: await window.__fetches('state/agent_templates.json') };
  // and a real mismatch must still be a mismatch, not a "could not read"
  out.mismatch = await (async () => {
    try { await B.hotload(AGENT, { className: 'AdaptAgent', file: 'adapt_agent.py', sha256: 'f'.repeat(64), log });
          return 'LOADED'; } catch (e) { return e.message; }
  })();
  return out;
})).catch(e => { console.log('  ✗ ' + e.message); fail++; return null; });
if (!one) { console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); await b.close(); process.exit(1); }
console.log('booted          :', one.booted, '· agents:', JSON.stringify(one.readyAgents));
for (const [m, v] of Object.entries(one.modes)) {
  console.log(('  ' + m + '        ').slice(0, 10) + '(' + v.fetched + ' fetch) ' + String(v.said).slice(0, 96));
}
console.log('  overlap   (' + one.concurrent.fetched + ' fetch) ' + JSON.stringify(one.concurrent.said));
console.log('  healthy   (' + one.healthy.fetched + ' fetch) ' + String(one.healthy.said).slice(0, 96));
console.log('  bad sha   ' + String(one.mismatch).slice(0, 96));
console.log('\nchecks:');
const refused = (m) => /REFUSED/.test(String(one.modes[m].said));
// raw.githubusercontent.com is blocked for the whole of this suite on purpose: nobody's test
// should depend on somebody else's server, and a page that cannot reach the grail is an ordinary
// Tuesday for a visitor behind a proxy. It used to be a deadlock — initPyodide hot-loads the
// local agents, hotload asks initPyodide for the runtime, and with NOTHING loaded from the grail
// first that question was answered with the still-pending boot promise, so the boot waited for
// itself and the page said "loading agents…" until the tab closed.
ok('the brainstem finishes booting with NOTHING loaded — this used to deadlock', one.booted === true);
ok('a 500 on the fingerprint list refuses the load', refused('500'));
ok('a 404 refuses it', refused('404'));
ok('a connection reset mid-request refuses it', refused('reset'));
ok('a 200 carrying truncated JSON refuses it', refused('trunc'));
ok('a 200 carrying HTML refuses it', refused('html'));
ok('an answer that never arrives is given up on rather than waited for forever',
   refused('slow') && !/LOADED/.test(String(one.modes.slow.said)));
ok('a 200 of valid JSON that is not the registry is IGNORANCE, not an empty allowlist',
   refused('shape'));
ok('the refusal names the fingerprint list, so a person knows WHAT failed',
   Object.keys(one.modes).every(m => /fingerprint list/.test(String(one.modes[m].said))));
ok('every failure mode re-fetched the list: not one of them latched',
   Object.values(one.modes).every(v => v.fetched >= 1));
ok('and the very next load, once the file is back, works — no reload, no latch',
   one.concurrent.said.every(x => /^LOADED:/.test(String(x))));
ok('two hot-loads overlapping the ONE fetch both get its answer, not a refusal invented in flight',
   one.concurrent.fetched === 1 && one.concurrent.said.every(x => /^LOADED:/.test(String(x))));
ok('and a list that parsed is never read again', /^LOADED:/.test(String(one.healthy.said)) && one.healthy.fetched === 0);
ok('a genuine hash mismatch is still reported as a mismatch, not as an unreadable list',
   /does not match its published sha256/.test(String(one.mismatch)));

// ══ 2. THE LATCH: one bad second during boot, and what is gone afterwards ════════════════════
console.log('\n── 2. the list is down for the two seconds the page boots ──');
broken[TEMPLATES] = '500';
const p2 = await ctx.newPage();
const errs2 = []; p2.on('pageerror', e => errs2.push(e.message));
await wire(p2);
await p2.goto('https://kody-w.github.io/AINexus/frontier.html', { timeout: 90000 });
const two = await within(180000, 'the brainstem never finished booting with the list down', p2.evaluate(async () => {
  const B = window.NexusBrainstem, out = { log: [] };
  const log = (...a) => out.log.push(a.join(' '));
  window.__autodrive = { people: () => [], orbs: () => [], say: async () => true };
  await B.initPyodide(log);                       // the whole boot happens with the list down
  out.afterBoot = B.status().agents.slice();
  out.note = B.status().note;
  await window.__break('state/agent_templates.json', null);      // the outage is over
  out.afterReinit = await B.initPyodide(log).then(() => B.status().agents.slice());
  const CORE = ['NexusWorld', 'LensGravity', 'LensDayNight', 'LensCataclysm',
                'Adapt', 'WorldForge', 'ChatTile', 'OrganismForge'];
  out.residency = await B.ensureResident(CORE, log);
  out.afterResidency = B.status().agents.slice();
  out.sourceOfWorld = B.sourceOf('NexusWorld');
  // and the world agent must actually WORK once it is back, not merely be named
  try {
    window.__autodrive.people = () => [{ id: 'peer-1', name: 'Ada', isAI: false }];
    out.used = String(await B.callAgent('NexusWorld', { action: 'people' })).slice(0, 80);
  } catch (e) { out.used = 'THREW ' + e.message; }
  return out;
})).catch(e => { console.log('  ✗ ' + e.message); fail++; return null; });
if (!two) { console.log('\n' + pass + ' passed, ' + fail + ' failed'); await b.close(); process.exit(1); }
console.log('agents after a boot with the list down :', JSON.stringify(two.afterBoot));
console.log('status note                            :', two.note);
console.log('after calling initPyodide again        :', JSON.stringify(two.afterReinit));
console.log('after one residency pass               :', JSON.stringify(two.afterResidency));
console.log('ensureResident reported                :', JSON.stringify(two.residency));
console.log('sourceOf("NexusWorld")                 :', JSON.stringify(two.sourceOfWorld));
console.log('calling the world agent                :', two.used);
console.log('\nchecks:');
ok('the outage really did cost the eight local agents at boot',
   !two.afterBoot.includes('NexusWorld') && !two.afterBoot.includes('WorldForge'));
ok('the loading note SAYS what it is short of instead of reading like a clean start',
   /refused/i.test(String(two.note)) && /NexusWorld/.test(String(two.note)));
ok('where a refused agent came from is remembered, so something can go back for it',
   !!(two.sourceOfWorld && two.sourceOfWorld.what));
ok('one residency pass — which every turn already does — brings all eight back',
   two.residency.missing.length === 0 && two.residency.resident.length === 8);
ok('the world agent is not merely named again, it answers',
   /peer-1/.test(String(two.used)));
ok('nothing threw on the page while all that happened', errs1.length === 0 && errs2.length === 0);
if (errs1.length || errs2.length) console.log('  page errors:', errs1.concat(errs2).slice(0, 3));

// ══ 3. autodrive: the new hard dependency on a <script> tag ══════════════════════════════════
console.log('\n── 3. autodrive.html when ai/frames.js is not there ──');
broken['ai/frames.js'] = '500';
const p3 = await ctx.newPage();
const errs3 = []; p3.on('pageerror', e => errs3.push(e.message));
await wire(p3);
await p3.goto('https://kody-w.github.io/AINexus/autodrive.html', { timeout: 60000 });
const three = await p3.evaluate(async () => {
  const out = {};
  out.moduleAtLoad = !!window.NexusFrames;
  const run = async () => { try { const l = await loadProgram('wanderer'); return 'LOADED via ' + l.via; }
                            catch (e) { return e.message; } };
  out.whileDown = await run();
  await window.__break('ai/frames.js', null);                  // the file is back
  out.afterItReturns = await run();
  // and the other ways that one script tag can come back wrong
  await window.__break('ai/frames.js', 'html');
  out.servedAsHtml = await (async () => { delete window.NexusFrames; return run(); })();
  await window.__break('ai/frames.js', null);
  out.afterHtml = await (async () => { return run(); })();
  return out;
});
console.log('NexusFrames present at load :', three.moduleAtLoad);
console.log('a program while it is down  :', String(three.whileDown).slice(0, 110));
console.log('once the file is back       :', String(three.afterItReturns).slice(0, 110));
console.log('served as text/html         :', String(three.servedAsHtml).slice(0, 110));
console.log('and back again              :', String(three.afterHtml).slice(0, 110));
console.log('\nchecks:');
ok('a missing ai/frames.js refuses every program rather than verifying with a weaker copy',
   !three.moduleAtLoad && /frames\.js/.test(String(three.whileDown)) && !/LOADED/.test(String(three.whileDown)));
ok('and the refusal names the file, not "undefined is not a function"',
   /ai\/frames\.js/.test(String(three.whileDown)));
ok('THE CAPABILITY COMES BACK when the file does — no reload of the tower',
   /^LOADED/.test(String(three.afterItReturns)));
ok('a 200 of HTML where the module should be is refused, not executed',
   !/LOADED/.test(String(three.servedAsHtml)) && /frames\.js/.test(String(three.servedAsHtml)));
ok('and that failure does not latch either', /^LOADED/.test(String(three.afterHtml)));

// ══ 4. autodrive: the chain and the program bytes ═══════════════════════════════════════════
console.log('\n── 4. autodrive.html when the chain or the program cannot be read ──');
const four = await p3.evaluate(async () => {
  const out = {};
  const t = async (rel, mode) => {
    await window.__break(rel, mode);
    let said; try { await loadProgram('wanderer'); said = 'LOADED'; } catch (e) { said = e.message; }
    await window.__break(rel, null);
    return said;
  };
  out.chain500  = await t('ai/programs/PROGRAMS.chain.jsonl', '500');
  out.chain404  = await t('ai/programs/PROGRAMS.chain.jsonl', '404');
  out.chainHtml = await t('ai/programs/PROGRAMS.chain.jsonl', 'html');
  out.chainTrunc= await t('ai/programs/PROGRAMS.chain.jsonl', 'trunc');
  out.chainReset= await t('ai/programs/PROGRAMS.chain.jsonl', 'reset');
  out.prog404   = await t('ai/programs/wanderer.json', '404');
  out.progTrunc = await t('ai/programs/wanderer.json', 'trunc');
  try { const l = await loadProgram('wanderer'); out.after = 'LOADED via ' + l.via; }
  catch (e) { out.after = e.message; }
  return out;
});
for (const [k, v] of Object.entries(four)) console.log(('  ' + k + '            ').slice(0, 14) + ': ' + String(v).slice(0, 100));
console.log('\nchecks:');
const chainCases = ['chain500', 'chain404', 'chainHtml', 'chainTrunc', 'chainReset'];
ok('no program runs on a chain that could not be read', chainCases.every(k => !/LOADED/.test(String(four[k]))));
ok('and the error NAMES the chain file rather than being a raw JSON parse error',
   chainCases.every(k => /PROGRAMS\.chain\.jsonl/.test(String(four[k]))));
ok('a missing program file is reported as missing, not accused of failing its seal',
   /wanderer\.json/.test(String(four.prog404)) && !/does not match its sealed hash/.test(String(four.prog404)));
ok('but bytes that really do differ from the seal are still a seal failure',
   /does not match its sealed hash/.test(String(four.progTrunc)));
ok('and every one of those recovers the moment the file is readable again',
   /^LOADED/.test(String(four.after)));
// Chrome executes a `text/html` body served to a <script src> and it dies in the parser — that
// SyntaxError is the sabotage doing its job. What matters is that the TOWER did not throw.
ok('the only thing that threw was the corrupt script itself, never the tower',
   errs3.every(m => /Unexpected token/.test(m)));
if (errs3.length) console.log('  page errors:', errs3.slice(0, 3));

// ══ 5. the Copilot endpoint allowlist ═══════════════════════════════════════════════════════
console.log('\n── 5. ai/copilot_auth.js: which addresses a seat may be posted to ──');
const p5 = await ctx.newPage();
const warns = [];
p5.on('console', m => { if (m.type() === 'warning') warns.push(m.text()); });
await p5.goto('https://kody-w.github.io/AINexus/frontier.html', { timeout: 60000 });
const five = await p5.evaluate(async () => {
  const A = window.NexusAuth, S = A.STORAGE_KEY, seen = {};
  const put = (h) => { localStorage.setItem(S, JSON.stringify({ copilotEndpoint: h }));
                       return decodeURIComponent((A.chatUrl().split('endpoint=')[1] || '')); };
  const HOSTS = ['https://api.individual.githubcopilot.com', 'https://api.business.githubcopilot.com',
                 'https://api.enterprise.githubcopilot.com', 'https://api.githubcopilot.com',
                 'https://githubcopilot.com/v1', 'https://copilot-proxy.githubusercontent.com',
                 'https://api.github.com', 'https://proxy.enterprise.githubcopilot.com.evil.io',
                 'http://api.githubcopilot.com', 'https://user:pw@evil.io/api.githubcopilot.com',
                 '//api.githubcopilot.com', 'not a url at all'];
  for (const h of HOSTS) seen[h] = put(h);
  // a refusal must not poison the next good answer
  put('https://evil.io');
  const afterBad = put('https://api.business.githubcopilot.com');
  localStorage.removeItem(S);
  return { seen, afterBad, def: A.COPILOT_DEFAULT_API };
});
await p5.waitForTimeout(300);          // console events arrive after the evaluate returns
for (const [k, v] of Object.entries(five.seen)) console.log(('  ' + k + '                                                  ').slice(0, 56) + '-> ' + v);
console.log('a good endpoint straight after a refused one :', five.afterBad);
console.log('warnings the page produced                   :', JSON.stringify(warns.filter(w => /copilot endpoint/i.test(w)).slice(0, 4)));
console.log('\nchecks:');
const kept = (h) => five.seen[h] === h.replace(/\/+$/, '');
ok('the four hosts GitHub actually serves Copilot from all pass',
   kept('https://api.individual.githubcopilot.com') && kept('https://api.business.githubcopilot.com')
   && kept('https://api.enterprise.githubcopilot.com') && kept('https://api.githubcopilot.com'));
ok('a lookalike host is refused', five.seen['https://proxy.enterprise.githubcopilot.com.evil.io'] === five.def);
ok('plain http is refused, and so is a host smuggled in front of the path',
   five.seen['http://api.githubcopilot.com'] === five.def
   && five.seen['https://user:pw@evil.io/api.githubcopilot.com'] === five.def);
ok('a string that is not a URL falls back rather than throwing', five.seen['not a url at all'] === five.def);
ok('refusing an endpoint does not latch — the next good one is honoured',
   five.afterBad === 'https://api.business.githubcopilot.com');
ok('AND THE SUBSTITUTION IS SAID OUT LOUD: a GitHub host not on the list is not swapped in silence',
   warns.some(w => /copilot endpoint/i.test(w) && /githubusercontent/.test(w)));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await b.close();
process.exit(fail ? 1 : 0);
})();

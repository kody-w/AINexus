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

// ── the eyes and the reasons are opt-in, and the default is byte-for-byte what it was ──
const eyes = await p.evaluate(async () => {
  const seen = [];
  const mind = { signedIn: () => true, isScripted: true, chat: async (messages, opts) => {
    seen.push({ messages: JSON.parse(JSON.stringify(messages)), tools: JSON.parse(JSON.stringify(opts.tools)) });
    return { content: 'over there.', tool_calls: [
      { id: 'w1', function: { name: 'world_walk', arguments: '{"dir":"forward","ms":700,"why":"the portal is ahead"}' } }] };
  } };
  const walked = [];
  const drive = { walk: async (dir, ms) => { walked.push([dir, ms]); return true; },
                  snapshot: () => ({ chat: [] }), people: () => [], orbs: () => [] };
  const pixel = 'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAQAcJaQAA3AA/v3AgAA=';
  const plain = await window.NexusBrainstem.turn({ percepts: { me: {} }, python: false, rounds: 1, drive, mind });
  const rich = await window.NexusBrainstem.turn({ percepts: { me: {} }, python: false, rounds: 1, drive, mind,
                                                  image: pixel, explain: true });
  const smuggled = await window.NexusBrainstem.turn({ percepts: { me: {} }, python: false, rounds: 1, drive, mind,
                                                      image: 'https://example.invalid/tracker.png' });
  const whyIn = (s) => s.tools.filter(t => t.function.name.indexOf('world_') === 0)
                              .every(t => 'why' in t.function.parameters.properties);
  return {
    plainContentIsText: typeof seen[0].messages[1].content === 'string',
    plainHasNoWhy: !seen[0].tools.some(t => 'why' in ((t.function.parameters || {}).properties || {})),
    plainSystem: seen[0].messages[0].content,
    richParts: Array.isArray(seen[1].messages[1].content) ? seen[1].messages[1].content.map(x => x.type) : null,
    richImage: Array.isArray(seen[1].messages[1].content) ? seen[1].messages[1].content[1].image_url.url === pixel : false,
    richWhy: whyIn(seen[1]),
    richSystemTells: /exactly what your eyes see/.test(seen[1].messages[0].content) && /short why/.test(seen[1].messages[0].content),
    keptWhy: rich.calls[0] && rich.calls[0].args.why,
    walked,
    smuggledIsText: typeof seen[2].messages[1].content === 'string' && !JSON.stringify(seen[2].messages).includes('example.invalid'),
  };
});
say('without image or explain, the request is exactly what it always was',
  eyes.plainContentIsText && eyes.plainHasNoWhy && !/eyes see|short why/.test(eyes.plainSystem));
say('with an image, the model is shown the picture beside the percepts',
  JSON.stringify(eyes.richParts) === '["text","image_url"]' && eyes.richImage && eyes.richSystemTells);
say('with explain, every verb offers a why, the record keeps it, and the hands never see it',
  eyes.richWhy && eyes.keptWhy === 'the portal is ahead' && JSON.stringify(eyes.walked[1]) === '["forward",700]');
say('an image that is not a data: picture is never sent anywhere', eyes.smuggledIsText);

// ── a mind may be given only some verbs: the rest are neither offered nor done ──
const given = await p.evaluate(async () => {
  let offered = null;
  const mind = { signedIn: () => true, isScripted: true, chat: async (messages, opts) => {
    offered = opts.tools.map(t => t.function.name).filter(n => n.indexOf('world_') === 0);
    return { content: '', tool_calls: [
      { id: 't1', function: { name: 'world_travel', arguments: '{"portal":"Crystal"}' } },
      { id: 't2', function: { name: 'world_look', arguments: '{"dx":40}' } }] };
  } };
  const done = [];
  const drive = { travel: async (p) => { done.push(['travel', p]); return true; },
                  look: async (dx) => { done.push(['look', dx]); return true; },
                  snapshot: () => ({ chat: [] }), people: () => [], orbs: () => [] };
  const r = await window.NexusBrainstem.turn({ percepts: { me: {} }, python: false, rounds: 1, drive, mind,
                                               verbs: ['look', 'say'] });
  return { offered, done, calls: r.calls.map(c => ({ tool: c.tool, failed: c.failed, result: c.result })) };
});
const routines = await p.evaluate(async () => {
  const offered = [];
  const mind = { signedIn: () => true, isScripted: true, chat: async (messages, opts) => {
    offered.push(opts.tools.map(t => t.function.name));
    return { content: '', tool_calls: [{ id: 'r1', function: { name: 'world_routine',
      arguments: '{"steps":[{"do":"wait","ms":900}],"why":"stay a while"}' } }] };
  } };
  const kept = [];
  const drive = { routine: async (steps) => { kept.push(steps); return 'routine set'; },
                  snapshot: () => ({ chat: [] }), people: () => [], orbs: () => [] };
  const plain = await window.NexusBrainstem.turn({ percepts: {}, python: false, rounds: 1, drive, mind });
  const given = await window.NexusBrainstem.turn({ percepts: {}, python: false, rounds: 1, drive, mind,
                                                   verbs: ['look', 'routine'] });
  return { offered, kept, plain: plain.calls[0], given: given.calls[0] };
});
say('a routine is offered only to a mind given it by name, and goes to the hands that keep one',
  !routines.offered[0].includes('world_routine') && routines.offered[1].includes('world_routine') &&
  routines.kept.length === 2 && routines.given.failed === false && /routine set/.test(routines.given.result));
say('a mind given only some verbs is offered only those, and a verb it was not given is refused and never done',
  JSON.stringify(given.offered) === '["world_look","world_say"]' &&
  JSON.stringify(given.done) === '[["look",40]]' &&
  given.calls[0].failed === true && /not allowed here: travel/.test(given.calls[0].result) && given.calls[1].failed === false);
console.log('\nnot exported:', await p.evaluate(()=>({ getToken: typeof window.NexusAuth?.getToken })));
console.log('errors:', errs.slice(0,3));
await b.close();
})();

// The other direction from frames_conformance.cjs. That suite proves the door REFUSES what the
// spec says to refuse; this one proves the door still ADMITS what an ordinary evening in this
// world actually hands it — a sentence with an emoji in it, a name in Japanese, a real coordinate,
// a session that ran long, a tick that went wrong.
//
// A verifier is easy to make strict and hard to make right. Every refusal added to frames.js is a
// promise that no honest input trips it, and that promise is not kept by reading the diff: the
// published vectors still reproducing says nothing about live data, because the published vectors
// are the inputs somebody already thought of. So this drives the REAL seal path — a player, a
// mind, a tick, a frame — with the kind of text people type.
//
// It also holds the seam a scripted mind opened. A mind is a contract, so `mind` threads through
// turn(), join(), live(), summon() and lines(); the risk in adding an optional path is that the
// DEFAULT one moved while nobody was looking. So the no-mind path is pinned here — same refusal,
// same resolution, same charge — and so is the accounting, because a scripted mind that could be
// mistaken for a paid one, or a paid one mistaken for free, would silently uncap a visitor's spend.
//
// Two defects this found, both since fixed:
//   · an error message cut at 200 UTF-16 units mid-emoji left a lone surrogate, §4 refused the
//     frame, and the tick that went wrong was once again the tick with no record
//   · every frame the tick loop sealed named nobody, so wear() — which now refuses to fall back to
//     whoever is in this tab — could not carve a tile from any real record, only from a hand-built one
//   · lines() and summon() took a beat out of an NPC's scene on the way past, so a character asked
//     for dialogue options skipped one of its own lines
const { createRequire } = require('module');
const _req=(()=>{for(const b of [process.env.PLAYWRIGHT_DIR, require('path').join(process.env.HOME||'','Documents/GitHub/aaa-fps')]){
 if(!b)continue; try{const r=createRequire(require('path').join(b,'package.json'));r.resolve('playwright');return r;}catch(e){}}return require;})();
const { chromium } = _req('playwright');
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..','..');
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.py':'text/plain'};
let pass=0,fail=0;
const ok=(n,c)=>{console.log((c?'  ✓ ':'  ✗ ')+n); c?pass++:fail++;};
(async()=>{
const b=await chromium.launch(); const ctx=await b.newContext();
await ctx.route('https://kody-w.github.io/AINexus/**',r=>{const u=new URL(r.request().url());
 const f=path.join(ROOT,decodeURIComponent(u.pathname).replace(/^\/AINexus/,''));
 if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory())return r.fulfill({status:404,body:'no'});
 r.fulfill({status:200,contentType:T[path.extname(f)]||'application/octet-stream',body:fs.readFileSync(f)});});
// NOTHING may reach a model endpoint. If anything does, this test is lying about what it proved.
let bought = 0;
await ctx.route('https://**/chat/completions*', r => { bought++; r.abort(); });
await ctx.route('https://rapp-auth.kwildfeuer.workers.dev/**', r => { bought++; r.abort(); });
const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('https://kody-w.github.io/AINexus/frontier.html',{timeout:60000});
await p.waitForFunction(()=>window.NexusHerd&&window.NexusFrames&&window.NexusMind,null,{timeout:45000});

const out = await p.evaluate(async () => {
  const H = window.NexusHerd, F = window.NexusFrames, M = window.NexusMind, B = window.NexusBrainstem;
  const R = {};
  const mkDrive = (over) => Object.assign({
    snapshot: () => ({ me: { x: 1.2345, y: 1.6, z: -8.7654 }, world: 'Frontier', room: 'r',
                       portals: [{ name: 'Ebike World' }], players: [], chat: [] }),
    people: () => [], orbs: () => [], dialogue: () => [],
    look: async () => true, walk: async () => true, travel: async () => true,
    say: async () => true, tell: async () => true, aim: async () => true, place: () => {},
  }, over || {});

  // ── 1. what people actually type ────────────────────────────────────────
  // Emoji, CJK, right-to-left, combining marks, a pasted astral character, a ZWJ family, a flag
  // and a skin tone. Every one of these is a WELL-FORMED string; §4 only refuses broken ones, and
  // the distinction has to hold on real input or the rule is unusable.
  const SAID = [
    'nice place 😀🔥 — see you at the door 🚪',
    'こんにちは、世界。ここは静かですね。',
    'مرحبا بالعالم · שלום עולם',
    'café naïve résumé — é is not é, and both are fine',
    'the set \u{1D54F} of all worlds 👨‍👩‍👧‍👦 🇯🇵 👍🏽',
  ];
  const talker = M.scripted(SAID.map(s => ({ say: s, do: [{ verb: 'say', args: { text: s } }], then: s })));
  await H.join({ id: 'talker', drive: mkDrive(), mind: talker, python: false });
  const said = [];
  for (let i = 0; i < SAID.length; i++) said.push(await H.serve('talker', { python: false }));
  const talkLine = String(H.chainOf('talker') || '').trim();
  const talkFrames = talkLine ? talkLine.split('\n').map(JSON.parse) : [];
  R.everyday = {
    sealed: said.every(e => !!e.frame), sealFailed: said.map(e => e.sealFailed || null).filter(Boolean),
    back: talkFrames.map(f => f.payload.asserts.said),
    at: talkFrames[0] && talkFrames[0].payload.asserts.at,
  };
  try { R.everyday.verified = (await F.verifyChain(talkLine)).frames; }
  catch (e) { R.everyday.verified = 'ERR ' + e.message; }

  // ── 2. a name somebody would actually choose ────────────────────────────
  const NAMES = ['小明', 'Ólafur', '🦖rex', 'مريم', 'Zoë'];
  await H.join({ id: NAMES[0], drive: mkDrive({ snapshot: () => ({
      me: { x: 0, y: 1.6, z: 0 }, world: 'Frontier', room: 'r', portals: [],
      players: NAMES.slice(1).map(n => ({ id: n, name: n })), chat: [] }) }),
    mind: M.scripted([{ say: 'hello, all of you 👋' }]), python: false });
  const namedTick = await H.serve(NAMES[0], { python: false });
  // a seal that failed leaves no line at all, and a test that then throws reports nothing —
  // the checks below have to be able to go RED, not to disappear
  const namedLine = String(H.chainOf(NAMES[0]) || '').trim();
  const namedFrame = namedLine ? JSON.parse(namedLine.split('\n')[0]) : null;
  R.names = { sealed: !!namedTick.frame, sealFailed: namedTick.sealFailed || null,
              roster: namedFrame && namedFrame.payload.requires.players };

  // ── 3. wearing a record the tick loop actually made ─────────────────────
  // wear() refuses to fall back to whoever is in this tab — the right call, and it means every
  // producer of a frame has to NAME its cast. This is the only test that wears a real one.
  try { if (!namedFrame) throw new Error('that tick sealed nothing, so there is nothing to wear');
        const t = await H.wear(namedFrame, 'the-night-the-power-went');
        R.worn = { hash: t.hash, cast: t.cast.map(c => c.id), lens: t.lens }; }
  catch (e) { R.worn = { error: e.message }; }

  // ── 4. the tick that went wrong, when the thing that went wrong has an emoji in it ──
  // copilot_auth throws 'copilot chat ' + status + ': ' + the API's own body, truncated. Land a
  // 200-unit cut between the halves of an emoji and the frame carrying the failure is refused —
  // losing the record of precisely the moment most worth having one.
  const head = 'copilot chat 400: ';
  const body = 'the model refused that line: '.padEnd(200 - head.length - 1, '.') + '🌍 …and the body goes on';
  const apiMsg = head + body;                       // index 200 lands on the high half of 🌍
  R.cut = { rawWellFormed: apiMsg.slice(0, 200).isWellFormed ? apiMsg.slice(0, 200).isWellFormed() : null,
            clippedWellFormed: F.clip(apiMsg, 200).isWellFormed ? F.clip(apiMsg, 200).isWellFormed() : null,
            clipLen: F.clip(apiMsg, 200).length };
  // clip must never CREATE a lone surrogate, wherever the cut lands
  let madeBroken = 0;
  for (let n = 0; n <= apiMsg.length + 2; n++) {
    const c = F.clip(apiMsg, n);
    if (c.isWellFormed && !c.isWellFormed()) madeBroken++;
  }
  R.cut.everyCutWellFormed = madeBroken === 0;
  const dead = mkDrive(); dead.snapshot = () => { throw new Error(apiMsg); }; dead.sense = undefined;
  await H.join({ id: 'apierr', drive: dead, mind: M.scripted([{ say: 'x' }]), python: false });
  const broke = await H.serve('apierr', { python: false });
  R.cut.tick = { frame: !!broke.frame, sealFailed: broke.sealFailed || null,
                 frames: String(H.chainOf('apierr') || '').trim().split('\n').filter(Boolean).length,
                 recorded: broke.frame ? JSON.parse(String(H.chainOf('apierr')).trim().split('\n')[0])
                                          .payload.asserts.error.slice(-12) : null };

  // ── 5. a session that ran long ──────────────────────────────────────────
  // Past the window the array drops its oldest frame. seq must keep counting the LIFE, the record
  // must say out loud that it is a window, and a window must NOT pass as a chain from genesis.
  await H.join({ id: 'marathon', drive: mkDrive(), mind: M.scripted([{ say: 'still here 🫡' }]), python: false });
  for (let i = 0; i < 505; i++) await H.serve('marathon', { python: false });
  const longLine = String(H.chainOf('marathon') || '').trim().split('\n').map(JSON.parse);
  R.long = { held: longLine.length, kind: H.chainKind('marathon'),
             firstSeq: longLine[0].seq, lastSeq: longLine[longLine.length - 1].seq };
  try { await F.verifyChain(longLine.map(f => JSON.stringify(f)).join('\n')); R.long.windowVerified = 'accepted'; }
  catch (e) { R.long.windowVerified = e.message.slice(0, 40); }

  // ── 6. a big percepts blob ──────────────────────────────────────────────
  const crowd = []; for (let i = 0; i < 60; i++) crowd.push({ id: 'p' + i, name: 'player ' + i + ' 🙂' });
  const portals = []; for (let i = 0; i < 40; i++) portals.push({ name: 'World ' + i + ' — 世界' });
  await H.join({ id: 'crowded', mind: M.scripted([{ say: 'busy in here' }]), python: false,
    drive: mkDrive({ snapshot: () => ({ me: { x: 0.5, y: 1.6, z: 0.5 }, world: 'Frontier', room: 'r',
      portals, players: crowd, chat: crowd.slice(0, 20).map(c => ({ from: c.id, text: 'hi 👋 ' + c.name })) }) }) });
  const bigTick = await H.serve('crowded', { python: false });
  R.big = { sealed: !!bigTick.frame, sealFailed: bigTick.sealFailed || null };

  // ── 7. the no-mind default path, byte for byte ──────────────────────────
  const held = window.NexusAuth;
  window.NexusAuth = null;
  const bare = mkDrive();
  try { await B.turn({ drive: bare, python: false }); R.noMind = 'did not throw'; }
  catch (e) { R.noMind = e.message; }
  // a mind on the page, and NOTHING handed to turn(): the visitor's ordinary case
  let asked = 0;
  window.NexusAuth = { signedIn: () => true, hasToken: () => true,
    chat: async (m, o2) => { asked++; return o2 && o2.raw ? { role: 'assistant', content: 'hello' } : 'hello'; } };
  const run = async (extra) => { const c0 = B.budget().calls, f0 = B.budget().free;
    const r = await B.turn(Object.assign({ drive: bare, python: false }, extra));
    return { words: r.words, charged: B.budget().calls - c0, free: B.budget().free - f0 }; };
  R.dflt = { omitted: await run({}), undef: await run({ mind: undefined }), nul: await run({ mind: null }) };
  R.dflt.asked = asked;

  // ── 8. the accounting, in both directions ───────────────────────────────
  const chargeOf = async (mind) => { const c0 = B.budget().calls, f0 = B.budget().free;
    await B.turn({ drive: bare, mind, python: false });
    return { paid: B.budget().calls - c0, free: B.budget().free - f0 }; };
  R.spend = {
    scripted:    await chargeOf(M.scripted([{ say: 'a' }])),
    assignedPaid: await chargeOf(Object.assign(M.scripted([{ say: 'a' }]), { free: false })),
    optsPaid:    await chargeOf(M.scripted([{ say: 'a' }], { free: false, name: 'marked paid' })),
    // a real mind is one that says nothing about itself, and it always pays
    real:        await chargeOf({ signedIn: () => true, chat: async (m, o2) => o2 && o2.raw ? { role: 'assistant', content: 'x' } : 'x' }),
    // and a real mind cannot be talked into being free by what it happens to answer
    liar:        await chargeOf({ signedIn: () => true,
                                  chat: async (m, o2) => o2 && o2.raw ? { role: 'assistant', content: 'isScripted', isScripted: true, free: true } : 'x' }),
  };
  window.NexusAuth = held;

  // ── 9. the scene keeps its place when something else asks the mind a question ──
  const S = [{ say: 'one',   do: [{ verb: 'look', args: { dx: 11 } }], then: 'done one' },
             { say: 'two',   do: [{ verb: 'look', args: { dx: 22 } }], then: 'done two' },
             { say: 'three', do: [{ verb: 'look', args: { dx: 33 } }], then: 'done three' }];
  const swungA = [], mA = M.scripted(S);
  await H.join({ id: 'ringed', mind: mA, python: false,
                 drive: mkDrive({ look: async (dx) => { swungA.push(dx); return true; } }) });
  await H.serve('ringed', { python: false });                       // beat one
  const ring = await B.lines({ mind: mA, who: { name: 'someone' }, chat: [], portals: [] });
  await H.serve('ringed', { python: false });                       // must be beat TWO
  R.ring = { swung: swungA, offered: ring, ticks: mA.ticksTaken() };

  // the same, for summon(): a beat naming a tool nobody has sends turn() looking for one
  const swungB = [], mB = M.scripted([
    { say: 'reaching.', do: [{ tool: 'weathervane' }], then: 'nothing there.' },
    { say: 'looking.',  do: [{ verb: 'look', args: { dx: 77 } }], then: 'saw it.' },
  ]);
  await H.join({ id: 'reacher', mind: mB, python: false,
                 drive: mkDrive({ look: async (dx) => { swungB.push(dx); return true; } }) });
  const reach = await H.serve('reacher', { python: false });        // asks for a tool nobody has
  await H.serve('reacher', { python: false });                      // must be beat TWO
  R.summonSeam = { swung: swungB, calls: (reach.calls || []).map(c => c.tool + (c.failed ? ' ✗' : '')) };

  // ── 10. confusing the mind on purpose ───────────────────────────────────
  // a caller that replays history: the assistant already spoke, so the beat is over
  const mR = M.scripted(S);
  const replayed = await mR.chat([{ role: 'system', content: 's' }, { role: 'user', content: 'PERCEPTS: {}' },
                                  { role: 'assistant', content: 'earlier' }, { role: 'user', content: 'PERCEPTS: {}' }], { raw: true });
  R.replay = { content: replayed.content, calls: (replayed.tool_calls || []).length, ticks: mR.ticksTaken() };

  // two players handed ONE mind object share its place in the scene — documented, not immune
  const seenA = [], seenB = [], shared = M.scripted(S);
  await H.join({ id: 'twinA', mind: shared, python: false, drive: mkDrive({ look: async (dx) => { seenA.push(dx); return true; } }) });
  await H.join({ id: 'twinB', mind: shared, python: false, drive: mkDrive({ look: async (dx) => { seenB.push(dx); return true; } }) });
  for (let i = 0; i < 3; i++) { await H.serve('twinA', { python: false }); await H.serve('twinB', { python: false }); }
  R.shared = { A: seenA, B: seenB };

  // a script that throws must not delete the moment
  await H.join({ id: 'brokenscene', mind: M.scripted(() => { throw new Error('the scene is broken'); }),
                 drive: mkDrive(), python: false });
  const thrown = await H.serve('brokenscene', { python: false });
  R.thrown = { error: thrown.error, frame: !!thrown.frame, sealFailed: thrown.sealFailed || null };

  // junk answers must arrive at the world as world events, never as this module's stack trace
  R.junk = {};
  for (const [name, script] of [['null', () => null], ['a string', () => 'just words'], ['a number', () => 7],
                                ['do: a string', () => ({ say: 'x', do: 'look' })],
                                ['do: a number', () => ({ say: 'x', do: 5 })],
                                ['do: one object', () => ({ say: 'x', do: { verb: 'look', args: { dx: 9 } } })]]) {
    const got = [];
    await H.join({ id: 'junk:' + name, mind: M.scripted(script), python: false,
                   drive: mkDrive({ look: async (dx) => { got.push(dx); return true; } }) });
    const r = await H.serve('junk:' + name, { python: false });
    R.junk[name] = { words: r.words, error: r.error || null, frame: !!r.frame,
                     calls: (r.calls || []).map(c => c.tool), looked: got };
  }

  // ── 11. going back starts another line, and another line is ONE stream ──
  // §7.5 step 1a is the only rule that catches this, and it caught it the day it was written:
  // fork() and enter() replaced the chain but left the stream pointer on the line they came from,
  // so the very next keyframe belonged to a different stream behind a perfectly correct hash link.
  const direct = () => M.scripted([{ say: '', do: [{ tool: 'direct',
    args: { directives: [{ player: 'talker', intent: 'wander' }] } } ] }]);
  await H.ensemble({ mind: direct(), python: false });
  await H.ensemble({ mind: direct(), python: false });
  let hist = String(H.history() || '').trim();
  R.line = { before: hist ? hist.split('\n').length : 0 };
  try { R.line.beforeVerified = (await F.verifyChain(hist)).frames; }
  catch (e) { R.line.beforeVerified = 'ERR ' + e.message.slice(0, 60); }
  await H.fork(JSON.parse(hist.split('\n').pop()), { reason: 'a test went back' });
  await H.ensemble({ mind: direct(), python: false });
  hist = String(H.history() || '').trim();
  const forked = hist.split('\n').map(JSON.parse);
  R.line.after = forked.length;
  R.line.streams = [...new Set(forked.map(f => String(f.stream_id)))].length;
  try { R.line.afterVerified = (await F.verifyChain(hist)).frames; }
  catch (e) { R.line.afterVerified = 'ERR ' + e.message.slice(0, 60); }

  // ── 12. the strictness is still there ───────────────────────────────────
  // admitting everyday data must not have cost the refusals; a spliced stream and a genesis
  // that is not seq 0 are the two the audit added and the two most easily lost again
  R.strict = {};
  // an internally PERFECT frame — its own hashes, the correct prev — that belongs to another
  // stream. Only the stream binding catches this one; every hash in it checks out.
  const alien = await F.buildFrame({ kind: 'body.pulse', streamId: 'rappid:@kody-w/elsewhere:' + 'ab'.repeat(32),
    seq: talkFrames[0].seq + 1, payload: { asserts: { said: 'I am from another line' } },
    prev: talkFrames[0].payload_hash });
  try { await F.verifyChain([talkFrames[0], alien].map(f => JSON.stringify(f)).join('\n')); R.strict.splice = 'accepted'; }
  catch (e) { R.strict.splice = e.message.slice(0, 60); }
  try { await F.verifyChain(JSON.stringify(talkFrames[1])); R.strict.lateGenesis = 'accepted'; }
  catch (e) { R.strict.lateGenesis = e.message.slice(0, 40); }

  R.budget = { calls: B.budget().calls, free: B.budget().free };
  return R;
});

console.log('what an ordinary evening said  :', JSON.stringify(out.everyday.back));
console.log('sealed as, in millimetres      :', JSON.stringify(out.everyday.at));
console.log('the cast a real tick names     :', JSON.stringify(out.names.roster));
console.log('a tile worn from a real record :', JSON.stringify(out.worn));
console.log('the emoji-cut error message    :', JSON.stringify(out.cut));
console.log('a long session                 :', JSON.stringify(out.long));
console.log('the default path               :', JSON.stringify(out.dflt));
console.log('the accounting                 :', JSON.stringify(out.spend));
console.log('the scene, past a dialogue ring:', JSON.stringify(out.ring.swung), 'offered:', out.ring.offered);
console.log('the scene, past a summon       :', JSON.stringify(out.summonSeam));
console.log('junk answers                   :', JSON.stringify(out.junk));
console.log('what the verifier still refuses:', JSON.stringify(out.strict));
console.log('the line, after going back     :', JSON.stringify(out.line));

console.log('\nCHANGE 1 — everyday data still gets through:');
ok('a real sentence with emoji, CJK, RTL, combining marks and an astral character seals a frame',
   out.everyday.sealed && out.everyday.sealFailed.length === 0);
ok('and comes back out of the frame byte for byte',
   JSON.stringify(out.everyday.back) === JSON.stringify([
     'nice place 😀🔥 — see you at the door 🚪',
     'こんにちは、世界。ここは静かですね。',
     'مرحبا بالعالم · שלום עולם',
     'café naïve résumé — é is not é, and both are fine',
     'the set \u{1D54F} of all worlds 👨‍👩‍👧‍👦 🇯🇵 👍🏽']));
ok('the whole evening verifies as a rapp/1 chain from genesis', out.everyday.verified === 5);
ok('a real coordinate is carried as integer millimetres, not refused as a float',
   out.everyday.at && out.everyday.at.x_milli === 1235 && out.everyday.at.z_milli === -8765);
ok('a player name someone would actually choose seals, and is named in the record',
   out.names.sealed && !out.names.sealFailed && !!out.names.roster
   && out.names.roster[0] === '小明' && out.names.roster.indexOf('🦖rex') > 0);
ok('a tile can be worn from a record the tick loop actually sealed — not only a hand-built one',
   !out.worn.error && out.worn.cast && out.worn.cast.length > 0);
ok('a 200-unit cut through an emoji IS ill-formed, and clip() is the thing that knows it',
   out.cut.rawWellFormed === false && out.cut.clippedWellFormed === true && out.cut.clipLen === 199);
ok('clip() never creates a lone surrogate, wherever the cut lands', out.cut.everyCutWellFormed === true);
ok('a tick that failed with an emoji in the error still seals exactly one frame',
   out.cut.tick.frame === true && out.cut.tick.sealFailed === null && out.cut.tick.frames === 1);
ok('a long session keeps counting the life, not the array, and says it is a window',
   out.long.held === 500 && out.long.kind === 'window' && out.long.lastSeq === 504 && out.long.firstSeq === 5);
ok('and a window is NOT offered as a chain from genesis', /genesis/.test(out.long.windowVerified));
ok('a big percepts blob — sixty people, forty portals, chat — seals',
   out.big.sealed && !out.big.sealFailed);
ok('the refusals the audit added are still there: a spliced stream and a late genesis',
   /stream_id changes/.test(out.strict.splice) && /genesis/.test(out.strict.lateGenesis));
ok('going back starts another line, and that line is one stream that still verifies',
   out.line.beforeVerified === 2 && out.line.after === 2 && out.line.streams === 1
   && out.line.afterVerified === 2);

console.log('\nCHANGE 2 — the default path, and the seam:');
ok('no mind anywhere still refuses with the same sentence', out.noMind === 'no mind: not signed in');
ok('with a mind on the page and none handed in, turn() uses it and charges exactly one call',
   out.dflt.omitted.words === 'hello' && out.dflt.omitted.charged === 1 && out.dflt.omitted.free === 0);
ok('mind:undefined and mind:null are the default path, not a third one',
   JSON.stringify(out.dflt.undef) === JSON.stringify(out.dflt.omitted)
   && JSON.stringify(out.dflt.nul) === JSON.stringify(out.dflt.omitted));
ok('a scripted mind spends none of the paid ceiling, and is counted in its own column',
   out.spend.scripted.paid === 0 && out.spend.scripted.free === 1);
ok('a scripted mind marked paid IS charged — by assignment and by option alike',
   out.spend.assignedPaid.paid === 1 && out.spend.optsPaid.paid === 1);
ok('a real mind always pays, and cannot answer its way out of it',
   out.spend.real.paid === 1 && out.spend.liar.paid === 1 && out.spend.liar.free === 0);
ok('a dialogue ring asking an NPC for lines does not take a beat out of its scene',
   JSON.stringify(out.ring.swung) === '[11,22]' && out.ring.offered === null && out.ring.ticks === 2);
ok('nor does a summon on the way past — the next beat is the next beat',
   JSON.stringify(out.summonSeam.swung) === '[77]'
   && out.summonSeam.calls.some(c => /weathervane/.test(c) && / ✗$/.test(c)));
// A mind that never started a scene is handed a transcript in which it apparently already spoke.
// The round is readable and is honoured — the beat is over — but there is no beat behind it to
// close, so it says nothing rather than inventing a line it never had. Nothing is spent either way.
ok('a replayed transcript ends the beat rather than starting one, and invents nothing',
   out.replay.content === '' && out.replay.calls === 0 && out.replay.ticks === 0);
ok('two players handed ONE mind object share its place — each gets alternate beats',
   JSON.stringify(out.shared.A) === '[11,33,22]' && JSON.stringify(out.shared.B) === '[22,11,33]');
ok('a script that throws does not delete the moment — the failure is sealed',
   out.thrown.error === 'the scene is broken' && out.thrown.frame === true && !out.thrown.sealFailed);
ok('junk from a script never reaches the world as this module\'s stack trace',
   Object.keys(out.junk).every(k => out.junk[k].error === null && out.junk[k].frame === true));
ok('a `do` that is not a list is read as one move or as none, never walked character by character',
   out.junk['do: a string'].calls.length === 0 && out.junk['do: a number'].calls.length === 0
   && JSON.stringify(out.junk['do: one object'].looked) === '[9]');
ok('nothing bought a thought — no model endpoint was reached', bought === 0);
ok('no page errors', errs.length === 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await b.close(); process.exit(fail?1:0);})();

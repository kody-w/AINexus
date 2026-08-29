// THE CEILINGS. Three of them, and until now not one had ever been reached in anger.
//
//   · the SPEND ceiling — 400 model calls and 90 minutes, the only thing between a tab left open
//     overnight and an unbounded bill on a visitor's own Copilot seat
//   · the ROUND cap — MAX_ROUNDS, which bounds one tick's tool conversation so a mind that never
//     stops calling cannot make a turn into an afternoon
//   · the LOOP's own ceilings — maxTicks, stop(), and the reasons live() ends for
//
// No model call has ever run in this estate, so a ceiling that had never been approached had
// never been tested. A scripted mind changes that: it drives thousands of turns for free, and
// everything downstream of the answer — the accounting, the refusal, the frames, the loop — is
// the real code. The mind marked `free: false` is the one that exercises the PAID path: it is
// still scripted, still buys nothing, and is still counted as though it had.
//
// NOTHING HERE REACHES A MODEL. The guard below aborts any request to one and the suite asserts
// none was made; a run that bought a thought would be lying about what it proved.
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
let pass = 0, fail = 0;
const ok = (n, c) => { console.log((c ? '  ✓ ' : '  ✗ ') + n); c ? pass++ : fail++; };

(async () => {
const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.route('https://kody-w.github.io/AINexus/**', r => { const u = new URL(r.request().url());
  const f = path.join(ROOT, decodeURIComponent(u.pathname).replace(/^\/AINexus/, ''));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.fulfill({ status: 404, body: 'no' });
  r.fulfill({ status: 200, contentType: T[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) }); });
let bought = 0;
await ctx.route('https://**/chat/completions*', r => { bought++; r.abort(); });
await ctx.route('https://rapp-auth.kwildfeuer.workers.dev/**', r => { bought++; r.abort(); });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('https://kody-w.github.io/AINexus/frontier.html', { timeout: 60000 });
await p.waitForFunction(() => window.NexusBrainstem && window.NexusMind && window.NexusFrames, null, { timeout: 45000 });

const out = await p.evaluate(async () => {
  const B = window.NexusBrainstem, M = window.NexusMind, R = {};
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const mkDrive = (extra) => Object.assign({
    snapshot: () => ({ me: { x: 0, y: 1, z: 0 }, world: 'Frontier', room: 'r',
                       portals: [{ name: 'Ebike World' }], players: [], chat: [] }),
    people: () => [], orbs: () => [{ name: 'Ebike World', distance: 3 }], dialogue: () => [],
    look: async () => true, walk: async () => true, travel: async () => true,
    say: async () => true, tell: async () => true, aim: async () => true }, extra || {});
  const clean = () => B.budget({ calls: 0, limit: 400, since: Date.now(), minutes: 90, stopped: null, free: 0 });
  // an NPC. free, because it buys nothing and asks nobody.
  const npc = () => M.scripted([{ say: 'evening.' }]);
  // the same NPC, metered on purpose: this is what drives the PAID ceiling without paying
  const seat = () => Object.assign(M.scripted([{ say: 'evening.' }]), { free: false });

  // ── 1. where the ceiling actually bites ─────────────────────────────────
  B.budget({ calls: 0, limit: 50, since: Date.now(), minutes: 90, stopped: null, free: 0 });
  const paid = seat(), drive = mkDrive();
  let thought = 0, refused = 0, first = null;
  for (let i = 0; i < 60; i++) {
    try { await B.turn({ drive, mind: paid, python: false }); thought++; }
    catch (e) { refused++; if (!first) first = { msg: e.message, code: e.code, reason: e.reason, at: thought }; }
  }
  R.bite = { thought, refused, first, after: B.budget() };

  // ── 2. THOUSANDS of free turns must not touch the paid ceiling ──────────
  // Ten times the ceiling, through the real turn(), the real lane, the real accounting — and the
  // visitor's seat must be exactly as untouched at the end as it was at the start.
  clean();
  const free = npc(), t0 = performance.now();
  let brokeAt = null;
  for (let i = 0; i < 4000; i++) {
    try { await B.turn({ drive, mind: free, python: false }); }
    catch (e) { brokeAt = { turn: i, msg: e.message }; break; }   // report it; never crash the suite
  }
  const afterFree = B.budget();
  let paidStillWorks = null;
  try { await B.turn({ drive, mind: seat(), python: false }); paidStillWorks = B.budget().calls; }
  catch (e) { paidStillWorks = 'refused: ' + e.message; }
  R.freeRun = { ms: Math.round(performance.now() - t0), brokeAt, calls: afterFree.calls, free: afterFree.free,
                thought: free.ticksTaken(), stopped: afterFree.stopped, paidStillWorks };

  // ── 3. three deaths, told apart ─────────────────────────────────────────
  B.budget({ calls: 0, limit: 1, since: Date.now(), stopped: null, free: 0 });
  const deaths = {};
  const meter = seat();
  await B.turn({ drive, mind: meter, python: false });                       // spends the one call
  try { await B.turn({ drive, mind: meter, python: false }); }
  catch (e) { deaths.budget = { msg: e.message, code: e.code, reason: e.reason }; }
  clean();
  try { await B.turn({ drive, mind: { signedIn: () => false, chat: async () => ({}) }, python: false }); }
  catch (e) { deaths.mind = { msg: e.message, code: e.code }; }
  try { await B.turn({ drive: null, mind: npc(), python: false }); }
  catch (e) { deaths.hands = { msg: e.message, code: e.code }; }
  R.deaths = deaths;

  // ── 4. the wall clock, and whether an operator can lift what it stopped ─
  B.budget({ calls: 0, limit: 400, since: Date.now() - 91 * 60000, minutes: 90, stopped: null, free: 0 });
  let timeRefusal = null;
  try { await B.turn({ drive, mind: seat(), python: false }); }
  catch (e) { timeRefusal = { msg: e.message, code: e.code, reason: e.reason }; }
  // the operator moves the deadline — which must actually move it
  B.budget({ since: Date.now() });
  let afterMovingTheDeadline;
  try { await B.turn({ drive, mind: seat(), python: false }); afterMovingTheDeadline = 'thinks again'; }
  catch (e) { afterMovingTheDeadline = 'still refused: ' + e.message; }
  // and the same for the call ceiling: raise it after it bites
  B.budget({ calls: 0, limit: 1, since: Date.now(), stopped: null });
  const m2 = seat();
  for (let i = 0; i < 3; i++) { try { await B.turn({ drive, mind: m2, python: false }); } catch (e) {} }
  const bitten = B.budget();
  B.budget({ limit: 400 });
  let afterRaise;
  try { await B.turn({ drive, mind: m2, python: false }); afterRaise = 'thinks again'; }
  catch (e) { afterRaise = 'still refused: ' + e.message; }
  R.clock = { timeRefusal, afterMovingTheDeadline, bittenAt: bitten.calls, bittenSays: bitten.stopped, afterRaise };

  // the deadline does not roll on its own: a hundred turns later it is the same instant
  clean();
  const stamp = B.budget().since;
  for (let i = 0; i < 100; i++) await B.turn({ drive, mind: npc(), python: false });
  R.clock.deadlineMoved = B.budget().since !== stamp;

  // ── 5. halt() binds everything; a ceiling binds only what spends ────────
  clean();
  B.halt('stopped by the operator');
  let freeUnderHalt = null;
  try { await B.turn({ drive, mind: npc(), python: false }); freeUnderHalt = 'still thought'; }
  catch (e) { freeUnderHalt = 'refused: ' + e.message; }
  R.halt = { freeUnderHalt, reason: B.budget().reason };
  clean();

  // ── 6. the round cap: a mind that never stops calling ───────────────────
  clean();
  let chats = 0, hands = 0;
  const runaway = { signedIn: () => true, isScripted: true, free: false,
    chat: async () => { chats++; return M.reply('still going', [{ verb: 'look', args: { dx: 1 } }]); } };
  const r = await B.turn({ drive: mkDrive({ look: async () => { hands++; return true; } }),
                           mind: runaway, python: false });
  R.runaway = { chats, hands, cost: B.budget().calls, rounds: r.rounds, note: r.note,
                words: r.words, calls: r.calls.length, MAX_ROUNDS: B.MAX_ROUNDS };

  // ── 7. live(): maxTicks holds, one frame per tick, and it says why it ended
  clean();
  const h1 = B.live({ everyMs: 10, maxTicks: 12, vision: false, python: false, mind: npc(), drive });
  for (let i = 0; i < 100 && !h1.state().done; i++) await sleep(30);
  const s1 = h1.state();
  let chainOk = null; try { chainOk = await h1.verify(); } catch (e) { chainOk = { error: e.message }; }
  R.maxTicks = { ticks: s1.ticks, frames: s1.chain.length, journal: s1.journal.length,
                 everySealed: s1.journal.every(j => !!j.frame), stopped: s1.stopped, reason: s1.reason,
                 verified: chainOk && chainOk.frames, spent: B.budget().calls, free: B.budget().free };

  // ── 8. live(): the ceiling hit mid-loop must STOP the loop ──────────────
  B.budget({ calls: 0, limit: 3, since: Date.now(), stopped: null, free: 0 });
  const h2 = B.live({ everyMs: 10, maxTicks: 0, vision: false, python: false, mind: seat(), drive });
  for (let i = 0; i < 100 && !h2.state().done; i++) await sleep(30);
  const s2 = h2.state();
  h2.stop('too late');                      // and the operator arriving after must not relabel it
  R.ceilingStopsLoop = { ticks: s2.ticks, running: s2.running, done: s2.done, stopped: s2.stopped,
                         reason: s2.reason, frames: s2.chain.length, spent: B.budget().calls,
                         lastEntry: s2.journal[s2.journal.length - 1],
                         reasonAfterLateStop: h2.state().reason };

  // ── 9. live(): stop() reaches inside the thought it interrupted ─────────
  clean();
  let inFlight = 0, afterStop = 0, movedAfterStop = 0, stopped = false;
  const slow = { signedIn: () => true, isScripted: true, free: false, chat: async () => {
    inFlight++; if (stopped) afterStop++;
    await sleep(60);
    return M.reply('going', [{ verb: 'look', args: { dx: 1 } }]); } };
  const h3 = B.live({ everyMs: 10, maxTicks: 0, vision: false, python: false, mind: slow,
                      drive: mkDrive({ look: async () => { if (stopped) movedAfterStop++; return true; } }) });
  await sleep(150);
  stopped = true; h3.stop('operator');
  const spentAtStop = B.budget().calls;
  await sleep(600);
  R.stopMidThought = { chats: inFlight, chatsAfterStop: afterStop, movedAfterStop,
                       spentAtStop, spentNow: B.budget().calls, done: h3.state().done,
                       stopped: h3.state().stopped };

  // ── 10. live(): a world that throws every tick ──────────────────────────
  clean();
  const h4 = B.live({ everyMs: 5, maxTicks: 0, vision: false, python: false, mind: npc(),
                      drive: mkDrive({ snapshot: () => { throw new Error('the world exploded'); } }) });
  for (let i = 0; i < 150 && !h4.state().done; i++) await sleep(30);
  const s4 = h4.state();
  h4.stop();
  R.throwingWorld = { ticks: s4.ticks, done: s4.done, stopped: s4.stopped, reason: s4.reason,
                      frames: s4.chain.length, everySealed: s4.journal.every(j => !!j.frame),
                      lastError: (s4.journal[s4.journal.length - 1] || {}).error };

  // ── 11. live(): the hands going away, and the mind dying ───────────────
  clean();
  window.__autodrive = mkDrive();
  const h5 = B.live({ everyMs: 10, maxTicks: 0, vision: false, python: false, mind: npc() });
  await sleep(120); window.__autodrive = null;
  for (let i = 0; i < 60 && !h5.state().done; i++) await sleep(20);
  R.handsGone = { stopped: h5.state().stopped, reason: h5.state().reason, ticks: h5.state().ticks };

  clean();
  let alive = true;
  const h6 = B.live({ everyMs: 10, maxTicks: 0, vision: false, python: false, drive,
                      mind: { signedIn: () => alive, chat: async () => M.reply('hi', null) } });
  await sleep(120); alive = false;
  for (let i = 0; i < 60 && !h6.state().done; i++) await sleep(20);
  R.mindDied = { stopped: h6.state().stopped, reason: h6.state().reason, ticks: h6.state().ticks };

  clean();
  return R;
});

// ── the scope of the ceiling, proved rather than asserted ────────────────
// One counter per JS realm. A second frame of the same page on the same origin gets its OWN 400,
// which is what the module's comment now says out loud; if that ever becomes one shared counter,
// this check is where it will be noticed.
const scope = await p.evaluate(async () => {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:absolute;left:-9999px;width:400px;height:300px';
  f.src = 'https://kody-w.github.io/AINexus/frontier.html';
  document.body.appendChild(f);
  await new Promise((res, rej) => { f.onload = res; f.onerror = () => rej(new Error('frame would not load')); });
  for (let i = 0; i < 100 && !(f.contentWindow && f.contentWindow.NexusBrainstem); i++)
    await new Promise(r => setTimeout(r, 100));
  const inner = f.contentWindow && f.contentWindow.NexusBrainstem;
  if (!inner) return { loaded: false };
  window.NexusBrainstem.budget({ calls: 0, limit: 7, since: Date.now(), stopped: null });
  return { loaded: true, outer: window.NexusBrainstem.budget().limit, inner: inner.budget().limit,
           sameObject: inner.budget() === window.NexusBrainstem.budget() };
});

const B = out;
console.log('THE SPEND CEILING');
console.log('  bites at            :', B.bite.thought, 'turns thought,', B.bite.refused, 'refused · limit was',
            B.bite.after.limit, '· first refusal at turn', B.bite.first && B.bite.first.at);
console.log('  says                :', B.bite.first && B.bite.first.msg);
console.log('  as                  : code=' + (B.bite.first && B.bite.first.code) + ' reason=' + (B.bite.first && B.bite.first.reason));
console.log('  4000 free turns     :', B.freeRun.ms + 'ms ·', B.freeRun.calls, 'paid,', B.freeRun.free,
            'free ·', B.freeRun.thought, 'thoughts taken · a paying mind afterwards:', B.freeRun.paidStillWorks,
            B.freeRun.brokeAt ? '· BROKE at turn ' + B.freeRun.brokeAt.turn + ': ' + B.freeRun.brokeAt.msg : '');
console.log('  three deaths        :', JSON.stringify(B.deaths));
console.log('  the wall clock      :', JSON.stringify(B.clock));
console.log('  operator halt       :', JSON.stringify(B.halt));
console.log('  scope               :', JSON.stringify(scope));
console.log('\nTHE ROUND CAP');
console.log('  a mind that never stops calling:', JSON.stringify(B.runaway));
console.log('\nTHE LOOP');
console.log('  maxTicks            :', JSON.stringify(B.maxTicks));
console.log('  ceiling mid-loop    :', JSON.stringify(B.ceilingStopsLoop));
console.log('  stop mid-thought    :', JSON.stringify(B.stopMidThought));
console.log('  a throwing world    :', JSON.stringify(B.throwingWorld));
console.log('  the hands going away:', JSON.stringify(B.handsGone));
console.log('  the mind dying      :', JSON.stringify(B.mindDied));

console.log('\nchecks:');
ok('nothing bought a thought — no model endpoint was reached', bought === 0);

ok('the ceiling bites at exactly the limit, not before and not after',
   B.bite.thought === 50 && B.bite.refused === 10 && B.bite.first.at === 50);
ok('and stays bitten: every later turn is refused too', B.bite.after.calls === B.bite.after.limit);
ok('the refusal says what happened, in a sentence naming the limit',
   /session budget reached \(50 model calls\)/.test(B.bite.first.msg));
ok('a caller can tell "out of budget" from a dead sign-in and from a world that went away',
   B.deaths.budget.code === 'budget' && B.deaths.budget.reason === 'calls'
   && !B.deaths.mind.code && /not signed in/.test(B.deaths.mind.msg)
   && !B.deaths.hands.code && /no hands/.test(B.deaths.hands.msg));

ok('four thousand FREE turns — ten times the ceiling — spend none of it',
   !B.freeRun.brokeAt && B.freeRun.calls === 0 && B.freeRun.free === 4000
   && B.freeRun.thought === 4000 && B.freeRun.stopped === null);
ok('and the visitor can still think afterwards — an NPC cannot lock a person out',
   B.freeRun.paidStillWorks === 1);

ok('the wall clock refuses when the deadline is past, and says minutes not calls',
   B.clock.timeRefusal && B.clock.timeRefusal.reason === 'time'
   && /90 minutes/.test(B.clock.timeRefusal.msg));
ok('the deadline never rolls on its own — a hundred turns do not refill it', B.clock.deadlineMoved === false);
ok('an operator moving the deadline actually moves it', B.clock.afterMovingTheDeadline === 'thinks again');
ok('an operator raising a ceiling that has bitten actually raises it', B.clock.afterRaise === 'thinks again');
ok('an operator HALT binds even a mind that costs nothing',
   /refused:/.test(B.halt.freeUnderHalt) && B.halt.reason === 'operator');

ok('the ceiling is one counter per frame, and the frames do not share it',
   scope.loaded === true && scope.outer === 7 && scope.inner === 400);

ok('a mind that never stops calling costs exactly MAX_ROUNDS calls, and no more',
   B.runaway.chats === B.runaway.MAX_ROUNDS && B.runaway.cost === B.runaway.MAX_ROUNDS
   && B.runaway.hands === B.runaway.MAX_ROUNDS);
ok('the runaway tick still returns, saying it ran out of rounds still acting',
   B.runaway.note === 'ran out of rounds still acting' && B.runaway.words === 'still going'
   && B.runaway.calls === B.runaway.MAX_ROUNDS);

ok('live() runs exactly its maxTicks and stops itself', B.maxTicks.ticks === 12 && B.maxTicks.done !== false);
ok('every tick of it sealed one frame, and the line verifies as a rapp/1 chain',
   B.maxTicks.frames === 12 && B.maxTicks.everySealed && B.maxTicks.verified === 12);
ok('a scripted loop spends nothing at all', B.maxTicks.spent === 0 && B.maxTicks.free === 12);

ok('the ceiling hit mid-loop STOPS the loop rather than knocking on it forever',
   B.ceilingStopsLoop.done === true && B.ceilingStopsLoop.running === false
   && B.ceilingStopsLoop.reason === 'budget');
ok('and the loop says so in words a person could act on',
   /session budget reached/.test(String(B.ceilingStopsLoop.stopped)));
ok('the failed tick still sealed its frame — the moment is not lost',
   !!(B.ceilingStopsLoop.lastEntry && B.ceilingStopsLoop.lastEntry.frame)
   && B.ceilingStopsLoop.frames === B.ceilingStopsLoop.ticks);
ok('an operator arriving after the fact does not relabel why it stopped',
   B.ceilingStopsLoop.reasonAfterLateStop === 'budget');

ok('stop() reaches inside the thought it interrupted — nothing more is bought',
   B.stopMidThought.chatsAfterStop === 0 && B.stopMidThought.spentNow === B.stopMidThought.spentAtStop);
ok('and the body stops moving with it', B.stopMidThought.movedAfterStop <= 1 && B.stopMidThought.done === true);

ok('a world that throws on every tick still seals a frame per tick',
   B.throwingWorld.everySealed && B.throwingWorld.frames === B.throwingWorld.ticks
   && /the world exploded/.test(String(B.throwingWorld.lastError)));
ok('and the loop gives up on it rather than ticking forever',
   B.throwingWorld.done === true && B.throwingWorld.reason === 'failing'
   && B.throwingWorld.ticks === 20);

ok('the hands going away ends the loop, and it names that', B.handsGone.reason === 'no-hands'
   && /hands went away/.test(String(B.handsGone.stopped)));
ok('a mind that dies ends the loop, and it names that', B.mindDied.reason === 'no-mind'
   && /not signed in/.test(String(B.mindDied.stopped)));

ok('no page errors', errs.length === 0);
if (errs.length) console.log('errors:', errs.slice(0, 3));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
await b.close(); process.exit(fail ? 1 : 0);})();

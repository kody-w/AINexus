// Deterministic test of the stop-generation bookkeeping, with a real clock.
// Loads the REAL ai/autodrive.js behind a minimal window/document stub, because a
// long-hidden Chrome tab throttles timers to roughly once a minute and cannot be
// trusted for anything time-dependent.
const fs = require('fs'), vm = require('vm');

function makeDriver(file) {
  const noop = () => {};
  const el = new Proxy({}, {
    get: (t, k) =>
      k === 'style' ? {}
      : k === 'classList' ? { add: noop, remove: noop, toggle: noop, contains: () => false }
      : k === 'getBoundingClientRect' ? () => ({ left: 0, top: 0, width: 800, height: 600 })
      : typeof k === 'string' ? noop
      : undefined,
    set: () => true,
  });
  const doc = {
    documentElement: el, body: el, head: el,
    createElement: () => el, getElementById: () => null, querySelector: () => null,
    querySelectorAll: () => [], addEventListener: noop, removeEventListener: noop,
    dispatchEvent: noop, hidden: false, visibilityState: 'visible',
  };
  const win = {
    document: doc, addEventListener: noop, removeEventListener: noop,
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 16),
    performance: { now: () => Date.now() },
    location: { href: 'http://x/', search: '', hash: '', pathname: '/' },
    navigator: { userAgent: 'node' }, console,
    KeyboardEvent: function () {}, MouseEvent: function () {}, Event: function () {},
    parent: null, innerWidth: 800, innerHeight: 600,
  };
  win.window = win; win.self = win; win.top = win;
  const ctx = vm.createContext(win);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  return win.__autodrive;
}

(async () => {
  const d = makeDriver(process.argv[2] || 'ai/autodrive.js');
  if (!d) { console.log('FAIL: driver did not attach'); process.exit(1); }
  const R = {};
  const step = { do: 'wait', ms: 10 };

  // 0) THE FRESH PAGE — this case must run before anything else touches the driver.
  //    A newly loaded page sits in generation 0, and 0 is falsy. Asking whether the
  //    caller's claim is TRUTHY instead of whether it EXISTS sent the first turn of
  //    every page down the operator branch, where it called stop() and cancelled the
  //    turn that issued it. Every other case here opens with a stop, which moves the
  //    epoch to 1 and hides it — which is exactly how it got past this file.
  const freshEpoch = d._epoch;
  d._liveTurn = d._epoch;                          // what mind() does on entry
  const v0 = await d.run({ steps: [step] }, null, { turn: freshEpoch });
  R['0_generation_zero_is_a_real_claim'] =
    { freshEpoch, verdict: v0, epochAfter: d._epoch, selfCancelled: d._epoch !== freshEpoch };

  // A) a turn's own tool calls must not cancel the turn that issued them.
  //    This is the drive.mind() path: turn() runs with nothing else on the stack and
  //    issues each tool call itself. Inferring "top level" from a zero depth made the
  //    first call bump the generation out from under its own turn.
  d.stop();
  d._liveTurn = d._epoch;                          // what mind() does on entry
  const e0 = d._epoch;
  const a1 = await d.run({ steps: [step] }, null, { turn: e0 });
  const a2 = await d.run({ steps: [step] }, null, { turn: e0 });
  const a3 = await d.run({ steps: [step] }, null, { turn: e0 });
  R.A_turn_survives_own_tool_calls =
    { verdicts: [a1, a2, a3], epochUnchanged: d._epoch === e0 };

  // B) a real operator stop must void the turn
  const eB = d._epoch;
  d.stop();
  R.B_operator_stop_seen = { epochBumped: d._epoch !== eB };

  // C) a turn call belonging to a cancelled generation must refuse, and run no steps
  const ranC = [];
  const vC = await d.run({ steps: [step, step] }, (v) => ranC.push(v), { turn: eB });
  R.C_turn_call_after_stop = { verdict: vC, stepsRan: ranC.length, running: d._running };

  // D) the operator can always start again
  R.D_operator_restart = await d.run({ steps: [step] }, null);

  // E) a throwing onStep escapes run(), but must not strand the depth counter —
  //    a stranded counter is what used to make every later run look nested for good
  const beforeE = d._depth;
  let escaped = null;
  try { await d.run({ steps: [step] }, () => { throw new Error('onStep blew up'); }); }
  catch (e) { escaped = e.message; }
  R.E_depth_after_throwing_onStep = { before: beforeE, after: d._depth, escaped };

  // F) THE CRITICAL: an operator run must work while a turn is PARKED.
  //    A turn waiting on an un-timeoutable auth.chat fetch holds the depth counter up
  //    forever. Treating that as "I am nested" made the tower, the per-tab CLI and the
  //    views' budget silently refuse every new program for the life of the request.
  d.stop();
  const parked = d.run({ steps: [{ do: 'wait', ms: 60000 }] }, null);   // never awaited
  await new Promise((r) => setTimeout(r, 120));
  const parkedGen = d._epoch;                  // the generation the parked turn belongs to
  const depthWhileParked = d._depth;
  // the operator hits Stop while that turn is parked — this is the trigger. The turn
  // cannot notice: it is suspended inside a fetch with no timeout, so it keeps the
  // depth counter raised for the whole life of the request.
  d.stop();
  const vF = await d.run({ steps: [step] }, null);            // operator, after the stop
  R.F_operator_run_while_turn_parked =
    { depthWhileParked, verdict: vF, running: d._running, depth: d._depth };

  // G) ...and that operator run must CANCEL the parked turn, not run beside it:
  //    two programs driving one avatar is the failure on the other side of F.
  const staleTurn = await d.run({ steps: [step] }, null, { turn: parkedGen });
  R.G_operator_run_cancels_parked_turn = { staleTurnVerdict: staleTurn };
  void parked;                                                 // left parked on purpose

  // I) A KILLED PROGRAM MUST STAY DEAD once a later operator run re-arms the global
  //    _running flag. The step loop used to ask only "is anything running", which the new
  //    run answers yes to — so the zombie woke, finished its steps and re-entered its own
  //    loop, acting beside the program that replaced it.
  d.stop();
  let zombieSteps = 0;
  const zombie = d.run({ steps: [{ do: 'wait', ms: 300 }], loop: true }, () => { zombieSteps++; });
  await new Promise((r) => setTimeout(r, 100));      // parked inside the wait
  d.stop();                                          // the operator kills it
  const atKill = zombieSteps;
  // The later operator run must still be IN FLIGHT when the zombie's wait resolves —
  // that is the whole trigger. _running is one global flag, so a live run answers "yes"
  // to a question the dead frame had no business asking. An awaited run that has already
  // finished leaves _running false and hides the bug completely.
  let liveSteps = 0;
  const live = d.run({ steps: [{ do: 'wait', ms: 250 }], loop: true }, () => { liveSteps++; });
  await new Promise((r) => setTimeout(r, 1600));     // room for several more loop turns
  d.stop();                                          // retire the live program
  void live;
  // The step already IN FLIGHT when the kill landed has to finish — an awaited sleep
  // cannot be un-awaited — so exactly one more callback is correct and expected. What
  // must not happen is the frame going round again.
  R.I_killed_program_stays_dead =
    { atKill, after: zombieSteps, extra: zombieSteps - atKill, liveSteps,
      resumed: (zombieSteps - atKill) > 1 };
  void zombie;

  // J) a `mind` step carried inside an already-voided frame must refuse, rather than
  //    re-stamping itself with the live generation and speaking from the dead
  d.stop();
  const staleGen = d._epoch - 1;
  const logs = [];
  const origLog = console.log;
  console.log = (...a) => { logs.push(a.join(' ')); };
  try { await d.mind({}, staleGen); } finally { console.log = origLog; }
  R.J_mind_refuses_an_inherited_stale_generation =
    { refused: logs.some((l) => /stopped generation/.test(l)) };

  console.log(JSON.stringify(R, null, 1));
  const pass =
    R['0_generation_zero_is_a_real_claim'].freshEpoch === 0 &&
    R['0_generation_zero_is_a_real_claim'].verdict === 'done' &&
    R['0_generation_zero_is_a_real_claim'].selfCancelled === false &&
    R.A_turn_survives_own_tool_calls.verdicts.every((v) => v === 'done') &&
    R.A_turn_survives_own_tool_calls.epochUnchanged &&
    R.B_operator_stop_seen.epochBumped &&
    R.C_turn_call_after_stop.verdict === 'stopped' &&
    R.C_turn_call_after_stop.stepsRan === 0 &&
    R.D_operator_restart === 'done' &&
    R.E_depth_after_throwing_onStep.after === 0 &&
    R.F_operator_run_while_turn_parked.verdict === 'done' &&
    R.G_operator_run_cancels_parked_turn.staleTurnVerdict === 'stopped' &&
    R.I_killed_program_stays_dead.resumed === false &&
    R.J_mind_refuses_an_inherited_stale_generation.refused === true;
  console.log(pass ? 'ALL PASS' : 'FAIL');
  process.exit(pass ? 0 : 1);
})();

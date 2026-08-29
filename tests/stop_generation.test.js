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

  // A) a turn's OWN top-level tool calls must not look like an operator cancelling it.
  //    vbrainstem captures the epoch once, then issues each tool call through drive.run().
  d.stop();
  const epoch0 = d._epoch;
  await d.run({ steps: [step] }, null);
  await d.run({ steps: [step] }, null);
  await d.run({ steps: [step] }, null);
  R.A_turn_survives_own_tool_calls = { epoch0, now: d._epoch, wouldSelfCancel: d._epoch !== epoch0 };

  // B) a real operator stop must still be visible to that same check
  const eB = d._epoch;
  d.stop();
  R.B_operator_stop_seen = { wouldFire: d._epoch !== eB };

  // C) the nested-after-stop refusal must still hold
  const outer = d.run({ steps: [{ do: 'wait', ms: 60 }], loop: true }, null);
  await new Promise((r) => setTimeout(r, 250));
  const midDepth = d._depth, midRunning = d._running;
  d.stop();
  const ran = [];
  const verdict = await d.run({ steps: [step, step] }, (v) => ran.push(v));
  R.C_nested_after_stop = { midDepth, midRunning, verdict, stepsRan: ran.length };
  await Promise.race([outer, new Promise((r) => setTimeout(r, 1500))]);
  await new Promise((r) => setTimeout(r, 100));
  R.C_settled = { depth: d._depth, running: d._running };

  // D) restart works after all that
  d.stop();
  R.D_restart = await d.run({ steps: [step] }, null);

  // E) a throwing onStep ESCAPES run() (the step's catch calls onStep again, and that
  //    second throw is not caught). What must still hold is that the finally drained the
  //    depth — a stranded counter would make every later top-level run look nested for
  //    the life of the page, and with a bumped epoch that means refuse forever.
  const before = d._depth;
  let escaped = null;
  try { await d.run({ steps: [step] }, () => { throw new Error('onStep blew up'); }); }
  catch (e) { escaped = e.message; }
  R.E_depth_after_throwing_onStep = { before, after: d._depth, escaped };

  // F) ...and the driver still works afterwards, which is the thing that matters
  R.F_still_usable_after_throw = await d.run({ steps: [step] }, null);

  console.log(JSON.stringify(R, null, 1));
  const pass =
    !R.A_turn_survives_own_tool_calls.wouldSelfCancel &&
    R.B_operator_stop_seen.wouldFire &&
    R.C_nested_after_stop.verdict === 'stopped' &&
    R.C_nested_after_stop.stepsRan === 0 &&
    R.C_settled.depth === 0 &&
    R.D_restart === 'done' &&
    R.E_depth_after_throwing_onStep.after === 0 &&
    R.F_still_usable_after_throw === 'done';
  console.log(pass ? 'ALL PASS' : 'FAIL');
  process.exit(pass ? 0 : 1);
})();

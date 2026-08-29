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
  // see() needs a canvas, and scan() is a loop of see()+look(). Without one the scan step
  // threw on its first iteration and case O measured a verb that never ran.
  const canvas = {
    width: 800, height: 600, getContext: () => ({ drawImage() {}, fillRect() {} }),
    toDataURL: () => 'data:image/webp;base64,AAAA',
    // look() aims its mousemove at the canvas, so it needs to accept events too —
    // without this every scan step died on "target.dispatchEvent is not a function"
    dispatchEvent: (ev) => win.dispatchEvent(ev),
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  };
  const doc = {
    documentElement: el, body: el, head: el,
    createElement: (t) => (t === 'canvas' ? canvas : el),
    getElementById: () => null,
    querySelector: (q) => (q === 'canvas' ? canvas : null),
    querySelectorAll: () => [], addEventListener: noop, removeEventListener: noop,
    dispatchEvent: noop, hidden: false, visibilityState: 'visible',
  };
  const events = [];
  const realMove = function originalUpdateMovement() {};
  const world = {
    camera: {
      position: { x: 0, y: 0, z: 0, set() {}, clone() { return this; } },
      rotation: { x: 0, y: 0, z: 0 }, lookAt() {}, quaternion: {},
      // facing() reads the heading through this; the mousemove handler below turns it
      getWorldDirection(v) { v.x = Math.sin(world.camera.rotation.y); v.y = 0; v.z = Math.cos(world.camera.rotation.y); return v; },
    },
    scene: { children: [], add() {}, remove() {} },
    updateMovement: realMove, updateHover: function originalUpdateHover() {},
    isPointerLocked: false, portals: [],
    portalIndex: [{ name: 'Crystal Caverns', x: 0, y: 0, z: -50 }],
  };
  const win = {
    worldNavigator: world, __events: events, __realMove: realMove,
    document: doc, addEventListener: (t, f) => {}, removeEventListener: noop,
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: (cb) => { win.__raf = (win.__raf || 0) + 1; return setTimeout(() => cb(Date.now()), 16); },
    performance: { now: () => Date.now() },
    location: { href: 'http://x/', search: '', hash: '', pathname: '/' },
    navigator: { userAgent: 'node' }, console,
    KeyboardEvent: function () {}, MouseEvent: function () {}, Event: function () {},
    parent: null, innerWidth: 800, innerHeight: 600,
  };
  win.window = win; win.self = win; win.top = win;
  win.THREE = { Vector3: class { constructor() { this.x = 0; this.y = 0; this.z = 0; } } };
  win.dispatchEvent = (ev) => {
    events.push({ type: ev.type, key: ev.key });
    // turn the head, so aim()'s calibration finds a real radians-per-unit and its loop
    // can actually converge — otherwise travel() returns before it ever walks or clicks
    if (ev.type === 'mousemove' && typeof ev.movementX === 'number') {
      world.camera.rotation.y -= ev.movementX * 0.0025;
    }
    return true;
  };
  doc.dispatchEvent = win.dispatchEvent;
  win.KeyboardEvent = function (type, o) { this.type = type; this.key = (o || {}).key; };
  // ...and mouse events must carry their type too. The placeholder above set nothing, so
  // every mousemove recorded as `type: undefined` and any case filtering for them measured
  // an empty list — a verb that never ran and a verb that ran perfectly looked identical.
  win.MouseEvent = function (type, o) { this.type = type; Object.assign(this, o || {}); };
  const ctx = vm.createContext(win);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  const d = win.__autodrive;
  if (d) { d.__win = win; }
  return d;
}

(async () => {
  const d = makeDriver(process.argv[2] || 'ai/autodrive.js');
  if (!d) { console.log('FAIL: driver did not attach'); process.exit(1); }
  const R = {};
  const step = { do: 'wait', ms: 10 };
  const win = d.__win;
  // Start a session the way an operator action does, and hand it back for the cases that
  // need to issue work under it.
  const openSession = async () => { await d.run({ steps: [step] }, null); return d._session; };

  // 0) THE FRESH PAGE. A driver that has never run anything has no session at all; the
  //    first operator action must open one and work. (Under the old counter model this
  //    case caught generation 0 being falsy, which sent every page's first turn down the
  //    operator branch to cancel itself. Sessions are objects, so that shape cannot recur
  //    — the case stays because the behaviour it pins still matters.)
  R['0_first_run_on_a_fresh_driver'] =
    { sessionBefore: d._session, verdict: await d.run({ steps: [step] }, null), alive: !!(d._session && d._session.alive) };

  // A) work issued BY a session must not cancel the session that issued it
  const sA = await openSession();
  const a = [];
  for (let i = 0; i < 3; i++) a.push(await d.run({ steps: [step] }, null, { session: sA }));
  R.A_issued_work_does_not_cancel_its_own_session =
    { verdicts: a, stillAlive: sA.alive, stillCurrent: d._session === sA };

  // B) a stop kills the session
  const sB = await openSession();
  d.stop();
  R.B_stop_kills_the_session = { alive: sB.alive };

  // C) work issued by a killed session must refuse, and run no steps
  const ranC = [];
  R.C_work_from_a_killed_session_refuses =
    { verdict: await d.run({ steps: [step, step] }, (v) => ranC.push(v), { session: sB }), stepsRan: ranC.length };

  // D) the operator can always start again
  R.D_operator_restart = await d.run({ steps: [step] }, null);

  // E) a throwing onStep escapes run(), but must not strand the depth counter
  const beforeE = d._depth;
  let escaped = null;
  try { await d.run({ steps: [step] }, () => { throw new Error('onStep blew up'); }); }
  catch (e) { escaped = e.message; }
  R.E_depth_after_throwing_onStep = { before: beforeE, after: d._depth, escaped };

  // F) an operator run must work while earlier work is PARKED. A turn waiting on an
  //    un-timeoutable auth.chat holds a frame open forever; treating that as "I am nested"
  //    made the tower, the CLI and the budget silently refuse every new program.
  d.stop();
  const parked = d.run({ steps: [{ do: 'wait', ms: 60000 }] }, null);   // never awaited
  await new Promise((r) => setTimeout(r, 120));
  const parkedSession = d._session;
  const depthWhileParked = d._depth;
  d.stop();                                          // the operator kills it
  R.F_operator_run_while_parked =
    { depthWhileParked, verdict: await d.run({ steps: [step] }, null), depth: d._depth };

  // G) ...and that operator run must CANCEL the parked work, not run beside it
  R.G_parked_work_is_cancelled =
    { parkedStillAlive: parkedSession.alive,
      staleVerdict: await d.run({ steps: [step] }, null, { session: parkedSession }) };

  // I) A KILLED PROGRAM MUST STAY DEAD even while a later operator run is in flight. The
  //    old model gated the step loop on one global _running flag, which the new run set
  //    true again — so the zombie woke, finished its steps and re-entered its own loop.
  d.stop();
  let zombieSteps = 0;
  const zombie = d.run({ steps: [{ do: 'wait', ms: 300 }], loop: true }, () => { zombieSteps++; });
  await new Promise((r) => setTimeout(r, 100));
  d.stop();
  const atKill = zombieSteps;
  let liveSteps = 0;
  const live = d.run({ steps: [{ do: 'wait', ms: 250 }], loop: true }, () => { liveSteps++; });
  await new Promise((r) => setTimeout(r, 1600));
  d.stop(); void live; void zombie;
  // the step already in flight at the kill must finish — an awaited sleep cannot be
  // un-awaited — so exactly one more callback is right. Going round again is not.
  R.I_killed_program_stays_dead =
    { atKill, extra: zombieSteps - atKill, liveSteps, resumed: (zombieSteps - atKill) > 1 };

  // J) a mind step carried inside killed work must refuse rather than re-adopting whatever
  //    is live and speaking from the dead
  const sJ = await openSession();
  d.stop();
  const logs = [];
  const origLog = console.log;
  console.log = (...x) => { logs.push(x.join(' ')); };
  try { await d.mind({}, sJ); } finally { console.log = origLog; }
  R.J_mind_refuses_a_killed_session = { refused: logs.some((l) => /stopped session/.test(l)) };

  // K) THE INVARIANT: after a stop the world is as it was found. Each of these was found
  //    separately, one review round at a time; this asserts the property they share.
  d.stop();
  win.__events.length = 0;
  const walking = d.run({ steps: [{ do: 'walk', dir: 'forward', ms: 5000 }] }, null);
  await new Promise((r) => setTimeout(r, 120));
  const heldBefore = win.__events.filter((e) => e.type === 'keydown' && e.key === 'w').length;
  d.camera({ film: false });
  const stubbedLegs = win.worldNavigator.updateMovement !== win.__realMove;
  d.stop();
  await new Promise((r) => setTimeout(r, 60));
  R.K_stop_leaves_the_world_as_it_found_it = {
    heldBefore,
    keyReleased: win.__events.some((e) => e.type === 'keyup' && e.key === 'w'),
    legsWereStubbed: stubbedLegs,
    legsRestored: win.worldNavigator.updateMovement === win.__realMove,
    filming: d._filming === true,
    pointerHeld: win.worldNavigator.isPointerLocked === true,
  };
  void walking;

  // L) A VERB THAT AWAITS IS A FRAME TOO. travel() ends in a click that opens a portal and
  //    NAVIGATES THE TAB; run() checks between steps but never inside one.
  d.stop();
  win.__events.length = 0;
  const clicks = [];
  const realMouse = win.MouseEvent;
  win.MouseEvent = function (t, o) { this.type = t; if (t === 'click') clicks.push(t); Object.assign(this, o || {}); };
  const travelling = d.run({ steps: [{ do: 'travel', portal: 'Crystal Caverns' }] }, null);
  await new Promise((r) => setTimeout(r, 150));
  d.stop();
  const verdictL = await Promise.race([travelling, new Promise((r) => setTimeout(() => r('HUNG'), 4000))]);
  win.MouseEvent = realMouse;
  R.L_a_stopped_travel_does_not_open_the_door = {
    verdict: verdictL,
    clicksAfterStop: clicks.length,
    // travel -> aim -> look is what actually takes the pointer, so this is the only place
    // release()'s pointer restore can be observed. Case K asserted it where nothing had
    // ever taken the pointer, which made the assertion vacuous.
    pointerReleased: win.worldNavigator.isPointerLocked === false,
    keyStillHeld: win.__events.filter((e) => e.type === 'keydown' && e.key === 'w').length >
                  win.__events.filter((e) => e.type === 'keyup' && e.key === 'w').length,
  };

  // M) ONE CAMERA, ONE LOOP. A stop lowers _filming and a camera step in the SAME task
  //    raises it again, so the previous loop's already-scheduled callback woke, saw a bare
  //    global set to true, and ran beside the new one — two loops over one camera, each
  //    with its own angle and shot budget, doubling the vision posts. The flag says a
  //    camera is filming; the serial says which one.
  d.stop();
  d.camera({ film: false });
  await new Promise((r) => setTimeout(r, 260));
  const oneLoop = win.__raf;                       // frames driven by a single loop
  win.__raf = 0;
  d.stop(); d.camera({ film: false });             // restart within one task
  await new Promise((r) => setTimeout(r, 260));
  const afterRestart = win.__raf;
  d.stop();
  R.M_one_camera_one_loop =
    { oneLoop, afterRestart, doubled: afterRestart > oneLoop * 1.6 };

  // N) STOP *AND RESTART*, not just stop. A verb that captures its session after an await
  //    latches whatever is live by then — so the operator pressing Start (which kills the
  //    old session and opens a new one) handed a killed frame the NEW session, and travel
  //    clicked through the portal under work that had been replaced. Case L only ever
  //    pressed stop, which leaves a dead session installed and hides this completely.
  d.stop();
  win.__events.length = 0;
  const clicks2 = [];
  const realMouse2 = win.MouseEvent;
  win.MouseEvent = function (t, o) { this.type = t; if (t === 'click') clicks2.push(t); Object.assign(this, o || {}); };
  const t1 = d.run({ steps: [{ do: 'travel', portal: 'Crystal Caverns' }] }, null);
  await new Promise((r) => setTimeout(r, 10));       // inside aim's calibration await
  const killed = d._session;
  await d.run({ steps: [step] }, null);              // the operator starts something else
  await Promise.race([t1, new Promise((r) => setTimeout(r, 3000))]);
  win.MouseEvent = realMouse2;
  R.N_restart_does_not_let_killed_work_click =
    { killedAlive: killed.alive, clicksAfterRestart: clicks2.length };

  // O) a stopped scan must stop turning, and must not re-latch the pointer that the
  //    stop's teardown just released
  d.stop();
  win.__events.length = 0;
  const scanning = d.run({ steps: [{ do: 'scan', steps: 8, deg: 90 }] }, null);
  await new Promise((r) => setTimeout(r, 90));
  d.stop();
  const movesAtStop = win.__events.filter((e) => e.type === 'mousemove').length;
  await Promise.race([scanning, new Promise((r) => setTimeout(r, 2500))]);
  const movesAfter = win.__events.filter((e) => e.type === 'mousemove').length;
  R.O_a_stopped_scan_stops_turning = {
    movesAtStop, movesAfter, keptTurning: movesAfter - movesAtStop > 2,
    pointerReLatched: win.worldNavigator.isPointerLocked === true,
  };

  console.log(JSON.stringify(R, null, 1));
  const pass =
    R['0_first_run_on_a_fresh_driver'].sessionBefore === null &&
    R['0_first_run_on_a_fresh_driver'].verdict === 'done' &&
    R['0_first_run_on_a_fresh_driver'].alive === true &&
    R.A_issued_work_does_not_cancel_its_own_session.verdicts.every((v) => v === 'done') &&
    R.A_issued_work_does_not_cancel_its_own_session.stillAlive === true &&
    R.A_issued_work_does_not_cancel_its_own_session.stillCurrent === true &&
    R.B_stop_kills_the_session.alive === false &&
    R.C_work_from_a_killed_session_refuses.verdict === 'stopped' &&
    R.C_work_from_a_killed_session_refuses.stepsRan === 0 &&
    R.D_operator_restart === 'done' &&
    R.E_depth_after_throwing_onStep.after === 0 &&
    R.F_operator_run_while_parked.verdict === 'done' &&
    R.G_parked_work_is_cancelled.parkedStillAlive === false &&
    R.G_parked_work_is_cancelled.staleVerdict === 'stopped' &&
    R.I_killed_program_stays_dead.resumed === false &&
    R.J_mind_refuses_a_killed_session.refused === true &&
    R.K_stop_leaves_the_world_as_it_found_it.keyReleased === true &&
    R.K_stop_leaves_the_world_as_it_found_it.legsWereStubbed === true &&
    R.K_stop_leaves_the_world_as_it_found_it.legsRestored === true &&
    R.K_stop_leaves_the_world_as_it_found_it.filming === false &&
    R.K_stop_leaves_the_world_as_it_found_it.pointerHeld === false &&
    R.L_a_stopped_travel_does_not_open_the_door.clicksAfterStop === 0 &&
    R.L_a_stopped_travel_does_not_open_the_door.keyStillHeld === false &&
    R.M_one_camera_one_loop.oneLoop > 3 &&          // the baseline loop really ran
    R.M_one_camera_one_loop.doubled === false &&
    R.L_a_stopped_travel_does_not_open_the_door.pointerReleased === true &&
    R.N_restart_does_not_let_killed_work_click.killedAlive === false &&
    R.N_restart_does_not_let_killed_work_click.clicksAfterRestart === 0 &&
    R.O_a_stopped_scan_stops_turning.keptTurning === false &&
    R.O_a_stopped_scan_stops_turning.pointerReLatched === false;
  console.log(pass ? 'ALL PASS' : 'FAIL');
  process.exit(pass ? 0 : 1);
})();

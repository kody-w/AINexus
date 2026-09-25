/* playout.js - a views frame, played forward to any moment before the next one arrives.
 *
 * A frame on views:@kody-w/ainexus is a state, not only a picture: where every body stands, and
 * the routine its mind left it running. Nothing is captured between frames, but that state can be
 * played forward, and everyone who plays it gets the same answer. The capture plays it forward
 * before the minds wake for the next frame, and every viewer plays it forward in the meantime. So
 * the next frame starts where the last one's routines took the bodies, and a viewer that played
 * along only has to take in what the minds did by hand on that tick. The frame is the day; this
 * is the night.
 *
 * DETERMINISTIC ON PURPOSE. The world's own legs move 0.15 a frame, so how far a walk goes in the
 * engine depends on the frame rate. Here a walk is 900 cm a second (0.15 at 60 frames a second), a
 * look is 2 mrad a pixel (the engine's lookSpeed), directions come from one table of integers,
 * and every sum is an integer. The same state and the same moment give the same pose in any
 * browser and in Node.
 *
 * NIGHT. Day and night belong to the place, not the body: everyone in one place keeps its one
 * clock, by proximity, and a frame seals that clock once for all of them. From 23:00 to 07:00
 * there every body sleeps in its bed, eyes on the sky, so where each one is through the night is
 * easy to predict, and it wakes where it slept, with its routine starting over.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexusPlayout = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WALK_CM_PER_S = 900;            // moveSpeed 0.15 a frame, at 60 frames a second
  const MRAD_PER_PX = 2;                // lookSpeed 0.002 rad for each pixel of mouse look
  const TURN_MS = 250;                  // how long one look takes, played out
  const TURN = 6283;                    // a whole turn, in whole mrad
  const HALF = 3141;
  const PITCH_MAX = 1570;
  const BOUND_CM = 4500;                // the hub's plaza: portals stand at 15 m, the ground ends at 100
  const EYE_CM = 200;                   // cameraHeight 2
  const NIGHT = { from: 23, until: 7 }; // local hours asleep: [from, until)
  const SLEEP_PITCH = 1100;             // lying down, looking up
  const MAX_STEPS = 8;
  const MAX_ACT_STEPS = 4, MAX_ACT_MS = 6000;   // an act, done once at a tick, by hand
  const MAX_ANSWER = 4000, MAX_BRACKETS = 128, SAY_MAX = 140;   // what the one mind may answer
  const DIRS = ['forward', 'back', 'left', 'right'];
  const WAKE_GRID_MS = 5 * 60000;       // when a body woke is found on a five-minute grid

  // one table of integers is what every engine agrees on
  const SIN = new Int32Array(TURN), COS = new Int32Array(TURN);
  for (let i = 0; i < TURN; i++) {
    SIN[i] = Math.round(Math.sin(i / 1000) * 1e6);
    COS[i] = Math.round(Math.cos(i / 1000) * 1e6);
  }
  const wrap = m => ((m % TURN) + TURN) % TURN;
  const norm = m => { const w = wrap(m); return w > HALF ? w - TURN : w; };

  // Where each body sleeps. The beds sit outside the ring of portals, between them, and face the
  // middle of the plaza.
  const BEDS = {
    wanderer: { x_cm: 1697, y_cm: EYE_CM, z_cm: 1697, yaw_mrad: 785, pitch_mrad: SLEEP_PITCH },
    greeter:  { x_cm: -1697, y_cm: EYE_CM, z_cm: 1697, yaw_mrad: -785, pitch_mrad: SLEEP_PITCH },
    pilgrim:  { x_cm: -1697, y_cm: EYE_CM, z_cm: -1697, yaw_mrad: -2356, pitch_mrad: SLEEP_PITCH },
    watcher:  { x_cm: 1697, y_cm: EYE_CM, z_cm: -1697, yaw_mrad: 2356, pitch_mrad: SLEEP_PITCH },
  };
  const ELSEWHERE = { x_cm: 0, y_cm: EYE_CM, z_cm: 2400, yaw_mrad: 0, pitch_mrad: SLEEP_PITCH };
  // The hub's one clock, where its heartbeat and its owner are. Every body in it keeps these hours.
  const PLACE_CLOCK = 'America/New_York';

  // What a body does before any mind has told it anything: the world's own static routines.
  const DEFAULTS = {
    wanderer: [{ do: 'walk', dir: 'forward', ms: 1800 }, { do: 'look', dx: 300, dy: 0 }, { do: 'wait', ms: 600 }],
    greeter: [{ do: 'wait', ms: 2500 }, { do: 'look', dx: 350, dy: 0 }, { do: 'wait', ms: 2500 }, { do: 'look', dx: -350, dy: 0 }],
    pilgrim: [{ do: 'walk', dir: 'forward', ms: 2200 }, { do: 'wait', ms: 1200 }, { do: 'look', dx: 785, dy: 0 }],
    watcher: [{ do: 'walk', dir: 'left', ms: 1500 }, { do: 'wait', ms: 2000 }, { do: 'walk', dir: 'right', ms: 1500 },
              { do: 'wait', ms: 2000 }, { do: 'look', dx: 60, dy: 0 }],
  };

  const bed = id => Object.assign({}, BEDS[id] || ELSEWHERE);
  const defaultRoutine = id => (DEFAULTS[id] || DEFAULTS.greeter).map(step => Object.assign({}, step));

  // ── a routine or an act a mind writes, made the one shape everything plays ─
  // Numbers are cut toward zero and held to their bounds; anything else about a step is refused,
  // and one refused step refuses the whole. tools/views_seal.py keeps the same rules.
  function whole(v, lo, hi) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    return Math.min(hi, Math.max(lo, Math.trunc(v))) + 0;
  }
  function step(s) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
    if (s.do === 'walk') {
      const ms = whole(s.ms, 100, 3000);
      return DIRS.includes(s.dir) && ms !== null ? { do: 'walk', dir: s.dir, ms } : null;
    }
    if (s.do === 'look') {
      const dx = s.dx === undefined ? 0 : whole(s.dx, -2000, 2000);
      const dy = s.dy === undefined ? 0 : whole(s.dy, -600, 600);
      return dx === null || dy === null ? null : { do: 'look', dx, dy };
    }
    if (s.do === 'wait') {
      const ms = whole(s.ms, 100, 10000);
      return ms === null ? null : { do: 'wait', ms };
    }
    return null;
  }
  function stepsOf(list, most, least, longest) {
    if (!Array.isArray(list) || list.length < 1 || list.length > most) return null;
    const out = [];
    let timed = 0;
    for (const s of list) {
      const one = step(s);
      if (!one) return null;
      out.push(one);
      timed += one.do === 'look' ? TURN_MS : one.ms;
    }
    return timed >= least && timed <= longest ? out : null;
  }
  // a routine loops until a mind sets another; an act is done once, at the tick, by hand
  const canonical = list => stepsOf(list, MAX_STEPS, 300, Infinity);
  const canonicalAct = list => stepsOf(list, MAX_ACT_STEPS, 0, MAX_ACT_MS);

  // ── what the one mind answered, made the one directive everyone derives ───
  // The world mind answers in words, and anyone must be able to derive from those words exactly
  // what every body was told: the capture that carries it out, the sealer (tools/views_seal.py
  // `directive`, the same rules) and every viewer. So an answer is read one way only: the text from
  // its first '{' to its last '}' is JSON with a `bodies` object, and each awake body in it may be
  // given a line to say, an act and a routine. Whatever cannot be one of those is not heard.
  const SPACES = /[\s\x1c-\x1f\x85\ufeff]+/g;
  const LONE = /[\ud800-\udfff]/gu;
  const SPLITS = /[\u0085\u2028\u2029]|[\ud800-\udfff]/u;     // what would split a line of the chain
  // a line a body may say: whole characters, every run of space one space, cut by code point
  const CONTROL = /[\x00-\x08\x0e-\x1b\x7f]/g;       // not text: a NUL cannot even be handed to a process
  function sayLine(value, max) {
    const flat = String(value).replace(CONTROL, '').replace(LONE, '\ufffd').replace(SPACES, ' ').replace(/^ +| +$/g, '');
    const chars = Array.from(flat);
    return chars.length <= max ? flat : chars.slice(0, max - 1).join('') + '…';
  }
  // The morning after a dream: every awake body says its line from the dream, word for word,
  // whatever else it was told. tools/views_seal.py `quote` is the same function.
  function quote(told, lines, awake) {
    const out = {};
    for (const id of Object.keys(told)) out[id] = Object.assign({}, told[id]);
    for (const id of awake) {
      const line = lines && typeof lines === 'object' && Object.prototype.hasOwnProperty.call(lines, id) ? lines[id] : null;
      const had = Object.prototype.hasOwnProperty.call(out, id) ? out[id] : {};
      if (typeof line === 'string' && line) out[id] = Object.assign(had, { say: line });
    }
    return out;
  }
  function directive(answer, awake) {
    if (typeof answer !== 'string' || !answer || Array.from(answer).length > MAX_ANSWER || SPLITS.test(answer)) return null;
    const from = answer.indexOf('{'), to = answer.lastIndexOf('}');
    if (from < 0 || to < from) return null;
    const text = answer.slice(from, to + 1);
    // nesting deep enough to exhaust one engine's parser and not another's is not an answer
    if ((text.match(/[[{]/g) || []).length > MAX_BRACKETS) return null;
    let said;
    try { said = JSON.parse(text); } catch (error) { return null; }
    const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
    if (!isMap(said) || !isMap(said.bodies)) return null;
    const out = {};
    for (const id of awake) {
      const told = Object.prototype.hasOwnProperty.call(said.bodies, id) ? said.bodies[id] : null;
      if (!isMap(told)) continue;
      const one = {};
      if (typeof told.say === 'string') {
        const line = sayLine(told.say, SAY_MAX);
        if (line) one.say = line;
      }
      const act = canonicalAct(told.act);
      if (act) one.act = act;
      const routine = canonical(told.routine);
      if (routine) one.routine = routine;
      if (Object.keys(one).length) out[id] = one;
    }
    return out;
  }

  // ── the kinematics ────────────────────────────────────────────────────────
  const duration = s => s.do === 'look' ? TURN_MS : s.ms;
  function held(x, z) {
    const r2 = x * x + z * z;
    if (r2 <= BOUND_CM * BOUND_CM) return [x, z];
    const r = Math.sqrt(r2);
    return [Math.trunc(x * BOUND_CM / r) + 0, Math.trunc(z * BOUND_CM / r) + 0];
  }
  // a pose `ms` into one step, from the pose that began it
  function advance(p, s, ms) {
    if (s.do === 'walk') {
      const i = wrap(p.yaw_mrad), sn = SIN[i], cs = COS[i];
      // the engine looks down -z: forward is (-sin, -cos), right is (cos, -sin)
      const f = s.dir === 'forward' ? [-sn, -cs] : s.dir === 'back' ? [sn, cs]
        : s.dir === 'left' ? [-cs, sn] : [cs, -sn];
      const d = Math.trunc(WALK_CM_PER_S * ms / 1000);
      const [x, z] = held(p.x_cm + Math.trunc(d * f[0] / 1e6), p.z_cm + Math.trunc(d * f[1] / 1e6));
      return { x_cm: x, y_cm: p.y_cm, z_cm: z, yaw_mrad: p.yaw_mrad, pitch_mrad: p.pitch_mrad };
    }
    if (s.do === 'look') {
      const turned = Math.trunc(s.dx * MRAD_PER_PX * ms / TURN_MS);
      const tilted = Math.trunc(s.dy * MRAD_PER_PX * ms / TURN_MS);
      return { x_cm: p.x_cm, y_cm: p.y_cm, z_cm: p.z_cm, yaw_mrad: norm(p.yaw_mrad - turned),
               pitch_mrad: Math.max(-PITCH_MAX, Math.min(PITCH_MAX, p.pitch_mrad - tilted)) };
    }
    return Object.assign({}, p);
  }

  // A routine played for `elapsed` ms from `start`, step by step. It cannot be skipped ahead a lap
  // at a time, because the edge of the plaza makes where a lap ends depend on where it began.
  // A cursor remembers the last whole step it reached, so asking again for a later moment only
  // plays what is new: a viewer asks sixty times a second.
  function cursor(start, steps) {
    let t0 = 0, p0 = Object.assign({}, start), i0 = 0;
    return function at(elapsed) {
      // a moment that is not a number is no moment: the body stays where it began
      if (!Number.isFinite(elapsed)) return Object.assign({}, start);
      let t = Math.max(0, Math.trunc(elapsed));
      if (!steps || !steps.length) return Object.assign({}, start);
      if (t < t0) { t0 = 0; p0 = Object.assign({}, start); i0 = 0; }
      let p = p0, i = i0, left = t - t0;
      for (;;) {
        const s = steps[i], d = duration(s);
        if (!(d > 0)) return p;           // a step that takes no time would never let this loop end
        if (left < d) { t0 = t - left; p0 = p; i0 = i; return advance(p, s, left); }
        p = advance(p, s, d);
        left -= d;
        i = (i + 1) % steps.length;
      }
    };
  }
  const play = (start, steps, elapsed) => cursor(start, steps)(elapsed);

  // ── the clock ─────────────────────────────────────────────────────────────
  // a clock this engine can read, or the hub's own: a line may name a zone this browser has never heard of
  function validClock(tz) {
    if (typeof tz === 'string' && tz) {
      try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch (error) {}
    }
    return PLACE_CLOCK;
  }
  const hours = new Map();
  function localHour(tz, ms) {
    let f = hours.get(tz);
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
      hours.set(tz, f);
    }
    const parts = f.formatToParts(new Date(ms));
    const get = type => Number((parts.find(p => p.type === type) || {}).value);
    return { hour: get('hour') % 24, minute: get('minute') };
  }
  function asleepAt(tz, ms) {
    const { hour } = localHour(tz, ms);
    return NIGHT.from > NIGHT.until ? (hour >= NIGHT.from || hour < NIGHT.until)
                                    : (hour >= NIGHT.from && hour < NIGHT.until);
  }
  function clockText(tz, ms) {
    const { hour, minute } = localHour(tz, ms);
    return tz.split('/').pop().replace(/_/g, ' ') + ' ' + String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
  }
  // The last moment in (from, to] at which a body asleep at some point after `from` woke; null when
  // it slept through none of that span. Waking is looked for on the five-minute marks of the clock
  // itself, not of the frame: every real timezone is a whole number of quarter hours from UTC, so
  // 07:00 anywhere is one of those marks, and a tick a second past it still finds the body awake.
  const woken = new Map();
  function wokeAt(tz, from, to) {
    if (!(to > from) || !Number.isFinite(from) || !Number.isFinite(to)) return null;
    const key = tz + '|' + from + '|' + Math.floor(to / WAKE_GRID_MS);
    if (woken.has(key)) return woken.get(key);
    let woke = null, sleeping = asleepAt(tz, from);
    for (let t = (Math.floor(from / WAKE_GRID_MS) + 1) * WAKE_GRID_MS; t <= to; t += WAKE_GRID_MS) {
      const now = asleepAt(tz, t);
      if (sleeping && !now) woke = t;
      sleeping = now;
    }
    if (woken.size > 256) woken.clear();
    woken.set(key, woke);
    return woke;
  }

  // ── a sealed body, at any moment after its frame ──────────────────────────
  // `entry` is a player as a frame seals it: { id, at, routine?, clock? }, where clock is the one
  // its frame keeps (views.clock; a line sealed before places had one named a clock per body).
  // `frameMs` is when its frame was captured. The answer is where it is and what it is doing at `ms`.
  // A tracker follows one sealed body forward, keeping its place: a viewer asks it again every
  // animation frame, and only the time since the last answer is played.
  function tracker(entry, frameMs) {
    const id = entry.id;
    const tz = validClock(entry.clock);
    const steps = entry.routine ? canonical(entry.routine.steps) : null;
    let from = null, run = null, risen = null;
    return function at(ms) {
      if (asleepAt(tz, ms)) return { pose: bed(id), asleep: true, since: null, tz };
      const woke = wokeAt(tz, frameMs, ms);
      const start = woke !== null ? woke : frameMs;
      if (start !== from) {
        from = start;
        // waking up means sitting up: eyes level before the routine starts over
        risen = woke !== null || !entry.at ? Object.assign(bed(id), { pitch_mrad: 0 }) : Object.assign({}, entry.at);
        run = steps ? cursor(risen, steps) : null;
      }
      return { pose: run ? run(ms - from) : Object.assign({}, risen), asleep: false, since: from, tz };
    };
  }
  const stateAt = (entry, frameMs, ms) => tracker(entry, frameMs)(ms);

  function summary(steps) {
    return (steps || []).map(s => s.do).join(', ');
  }

  return { canonical, canonicalAct, directive, quote, sayLine, play, cursor, stateAt, tracker, validClock, asleepAt, wokeAt,
           clockText, bed, defaultRoutine, summary, duration, WALK_CM_PER_S, MRAD_PER_PX, TURN_MS, BOUND_CM, NIGHT,
           BEDS, PLACE_CLOCK, MAX_ACT_STEPS, MAX_ACT_MS, MAX_ANSWER, SAY_MAX };
}));

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
 * NIGHT. Each body keeps the hours of its own timezone, spread around the globe so the world is
 * never asleep all at once. From 23:00 to 07:00 local time it sleeps in its bed, eyes on the sky,
 * and it wakes where it slept, with its routine starting over.
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

  // Where each body sleeps, and whose hours it keeps. The beds sit outside the ring of portals,
  // between them, and face the middle of the plaza.
  const HOMES = {
    wanderer: { tz: 'Asia/Tokyo',       bed: { x_cm: 1697, y_cm: EYE_CM, z_cm: 1697, yaw_mrad: 785, pitch_mrad: SLEEP_PITCH } },
    greeter:  { tz: 'America/New_York', bed: { x_cm: -1697, y_cm: EYE_CM, z_cm: 1697, yaw_mrad: -785, pitch_mrad: SLEEP_PITCH } },
    pilgrim:  { tz: 'Europe/London',    bed: { x_cm: -1697, y_cm: EYE_CM, z_cm: -1697, yaw_mrad: -2356, pitch_mrad: SLEEP_PITCH } },
    watcher:  { tz: 'Australia/Sydney', bed: { x_cm: 1697, y_cm: EYE_CM, z_cm: -1697, yaw_mrad: 2356, pitch_mrad: SLEEP_PITCH } },
  };
  const ELSEWHERE = { tz: 'America/New_York', bed: { x_cm: 0, y_cm: EYE_CM, z_cm: 2400, yaw_mrad: 0, pitch_mrad: SLEEP_PITCH } };

  // What a body does before any mind has told it anything: the world's own static routines.
  const DEFAULTS = {
    wanderer: [{ do: 'walk', dir: 'forward', ms: 1800 }, { do: 'look', dx: 300, dy: 0 }, { do: 'wait', ms: 600 }],
    greeter: [{ do: 'wait', ms: 2500 }, { do: 'look', dx: 350, dy: 0 }, { do: 'wait', ms: 2500 }, { do: 'look', dx: -350, dy: 0 }],
    pilgrim: [{ do: 'walk', dir: 'forward', ms: 2200 }, { do: 'wait', ms: 1200 }, { do: 'look', dx: 785, dy: 0 }],
    watcher: [{ do: 'walk', dir: 'left', ms: 1500 }, { do: 'wait', ms: 2000 }, { do: 'walk', dir: 'right', ms: 1500 },
              { do: 'wait', ms: 2000 }, { do: 'look', dx: 60, dy: 0 }],
  };

  const home = id => HOMES[id] || ELSEWHERE;
  const bed = id => Object.assign({}, home(id).bed);
  const clockOf = id => home(id).tz;
  const defaultRoutine = id => (DEFAULTS[id] || DEFAULTS.greeter).map(step => Object.assign({}, step));

  // ── a routine a mind writes, made the one shape everything plays ──────────
  // Numbers are cut toward zero and held to their bounds; anything else about a step is refused,
  // and one refused step refuses the routine. tools/views_seal.py keeps the same rules.
  function whole(v, lo, hi) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    return Math.min(hi, Math.max(lo, Math.trunc(v))) + 0;
  }
  function canonical(steps) {
    if (!Array.isArray(steps) || steps.length < 1 || steps.length > MAX_STEPS) return null;
    const out = [];
    let timed = 0;
    for (const s of steps) {
      if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
      if (s.do === 'walk') {
        const ms = whole(s.ms, 100, 3000);
        if (!DIRS.includes(s.dir) || ms === null) return null;
        out.push({ do: 'walk', dir: s.dir, ms });
        timed += ms;
      } else if (s.do === 'look') {
        const dx = s.dx === undefined ? 0 : whole(s.dx, -2000, 2000);
        const dy = s.dy === undefined ? 0 : whole(s.dy, -600, 600);
        if (dx === null || dy === null) return null;
        out.push({ do: 'look', dx, dy });
        timed += TURN_MS;
      } else if (s.do === 'wait') {
        const ms = whole(s.ms, 100, 10000);
        if (ms === null) return null;
        out.push({ do: 'wait', ms });
        timed += ms;
      } else {
        return null;
      }
    }
    return timed >= 300 ? out : null;
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
  // The last moment in (from, to] at which a body asleep at some point after `from` woke, on the
  // grid every player of the line agrees on; null when it slept through none of that span.
  const woken = new Map();
  function wokeAt(tz, from, to) {
    if (!(to > from)) return null;
    const key = tz + '|' + from + '|' + Math.floor((to - from) / WAKE_GRID_MS);
    if (woken.has(key)) return woken.get(key);
    let woke = null, sleeping = asleepAt(tz, from);
    for (let t = from + WAKE_GRID_MS; t <= to; t += WAKE_GRID_MS) {
      const now = asleepAt(tz, t);
      if (sleeping && !now) woke = t;
      sleeping = now;
    }
    if (woken.size > 256) woken.clear();
    woken.set(key, woke);
    return woke;
  }

  // ── a sealed body, at any moment after its frame ──────────────────────────
  // `entry` is a player as a frame seals it: { id, at, routine?, clock? }. `frameMs` is when its
  // frame was captured. The answer is where it is and what it is doing at `ms`.
  // A tracker follows one sealed body forward, keeping its place: a viewer asks it again every
  // animation frame, and only the time since the last answer is played.
  function tracker(entry, frameMs) {
    const id = entry.id;
    const tz = entry.clock || clockOf(id);
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

  return { canonical, play, cursor, stateAt, tracker, asleepAt, wokeAt, clockText, clockOf, bed, defaultRoutine,
           summary, duration, WALK_CM_PER_S, MRAD_PER_PX, TURN_MS, BOUND_CM, NIGHT, HOMES };
}));

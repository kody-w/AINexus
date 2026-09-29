/* kestrel.js — the roost's birds, each played by rule from its own verified DOGG dimension.
 *
 * Kestrel is a RAPP organism that tends kody-w/dogg. Once a day it wakes, hunts for one small fix,
 * and sleeps again. Each hunt is one rapp/1 frame on its public DOGG dimension
 * (kestrel:@kody-w/dogg-kestrel), keyed to the spine tick it woke at. Merlin, its sibling, was grown
 * from Kestrel's egg with another mind and lives on another machine; its hunts are frames on
 * merlin:@kody-w/dogg-merlin. This file turns a bird's frames into its body's routine, with no model and
 * no seat. A dimension is taken in by frame hash, and only after every frame verifies. Every pose is
 * computed from the last one, so a body flies to its new state and never snaps. The place keeps the hub's
 * clock, and at night every bird is in its box. A kestrel hovers over the field; a merlin dashes low.
 */
(function (root) {
  'use strict';

  const PLACE_CLOCK = 'America/New_York';     // the hub's place clock: one clock per place
  const BED = [23, 7];                         // everyone in the place is in bed 23:00-07:00
  const HOUR = 3600000;
  const DAY = 24 * HOUR;
  const HUNT_WINDOW = 2 * HOUR;                // a cycle lives inside this after it falls due
  const REPLAY_MS = 24000;                     // a new hunt is flown once, in 24 seconds
  const MAX_SPEED = 9;                         // metres a second: the body flies to its twin
  const MAX_TURN = 4;                          // radians a second
  const FIELD = { x: 11, y: 0.35, z: -9 };     // kody-w/dogg: the one field both birds hunt over
  const BIRDS = {
    kestrel: {
      key: 'kestrel', name: 'Kestrel', style: 'hover', stream: 'kestrel:@kody-w/dogg-kestrel',
      source: 'https://raw.githubusercontent.com/kody-w/dogg-kestrel/main/kestrel',
      spots: { perch: { x: 0, y: 3.15, z: 0 }, box: { x: -6, y: 4.35, z: 2.6 }, hover: { x: 9, y: 11, z: -7 },
               field: FIELD, rise: { x: 4, y: 7, z: -3 } }
    },
    merlin: {
      key: 'merlin', name: 'Merlin', style: 'dash', stream: 'merlin:@kody-w/dogg-merlin',
      source: 'https://raw.githubusercontent.com/kody-w/dogg-merlin/main/merlin',
      spots: { perch: { x: 4.5, y: 2.55, z: 3.5 }, box: { x: -9.5, y: 4.35, z: -1.5 }, hover: { x: 16, y: 1.4, z: -9 },
               field: FIELD, rise: { x: 8, y: 2.4, z: -1 } }
    }
  };
  const STREAM = BIRDS.kestrel.stream;
  const SOURCE = BIRDS.kestrel.source;
  const SPOTS = BIRDS.kestrel.spots;

  // ── the place's clock ─────────────────────────────────────────────────────
  function placeHour(ms, clock) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: clock || PLACE_CLOCK, hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
    }).formatToParts(new Date(ms));
    const part = (type) => Number(parts.find(p => p.type === type).value);
    return part('hour') + part('minute') / 60;
  }

  function isNight(ms, clock) {
    const h = placeHour(ms, clock);
    return h >= BED[0] || h < BED[1];
  }

  // ── what a verified frame says ────────────────────────────────────────────
  function hunt(frame) {
    const p = frame.payload || {};
    const immune = p.immune || {};
    return {
      seq: frame.seq, frame_hash: frame.frame_hash, cycle: p.cycle, tick: p.tick, tick_utc: p.tick_utc,
      woke_utc: p.woke_utc, elapsed_seconds: p.elapsed_seconds, verdict: String(p.verdict || 'unknown'),
      subject: p.proposal && p.proposal.subject ? String(p.proposal.subject) : null,
      immune: { passed: Number(immune.passed) || 0, total: Number(immune.total) || 0 },
      adopted: (p.rechecked || []).filter(r => r && r.status === 'adopted').length,
      waiting: (p.rechecked || []).filter(r => r && r.status === 'pending').length,
      organism_frame: p.organism_frame || null
    };
  }

  // Take in a dimension: every frame must verify as one rapp/1 chain on the bird's own stream (Kestrel's by default).
  async function takeIn(frames, verifyChain, stream) {
    const want = stream || STREAM;
    const proof = await verifyChain(frames);
    if (proof.stream_id !== want) {
      const name = want.split(':')[0];
      throw new Error('not ' + name.charAt(0).toUpperCase() + name.slice(1) + '\'s dimension: ' + proof.stream_id);
    }
    const head = frames[frames.length - 1];
    return {
      stream: want, frames: proof.frames, head: proof.head, hunts: frames.map(hunt),
      took_in: { stream: want, seq: head.seq, frame_hash: proof.head }
    };
  }

  // A public copy of the dimension: HEAD.json, then sealed epochs, then the flat tail.
  async function fetchFrames(fetchJson, fetchText, base) {
    const at = base || SOURCE;
    const meta = await fetchJson(at + '/HEAD.json');
    const count = Number(meta.count), sealed = Number(meta.sealed_epochs || 0), size = Number(meta.epoch_size || 288);
    const frames = [];
    for (let k = 0; k < sealed; k++) {
      const text = await fetchText(at + '/epochs/' + k + '.jsonl');
      for (const line of text.split('\n')) if (line.trim()) frames.push(JSON.parse(line));
    }
    for (let n = sealed * size; n < count; n++) frames.push(await fetchJson(at + '/' + n + '.json'));
    if (frames.length !== count) throw new Error('HEAD.json says ' + count + ' frames, the copy holds ' + frames.length);
    return frames;
  }

  // ── the routine the rules write ───────────────────────────────────────────
  function cadence(hunts) {
    const times = hunts.map(h => Date.parse(h.woke_utc)).filter(Number.isFinite);
    const gaps = [];
    for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] >= HOUR) gaps.push(times[i] - times[i - 1]);
    if (!gaps.length) return DAY;
    gaps.sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)];
  }

  function verdictLine(h) {
    if (h.verdict === 'accepted') {
      return 'I caught one: “' + (h.subject || 'a small fix') + '”, and my immune system passed ' +
             h.immune.passed + ' of ' + h.immune.total + ' checks before I kept it';
    }
    if (h.verdict === 'no-mutation') return 'I found nothing worth catching and came back empty';
    if (h.verdict === 'rejected') return 'my immune system made me drop what I caught';
    if (h.verdict === 'failed') return 'I missed: the hunt failed';
    return 'my frame does not say what I caught';
  }

  function outcome(verdict) {
    if (verdict === 'accepted') return 'catch';
    if (verdict === 'rejected') return 'drop';
    if (verdict === 'failed') return 'miss';
    return 'empty';
  }

  function stamp(ms, clock) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: clock || PLACE_CLOCK, weekday: 'short', hour: 'numeric', minute: '2-digit'
    }).format(new Date(ms));
  }

  function routineAt(life, now, clock) {
    const last = life && life.hunts.length ? life.hunts[life.hunts.length - 1] : null;
    const gifts = last ? last.adopted : 0;
    if (isNight(now, clock)) {
      return { routine: 'roost', gifts,
               say: 'Night in my place (New York time): I sleep in my box until morning, like everyone here.' };
    }
    if (!last) {
      return { routine: 'perch', gifts, say: 'I have not read my dimension yet, so I keep to my post.' };
    }
    const due = Date.parse(last.woke_utc) + cadence(life.hunts);
    if (now >= due && now < due + HUNT_WINDOW) {
      return { routine: 'hunt', gifts,
               say: 'Out hunting: cycle ' + (last.cycle + 1) + ' fell due ' + stamp(due, clock) +
                    '. My next frame will say what I caught.' };
    }
    const kept = gifts ? ' ' + gifts + (gifts === 1 ? ' catch' : ' catches') + ' of mine were adopted.' : '';
    if (now >= due + HUNT_WINDOW) {
      return { routine: 'perch', gifts,
               say: 'No hunt since cycle ' + last.cycle + ' (spine tick ' + last.tick + '): my heart is resting or my ' +
                    'budget is spent. Then, ' + verdictLine(last) + '.' + kept };
    }
    return { routine: 'perch', gifts,
             say: 'Between hunts. Cycle ' + last.cycle + ' at spine tick ' + last.tick + ': ' + verdictLine(last) + '.' + kept };
  }

  function replayPlan(h, startedMs) {
    return { routine: 'replay', hunt: h, started: startedMs, outcome: outcome(h.verdict),
             say: 'Cycle ' + h.cycle + ' at spine tick ' + h.tick + ': ' + verdictLine(h) + '.' };
  }

  // ── poses: targets the rules name, and a body that only ever flies toward them ──
  const lerp = (a, b, s) => a + (b - a) * s;
  const mix = (p, q, s) => ({ x: lerp(p.x, q.x, s), y: lerp(p.y, q.y, s), z: lerp(p.z, q.z, s) });
  const ease = (s) => s * s * (3 - 2 * s);
  const span = (s, a, b) => Math.min(1, Math.max(0, (s - a) / (b - a)));

  // A merlin hunts in a fast, low circuit around the field, facing where it flies.
  function circuit(spots, t) {
    const a = 0.5 * t, r = 6;
    return { x: spots.field.x + r * Math.sin(a), y: spots.hover.y + Math.sin(t / 0.9) * 0.25,
             z: spots.field.z + r * Math.cos(a), yaw: Math.atan2(Math.cos(a), -Math.sin(a)) };
  }

  function targetAt(plan, now, bird) {
    const S = (bird || BIRDS.kestrel).spots, dash = (bird || BIRDS.kestrel).style === 'dash';
    const t = now / 1000;
    if (plan.routine === 'roost') {
      return Object.assign({}, S.box, { yaw: Math.PI * 0.5, wing: 0, flap: 0, tail: 0, head: 0, asleep: 1, carrying: 0 });
    }
    if (plan.routine === 'hunt') {
      if (dash) return Object.assign(circuit(S, t), { wing: 1, flap: 10, tail: 0.3, head: -0.3, asleep: 0, carrying: 0 });
      return { x: S.hover.x + Math.sin(t / 3.1) * 0.6, y: S.hover.y + Math.sin(t / 1.7) * 0.25,
               z: S.hover.z + Math.cos(t / 4.3) * 0.5, yaw: -0.9, wing: 1, flap: 7, tail: 1,
               head: -0.5, asleep: 0, carrying: 0 };
    }
    if (plan.routine === 'replay') {
      const s = Math.min(1, Math.max(0, (now - plan.started) / REPLAY_MS));
      const grounded = plan.outcome === 'miss' ? 2.2 : S.field.y;
      const field = { x: S.field.x, y: grounded, z: S.field.z };
      let at, yaw = null, wing = 1, flap = 5, tail = 0.6, head = 0;
      if (dash) {
        const c = circuit(S, t);
        if (s < 0.1) { at = mix(S.perch, S.rise, ease(span(s, 0, 0.1))); flap = 10; }
        else if (s < 0.5) { at = mix(S.rise, c, ease(span(s, 0.1, 0.18))); yaw = c.yaw; flap = 10; tail = 0.3; head = -0.3; }
        else if (s < 0.6) { at = mix(c, field, ease(span(s, 0.5, 0.6))); wing = 0.6; flap = 4; tail = 0.2; head = -0.9; }
        else if (s < 0.72) { at = field; wing = 1; flap = 8; head = -0.4; }
        else { at = mix(field, S.perch, ease(span(s, 0.72, 1))); flap = 8; }
      } else if (s < 0.12) { at = mix(S.perch, S.rise, ease(span(s, 0, 0.12))); flap = 9; }
      else if (s < 0.5) {
        at = mix(S.rise, S.hover, ease(span(s, 0.12, 0.3)));
        at = { x: at.x + Math.sin(t / 3.1) * 0.5, y: at.y + Math.sin(t / 1.7) * 0.2, z: at.z };
        flap = 7; tail = 1; head = -0.5;
      } else if (s < 0.62) { at = mix(S.hover, field, ease(span(s, 0.5, 0.62))); wing = 0.25; flap = 0; tail = 0.2; head = -0.9; }
      else if (s < 0.72) { at = field; wing = 1; flap = 8; head = -0.4; }
      else { at = mix(field, S.perch, ease(span(s, 0.72, 1))); flap = 6; }
      const carrying = (plan.outcome === 'catch' && s >= 0.66) || (plan.outcome === 'drop' && s >= 0.66 && s < 0.82) ? 1 : 0;
      if (s >= 0.97) { wing = 0; flap = 0; tail = 0; }
      return { x: at.x, y: at.y, z: at.z, yaw, wing, flap, tail, head, asleep: 0, carrying };
    }
    return Object.assign({}, S.perch, { yaw: Math.sin(t / 23) * 0.5, wing: 0, flap: 0, tail: 0,
                                        head: Math.sin(t / 2.3) * 0.6 + Math.sin(t / 7.1) * 0.3, asleep: 0, carrying: 0 });
  }

  function approach(value, goal, rate, dt) {
    return value + (goal - value) * Math.min(1, rate * dt);
  }

  function turn(yaw, goal, dt) {
    let d = ((goal - yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    const most = MAX_TURN * dt;
    return yaw + Math.max(-most, Math.min(most, d));
  }

  // One step of the body toward the target: never farther than MAX_SPEED allows, never a jump. A body
  // that is travelling faces where it flies; one that is hovering or perched holds the target's heading.
  function step(pose, target, dt) {
    const dx = target.x - pose.x, dy = target.y - pose.y, dz = target.z - pose.z;
    const far = Math.hypot(dx, dy, dz), most = MAX_SPEED * dt;
    const k = far > most ? most / far : 1;
    const goal = Math.hypot(dx, dz) > 1 ? Math.atan2(dx, dz)
      : (typeof target.yaw === 'number' ? target.yaw : pose.yaw);
    return {
      x: pose.x + dx * k, y: pose.y + dy * k, z: pose.z + dz * k, yaw: turn(pose.yaw, goal, dt),
      wing: approach(pose.wing, target.wing, 6, dt), flap: approach(pose.flap, target.flap, 4, dt),
      tail: approach(pose.tail, target.tail, 5, dt), head: approach(pose.head, target.head, 5, dt),
      asleep: approach(pose.asleep, target.asleep, 1.5, dt), carrying: target.carrying
    };
  }

  function restingPose(bird) {
    return Object.assign({}, (bird || BIRDS.kestrel).spots.perch,
                         { yaw: 0, wing: 0, flap: 0, tail: 0, head: 0, asleep: 0, carrying: 0 });
  }

  root.NexusKestrel = {
    STREAM, SOURCE, PLACE_CLOCK, REPLAY_MS, MAX_SPEED, SPOTS, BIRDS,
    placeHour, isNight, hunt, takeIn, fetchFrames, cadence, verdictLine, outcome, routineAt, replayPlan,
    targetAt, step, restingPose
  };
})(typeof window !== 'undefined' ? window : globalThis);

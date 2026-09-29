/* kestrel_roost.cjs — Kestrel's body is played by rule from its verified DOGG dimension, and never snaps.
 *
 * The roost (kestrel.html) takes in Kestrel's public dimension only after every frame verifies as one
 * rapp/1 chain, keeps the hub's place clock (everyone in bed 23:00-07:00 New York time), and flies
 * the body toward what the rules name, never faster than it can fly. These are those rules, run
 * without a browser.
 *
 *   node tests/kestrel_roost.cjs
 */
const assert = require('assert');
const path = require('path');
require(path.join(__dirname, '..', 'ai', 'frames.js'));
require(path.join(__dirname, '..', 'ai', 'kestrel.js'));

const F = globalThis.NexusFrames;
const K = globalThis.NexusKestrel;
const REAL = require('./kestrel_dimension.json').frames;
const MERLIN = require('./merlin_dimension.json').frames;
const M = K.BIRDS.merlin;
const NOON = Date.parse('2026-09-29T16:00:00.000Z');         // 12:00 in New York
const NIGHT = Date.parse('2026-09-29T06:00:00.000Z');        // 02:00 in New York
const HOUR = 3600000;

async function dimension(hunts, streamId) {
  const frames = [];
  let prev = null;
  for (let i = 0; i < hunts.length; i++) {
    const h = hunts[i];
    const frame = await F.buildFrame({
      lax: true, kind: 'kestrel.cycle', streamId: streamId || K.STREAM, seq: i, utc: h.woke, prev,
      payload: { tick: 1000 + i, tick_frame: 'a'.repeat(64), tick_utc: h.woke, cycle: i + 1, woke_utc: h.woke,
                 verdict: h.verdict, proposal: h.subject ? { subject: h.subject } : null,
                 immune: { passed: h.subject ? 7 : 0, total: h.subject ? 7 : 0 }, elapsed_seconds: 900,
                 rechecked: (h.adopted || []).map(status => ({ status })) }
    });
    frames.push(frame);
    prev = frame.payload_hash;
  }
  return frames;
}

function fly(plan, from, start, seconds, check, bird) {
  let pose = from;
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    const now = start + t * 1000;
    const next = K.step(pose, K.targetAt(plan(now), now, bird), dt);
    const moved = Math.hypot(next.x - pose.x, next.y - pose.y, next.z - pose.z);
    assert.ok(moved <= K.MAX_SPEED * dt + 1e-9, `the body jumped ${moved.toFixed(3)} m in one frame at ${t.toFixed(2)} s`);
    for (const angle of ['yaw', 'pitch']) {
      const d = Math.abs(Math.atan2(Math.sin(next[angle] - (pose[angle] || 0)), Math.cos(next[angle] - (pose[angle] || 0))));
      assert.ok(d <= K.MAX_TURN * dt + 1e-9, `the body snapped its ${angle} by ${d.toFixed(3)} rad in one frame`);
    }
    if (check) check(next, now);
    pose = next;
  }
  return pose;
}

(async () => {
  // the place's clock, not the body's: 23:30 and 02:00 are night, 07:00 and noon are day
  assert.strictEqual(K.isNight(Date.parse('2026-09-29T03:30:00.000Z')), true);
  assert.strictEqual(K.isNight(NIGHT), true);
  assert.strictEqual(K.isNight(Date.parse('2026-09-29T11:00:00.000Z')), false);
  assert.strictEqual(K.isNight(NOON), false);

  // the real stream: Kestrel's published frames verify and read as hunts
  const real = await K.takeIn(REAL, F.verifyChain);
  assert.strictEqual(real.frames, 5);
  assert.strictEqual(real.took_in.frame_hash, REAL[4].frame_hash, 'the dimension is taken in by its head frame hash');
  assert.deepStrictEqual(real.hunts.map(h => h.verdict), ['accepted', 'accepted', 'accepted', 'no-mutation', 'no-mutation']);
  assert.strictEqual(real.hunts[0].subject, 'site: Reject null epoch metadata in source HEADs');
  assert.strictEqual(real.hunts[4].adopted, 3);

  // nothing unverified moves the body: a changed payload, a broken link or another stream is refused
  const tampered = JSON.parse(JSON.stringify(REAL));
  tampered[3].payload.verdict = 'accepted';
  await assert.rejects(K.takeIn(tampered, F.verifyChain), /payload_hash mismatch/);
  const unlinked = JSON.parse(JSON.stringify(REAL)).filter((_, i) => i !== 2);
  await assert.rejects(K.takeIn(unlinked, F.verifyChain));
  const merlin = await dimension([{ woke: '2026-09-28T20:00:00.000Z', verdict: 'accepted', subject: 'x' }],
                                 'merlin:@kody-w/dogg-merlin');
  await assert.rejects(K.takeIn(merlin, F.verifyChain), /not Kestrel's dimension/);

  // the routine the rules write, from the frames alone
  const life = await K.takeIn(await dimension([
    { woke: '2026-09-26T16:00:00.000Z', verdict: 'accepted', subject: 'docs: fix a broken link' },
    { woke: '2026-09-27T16:00:00.000Z', verdict: 'no-mutation', adopted: ['adopted'] },
    { woke: '2026-09-28T16:00:00.000Z', verdict: 'accepted', subject: 'tests: cover the epoch seal', adopted: ['adopted', 'pending'] }
  ]), F.verifyChain);
  assert.strictEqual(K.cadence(life.hunts), 24 * HOUR);
  const between = K.routineAt(life, Date.parse('2026-09-28T20:00:00.000Z'));
  assert.strictEqual(between.routine, 'perch');
  assert.ok(between.say.includes('Cycle 3') && between.say.includes('tests: cover the epoch seal'), between.say);
  assert.strictEqual(between.gifts, 1, 'the box holds one gift for each adopted catch');
  assert.strictEqual(K.routineAt(life, NOON + 30 * 60000).routine, 'hunt', 'a cycle that fell due is out hunting');
  assert.strictEqual(K.routineAt(life, NOON + 3 * HOUR).routine, 'perch', 'a late cycle is not a hunt forever');
  const late = K.routineAt(life, NOON + 3 * HOUR).say;
  assert.ok(late.startsWith('My last verified frame is cycle 3') && late.includes('no newer frame of mine has reached'),
            'a late hunt is told as what the frames say, never as a guessed cause');
  assert.ok(!/heart|budget/.test(late), late);
  assert.strictEqual(K.routineAt(life, NIGHT).routine, 'roost', 'at night everyone in the place is in bed');
  assert.strictEqual(K.routineAt(null, NOON).routine, 'perch');

  // a new frame is flown once, and the body lines up with the state it implies without a jump
  const start = NOON;
  const catchPlan = K.replayPlan(life.hunts[2], start);
  let carried = false;
  const landed = fly(() => catchPlan, K.restingPose(), start, K.REPLAY_MS / 1000 + 6, (p) => { carried = carried || !!p.carrying; });
  assert.ok(carried, 'an accepted hunt comes home carrying its catch');
  assert.ok(Math.hypot(landed.x - K.SPOTS.perch.x, landed.y - K.SPOTS.perch.y, landed.z - K.SPOTS.perch.z) < 0.05,
            'after the hunt the body is back on its perch, where the frame says it rests');
  let lowest = Infinity;
  fly(() => K.replayPlan(Object.assign({}, life.hunts[2], { verdict: 'failed' }), start), K.restingPose(), start,
      K.REPLAY_MS / 1000, (p) => { lowest = Math.min(lowest, p.y); assert.ok(!p.carrying); });
  assert.ok(lowest > 1.5, 'a failed hunt pulls up before the grass');
  fly(() => K.replayPlan(life.hunts[1], start), K.restingPose(), start, K.REPLAY_MS / 1000,
      (p) => assert.ok(!p.carrying, 'an empty hunt carries nothing'));
  let dropped = false, held = false;
  fly(() => K.replayPlan(Object.assign({}, life.hunts[2], { verdict: 'rejected' }), start), K.restingPose(), start,
      K.REPLAY_MS / 1000 + 2, (p, now) => { if (p.carrying) held = true; if (held && !p.carrying) dropped = true; });
  assert.ok(held && dropped, 'a rejected catch is dropped before the body lands');

  // from its perch to the hunt and on to the box: every change of routine is flown, never snapped
  const hovering = fly(() => ({ routine: 'hunt' }), K.restingPose(), start, 8);
  assert.ok(Math.hypot(hovering.x - K.SPOTS.hover.x, hovering.z - K.SPOTS.hover.z) < 1.5, 'it reaches the hover');
  const asleep = fly(() => ({ routine: 'roost' }), hovering, start, 12);
  assert.ok(asleep.asleep > 0.9 && Math.hypot(asleep.x - K.SPOTS.box.x, asleep.y - K.SPOTS.box.y) < 0.05);

  // Merlin, Kestrel's sibling on another machine: its own real stream, never taken for Kestrel's or the reverse
  const merlinLife = await K.takeIn(MERLIN, F.verifyChain, M.stream);
  assert.strictEqual(merlinLife.frames, 4);
  assert.strictEqual(merlinLife.took_in.frame_hash, MERLIN[3].frame_hash);
  assert.deepStrictEqual(merlinLife.hunts.map(h => h.verdict), ['accepted', 'accepted', 'accepted', 'accepted']);
  assert.strictEqual(merlinLife.hunts[3].adopted, 3);
  await assert.rejects(K.takeIn(MERLIN, F.verifyChain), /not Kestrel's dimension/);
  await assert.rejects(K.takeIn(REAL, F.verifyChain, M.stream), /not Merlin's dimension/);
  assert.strictEqual(K.routineAt(merlinLife, NIGHT).routine, 'roost', 'one clock for every bird in the place');

  // a merlin dashes low where a kestrel hovers, comes home with its catch, and lands on its own perch
  let highest = -Infinity, merlinCarried = false;
  const merlinHome = fly(() => K.replayPlan(merlinLife.hunts[3], start), K.restingPose(M), start, K.REPLAY_MS / 1000 + 6,
                         (p) => { highest = Math.max(highest, p.y); merlinCarried = merlinCarried || !!p.carrying; }, M);
  assert.ok(highest < 3.2, `a merlin hunts low, not ${highest.toFixed(2)} m up`);
  assert.ok(merlinCarried, 'its accepted hunt comes home with a catch');
  assert.ok(Math.hypot(merlinHome.x - M.spots.perch.x, merlinHome.y - M.spots.perch.y, merlinHome.z - M.spots.perch.z) < 0.05);
  let kestrelHighest = -Infinity;
  fly(() => K.replayPlan(real.hunts[0], start), K.restingPose(), start, K.REPLAY_MS / 1000, (p) => { kestrelHighest = Math.max(kestrelHighest, p.y); });
  assert.ok(kestrelHighest > 9, 'a kestrel climbs to hover');
  const dashing = fly(() => ({ routine: 'hunt' }), K.restingPose(M), start, 10, null, M);
  assert.ok(Math.abs(Math.hypot(dashing.x - M.spots.field.x, dashing.z - M.spots.field.z) - 6) < 1.5, 'it circles the field');
  const tangent = K.targetAt({ routine: 'hunt' }, start + 10000, M);
  const ahead = K.targetAt({ routine: 'hunt' }, start + 10100, M);
  const along = Math.atan2(ahead.x - tangent.x, ahead.z - tangent.z);
  assert.ok(Math.abs(Math.atan2(Math.sin(along - tangent.yaw), Math.cos(along - tangent.yaw))) < 0.1, 'it faces where it flies');
  const merlinAsleep = fly(() => ({ routine: 'roost' }), dashing, start, 14, null, M);
  assert.ok(merlinAsleep.asleep > 0.9 && Math.hypot(merlinAsleep.x - M.spots.box.x, merlinAsleep.y - M.spots.box.y) < 0.05,
            'it sleeps in its own box');
  assert.ok(Math.hypot(M.spots.box.x - K.SPOTS.box.x, M.spots.box.z - K.SPOTS.box.z) > 3, 'two birds, two boxes');
  assert.ok(Math.hypot(M.spots.perch.x - K.SPOTS.perch.x, M.spots.perch.z - K.SPOTS.perch.z) > 3, 'two birds, two perches');

  // a public copy is read the way DOGG publishes it: sealed epochs, then the flat tail
  const pages = { 'HEAD.json': { count: 5, sealed_epochs: 2, epoch_size: 2 },
                  'epochs/0.jsonl': REAL.slice(0, 2).map(f => JSON.stringify(f)).join('\n') + '\n',
                  'epochs/1.jsonl': REAL.slice(2, 4).map(f => JSON.stringify(f)).join('\n') + '\n', '4.json': REAL[4] };
  const at = (url) => pages[url.slice('src/'.length)];
  const read = await K.fetchFrames(async u => at(u), async u => at(u), 'src');
  assert.deepStrictEqual(read.map(f => f.seq), [0, 1, 2, 3, 4]);
  pages['HEAD.json'] = { count: 6, sealed_epochs: 2, epoch_size: 2 };
  await assert.rejects(K.fetchFrames(async u => { const v = at(u); if (v === undefined) throw new Error('404 ' + u); return v; },
                                     async u => at(u), 'src'), /404/, 'a copy missing a frame its HEAD names is refused');

  // a moving body faces where it moves, not sideways: in every fast frame of a replay, heading and bearing agree
  let fast = 0, facing = 0, prev = null;
  fly(() => K.replayPlan(real.hunts[0], start), K.restingPose(), start, K.REPLAY_MS / 1000, (p) => {
    if (prev) {
      const vx = p.x - prev.x, vz = p.z - prev.z;
      if (Math.hypot(vx, vz) * 60 > 2) {
        fast++;
        const off = Math.atan2(Math.sin(Math.atan2(vx, vz) - p.yaw), Math.cos(Math.atan2(vx, vz) - p.yaw));
        if (Math.abs(off) < 0.35) facing++;
      }
    }
    prev = p;
  });
  assert.ok(fast > 100 && facing / fast > 0.85, `it faced where it flew in only ${facing} of ${fast} fast frames`);

  // only real birds are birds: inherited names are nobody
  assert.deepStrictEqual(['kestrel', 'merlin', 'constructor', '__proto__', 'toString', 5, undefined].map(K.birdKey),
                         ['kestrel', 'merlin', null, null, null, null, null]);

  // a re-read only ever moves a bird forward: a lagging copy changes nothing, a rewritten one is refused,
  // and each new hunt is flown exactly once
  const woke = (d) => ({ woke: `2026-09-${d}T16:00:00.000Z`, verdict: 'accepted', subject: 'fix ' + d });
  const takes = async (days) => K.takeIn(await dimension(days.map(woke)), F.verifyChain);
  const bird = { life: null, replays: [], plan: null };
  assert.deepStrictEqual(K.absorb(bird, await takes([21, 22, 23])).queued, [2], 'the first read remembers the last hunt');
  assert.deepStrictEqual(K.absorb(bird, await takes([21, 22])), { changed: false, queued: [], why: null });
  assert.strictEqual(bird.life.hunts.length, 3, 'a lagging copy never rolls a bird back');
  assert.deepStrictEqual(K.absorb(bird, await takes([21, 22, 23])).queued, []);
  assert.deepStrictEqual(K.absorb(bird, await takes([21, 22, 23, 24])).queued, [3]);
  assert.match(K.absorb(bird, await takes([21, 22, 25, 26, 27])).why, /no longer extends/);
  assert.match(K.absorb(bird, await takes([21, 25])).why, /no longer holds/);
  assert.deepStrictEqual(bird.replays.map(h => h.seq), [2, 3], 'each new hunt is queued once');

  // bedtime wins: a replay still in flight at 23:00 waits for the morning, and is flown then
  const flying = { life: bird.life, replays: [bird.life.hunts[3]], plan: null };
  const beforeBed = Date.parse('2026-09-30T02:59:50.000Z');         // 22:59:50 in New York
  assert.strictEqual(K.planFor(flying, beforeBed).routine, 'replay');
  assert.strictEqual(K.planFor(flying, beforeBed + 15000).routine, 'roost');
  assert.deepStrictEqual(flying.replays.map(h => h.seq), [3], 'the unfinished replay waits for morning');
  const morning = Date.parse('2026-09-30T11:00:10.000Z');             // 07:00:10 in New York
  const dawn = K.planFor(flying, morning);
  assert.deepStrictEqual([dawn.routine, dawn.hunt.seq, dawn.started], ['replay', 3, morning]);
  assert.strictEqual(K.planFor(flying, morning + K.REPLAY_MS + 1).routine, 'perch');

  console.log('kestrel roost: 2 real dimensions and 3 forged ones checked; both birds followed every rule without a jump');
})().catch(error => { console.error(error); process.exit(1); });

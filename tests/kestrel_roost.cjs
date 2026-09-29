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

function fly(plan, from, start, seconds, check) {
  let pose = from;
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    const now = start + t * 1000;
    const next = K.step(pose, K.targetAt(plan(now), now), dt);
    const moved = Math.hypot(next.x - pose.x, next.y - pose.y, next.z - pose.z);
    assert.ok(moved <= K.MAX_SPEED * dt + 1e-9, `the body jumped ${moved.toFixed(3)} m in one frame at ${t.toFixed(2)} s`);
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
  assert.ok(K.routineAt(life, NOON + 3 * HOUR).say.startsWith('No hunt since cycle 3'));
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

  console.log('kestrel roost: 1 real dimension and 3 forged ones checked; the body followed every rule without a jump');
})().catch(error => { console.error(error); process.exit(1); });

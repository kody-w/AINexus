const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { appendCapture } = require('../tools/dogg_stream.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dogg-stream-test-'));
const streamDir = path.join(root, 'stream');

function capture(id, recorded) {
  const directory = path.join(root, id);
  fs.mkdirSync(path.join(directory, 'wanderer'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'wanderer', '0000.webp'), id);
  return {
    directory,
    manifest: {
      recorded,
      world: 'index.html',
      fps: 1,
      frames: 1,
      ticks: [{ id, capturedAt: recorded }],
      players: [{
        id: 'wanderer',
        label: 'AI wanderer',
        shots: ['wanderer/0000.webp'],
        doing: [id],
        epochs: ['']
      }]
    }
  };
}

try {
  const first = capture('tick-one', '2026-08-29T00:00:00.000Z');
  const second = capture('tick-two', '2026-08-29T00:05:00.000Z');
  const third = capture('tick-three', '2026-08-29T00:10:00.000Z');
  const fourth = capture('tick-four', '2026-08-29T00:10:00.000Z');

  const firstManifest = appendCapture({
    streamDir,
    captureDir: first.directory,
    captureManifest: first.manifest,
    maxFrames: 2,
    tickSeconds: 300
  });
  appendCapture({
    streamDir,
    captureDir: second.directory,
    captureManifest: second.manifest,
    maxFrames: 2,
    tickSeconds: 300
  });
  appendCapture({
    streamDir,
    captureDir: third.directory,
    captureManifest: third.manifest,
    maxFrames: 2,
    tickSeconds: 300
  });
  const manifest = appendCapture({
    streamDir,
    captureDir: fourth.directory,
    captureManifest: fourth.manifest,
    maxFrames: 2,
    tickSeconds: 300
  });

  assert.equal(manifest.live, true);
  assert.equal(manifest.frames, 2);
  assert.equal(manifest.droppedFrames, 2);
  assert.equal(manifest.ticks.every(tick => /^[^:]+:0000$/.test(tick.id)), true);
  assert.deepEqual(manifest.ticks.map(tick => tick.capturedAt),
    ['2026-08-29T00:10:00.000Z', '2026-08-29T00:10:00.000Z']);
  assert.deepEqual(manifest.players[0].doing, ['tick-three', 'tick-four']);
  assert.notEqual(manifest.ticks[0].segment, manifest.ticks[1].segment);
  assert.match(manifest.players[0].shots[1],
    /^segments\/2026-08-29T00-10-00.000Z-[0-9a-f]{8}\//);
  assert.equal(fs.existsSync(path.join(streamDir, 'segments', firstManifest.ticks[0].segment)), false);
  assert.equal(fs.existsSync(path.join(streamDir, 'segments', manifest.ticks[1].segment)), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(streamDir, 'manifest.json'))).frames, 2);
  console.log('DOGG stream appends immutable ticks and trims its rolling window');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

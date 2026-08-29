/* dogg_stream.cjs - append a finite view capture to a bounded public DOGG timeline.
 *
 * A stream keeps immutable segment paths and one cumulative manifest. The viewer can poll that
 * manifest, hold the live edge between ticks, and scrub any frame still in the rolling window.
 *
 *   node tools/dogg_stream.cjs --source recordings/latest/manifest.json \
 *     --target /path/to/feed/recordings/live [--max-frames 2016] [--tick-seconds 300]
 */
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

function frameCount(manifest) {
  const players = manifest && Array.isArray(manifest.players) ? manifest.players : [];
  const lengths = players.flatMap(player => [
    Array.isArray(player.shots) ? player.shots.length : 0,
    Array.isArray(player.doing) ? player.doing.length : 0,
    Array.isArray(player.epochs) ? player.epochs.length : 0
  ]);
  return Math.max(0, Number(manifest && manifest.frames) || 0,
    Array.isArray(manifest && manifest.ticks) ? manifest.ticks.length : 0, ...lengths);
}

function inside(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    return candidate;
  }
  throw new Error(`${label} escapes ${root}`);
}

function safeSegmentId(raw) {
  const id = String(raw || new Date().toISOString()).replace(/[^0-9A-Za-z._-]/g, '-');
  if (!id || id === '.' || id === '..') throw new Error('capture has no usable segment id');
  return id;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.manifest-${process.pid}-${Date.now()}.tmp`);
  fs.writeFileSync(temporary, JSON.stringify(value));
  fs.renameSync(temporary, file);
}

function normalizedPlayer(player, frames) {
  const shots = Array.isArray(player.shots) ? player.shots.slice(0, frames) : [];
  const doing = Array.isArray(player.doing) ? player.doing.slice(0, frames) : [];
  const epochs = Array.isArray(player.epochs) ? player.epochs.slice(0, frames) : [];
  while (shots.length < frames) shots.push(null);
  while (doing.length < frames) doing.push('');
  while (epochs.length < frames) epochs.push('');
  return { id: player.id, label: player.label || player.id, shots, doing, epochs };
}

function captureTime(manifest, index, frames) {
  const tick = Array.isArray(manifest.ticks) ? manifest.ticks[index] : null;
  if (tick && tick.capturedAt) return tick.capturedAt;
  const end = Date.parse(manifest.recorded || manifest.updated || '');
  if (!Number.isFinite(end)) return new Date().toISOString();
  const fps = Math.max(.001, Number(manifest.fps) || 1);
  return new Date(end - ((frames - 1 - index) * 1000 / fps)).toISOString();
}

function appendCapture(options) {
  const streamDir = path.resolve(options.streamDir);
  const captureDir = path.resolve(options.captureDir);
  const capture = options.captureManifest;
  const maxFrames = Math.max(1, Number(options.maxFrames) || 2016);
  const tickSeconds = Math.max(0, Number(options.tickSeconds) || 0);
  const captureFrames = frameCount(capture);
  if (!captureFrames) throw new Error('capture contains no frames');
  if (!Array.isArray(capture.players) || !capture.players.length) throw new Error('capture contains no players');

  fs.mkdirSync(streamDir, { recursive: true });
  const manifestFile = path.join(streamDir, 'manifest.json');
  const existing = fs.existsSync(manifestFile) ? readJson(manifestFile) : {
    version: 2, live: true, stream: 'DOGG', frames: 0, ticks: [], players: []
  };
  const existingFrames = frameCount(existing);
  const segmentId = safeSegmentId(capture.segment || capture.recorded || capture.updated) +
    '-' + crypto.randomUUID().slice(0, 8);
  const segmentDir = inside(streamDir, path.resolve(streamDir, 'segments', segmentId), 'segment');
  const copied = new Map();

  function copyShot(relativeShot) {
    if (!relativeShot) return null;
    if (copied.has(relativeShot)) return copied.get(relativeShot);
    const source = inside(captureDir, path.resolve(captureDir, relativeShot), 'shot');
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
      throw new Error(`missing capture shot ${relativeShot}`);
    }
    const normalized = path.relative(captureDir, source);
    const destination = inside(segmentDir, path.resolve(segmentDir, normalized), 'shot destination');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    const streamed = path.posix.join('segments', segmentId,
      ...normalized.split(path.sep).filter(Boolean));
    copied.set(relativeShot, streamed);
    return streamed;
  }

  const previousById = new Map((existing.players || []).map(player => [
    player.id, normalizedPlayer(player, existingFrames)
  ]));
  const captureById = new Map(capture.players.map(player => [player.id, player]));
  const ids = [...new Set([...previousById.keys(), ...captureById.keys()])];
  const players = ids.map(id => {
    const previous = previousById.get(id) || normalizedPlayer({ id, label: id }, existingFrames);
    const incoming = captureById.get(id);
    let lastShot = previous.shots.length ? previous.shots[previous.shots.length - 1] : null;
    for (let frame = 0; frame < captureFrames; frame++) {
      const shot = incoming && Array.isArray(incoming.shots) ? incoming.shots[frame] : null;
      if (shot) lastShot = copyShot(shot);
      previous.shots.push(lastShot);
      previous.doing.push(incoming && Array.isArray(incoming.doing) ? incoming.doing[frame] || '' : '');
      previous.epochs.push(incoming && Array.isArray(incoming.epochs) ? incoming.epochs[frame] || '' : '');
    }
    previous.label = incoming && (incoming.label || incoming.id) || previous.label || id;
    return previous;
  });

  const ticks = Array.isArray(existing.ticks) ? existing.ticks.slice(0, existingFrames) : [];
  while (ticks.length < existingFrames) ticks.push({ id: `legacy-${ticks.length}`, capturedAt: existing.recorded || '' });
  for (let frame = 0; frame < captureFrames; frame++) {
    ticks.push({
      id: `${segmentId}:${String(frame).padStart(4, '0')}`,
      capturedAt: captureTime(capture, frame, captureFrames),
      segment: segmentId
    });
  }

  let droppedFrames = Number(existing.droppedFrames) || 0;
  const trim = Math.max(0, ticks.length - maxFrames);
  if (trim) {
    ticks.splice(0, trim);
    for (const player of players) {
      player.shots.splice(0, trim);
      player.doing.splice(0, trim);
      player.epochs.splice(0, trim);
    }
    droppedFrames += trim;
  }

  const retainedSegments = new Set();
  for (const player of players) {
    for (const shot of player.shots) {
      const match = typeof shot === 'string' && shot.match(/^segments\/([^/]+)\//);
      if (match) retainedSegments.add(match[1]);
    }
  }
  const segmentsRoot = path.join(streamDir, 'segments');
  if (fs.existsSync(segmentsRoot)) {
    for (const entry of fs.readdirSync(segmentsRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && !retainedSegments.has(entry.name)) {
        fs.rmSync(path.join(segmentsRoot, entry.name), { recursive: true, force: true });
      }
    }
  }

  const firstTick = ticks[0] || {};
  const lastTick = ticks[ticks.length - 1] || {};
  const manifest = {
    version: 2,
    live: true,
    stream: existing.stream || 'DOGG',
    recorded: firstTick.capturedAt || capture.recorded || existing.recorded || '',
    updated: lastTick.capturedAt || capture.recorded || new Date().toISOString(),
    world: capture.world || existing.world || '',
    playbackFps: Number(existing.playbackFps) || 4,
    tickSeconds: tickSeconds || Number(existing.tickSeconds) || 0,
    frames: ticks.length,
    maxFrames,
    droppedFrames,
    ticks,
    players
  };
  writeJsonAtomic(manifestFile, manifest);
  return manifest;
}

function arg(name, fallback) {
  const index = process.argv.indexOf('--' + name);
  return index > 0 ? process.argv[index + 1] : fallback;
}

if (require.main === module) {
  const source = path.resolve(arg('source', ''));
  const target = path.resolve(arg('target', ''));
  if (!arg('source', '') || !arg('target', '')) {
    console.error('usage: node tools/dogg_stream.cjs --source <manifest.json> --target <stream-dir>');
    process.exit(2);
  }
  const manifest = appendCapture({
    streamDir: target,
    captureDir: path.dirname(source),
    captureManifest: readJson(source),
    maxFrames: arg('max-frames', 2016),
    tickSeconds: arg('tick-seconds', 0)
  });
  console.log(`${manifest.frames} DOGG frames at ${target}`);
}

module.exports = { appendCapture, frameCount };

'use strict';

// Tick Tock DOGG Heist, from the outside. This suite intentionally knows nothing about the
// implementation: it serves the requested repository root at the production origin, opens the
// visible controls, and measures only the DOM and the documented window.__doggHeist contract.
const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');

const localRequire = (() => {
  for (const base of [
    process.env.PLAYWRIGHT_DIR,
    path.join(process.env.HOME || '', 'Documents/GitHub/aaa-fps')
  ]) {
    if (!base) continue;
    try {
      const candidate = createRequire(path.join(base, 'package.json'));
      candidate.resolve('playwright');
      return candidate;
    } catch (error) {}
  }
  return require;
})();
const { chromium } = localRequire('playwright');

const DEFAULT_ROOT = path.resolve(__dirname, '..', '..');
const ROOT = path.resolve(process.env.DOGG_HEIST_ROOT || DEFAULT_ROOT);
const PAGE_URL = 'https://kody-w.github.io/AINexus/dogg-heist.html';
const ARTIFACT = path.join(ROOT, 'dogg-heist.html');
const REQUIRED_IDS = [
  'play-toggle', 'step-button', 'restart-button', 'speed-select', 'timeline',
  'fork-button', 'export-button', 'import-button', 'help-button', 'game-board',
  'pov-grid', 'status-live', 'tick-value', 'branch-value', 'head-value',
  'alarm-value', 'objective-value', 'event-log'
];
const REQUIRED_METHODS = [
  'state', 'pause', 'play', 'step', 'restart', 'scrub', 'fork', 'exportState',
  'importState', 'queueDirective', 'verifyChain', 'setSpeed'
];
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.cjs': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

const results = [];
const pageErrors = [];
let browser;

function result(name, passed, detail = '') {
  results.push({ name, passed: Boolean(passed), detail: String(detail || '') });
  return Boolean(passed);
}

function requireMeasurement(condition, message) {
  if (!condition) throw new Error(`cannot measure ${message}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function poll(read, accept, timeout = 6000, interval = 50) {
  const deadline = Date.now() + timeout;
  let last;
  let lastError;
  while (Date.now() < deadline) {
    try {
      last = await read();
      if (accept(last)) return last;
    } catch (error) {
      lastError = error;
    }
    await sleep(interval);
  }
  if (lastError) throw lastError;
  throw new Error(`measurement timed out after ${timeout}ms; last value: ${JSON.stringify(last)}`);
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function materialProjection(value) {
  const omit = /(seed|rng|random|tick|clock|time|date|hash|head|branch|dimension|frame|history|chain|ledger|event|log|status|message|playing|paused|running|speed|ready|cursor|selected|viewTick|persistence|storage)/i;
  const project = (item, key = '') => {
    if (omit.test(key)) return undefined;
    if (Array.isArray(item)) return item.map(entry => project(entry, '')).filter(entry => entry !== undefined);
    if (item && typeof item === 'object') {
      const output = {};
      for (const child of Object.keys(item).sort()) {
        const projected = project(item[child], child);
        if (projected !== undefined) output[child] = projected;
      }
      return output;
    }
    return item;
  };
  return project(value);
}

function canonicalProjection(value) {
  const omit = /(wallClock|timestamp|createdAt|updatedAt|exportedAt|savedAt|lastSaved|elapsed|duration|playing|paused|running|speed|render|cursor|selectedTick|viewTick|persistence|storageStatus|statusLive)/i;
  const project = (item, key = '') => {
    if (omit.test(key)) return undefined;
    if (Array.isArray(item)) return item.map(entry => project(entry, '')).filter(entry => entry !== undefined);
    if (item && typeof item === 'object') {
      const output = {};
      for (const child of Object.keys(item).sort()) {
        const projected = project(item[child], child);
        if (projected !== undefined) output[child] = projected;
      }
      return output;
    }
    return item;
  };
  return project(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function walkJson(value, visit, trail = []) {
  visit(value, trail);
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    walkJson(child, visit, trail.concat(Array.isArray(value) ? Number(key) : key));
  }
}

function valueAt(root, trail) {
  let value = root;
  for (const key of trail) {
    if (value == null) return undefined;
    value = value[key];
  }
  return value;
}

function parentAt(root, trail) {
  return valueAt(root, trail.slice(0, -1));
}

function canonicalSha256(value) {
  return crypto.createHash('sha256').update(stable(value), 'utf8').digest('hex');
}

function hashBody(value) {
  const match = String(value || '').match(/^(sha256:)?([0-9a-f]{64})$/i);
  return match ? { prefix: match[1] || '', hex: match[2].toLowerCase() } : null;
}

function checksumMaterial(root, convention) {
  if (convention.scope === 'sibling') return cloneJson(valueAt(root, convention.scopePath));
  if (convention.scope === 'parent') {
    const parent = cloneJson(valueAt(root, convention.scopePath));
    delete parent[convention.field];
    return parent;
  }
  const copy = cloneJson(root);
  delete parentAt(copy, convention.path)[convention.field];
  return copy;
}

function findChecksumConvention(root) {
  const candidates = [];
  walkJson(root, (value, trail) => {
    if (!trail.length || typeof value !== 'string') return;
    const field = String(trail[trail.length - 1]);
    const parsed = hashBody(value);
    if (!parsed || !/(checksum|sha256|digest|integrity)/i.test(field)) return;
    const parentPath = trail.slice(0, -1);
    const parent = valueAt(root, parentPath);
    const scopes = [
      { scope: 'root', scopePath: [], score: 30 - trail.length },
      { scope: 'parent', scopePath: parentPath, score: 20 - trail.length }
    ];
    if (parent && typeof parent === 'object') {
      for (const sibling of ['payload', 'data', 'state', 'export', 'content', 'manifest']) {
        if (parent[sibling] && typeof parent[sibling] === 'object') {
          scopes.push({
            scope: 'sibling',
            scopePath: parentPath.concat(sibling),
            score: 10 - trail.length
          });
        }
      }
    }
    for (const scope of scopes) {
      const convention = Object.assign({
        path: trail,
        field,
        prefix: parsed.prefix
      }, scope);
      let material;
      try {
        material = checksumMaterial(root, convention);
      } catch (error) {
        continue;
      }
      if (canonicalSha256(material) === parsed.hex) candidates.push(convention);
    }
  });
  candidates.sort((a, b) => b.score - a.score);
  requireMeasurement(candidates.length > 0,
    'the export outer checksum convention from its own canonical JSON/SHA-256');
  return candidates[0];
}

function rewriteChecksum(root, convention) {
  const material = checksumMaterial(root, convention);
  parentAt(root, convention.path)[convention.field] =
    convention.prefix + canonicalSha256(material);
  const rewritten = hashBody(valueAt(root, convention.path));
  requireMeasurement(rewritten &&
    rewritten.hex === canonicalSha256(checksumMaterial(root, convention)),
  'a correctly recomputed canonical outer checksum');
}

function invalidRoleImport(json) {
  const parsed = JSON.parse(json);
  const convention = findChecksumConvention(parsed);
  const roles = [];
  walkJson(parsed, (value, trail) => {
    if (!trail.length || typeof value !== 'string') return;
    const field = String(trail[trail.length - 1]);
    const joined = trail.join('.');
    if (/^(role|agentRole)$/i.test(field) &&
        /(agents|crew|operatives|players|doggs|dogs)/i.test(joined)) {
      const coveredPath = convention.scope === 'root' ? [] : convention.scopePath;
      const covered = coveredPath.every((part, index) => trail[index] === part);
      roles.push({
        trail,
        score: (covered ? 50 : 0) + (/frames|history|chain/i.test(joined) ? 0 : 20) - trail.length
      });
    }
  });
  roles.sort((a, b) => b.score - a.score);
  requireMeasurement(roles.length > 0, 'an exported agent role');
  const selected = roles[0];
  parentAt(parsed, selected.trail)[selected.trail[selected.trail.length - 1]] =
    '__INVALID_DOGG_ROLE__';
  rewriteChecksum(parsed, convention);
  return {
    json: JSON.stringify(parsed),
    rolePath: selected.trail.join('.'),
    checksumPath: convention.path.join('.'),
    checksumScope: convention.scope
  };
}

function runningImport(json) {
  const parsed = JSON.parse(json);
  requireMeasurement(parsed.data && typeof parsed.data === 'object' &&
    !Array.isArray(parsed.data), 'export data for running-mode mutation');
  const convention = findChecksumConvention(parsed);
  const checksumBefore = String(valueAt(parsed, convention.path));
  requireMeasurement(parsed.data.running !== true, 'a non-running source export');
  parsed.data.running = true;
  rewriteChecksum(parsed, convention);
  const checksumAfter = String(valueAt(parsed, convention.path));
  requireMeasurement(checksumAfter !== checksumBefore,
    'running mode covered by the canonical outer checksum');
  return {
    json: JSON.stringify(parsed),
    checksumPath: convention.path.join('.'),
    checksumScope: convention.scope
  };
}

function oversizedImport(json) {
  const parsed = JSON.parse(json);
  const convention = findChecksumConvention(parsed);
  const targetBytes = 8 * 1024 * 1024 + 64 * 1024;
  parsed.importPadding = 'x'.repeat(Math.max(1, targetBytes - Buffer.byteLength(json, 'utf8')));
  rewriteChecksum(parsed, convention);
  let output = JSON.stringify(parsed);
  if (Buffer.byteLength(output, 'utf8') <= 8 * 1024 * 1024) {
    parsed.importPadding += 'x'.repeat(128 * 1024);
    rewriteChecksum(parsed, convention);
    output = JSON.stringify(parsed);
  }
  requireMeasurement(Buffer.byteLength(output, 'utf8') > 8 * 1024 * 1024,
    'a bounded import payload just over 8 MiB');
  return {
    json: output,
    bytes: Buffer.byteLength(output, 'utf8'),
    checksumPath: convention.path.join('.')
  };
}

function frameHashConvention(exported) {
  const bundle = exportedFrames(exported);
  const frames = bundle.frames;
  requireMeasurement(frames.length >= 3, 'a multi-tick frame chain');
  const hashKeys = Object.keys(frames[0]).filter(key =>
    /(hash|digest|seal)$/i.test(key) && hashBody(frames[0][key]));
  for (const hashKey of hashKeys) {
    if (!frames.every(frame => frame && typeof frame === 'object' && hashBody(frame[hashKey]))) {
      continue;
    }
    const keys = Object.keys(frames[0]).filter(key => key !== hashKey &&
      frames.every(frame => Object.prototype.hasOwnProperty.call(frame, key)));
    const parentKeys = keys.filter(key => /^(?:parent|parentHash|prev|prevHash|previousHash)$/i.test(key));
    const tickKeys = keys.filter(key => /^(?:tick|seq|index)$/i.test(key));
    const stateKeys = keys.filter(key => /^(?:state|snapshot|payload|data|world)$/i.test(key));
    if (!parentKeys.length || !tickKeys.length || !stateKeys.length) continue;
    const candidateSets = [];
    if (keys.length <= 13) {
      const limit = 1 << keys.length;
      for (let mask = 1; mask < limit; mask++) {
        const selected = keys.filter((_, index) => mask & (1 << index));
        if (!selected.some(key => parentKeys.includes(key)) ||
            !selected.some(key => tickKeys.includes(key)) ||
            !selected.some(key => stateKeys.includes(key))) continue;
        candidateSets.push(selected);
      }
    } else {
      candidateSets.push(keys);
      for (const parentKey of parentKeys) {
        for (const tickKey of tickKeys) {
          for (const stateKey of stateKeys) {
            candidateSets.push([parentKey, tickKey, stateKey]);
            for (const eventKey of keys.filter(key => /event|action|intent/i.test(key))) {
              candidateSets.push([parentKey, tickKey, stateKey, eventKey]);
            }
          }
        }
      }
    }
    candidateSets.sort((a, b) => b.length - a.length);
    for (const selectedKeys of candidateSets) {
      const matches = frames.every(frame => {
        const material = Object.fromEntries(selectedKeys.map(key => [key, frame[key]]));
        return canonicalSha256(material) === hashBody(frame[hashKey]).hex;
      });
      if (!matches) continue;
      const parentKey = parentKeys.find(key => selectedKeys.includes(key) &&
        frames.slice(1).every((frame, index) => {
          const parent = hashBody(frame[key]);
          const prior = hashBody(frames[index][hashKey]);
          return parent && prior && parent.hex === prior.hex;
        }));
      if (!parentKey) continue;
      const tickKey = tickKeys.find(key => selectedKeys.includes(key));
      if (!tickKey) continue;
      return {
        framesPath: bundle.trail,
        hashKey,
        parentKey,
        tickKey,
        selectedKeys,
        hashPrefix: hashBody(frames[0][hashKey]).prefix
      };
    }
  }
  throw new Error('cannot measure the documented canonical frame/hash material');
}

function formatHashLike(hex, sample) {
  const parsed = hashBody(sample);
  return (parsed?.prefix || '') + hex;
}

function verifyRehashedFrames(exported, convention) {
  const frames = valueAt(exported, convention.framesPath);
  return frames.every((frame, index) => {
    const material = Object.fromEntries(
      convention.selectedKeys.map(key => [key, frame[key]])
    );
    const validHash = canonicalSha256(material) === hashBody(frame[convention.hashKey])?.hex;
    const validParent = index === 0 || (
      hashBody(frame[convention.parentKey])?.hex ===
      hashBody(frames[index - 1][convention.hashKey])?.hex
    );
    return validHash && validParent;
  });
}

function rehashFrameDescendants(exported, convention, fromIndex) {
  const frames = valueAt(exported, convention.framesPath);
  const oldHead = frames[frames.length - 1][convention.hashKey];
  for (let index = fromIndex; index < frames.length; index++) {
    const frame = frames[index];
    if (index > 0) {
      frame[convention.parentKey] = formatHashLike(
        hashBody(frames[index - 1][convention.hashKey]).hex,
        frame[convention.parentKey]
      );
    }
    const material = Object.fromEntries(
      convention.selectedKeys.map(key => [key, frame[key]])
    );
    frame[convention.hashKey] = convention.hashPrefix + canonicalSha256(material);
  }
  const newHead = frames[frames.length - 1][convention.hashKey];
  walkJson(exported, (value, trail) => {
    if (!trail.length || typeof value !== 'string') return;
    if (trail.length >= convention.framesPath.length &&
        convention.framesPath.every((part, index) => trail[index] === part)) return;
    const key = String(trail[trail.length - 1]);
    if (!/head/i.test(key) || hashBody(value)?.hex !== hashBody(oldHead)?.hex) return;
    parentAt(exported, trail)[trail[trail.length - 1]] = formatHashLike(
      hashBody(newHead).hex,
      value
    );
  });
  requireMeasurement(verifyRehashedFrames(exported, convention),
    'every mutated frame hash and descendant parent link recomputed');
  return { oldHead, newHead };
}

function stateAgentEntries(state) {
  const container = agentsOf(state);
  return collectionEntries(container).map(({ key, value }) => ({
    key,
    agent: value,
    id: String(value?.id ?? value?.agentId ?? value?.callsign ?? value?.name ?? key)
  })).filter(entry => entry.agent && typeof entry.agent === 'object');
}

function setCoordinate(value, coordinate) {
  if (!value || typeof value !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(value, 'x') &&
      Object.prototype.hasOwnProperty.call(value, 'y')) {
    value.x = coordinate.x;
    value.y = coordinate.y;
    return true;
  }
  for (const key of ['position', 'pos', 'location', 'cell', 'tile', 'at', 'coordinate']) {
    if (value[key] && typeof value[key] === 'object' &&
        setCoordinate(value[key], coordinate)) return true;
  }
  return false;
}

function traversableCells(state) {
  const candidates = [];
  walkJson(state, (value, trail) => {
    const context = trail.join('.');
    if (Array.isArray(value) && value.length && value.every(row => Array.isArray(row))) {
      const cells = [];
      value.forEach((row, y) => row.forEach((cell, x) => {
        const text = typeof cell === 'string' ? cell :
          cell && typeof cell === 'object' ?
            `${cell.type || ''} ${cell.kind || ''} ${cell.status || ''} ${cell.state || ''}` : '';
        const explicit = cell && typeof cell === 'object' ?
          cell.traversable ?? cell.walkable ?? cell.passable : undefined;
        const blocked = explicit === false ||
          /\b(wall|void|blocked|impassable|closed|obstacle)\b/i.test(text) ||
          cell === '#';
        if (!blocked && (explicit === true || typeof cell === 'string' ||
            (cell && typeof cell === 'object'))) cells.push({ x, y });
      }));
      if (cells.length) {
        candidates.push({
          cells,
          score: (/facility|map|grid|board|layout/i.test(context) ? 30 : 0) + cells.length,
          source: context
        });
      }
    }
    if (Array.isArray(value) && /cells|tiles/i.test(context)) {
      const cells = value.map(cell => {
        const coordinate = coordinateOf(cell);
        if (!coordinate) return null;
        const text = `${cell.type || ''} ${cell.kind || ''} ${cell.status || ''} ${cell.state || ''}`;
        const explicit = cell.traversable ?? cell.walkable ?? cell.passable;
        if (explicit === false || /\b(wall|void|blocked|impassable|closed|obstacle)\b/i.test(text)) {
          return null;
        }
        return coordinate;
      }).filter(Boolean);
      if (cells.length) candidates.push({ cells, score: 20 + cells.length, source: context });
    }
  });
  candidates.sort((a, b) => b.score - a.score);
  requireMeasurement(candidates.length > 0, 'public traversable facility cells');
  return candidates[0];
}

function mutateAgentTeleport(exported, frameIndex) {
  const convention = frameHashConvention(exported);
  const frames = valueAt(exported, convention.framesPath);
  const state = frameState(frames[frameIndex]);
  requireMeasurement(state, `raw state in frame ${frameIndex}`);
  const agents = stateAgentEntries(state);
  requireMeasurement(agents.length > 0, `an agent in frame ${frameIndex}`);
  const chosen = agents.find(entry => coordinateOf(entry.agent)) || agents[0];
  const from = coordinateOf(chosen.agent);
  requireMeasurement(from, `agent ${chosen.id} position in frame ${frameIndex}`);
  const occupied = new Set(agents.map(entry => coordinateOf(entry.agent))
    .filter(Boolean).map(position => `${position.x},${position.y}`));
  const traversable = traversableCells(state);
  const target = traversable.cells.filter(cell =>
    !occupied.has(`${cell.x},${cell.y}`) &&
    Math.abs(cell.x - from.x) + Math.abs(cell.y - from.y) >= 4)
    .sort((a, b) =>
      (Math.abs(b.x - from.x) + Math.abs(b.y - from.y)) -
      (Math.abs(a.x - from.x) + Math.abs(a.y - from.y)))[0];
  requireMeasurement(target, `a far traversable cell for ${chosen.id}`);
  requireMeasurement(setCoordinate(chosen.agent, target),
    `writable ${chosen.id} coordinates`);
  const heads = rehashFrameDescendants(exported, convention, frameIndex);
  return {
    convention,
    frameIndex,
    detail: `${chosen.id} ${from.x},${from.y}→${target.x},${target.y} via ${traversable.source}`,
    heads
  };
}

function mutateImpossibleFixtureJump(exported, frameIndex) {
  const convention = frameHashConvention(exported);
  const frames = valueAt(exported, convention.framesPath);
  const state = frameState(frames[frameIndex]);
  requireMeasurement(state, `raw state in frame ${frameIndex}`);
  let mutation;
  walkJson(state, (value, trail) => {
    if (mutation || !value || typeof value !== 'object' || Array.isArray(value)) return;
    const identity = [
      value.id, value.name, value.type, value.kind, value.label, trail.join('.')
    ].filter(Boolean).join(' ');
    if (/\bterminals?\b/i.test(identity)) {
      if (value.hacked === false) {
        value.hacked = true;
        mutation = `${trail.join('.')}.hacked false→true`;
      } else if (value.isHacked === false) {
        value.isHacked = true;
        mutation = `${trail.join('.')}.isHacked false→true`;
      } else if (typeof value.status === 'string' &&
          /\b(unhacked|locked|inactive|ready)\b/i.test(value.status)) {
        const before = value.status;
        value.status = 'hacked';
        mutation = `${trail.join('.')}.status ${before}→hacked`;
      }
    }
    if (!mutation && /\bdoors?\b/i.test(identity)) {
      if (value.open === false) {
        value.open = true;
        mutation = `${trail.join('.')}.open false→true`;
      } else if (typeof value.status === 'string' && /\b(closed|locked)\b/i.test(value.status)) {
        const before = value.status;
        value.status = 'open';
        mutation = `${trail.join('.')}.status ${before}→open`;
      }
    }
  });
  requireMeasurement(mutation, 'an unhacked terminal or closed door in tick-1 state');
  const heads = rehashFrameDescendants(exported, convention, frameIndex);
  return { convention, frameIndex, detail: mutation, heads };
}

function fullyRehashedSemanticMutation(json, kind) {
  const parsed = JSON.parse(json);
  const checksumConvention = findChecksumConvention(parsed);
  const bundle = exportedFrames(parsed);
  const frameIndex = bundle.frames.findIndex(frame => tickOf(frameState(frame)) === 1);
  const selectedIndex = frameIndex >= 1 ? frameIndex : 1;
  const mutation = kind === 'teleport' ?
    mutateAgentTeleport(parsed, selectedIndex) :
    mutateImpossibleFixtureJump(parsed, selectedIndex);
  rewriteChecksum(parsed, checksumConvention);
  requireMeasurement(hashBody(valueAt(parsed, checksumConvention.path))?.hex ===
    canonicalSha256(checksumMaterial(parsed, checksumConvention)),
  'outer checksum after fully rehashed semantic mutation');
  return {
    json: JSON.stringify(parsed),
    detail: mutation.detail,
    frameIndex: selectedIndex,
    checksumPath: checksumConvention.path.join('.'),
    frameHashKey: mutation.convention.hashKey,
    parentKey: mutation.convention.parentKey
  };
}

function appendPostTerminalFrame(json, kind) {
  const parsed = JSON.parse(json);
  const checksumConvention = findChecksumConvention(parsed);
  const convention = frameHashConvention(parsed);
  const frames = valueAt(parsed, convention.framesPath);
  const terminalFrame = frames[frames.length - 1];
  const terminalState = frameState(terminalFrame);
  const terminalProjection = terminalState && rawFrameProjection(terminalState);
  requireMeasurement(terminalState && (
    isTerminalOutcome(terminalProjection.outcome) ||
    terminalProjection.objective.stage === 'complete'
  ),
    'a terminal head before appending an impossible frame');
  const appended = cloneJson(terminalFrame);
  const priorTick = Number(terminalFrame[convention.tickKey]);
  requireMeasurement(Number.isFinite(priorTick), 'numeric terminal frame tick');
  appended[convention.tickKey] = priorTick + 1;
  const appendedState = frameState(appended);
  requireMeasurement(appendedState, 'state in the appended post-terminal frame');
  for (const key of ['tick', 'currentTick', 'liveTick']) {
    if (Number.isFinite(Number(appendedState[key]))) appendedState[key] = priorTick + 1;
  }

  let detail;
  if (kind === 'fork') {
    let branchMutation;
    walkJson(appendedState, (value, trail) => {
      if (branchMutation || !trail.length || typeof value !== 'string') return;
      const key = String(trail[trail.length - 1]);
      if (!/^(?:branch|branchId|dimension)$/i.test(key)) return;
      const next = `${value}-post-terminal`;
      parentAt(appendedState, trail)[trail[trail.length - 1]] = next;
      branchMutation = { trail, before: value, after: next };
    });
    if (!branchMutation) {
      walkJson(appended, (value, trail) => {
        if (branchMutation || !trail.length || typeof value !== 'string') return;
        const key = String(trail[trail.length - 1]);
        if (!/^(?:branch|branchId|dimension)$/i.test(key)) return;
        const next = `${value}-post-terminal`;
        parentAt(appended, trail)[trail[trail.length - 1]] = next;
        branchMutation = { trail, before: value, after: next };
      });
    }
    requireMeasurement(branchMutation, 'a branch identifier for an appended fork frame');
    detail = `${branchMutation.trail.join('.')} ${branchMutation.before}→${branchMutation.after}`;
    const data = parsed.data;
    if (data && typeof data === 'object') {
      for (const key of ['branch', 'branchId', 'dimension']) {
        if (typeof data[key] === 'string') data[key] = branchMutation.after;
      }
    }
  } else {
    let directiveMutation;
    for (const { id, agent } of stateAgentEntries(appendedState)) {
      walkJson(agent, (value, trail) => {
        if (directiveMutation || !trail.length || typeof value !== 'string') return;
        const key = String(trail[trail.length - 1]);
        if (!/^(?:intent|action|mode|doing)$/i.test(key)) return;
        const next = /\bmove\b/i.test(value) ? 'hold' : 'move';
        parentAt(agent, trail)[trail[trail.length - 1]] = next;
        directiveMutation = { id, trail, before: value, after: next };
      });
      if (directiveMutation) break;
    }
    if (!directiveMutation) return null;
    detail = `${directiveMutation.id}.${directiveMutation.trail.join('.')} ${directiveMutation.before}→${directiveMutation.after}`;
  }

  frames.push(appended);
  const data = parsed.data;
  if (data && typeof data === 'object') {
    for (const key of ['cursor', 'selectedFrame', 'frameIndex']) {
      if (Number.isFinite(Number(data[key]))) data[key] = frames.length - 1;
    }
    for (const key of ['frameCount', 'framesCount', 'historyCount']) {
      if (Number.isFinite(Number(data[key]))) data[key] = frames.length;
    }
    for (const key of ['tick', 'currentTick', 'liveTick']) {
      if (Number.isFinite(Number(data[key]))) data[key] = priorTick + 1;
    }
  }
  const heads = rehashFrameDescendants(parsed, convention, frames.length - 1);
  rewriteChecksum(parsed, checksumConvention);
  requireMeasurement(verifyRehashedFrames(parsed, convention),
    `fully rehashed appended ${kind} frame`);
  return {
    json: JSON.stringify(parsed),
    kind,
    detail,
    tick: priorTick + 1,
    heads,
    checksumPath: checksumConvention.path.join('.')
  };
}

function findNamedValue(root, names, maxDepth = 8) {
  const wanted = new Set(names.map(name => name.toLowerCase()));
  const queue = [{ value: root, trail: [], depth: 0 }];
  while (queue.length) {
    const current = queue.shift();
    if (!current.value || typeof current.value !== 'object' || current.depth > maxDepth) continue;
    for (const [key, value] of Object.entries(current.value)) {
      const trail = current.trail.concat(key);
      if (wanted.has(key.toLowerCase())) return { value, trail };
      if (value && typeof value === 'object') {
        queue.push({ value, trail, depth: current.depth + 1 });
      }
    }
  }
  return null;
}

function coordinateOf(value) {
  if (Array.isArray(value) && value.length >= 2 &&
      Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
    return { x: Number(value[0]), y: Number(value[1]) };
  }
  if (typeof value === 'string') {
    const match = value.match(/(-?\d+)\s*[,/:]\s*(-?\d+)/);
    if (match) return { x: Number(match[1]), y: Number(match[2]) };
  }
  if (!value || typeof value !== 'object') return null;
  const x = value.x ?? value.col ?? value.column ?? value.cx;
  const y = value.y ?? value.row ?? value.cy;
  if (Number.isFinite(Number(x)) && Number.isFinite(Number(y))) {
    return { x: Number(x), y: Number(y) };
  }
  for (const key of ['position', 'pos', 'location', 'cell', 'tile', 'at', 'coordinate']) {
    const nested = coordinateOf(value[key]);
    if (nested) return nested;
  }
  return null;
}

function facilityDimensions(snapshot) {
  const latest = snapshot.exported ? latestExportFrame(snapshot.exported) : null;
  const roots = [
    snapshot.state,
    snapshot.exported && snapshot.exported.state,
    latest && latest.state,
    latest && latest.snapshot,
    latest && latest.payload && latest.payload.state,
    latest && latest.payload && latest.payload.snapshot,
    latest && latest.payload,
    latest
  ].filter(value => value && typeof value === 'object');
  const candidates = [];
  for (const root of roots) {
    walkJson(root, (value, trail) => {
      if (!value || typeof value !== 'object') return;
      const context = trail.join('.');
      if (Array.isArray(value) && value.length && value.every(row => Array.isArray(row))) {
        candidates.push({
          cols: Math.max(...value.map(row => row.length)),
          rows: value.length,
          source: context,
          score: /facility|map|grid|board|layout/i.test(context) ? 20 : 1
        });
      } else if (!Array.isArray(value)) {
        const cols = Number(value.width ?? value.cols ?? value.columns);
        const rows = Number(value.height ?? value.rows);
        if (Number.isFinite(cols) && Number.isFinite(rows) &&
            cols > 1 && rows > 1 && cols <= 200 && rows <= 200) {
          candidates.push({
            cols,
            rows,
            source: context,
            score: /facility|map|grid|board|layout/i.test(context) ? 30 : 2
          });
        }
      }
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

function agentNamed(snapshot, name) {
  const wanted = new RegExp(name, 'i');
  return snapshot.agents.find(agent => wanted.test([
    agent.id,
    agent.state && agent.state.name,
    agent.state && agent.state.callsign,
    agent.state && agent.state.label,
    agent.state && agent.state.role
  ].filter(Boolean).join(' ')));
}

function outcomeOf(state) {
  const candidates = [];
  walkJson(state, (value, trail) => {
    if (!trail.length) return;
    const key = String(trail[trail.length - 1]);
    if (/^(outcome|gameOutcome|missionOutcome)$/i.test(key) && value == null) {
      candidates.push({ value: null, text: 'null', score: 30, trail });
      return;
    }
    if (value == null || typeof value === 'object') return;
    if (/^(won|lost|complete|completed|gameOver|ended)$/i.test(key) && value === true) {
      candidates.push({ value: key, text: key, score: 25, trail });
      return;
    }
    if (!/^(outcome|result|gameOutcome|missionOutcome|missionStatus|phase|status)$/i.test(key)) return;
    const context = trail.slice(0, -1).join('.');
    if (/^(phase|status)$/i.test(key) && trail.length > 3 &&
        !/(game|mission|objective|heist|simulation)/i.test(context)) return;
    const text = String(value);
    const score = /\b(win|won|victory|success|lose|lost|loss|failure|failed|defeat)\b/i.test(text) ?
      20 : /(game|mission|objective|heist|simulation)/i.test(context) ? 5 : 1;
    if (score === 0) return;
    candidates.push({ value, text, score, trail });
  });
  candidates.sort((a, b) => b.score - a.score || a.trail.length - b.trail.length);
  return candidates.length ? candidates[0].value : undefined;
}

function isTerminalOutcome(value) {
  return /\b(win|won|victory|success|lose|lost|loss|failure|failed|defeat|complete|completed|gameover|ended)\b/i
    .test(String(value ?? ''));
}

function outcomeClass(value) {
  const text = String(value ?? '').toLowerCase();
  if (/\b(win|won|victory|success|complete|completed)\b/.test(text)) return 'success';
  if (/\b(lose|lost|loss|failure|failed|defeat)\b/.test(text)) return 'failure';
  return 'pending';
}

function topLevelOutcomeOf(state) {
  if (state && typeof state === 'object' &&
      Object.prototype.hasOwnProperty.call(state, 'outcome')) {
    return state.outcome;
  }
  return outcomeOf(state);
}

function objectiveOf(state) {
  const found = findNamedValue(state, [
    'objective', 'objectives', 'missionObjective', 'mission', 'goal', 'goals'
  ]);
  return found ? found.value : undefined;
}

function agentsOf(state) {
  const found = findNamedValue(state, ['agents', 'crew', 'operatives', 'players', 'doggs', 'dogs']);
  return found ? found.value : undefined;
}

function povsOf(state) {
  const found = findNamedValue(state, [
    'povs', 'perceptions', 'agentViews', 'views', 'observations'
  ]);
  if (found) return found.value;
  const agents = agentsOf(state);
  const entries = Array.isArray(agents) ? agents : Object.values(agents || {});
  if (!entries.length) return undefined;
  const derived = entries.map(agent => agent &&
    (agent.pov || agent.perception || agent.view || agent.visibleCells || agent.knownCells));
  return derived.every(value => value !== undefined) ? derived : undefined;
}

function tickOf(state) {
  for (const key of ['tick', 'currentTick', 'viewTick', 'selectedTick']) {
    if (Number.isFinite(Number(state && state[key]))) return Number(state[key]);
  }
  const found = findNamedValue(state, ['tick', 'currentTick', 'viewTick', 'selectedTick'], 4);
  return found && Number.isFinite(Number(found.value)) ? Number(found.value) : undefined;
}

function historicalProjection(state) {
  return {
    tick: tickOf(state),
    outcome: outcomeOf(state),
    agents: agentsOf(state),
    objective: objectiveOf(state),
    povs: povsOf(state)
  };
}

function collectionEntries(container) {
  if (Array.isArray(container)) return container.map((value, index) => ({ key: String(index), value }));
  if (!container || typeof container !== 'object') return [];
  return Object.entries(container).map(([key, value]) => ({ key, value }));
}

function normalizedCells(value) {
  if (value == null) return { cells: [], count: 0 };
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of ['knownCells', 'seen', 'seenCells', 'known', 'cells']) {
      if (value[key] !== undefined && value[key] !== value) return normalizedCells(value[key]);
    }
    for (const key of ['knownCount', 'seenCount', 'cellCount', 'count']) {
      if (Number.isFinite(Number(value[key]))) return { cells: [], count: Number(value[key]) };
    }
    for (const key of ['visibleCells', 'visible']) {
      if (value[key] !== undefined && value[key] !== value) return normalizedCells(value[key]);
    }
    if (Number.isFinite(Number(value.visibleCount))) {
      return { cells: [], count: Number(value.visibleCount) };
    }
    const coordinateKeys = Object.entries(value).filter(([key, present]) =>
      present && /-?\d+\s*[,/:]\s*-?\d+/.test(key)).map(([key]) => key.replace(/\s+/g, ''));
    if (coordinateKeys.length) {
      const cells = [...new Set(coordinateKeys)].sort();
      return { cells, count: cells.length };
    }
    const entries = Object.entries(value);
    if (entries.length && entries.every(([, present]) =>
      present == null || ['boolean', 'number', 'string'].includes(typeof present))) {
      const cells = entries.filter(([, present]) => Boolean(present)).map(([key]) => key).sort();
      return { cells, count: cells.length };
    }
  }
  if (!Array.isArray(value)) {
    const coordinate = coordinateOf(value);
    if (coordinate) return { cells: [`${coordinate.x},${coordinate.y}`], count: 1 };
    return { cells: [], count: 0 };
  }
  if (value.every(row => Array.isArray(row))) {
    const cells = [];
    value.forEach((row, y) => row.forEach((present, x) => {
      if (present && !/^(?:unknown|fog|unseen|\?)$/i.test(String(present))) cells.push(`${x},${y}`);
    }));
    return { cells, count: cells.length };
  }
  const cells = [];
  for (const item of value) {
    const coordinate = coordinateOf(item);
    if (coordinate) {
      cells.push(`${coordinate.x},${coordinate.y}`);
    } else if (typeof item === 'string' || typeof item === 'number') {
      cells.push(String(item).replace(/\s+/g, ''));
    }
  }
  const unique = [...new Set(cells)].sort();
  return { cells: unique, count: unique.length };
}

function normalizedAgents(container) {
  return collectionEntries(container).map(({ key, value }) => {
    const agent = value && typeof value === 'object' ? value : {};
    const id = String(agent.id ?? agent.agentId ?? agent.callsign ?? agent.name ?? key);
    const seen = normalizedCells(
      agent.seen ?? agent.knownCells ?? agent.seenCells ?? agent.known ?? agent.pov
    );
    return {
      id,
      position: coordinateOf(agent),
      role: agent.role ?? agent.agentRole,
      status: agent.status,
      intent: agent.intent,
      target: agent.target,
      marked: agent.marked ?? agent.caught ?? agent.detected,
      seen
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

function normalizedPovs(container, agentIds = []) {
  return collectionEntries(container).map(({ key, value }, index) => {
    const view = value && typeof value === 'object' ? value : {};
    const id = String(view.id ?? view.agentId ?? view.callsign ?? view.name ??
      (key.match(/^\d+$/) ? agentIds[index] : key) ?? key);
    return {
      id,
      seen: normalizedCells(view)
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

function completionFlag(value) {
  if (value === true) return true;
  if (typeof value === 'string') {
    return /\b(complete|completed|hacked|acquired|reached|extracted|secured|stolen)\b/i.test(value);
  }
  if (!value || typeof value !== 'object') return false;
  if (value.complete === true || value.completed === true || value.hacked === true ||
      value.acquired === true || value.reached === true || value.extracted === true) return true;
  return /\b(complete|completed|hacked|acquired|reached|extracted|secured|stolen)\b/i
    .test(String(value.status || value.state || value.phase || ''));
}

function booleanState(value) {
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    if (/\b(true|yes|acquired|complete|completed|hacked|reached|extracted)\b/i.test(value)) return true;
    if (/\b(false|no|locked|pending|active|incomplete|unhacked)\b/i.test(value)) return false;
  }
  if (value && typeof value === 'object') return completionFlag(value);
  return undefined;
}

function progressCount(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== 'object') return undefined;
  for (const key of [
    'count', 'done', 'completed', 'extractedAgents', 'agentsExtracted',
    'agents', 'crew', 'extracted'
  ]) {
    if (Number.isFinite(Number(value[key]))) return Number(value[key]);
    if (Array.isArray(value[key])) return value[key].length;
  }
  const booleanValues = Object.values(value);
  if (booleanValues.length && booleanValues.every(item => typeof item === 'boolean')) {
    return booleanValues.filter(Boolean).length;
  }
  return undefined;
}

function rawFrameProjection(state) {
  const agents = normalizedAgents(agentsOf(state));
  const terminalContainer = findNamedValue(state, ['terminals'], 6)?.value;
  const terminals = collectionEntries(terminalContainer).map(({ value }) => {
    const terminal = value && typeof value === 'object' ? value : {};
    return {
      hacked: completionFlag(terminal),
      position: coordinateOf(terminal)
    };
  });
  let required;
  walkJson(state, (value, trail) => {
    if (required !== undefined || !trail.length || !Number.isFinite(Number(value))) return;
    const key = String(trail[trail.length - 1]);
    if (/(requiredTerminals|terminalsRequired|requiredHacks|terminalTarget)/i.test(key)) {
      required = Number(value);
    }
  });
  const core = findNamedValue(state, ['core', 'vaultCore', 'dataCore'], 6)?.value;
  const extraction = findNamedValue(state, ['extraction', 'extract', 'exit'], 6)?.value;
  const hacked = terminals.filter(terminal => terminal.hacked).length;
  const explicitCoreAcquired = findNamedValue(state, ['coreAcquired'], 6)?.value;
  const coreComplete = booleanState(explicitCoreAcquired) ?? completionFlag(core);
  const explicitExtracted = findNamedValue(state, ['extractedAgents', 'agentsExtracted'], 6)?.value;
  const explicitTotal = findNamedValue(state, ['totalAgents', 'agentTotal'], 6)?.value;
  let extractedAgents = progressCount(explicitExtracted);
  if (extractedAgents === undefined) extractedAgents = progressCount(extraction);
  const totalAgents = progressCount(explicitTotal) ?? agents.length;
  const extractionComplete = completionFlag(extraction) ||
    (Number.isFinite(extractedAgents) && totalAgents > 0 && extractedAgents >= totalAgents);
  if (extractionComplete && extractedAgents === undefined) extractedAgents = totalAgents;
  const stage = extractionComplete ? 'complete' :
    coreComplete ? 'extraction' :
      Number.isFinite(required) && hacked >= required ? 'core' : 'terminals';
  const explicitOutcome = topLevelOutcomeOf(state);
  return {
    tick: tickOf(state),
    outcome: explicitOutcome === undefined ?
      (extractionComplete ? 'complete' : null) : explicitOutcome,
    agents,
    objective: {
      hacked,
      required,
      terminalCount: terminals.length,
      coreComplete,
      extractionComplete,
      extractedAgents,
      totalAgents,
      stage
    },
    povs: agents.map(agent => ({ id: agent.id, seen: agent.seen }))
  };
}

function publicObjectiveProjection(state, domText = '') {
  const objective = objectiveOf(state);
  const text = `${typeof objective === 'string' ? objective : stable(objective)} ${domText}`;
  const field = names => {
    for (const name of names) {
      if (objective && typeof objective === 'object' &&
          Object.prototype.hasOwnProperty.call(objective, name)) return objective[name];
    }
    return findNamedValue(objective, names, 5)?.value;
  };
  let terminalsHacked = progressCount(field(['terminalsHacked', 'hackedTerminals']));
  let terminalsRequired = progressCount(field(['terminalsRequired', 'requiredTerminals']));
  let coreAcquired = booleanState(field(['coreAcquired']));
  let extractedAgents = progressCount(field(['extractedAgents', 'agentsExtracted']));
  let totalAgents = progressCount(field(['totalAgents', 'agentTotal']));

  const terminalFraction =
    text.match(/(?:terminals?|hacks?|hacked)[^\d]{0,30}(\d+)\s*\/\s*(\d+)/i) ||
    text.match(/(\d+)\s*\/\s*(\d+)[^\n]{0,20}(?:terminals?|hacks?)/i);
  if (terminalsHacked === undefined && terminalFraction) terminalsHacked = Number(terminalFraction[1]);
  if (terminalsRequired === undefined && terminalFraction) terminalsRequired = Number(terminalFraction[2]);

  const extractionFraction =
    text.match(/(?:extract(?:ed|ion)?|crew|agents?)[^\d]{0,30}(\d+)\s*\/\s*(\d+)/i) ||
    text.match(/(\d+)\s*\/\s*(\d+)[^\n]{0,20}(?:crew|agents?|extract(?:ed|ion)?)/i);
  if (extractedAgents === undefined && extractionFraction) extractedAgents = Number(extractionFraction[1]);
  if (totalAgents === undefined && extractionFraction) totalAgents = Number(extractionFraction[2]);
  if (coreAcquired === undefined &&
      /\bcore\b.{0,40}\b(acquired|hacked|secured|complete)\b|\b(acquired|hacked|secured|complete)\b.{0,40}\bcore\b/i.test(text)) {
    coreAcquired = true;
  }

  const explicitStage = findNamedValue(objective, ['stage', 'current', 'phase', 'kind'], 4)?.value;
  const stage = Number.isFinite(extractedAgents) && Number.isFinite(totalAgents) &&
      totalAgents > 0 && extractedAgents >= totalAgents ? 'complete' :
    coreAcquired === true ? 'extraction' :
      Number.isFinite(terminalsHacked) && Number.isFinite(terminalsRequired) &&
        terminalsHacked >= terminalsRequired ? 'core' :
        explicitStage !== undefined ? (
          /\b(complete|completed|won|victory)\b/i.test(String(explicitStage)) ? 'complete' :
            /\b(extract|extraction|escape|exit)\b/i.test(String(explicitStage)) ? 'extraction' :
              /\b(core|vault)\b/i.test(String(explicitStage)) ? 'core' :
                /\bterminal\b/i.test(String(explicitStage)) ? 'terminals' : undefined
        ) : undefined;
  return {
    terminalsHacked,
    terminalsRequired,
    coreAcquired,
    extractedAgents,
    totalAgents,
    stage,
    text
  };
}

function historyCoherence(publicState, raw, domObjective = '') {
  const publicAgents = normalizedAgents(agentsOf(publicState));
  const publicPovs = normalizedPovs(povsOf(publicState), publicAgents.map(agent => agent.id));
  const agentMatch = raw.agents.length === publicAgents.length && raw.agents.every(rawAgent => {
    const shown = publicAgents.find(agent => agent.id === rawAgent.id);
    if (!shown || !rawAgent.position || !shown.position ||
        rawAgent.position.x !== shown.position.x || rawAgent.position.y !== shown.position.y) return false;
    for (const key of ['role', 'status', 'intent', 'target', 'marked']) {
      if (rawAgent[key] !== undefined && shown[key] !== undefined &&
          stable(rawAgent[key]) !== stable(shown[key])) return false;
    }
    return true;
  });
  const povMatch = raw.povs.length === publicPovs.length && raw.povs.every(rawPov => {
    const shown = publicPovs.find(pov => pov.id === rawPov.id);
    if (!shown || rawPov.seen.count !== shown.seen.count) return false;
    const comparableCoordinates = rawPov.seen.cells.length && shown.seen.cells.length &&
      rawPov.seen.cells.every(cell => /,/.test(cell)) &&
      shown.seen.cells.every(cell => /,/.test(cell));
    return !comparableCoordinates ||
      stable(rawPov.seen.cells) === stable(shown.seen.cells);
  });
  const objective = publicObjectiveProjection(publicState, domObjective);
  const terminalCountsMatch =
    Number.isFinite(objective.terminalsHacked) &&
    Number.isFinite(objective.terminalsRequired) &&
    Number.isFinite(raw.objective.required) &&
    objective.terminalsHacked === raw.objective.hacked &&
    objective.terminalsRequired === raw.objective.required;
  const coreMatch = typeof objective.coreAcquired === 'boolean' &&
    objective.coreAcquired === raw.objective.coreComplete;
  const extractedMatch = !Number.isFinite(objective.extractedAgents) ||
    !Number.isFinite(raw.objective.extractedAgents) ||
    objective.extractedAgents === raw.objective.extractedAgents;
  const totalAgentsMatch = !Number.isFinite(objective.totalAgents) ||
    !Number.isFinite(raw.objective.totalAgents) ||
    objective.totalAgents === raw.objective.totalAgents;
  const objectiveStageMatch = objective.stage === undefined ||
    objective.stage === raw.objective.stage;
  const publicOutcome = topLevelOutcomeOf(publicState);
  const outcomeMatch = publicOutcome !== undefined && raw.outcome !== undefined ?
    stable(publicOutcome) === stable(raw.outcome) :
    outcomeClass(publicOutcome) === outcomeClass(raw.outcome);
  return {
    tickMatch: tickOf(publicState) === raw.tick,
    outcomeMatch,
    agentMatch,
    objectiveMatch: terminalCountsMatch && coreMatch &&
      extractedMatch && totalAgentsMatch && objectiveStageMatch,
    povMatch,
    publicObjective: objective
  };
}

function frameState(frame) {
  const candidates = [
    frame && frame.state,
    frame && frame.snapshot,
    frame && frame.payload && frame.payload.state,
    frame && frame.payload && frame.payload.snapshot,
    frame && frame.payload && frame.payload.world,
    frame && frame.payload,
    frame
  ].filter(value => value && typeof value === 'object');
  for (const candidate of candidates) {
    const projection = rawFrameProjection(candidate);
    if (Number.isFinite(projection.tick) && projection.agents.length > 0 &&
        projection.objective.terminalCount > 0 && projection.povs.length > 0) {
      return candidate;
    }
  }
  return null;
}

function exportedFrames(exported) {
  const candidates = [];
  walkJson(exported, (value, trail) => {
    if (!Array.isArray(value) || value.length < 2) return;
    const key = String(trail[trail.length - 1] || '');
    if (!/(frames|history|chain|timeline)/i.test(key) &&
        !value.some(frame => frame && typeof frame === 'object' &&
          (frame.tick !== undefined || frame.seq !== undefined || frame.payload))) return;
    const usable = value.filter(frame => frameState(frame)).length;
    if (usable) candidates.push({ frames: value, usable, trail, score: usable * 10 - trail.length });
  });
  candidates.sort((a, b) => b.score - a.score);
  requireMeasurement(candidates.length > 0, 'exported historical frames carrying inspected state');
  return candidates[0];
}

function latestExportFrame(exported) {
  const candidates = [];
  walkJson(exported, (value, trail) => {
    if (!Array.isArray(value) || !value.length) return;
    const key = String(trail[trail.length - 1] || '');
    if (!/(frames|history|chain|timeline)/i.test(key)) return;
    const objects = value.filter(item => item && typeof item === 'object').length;
    if (!objects) return;
    candidates.push({
      frame: value[value.length - 1],
      trail,
      score: objects * 5 - trail.length
    });
  });
  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length) return candidates[0].frame;
  const direct = findNamedValue(exported, ['currentFrame', 'headFrame', 'liveFrame'], 5);
  return direct && direct.value && typeof direct.value === 'object' ? direct.value : null;
}

function liveMetadataOf(state) {
  const heads = ['liveHead', 'liveHeadHash', 'headLive'];
  for (const key of heads) {
    if (typeof state?.[key] === 'string') return { head: state[key], source: key };
  }
  for (const holderName of ['live', 'liveHead', 'timeline', 'metadata', 'meta']) {
    const holder = state && state[holderName];
    if (!holder || typeof holder !== 'object') continue;
    const explicitlyLiveHolder = holderName === 'live' || holderName === 'liveHead';
    const head = explicitlyLiveHolder ?
      (holder.headHash || holder.head || holder.liveHeadHash || holder.liveHead) :
      (holder.liveHeadHash || holder.liveHead);
    const tick = holder.tick ?? holder.liveTick;
    const frameCount = holder.frameCount ?? holder.frames;
    if (typeof head === 'string') {
      return {
        head,
        tick: Number.isFinite(Number(tick)) ? Number(tick) : undefined,
        frameCount: Number.isFinite(Number(frameCount)) ? Number(frameCount) :
          Array.isArray(frameCount) ? frameCount.length : undefined,
        source: holderName
      };
    }
  }
  return null;
}

function pendingDirectiveProjection(state) {
  const found = [];
  walkJson(state, (value, trail) => {
    if (!trail.length) return;
    const key = String(trail[trail.length - 1]);
    if (!/^(?:directiveQueue|pendingDirectives|queuedDirectives|directives)$/i.test(key)) return;
    found.push({ path: trail.join('.'), value });
  });
  return found;
}

function exposedRuntimeLimits(snapshot) {
  const limits = { directive: [], frame: [] };
  const visit = (value, trail = [], depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 7) return;
    for (const [key, child] of Object.entries(value)) {
      const next = trail.concat(key);
      const pathText = next.join('.');
      if (Number.isFinite(Number(child)) && /\b(max|limit|cap|capacity)\b/i.test(pathText)) {
        if (/directive|queue/i.test(pathText)) {
          limits.directive.push({ path: pathText, value: Number(child) });
        }
        if (/frame|history|timeline|chain/i.test(pathText)) {
          limits.frame.push({ path: pathText, value: Number(child) });
        }
      }
      if (child && typeof child === 'object' &&
          !/(frames|history|chain|timeline)$/i.test(key)) {
        visit(child, next, depth + 1);
      }
    }
  };
  visit(snapshot.state);
  visit(snapshot.exported?.data);
  const pick = values => values.filter(item => item.value > 0 && item.value <= 10000)
    .sort((a, b) => a.value - b.value)[0];
  return {
    directive: pick(limits.directive),
    frame: pick(limits.frame)
  };
}

function policyState(snapshot) {
  const state = snapshot.state;
  const latest = snapshot.exported && latestExportFrame(snapshot.exported);
  const detailRoots = [
    latest && latest.state,
    latest && latest.snapshot,
    latest && latest.payload && latest.payload.state,
    latest && latest.payload && latest.payload.snapshot,
    latest && latest.payload,
    latest
  ].filter(value => value && typeof value === 'object');
  const objectiveText = [
    snapshot.dom?.['objective-value'] || '',
    stable(objectiveOf(state)),
    ...detailRoots.map(root => stable(objectiveOf(root)))
  ].join(' ');
  const requiredCandidates = [];
  for (const root of [state, ...detailRoots]) {
    walkJson(root, (value, trail) => {
      if (!trail.length || !Number.isFinite(Number(value))) return;
      const key = String(trail[trail.length - 1]);
      const context = trail.slice(0, -1).join('.');
      if (/(requiredTerminals|terminalsRequired|requiredHacks|terminalTarget|hackTarget)/i.test(key) ||
          (key.toLowerCase() === 'required' && /terminal|objective|hack/i.test(context))) {
        requiredCandidates.push({ value: Number(value), score: 20 - trail.length });
      }
    });
  }
  requiredCandidates.sort((a, b) => b.score - a.score);
  let required = requiredCandidates[0]?.value;
  if (required === undefined) {
    const match = objectiveText.match(/(?:hack|required|need)[^\d]{0,30}(\d+)[^\n]{0,30}terminal/i) ||
      objectiveText.match(/terminal[^\d]{0,20}(\d+)\s*(?:required|needed)/i);
    if (match) required = Number(match[1]);
  }

  const terminals = [];
  let core;
  for (const root of detailRoots) {
    walkJson(root, (value, trail) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      if (/(frames|history|chain|ledger|past|replay)/i.test(trail.join('.'))) return;
      const identity = [
        value.id, value.name, value.type, value.kind, value.role, value.label,
        trail.join(' ')
      ].filter(Boolean).join(' ');
      const position = coordinateOf(value);
      if (/\bterminals?\b/i.test(identity) && position &&
          ('hacked' in value || 'isHacked' in value || 'status' in value || 'state' in value ||
            'complete' in value || 'activated' in value)) {
        const status = String(value.status || value.state || '');
        terminals.push({
          id: String(value.id || value.name || value.label || `${position.x},${position.y}`),
          position,
          hacked: value.hacked === true || value.isHacked === true ||
            value.complete === true || value.activated === true ||
            /\b(hacked|complete|activated|owned)\b/i.test(status)
        });
      }
      if (!core && /\b(core|vault core|data core)\b/i.test(identity) && position) {
        const status = String(value.status || value.state || '');
        core = {
          id: String(value.id || value.name || 'core'),
          position,
          complete: value.hacked === true || value.complete === true || value.activated === true ||
            value.reached === true || /\b(hacked|complete|activated|reached|secured|stolen)\b/i.test(status)
        };
      }
    });
  }
  const terminalMap = new Map();
  for (const terminal of terminals) {
    const key = `${terminal.position.x},${terminal.position.y}`;
    const existing = terminalMap.get(key);
    terminalMap.set(key, existing ?
      Object.assign({}, existing, { hacked: existing.hacked || terminal.hacked }) : terminal);
  }
  const uniqueTerminals = [...terminalMap.values()];
  const agentIntent = snapshot.agents.map(agent => {
    const intentValues = [];
    walkJson(agent.state, (value, trail) => {
      if (!trail.length || value == null) return;
      const key = String(trail[trail.length - 1]);
      if (/^(intent|action|target|goal|plan|mode|doing|destination)$/i.test(key) &&
          (typeof value !== 'object' || value)) {
        intentValues.push(typeof value === 'string' ? value : stable(value));
      }
    });
    return {
      id: agent.id,
      text: intentValues.join(' '),
      position: coordinateOf(agent.state)
    };
  });
  return {
    required,
    terminals: uniqueTerminals,
    hacked: uniqueTerminals.filter(terminal => terminal.hacked).length,
    untouched: uniqueTerminals.filter(terminal => !terminal.hacked),
    core,
    agentIntent,
    outcome: outcomeOf(state)
  };
}

function mutateExportedHash(json) {
  const parsed = JSON.parse(json);
  const candidates = [];
  const walk = (value, trail = []) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const next = trail.concat(key);
      if (typeof child === 'string' &&
          /^(?:sha256:)?[0-9a-f]{64}$/i.test(child) &&
          /(hash|head|prev|parent|digest|seal)/i.test(key)) {
        const joined = next.join('.');
        const score = (/frames|history|chain|timeline/i.test(joined) ? 10 : 0) +
          (/^(hash|frameHash|seal|digest)$/i.test(key) ? 5 : 0);
        candidates.push({ owner: value, key, value: child, path: joined, score });
      }
      walk(child, next);
    }
  };
  walk(parsed);
  requireMeasurement(candidates.length > 0, 'a frame/hash field in the exported state');
  candidates.sort((a, b) => b.score - a.score);
  const target = candidates[0];
  const prefix = target.value.startsWith('sha256:') ? 'sha256:' : '';
  const body = target.value.slice(prefix.length);
  target.owner[target.key] = prefix + (body[0].toLowerCase() === '0' ? '1' : '0') + body.slice(1);
  return { json: JSON.stringify(parsed), path: target.path };
}

function verificationPassed(outcome) {
  if (!outcome || outcome.threw) return false;
  const value = outcome.value;
  if (value === true) return true;
  if (!value || typeof value !== 'object') return false;
  if (value.valid === false || value.ok === false || value.verified === false) return false;
  if (value.valid === true || value.ok === true || value.verified === true) return true;
  return Number.isFinite(value.frames) && value.frames > 0 &&
    typeof value.head === 'string' && value.head.length >= 32;
}

function verificationFailed(outcome) {
  if (!outcome) return false;
  if (outcome.threw || outcome.value === false) return true;
  const value = outcome.value;
  return Boolean(value && typeof value === 'object' &&
    (value.valid === false || value.ok === false || value.verified === false));
}

function explicitImportRejection(outcome) {
  if (!outcome) return false;
  if (outcome.threw || outcome.value === false) return true;
  const value = outcome.value;
  if (typeof value === 'string') return /reject|invalid|corrupt|malformed|fail|error/i.test(value);
  return Boolean(value && typeof value === 'object' &&
    (value.ok === false || value.valid === false || value.accepted === false ||
      value.imported === false));
}

async function serve(context) {
  await context.route('https://kody-w.github.io/AINexus/**', route => {
    const url = new URL(route.request().url());
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch (error) {
      return route.fulfill({ status: 400, body: 'bad path' });
    }
    const prefix = '/AINexus/';
    if (pathname !== '/AINexus' && !pathname.startsWith(prefix)) {
      return route.fulfill({ status: 404, body: 'no' });
    }
    const relative = pathname === '/AINexus' ? 'index.html' : pathname.slice(prefix.length);
    const file = path.resolve(ROOT, relative);
    if ((file !== ROOT && !file.startsWith(ROOT + path.sep)) ||
        !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return route.fulfill({ status: 404, body: 'no' });
    }
    return route.fulfill({
      status: 200,
      contentType: TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      body: fs.readFileSync(file)
    });
  });
}

async function denyStorage(context) {
  await context.addInitScript(() => {
    const denied = () => {
      throw new DOMException('Storage denied by black-box test', 'SecurityError');
    };
    for (const method of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) {
      Object.defineProperty(Storage.prototype, method, {
        configurable: true,
        writable: true,
        value: denied
      });
    }
    Object.defineProperty(Storage.prototype, 'length', {
      configurable: true,
      get: denied
    });
  });
}

async function auditSlowStreamFirstPaint(browser) {
  const html = fs.readFileSync(ARTIFACT, 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi)];
  requireMeasurement(scripts.length > 0, 'a final application script to delay');
  const applicationScript = [...scripts].reverse().find(match =>
    /__doggHeist/.test(match[0])) || scripts[scripts.length - 1];
  const splitAt = applicationScript.index;
  const prefix = html.slice(0, splitAt);
  const suffix = html.slice(splitAt);
  requireMeasurement(/intro-card/i.test(prefix) && /app-shell/i.test(prefix) &&
    /skip/i.test(prefix), 'intro, app shell, and skip markup before the final script');

  let releaseStream;
  let prefixArrived;
  const prefixSent = new Promise(resolve => { prefixArrived = resolve; });
  const release = new Promise(resolve => { releaseStream = resolve; });
  const server = http.createServer(async (request, response) => {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    });
    response.write(prefix);
    prefixArrived();
    await release;
    response.end(suffix);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const context = await browser.newContext({ viewport: { width: 900, height: 360 } });
  const page = await context.newPage();
  watchPage(page, 'slow-stream first paint');
  let navigation;
  try {
    navigation = page.goto(`http://127.0.0.1:${address.port}/dogg-heist.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });
    await prefixSent;
    await page.locator('.intro-card').waitFor({ state: 'visible', timeout: 3000 });
    const skip = page.locator(
      '.skip-link, a[href="#game-board"], a[href="#app-shell"], a[href="#main"], a[href="#main-content"]'
    ).first();
    requireMeasurement(await skip.count() === 1, 'the streamed skip link');
    const href = await skip.getAttribute('href');
    requireMeasurement(href && href.startsWith('#'), 'a same-page streamed skip target');
    const begin = await page.evaluate(() => {
      const card = document.querySelector('.intro-card');
      const controls = card ? [...card.querySelectorAll(
        'button, [role="button"], input[type="button"], input[type="submit"]'
      )] : [];
      const chosen = controls.find(control => {
        const text = [
          control.id,
          control.getAttribute('aria-label'),
          control.getAttribute('title'),
          control.textContent,
          control.value
        ].filter(Boolean).join(' ');
        return /\b(begin|start|enter|continue|deploy|ready)\b/i.test(text);
      });
      if (!chosen) return { found: false };
      chosen.setAttribute('data-dogg-test-stream-begin', 'true');
      return { found: true };
    });
    requireMeasurement(begin.found, 'the streamed Begin control');
    const before = await page.evaluate(() => ({
      hash: location.hash,
      ready: window.__doggHeist?.ready,
      cardVisible: Boolean(document.querySelector('.intro-card')),
      active: document.activeElement?.id || document.activeElement?.tagName || ''
    }));
    const parserSamples = [];
    for (let index = 0; index < 10; index++) {
      await page.keyboard.press('Tab');
      const afterTab = await page.evaluate(() => {
        const card = document.querySelector('.intro-card');
        return {
          inside: Boolean(card && card.contains(document.activeElement)),
          begin: document.activeElement?.hasAttribute('data-dogg-test-stream-begin') || false,
          active: document.activeElement?.id || document.activeElement?.tagName || '',
          hash: location.hash,
          ready: window.__doggHeist?.ready,
          cardVisible: Boolean(card && getComputedStyle(card).display !== 'none')
        };
      });
      parserSamples.push(afterTab);
      if (afterTab.begin) break;
    }
    requireMeasurement(parserSamples.some(sample => sample.begin),
      'Tab reaching Begin while the final script is delayed');
    await page.evaluate(() => {
      const visible = element => {
        if (!element || element.hidden || element.hasAttribute('inert') ||
            element.getAttribute('aria-hidden') === 'true') return false;
        if (typeof element.checkVisibility === 'function') {
          return element.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true
          });
        }
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' &&
          Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
      };
      const probe = { first: null };
      const capture = source => {
        if (probe.first) return;
        const api = window.__doggHeist;
        const intro = document.getElementById('intro-overlay') ||
          document.querySelector('.intro-card');
        if (api?.ready !== true || visible(intro)) return;
        const board = document.getElementById('game-board');
        const rect = board?.getBoundingClientRect();
        probe.first = {
          source,
          hash: location.hash,
          active: document.activeElement?.id || document.activeElement?.tagName || '',
          boardFocused: document.activeElement === board ||
            Boolean(board?.contains(document.activeElement)),
          boardIntersects: Boolean(rect && rect.right > 0 && rect.left < innerWidth &&
            rect.bottom > 0 && rect.top < innerHeight),
          boardRect: rect ? {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom
          } : null,
          scroll: {
            window: scrollY,
            document: document.scrollingElement?.scrollTop || 0
          },
          introVisible: false,
          ready: true
        };
      };
      const observer = new MutationObserver(() =>
        queueMicrotask(() => capture('mutation')));
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true
      });
      const frame = () => {
        capture('frame');
        if (probe.first) observer.disconnect();
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      window.__doggSkipReleaseProbe = probe;
    });
    const queuedSkipBefore = await page.evaluate(() => {
      const card = document.querySelector('.intro-card');
      const board = document.getElementById('game-board');
      const rect = board?.getBoundingClientRect();
      return {
        hash: location.hash,
        ready: window.__doggHeist?.ready,
        active: document.activeElement?.id || document.activeElement?.tagName || '',
        inside: Boolean(card && card.contains(document.activeElement)),
        introVisible: Boolean(card && getComputedStyle(card).display !== 'none'),
        boardFocused: document.activeElement === board,
        boardIntersects: Boolean(rect && rect.right > 0 && rect.left < innerWidth &&
          rect.bottom > 0 && rect.top < innerHeight),
        scroll: {
          window: scrollY,
          document: document.scrollingElement?.scrollTop || 0
        }
      };
    });
    await skip.evaluate(element => element.click());
    await sleep(60);
    const queuedSkipImmediate = await page.evaluate(() => {
      const card = document.querySelector('.intro-card');
      const board = document.getElementById('game-board');
      const rect = board?.getBoundingClientRect();
      return {
        hash: location.hash,
        ready: window.__doggHeist?.ready,
        active: document.activeElement?.id || document.activeElement?.tagName || '',
        inside: Boolean(card && card.contains(document.activeElement)),
        introVisible: Boolean(card && getComputedStyle(card).display !== 'none'),
        boardFocused: document.activeElement === board,
        boardIntersects: Boolean(rect && rect.right > 0 && rect.left < innerWidth &&
          rect.bottom > 0 && rect.top < innerHeight),
        scroll: {
          window: scrollY,
          document: document.scrollingElement?.scrollTop || 0
        }
      };
    });
    const preReadySkipHeld =
      queuedSkipBefore.ready !== true &&
      queuedSkipBefore.inside &&
      !queuedSkipBefore.boardIntersects &&
      queuedSkipImmediate.ready !== true &&
      queuedSkipImmediate.introVisible &&
      queuedSkipImmediate.inside &&
      !queuedSkipImmediate.boardFocused &&
      queuedSkipImmediate.active === queuedSkipBefore.active &&
      queuedSkipImmediate.hash === queuedSkipBefore.hash &&
      queuedSkipImmediate.scroll.window === queuedSkipBefore.scroll.window &&
      queuedSkipImmediate.scroll.document === queuedSkipBefore.scroll.document;
    await page.locator('[data-dogg-test-stream-begin="true"]').focus();
    const acknowledgementBefore = await page.evaluate(() => {
      const card = document.querySelector('.intro-card');
      const beginControl = document.querySelector('[data-dogg-test-stream-begin="true"]');
      const play = document.getElementById('play-toggle');
      let state;
      try {
        state = window.__doggHeist?.state?.();
      } catch (error) {}
      return {
        hash: location.hash,
        ready: window.__doggHeist?.ready,
        tick: state?.tick,
        running: state?.running ?? state?.playing,
        play: [
          play?.getAttribute('aria-pressed'),
          play?.textContent
        ].join('|'),
        signature: JSON.stringify({
          cardText: card?.textContent,
          cardData: card ? Object.assign({}, card.dataset) : null,
          beginText: beginControl?.textContent,
          beginAria: beginControl ? {
            label: beginControl.getAttribute('aria-label'),
            busy: beginControl.getAttribute('aria-busy'),
            pressed: beginControl.getAttribute('aria-pressed'),
            disabled: beginControl.getAttribute('aria-disabled'),
            nativeDisabled: beginControl.disabled
          } : null,
          beginData: beginControl ? Object.assign({}, beginControl.dataset) : null,
          htmlData: Object.assign({}, document.documentElement.dataset),
          bodyData: Object.assign({}, document.body.dataset),
          pendingGlobals: Object.fromEntries(Object.keys(window)
            .filter(key => /^__.*(?:pending|queued?|start)/i.test(key))
            .map(key => [key, ['string', 'number', 'boolean'].includes(typeof window[key]) ?
              window[key] : typeof window[key]])),
          live: document.getElementById('status-live')?.textContent
        })
      };
    });
    await page.keyboard.press('Enter');
    let acknowledgementAfter;
    try {
      acknowledgementAfter = await poll(
        () => page.evaluate(() => {
          const card = document.querySelector('.intro-card');
          const beginControl = document.querySelector('[data-dogg-test-stream-begin="true"]');
          const play = document.getElementById('play-toggle');
          let state;
          try {
            state = window.__doggHeist?.state?.();
          } catch (error) {}
          return {
            hash: location.hash,
            ready: window.__doggHeist?.ready,
            tick: state?.tick,
            running: state?.running ?? state?.playing,
            play: [
              play?.getAttribute('aria-pressed'),
              play?.textContent
            ].join('|'),
            inside: Boolean(card && card.contains(document.activeElement)),
            cardVisible: Boolean(card && getComputedStyle(card).display !== 'none'),
            pendingShield: Boolean(beginControl && (
              beginControl.disabled ||
              beginControl.getAttribute('aria-busy') === 'true' ||
              beginControl.getAttribute('aria-disabled') === 'true'
            )),
            signature: JSON.stringify({
              cardText: card?.textContent,
              cardData: card ? Object.assign({}, card.dataset) : null,
              beginText: beginControl?.textContent,
              beginAria: beginControl ? {
                label: beginControl.getAttribute('aria-label'),
                busy: beginControl.getAttribute('aria-busy'),
                pressed: beginControl.getAttribute('aria-pressed'),
                disabled: beginControl.getAttribute('aria-disabled'),
                nativeDisabled: beginControl.disabled
              } : null,
              beginData: beginControl ? Object.assign({}, beginControl.dataset) : null,
              htmlData: Object.assign({}, document.documentElement.dataset),
              bodyData: Object.assign({}, document.body.dataset),
              pendingGlobals: Object.fromEntries(Object.keys(window)
                .filter(key => /^__.*(?:pending|queued?|start)/i.test(key))
                .map(key => [key, ['string', 'number', 'boolean'].includes(typeof window[key]) ?
                  window[key] : typeof window[key]])),
              live: document.getElementById('status-live')?.textContent
            })
          };
        }),
        value => value.signature !== acknowledgementBefore.signature,
        700,
        20
      );
    } catch (error) {
      acknowledgementAfter = await page.evaluate(() => ({
        hash: location.hash,
        ready: window.__doggHeist?.ready,
        inside: Boolean(document.querySelector('.intro-card')?.contains(document.activeElement)),
        cardVisible: Boolean(document.querySelector('.intro-card')),
        pendingShield: false,
        signature: ''
      }));
    }
    const skipBlocked = await skip.evaluate(element =>
      element.tabIndex < 0 || element.getAttribute('aria-disabled') === 'true' ||
      Boolean(element.closest('[inert], [aria-hidden="true"]')));
    const parserHeld = before.ready !== true &&
      parserSamples.every(sample =>
        sample.inside && sample.hash === before.hash &&
        sample.ready !== true && sample.cardVisible) &&
      acknowledgementAfter.inside && acknowledgementAfter.cardVisible &&
      acknowledgementAfter.hash === acknowledgementBefore.hash &&
      acknowledgementAfter.ready !== true &&
      acknowledgementAfter.tick === acknowledgementBefore.tick &&
      acknowledgementAfter.running === acknowledgementBefore.running &&
      acknowledgementAfter.play === acknowledgementBefore.play;
    const acknowledged =
      acknowledgementAfter.signature &&
      acknowledgementAfter.signature !== acknowledgementBefore.signature;

    releaseStream();
    await navigation;
    const queuedReady = await poll(
      () => page.evaluate(async () => {
        const api = window.__doggHeist;
        let state = {};
        try {
          state = api && typeof api.state === 'function' ?
            await Promise.resolve(api.state()) : {};
        } catch (error) {}
        const card = document.querySelector('.intro-card');
        const style = card && getComputedStyle(card);
        const rect = card && card.getBoundingClientRect();
        const board = document.getElementById('game-board');
        const boardRect = board?.getBoundingClientRect();
        return {
          ready: api?.ready,
          tick: Number(state.tick ?? state.currentTick ?? state.liveTick),
          running: Boolean(state.running ?? state.playing),
          introVisible: Boolean(card && !card.hidden && style.display !== 'none' &&
            style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0),
          release: window.__doggSkipReleaseProbe?.first || null,
          current: {
            hash: location.hash,
            active: document.activeElement?.id || document.activeElement?.tagName || '',
            boardFocused: document.activeElement === board ||
              Boolean(board?.contains(document.activeElement)),
            boardIntersects: Boolean(boardRect && boardRect.right > 0 &&
              boardRect.left < innerWidth && boardRect.bottom > 0 &&
              boardRect.top < innerHeight),
            boardRect: boardRect ? {
              left: boardRect.left,
              top: boardRect.top,
              right: boardRect.right,
              bottom: boardRect.bottom
            } : null
          }
        };
      }),
      value => value.ready === true && !value.introVisible &&
        Number.isFinite(value.tick) && Boolean(value.release),
      5000,
      25
    );
    const queuedAdvanced = await poll(
      () => page.evaluate(async () => {
        const state = await Promise.resolve(window.__doggHeist.state());
        return {
          tick: Number(state.tick ?? state.currentTick ?? state.liveTick),
          running: Boolean(state.running ?? state.playing)
        };
      }),
      value => value.running && value.tick > queuedReady.tick,
      5000,
      40
    );
    await page.evaluate(() => window.__doggHeist.pause());

    await page.evaluate(() => {
      history.replaceState(null, '', location.pathname + location.search);
      document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
      document.body.style.setProperty('scroll-behavior', 'auto', 'important');
      scrollTo(0, 0);
      if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
      document.getElementById('play-toggle')?.focus();
    });
    await skip.focus();
    await page.keyboard.press('Enter');
    await poll(
      () => page.evaluate(() => location.hash),
      hash => hash === href,
      1500,
      25
    );
    const skipAfter = await page.evaluate(expected => {
      const target = document.querySelector(expected);
      return {
        hash: location.hash,
        targetExists: Boolean(target),
        focusedTarget: Boolean(target &&
          (document.activeElement === target || target.contains(document.activeElement)))
      };
    }, href);
    return {
      parserHeld,
      acknowledged,
      pendingShield: acknowledgementAfter.pendingShield,
      acknowledgementBefore,
      acknowledgementAfter,
      queuedReady,
      queuedAdvanced,
      queuedRelease: queuedReady.release || queuedReady.current,
      queuedSkipBefore,
      queuedSkipImmediate,
      preReadySkipHeld,
      skipBlocked,
      before,
      parserSamples,
      href,
      skipAfter
    };
  } finally {
    if (releaseStream) releaseStream();
    await context.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
  }
}

async function auditRepeatedIntroActivation(browser, mode) {
  const context = await browser.newContext({
    viewport: { width: 836, height: 224 },
    screen: { width: 836, height: 224 },
    hasTouch: true,
    isMobile: true
  });
  await serve(context);
  const page = await navigateHeist(context, `${mode} repeated intro page`);
  try {
    const begin = await page.evaluate(() => {
      const card = document.querySelector('.intro-card');
      const controls = card ? [...card.querySelectorAll(
        'button, [role="button"], input[type="button"], input[type="submit"]'
      )] : [];
      const element = controls.find(control => {
        const text = [
          control.id,
          control.getAttribute('aria-label'),
          control.getAttribute('title'),
          control.textContent,
          control.value
        ].filter(Boolean).join(' ');
        return /\b(begin|start|enter|continue|deploy|ready)\b/i.test(text);
      });
      if (!element) return null;
      element.setAttribute('data-dogg-test-repeat-begin', 'true');
      const rect = element.getBoundingClientRect();
      return {
        overlayFound: Boolean(document.getElementById('intro-overlay')),
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
    });
    requireMeasurement(begin && begin.overlayFound,
      `${mode} Begin control inside #intro-overlay`);
    const beforeState = await page.evaluate(async () => {
      const api = window.__doggHeist;
      const state = api && typeof api.state === 'function' ?
        await Promise.resolve(api.state()) : {};
      return JSON.parse(JSON.stringify(state));
    });
    const beforeSeed = findNamedValue(beforeState, [
      'seed', 'worldSeed', 'facilitySeed'
    ])?.value;
    requireMeasurement(beforeSeed !== undefined, `${mode} original seed`);
    const beforeBranch = findNamedValue(beforeState, [
      'branch', 'branchId', 'dimension'
    ])?.value;
    const beforeDirectives = stable(pendingDirectiveProjection(beforeState));
    const beforeSurface = await page.evaluate(() => ({
      hash: location.hash,
      event: document.getElementById('event-log')?.textContent || '',
      status: document.getElementById('status-live')?.textContent || ''
    }));

    if (mode === 'double-click') {
      await page.mouse.click(begin.x, begin.y, { clickCount: 2, delay: 20 });
    } else if (mode === 'double-enter') {
      await page.locator('[data-dogg-test-repeat-begin="true"]').focus();
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
    } else {
      await page.touchscreen.tap(begin.x, begin.y);
      await page.touchscreen.tap(begin.x, begin.y);
    }
    const shield = await page.evaluate(() => {
      const beginControl = document.querySelector('[data-dogg-test-repeat-begin="true"]');
      const card = document.querySelector('.intro-card');
      return {
        acknowledged: Boolean(beginControl && (
          beginControl.disabled ||
          beginControl.getAttribute('aria-busy') === 'true' ||
          beginControl.getAttribute('aria-disabled') === 'true' ||
          Object.entries(beginControl.dataset).some(([key, value]) =>
            /pending|busy|start|guard|shield/i.test(key) && value !== 'false')
        )),
        cardPresent: Boolean(card)
      };
    });
    const ready = await poll(
      () => page.evaluate(async () => {
        const api = window.__doggHeist;
        const state = api && typeof api.state === 'function' ?
          await Promise.resolve(api.state()) : {};
        const visible = element => {
          if (!element || element.hidden || element.hasAttribute('inert') ||
              element.getAttribute('aria-hidden') === 'true') return false;
          if (typeof element.checkVisibility === 'function') {
            return element.checkVisibility({
              checkOpacity: true,
              checkVisibilityCSS: true
            });
          }
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' &&
            Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
        };
        const overlay = document.getElementById('intro-overlay');
        const card = overlay?.querySelector('.intro-card');
        const overlayVisible = visible(overlay);
        return {
          ready: api?.ready,
          state: JSON.parse(JSON.stringify(state)),
          hash: location.hash,
          overlayFound: Boolean(overlay),
          introVisible: overlayVisible && (!card || visible(card)),
          event: document.getElementById('event-log')?.textContent || '',
          status: document.getElementById('status-live')?.textContent || ''
        };
      }),
      value => value.ready === true && value.overlayFound && !value.introVisible,
      5000,
      25
    );
    const readyTick = Number(ready.state.tick ?? ready.state.currentTick ?? ready.state.liveTick);
    const advanced = await poll(
      () => page.evaluate(async () => {
        const state = await Promise.resolve(window.__doggHeist.state());
        return {
          tick: Number(state.tick ?? state.currentTick ?? state.liveTick),
          running: Boolean(state.running ?? state.playing),
          state: JSON.parse(JSON.stringify(state))
        };
      }),
      value => value.running && value.tick > readyTick,
      5000,
      40
    );
    await page.evaluate(() => window.__doggHeist.pause());
    const afterSeed = findNamedValue(advanced.state, [
      'seed', 'worldSeed', 'facilitySeed'
    ])?.value;
    const afterBranch = findNamedValue(advanced.state, [
      'branch', 'branchId', 'dimension'
    ])?.value;
    const afterDirectives = stable(pendingDirectiveProjection(ready.state));
    const surfaceDelta =
      `${ready.status.slice(beforeSurface.status.length)} ${ready.event.slice(beforeSurface.event.length)}`;
    const startMentions = (surfaceDelta.match(
      /\b(operation|mission|heist)\s+(?:started|began|running)\b/gi
    ) || []).length;
    return {
      mode,
      shield,
      beforeSeed,
      afterSeed,
      beforeBranch,
      afterBranch,
      beforeDirectives,
      afterDirectives,
      hashUnchanged: ready.hash === beforeSurface.hash,
      running: advanced.running,
      tickAdvanced: advanced.tick > readyTick,
      oneStart: startMentions <= 1,
      noDirective: beforeDirectives === afterDirectives &&
        !/\bdirective\b/i.test(surfaceDelta),
      readyTick,
      advancedTick: advanced.tick,
      surfaceDelta: surfaceDelta.replace(/\s+/g, ' ').trim().slice(-160)
    };
  } finally {
    await context.close();
  }
}

function watchPage(page, label) {
  page.on('pageerror', error => pageErrors.push(`${label}: ${error.message}`));
}

async function navigateHeistAtDomContentLoaded(context, label) {
  const page = await context.newPage();
  watchPage(page, label);
  const response = await page.goto(PAGE_URL, { timeout: 20000, waitUntil: 'domcontentloaded' });
  requireMeasurement(response && response.status() === 200, `${label} HTTP 200`);
  return page;
}

async function waitForHeistSurface(page) {
  await page.waitForFunction(() => {
    const visible = element => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    return Boolean(window.__doggHeist &&
      (window.__doggHeist.ready === true ||
        [...document.querySelectorAll('dialog, [role="dialog"], [aria-modal="true"]')].some(visible)));
  }, null, { timeout: 12000 });
}

async function navigateHeist(context, label) {
  const page = await navigateHeistAtDomContentLoaded(context, label);
  await waitForHeistSurface(page);
  return page;
}

async function auditFirstPaintIntroScroll(page) {
  const setup = await page.evaluate(() => {
    const card = document.querySelector('.intro-card');
    if (!card) return { found: false };
    const overlay = card.closest(
      '.intro-overlay, #intro-overlay, [class*="intro"][class*="overlay"], dialog, [role="dialog"], [aria-modal="true"]'
    ) || card.parentElement;
    if (!overlay) return { found: false };
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    if (!visible(card) || !visible(overlay)) return { found: false };
    const roots = [document.documentElement, document.body].filter(Boolean);
    const originals = roots.map(element => ({
      element,
      value: element.style.getPropertyValue('scroll-behavior'),
      priority: element.style.getPropertyPriority('scroll-behavior')
    }));
    roots.forEach(element => element.style.setProperty('scroll-behavior', 'auto', 'important'));
    window.scrollTo(0, 0);
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    originals.forEach(({ element, value, priority }) => {
      if (value) element.style.setProperty('scroll-behavior', value, priority);
      else element.style.removeProperty('scroll-behavior');
    });

    const cardRect = card.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    const left = Math.max(0, overlayRect.left);
    const right = Math.min(innerWidth, overlayRect.right);
    const top = Math.max(0, overlayRect.top);
    const bottom = Math.min(innerHeight, overlayRect.bottom);
    const candidates = [
      { x: (left + Math.min(right, cardRect.left)) / 2, y: (top + bottom) / 2 },
      { x: (Math.max(left, cardRect.right) + right) / 2, y: (top + bottom) / 2 },
      { x: (left + right) / 2, y: (top + Math.min(bottom, cardRect.top)) / 2 },
      { x: (left + right) / 2, y: (Math.max(top, cardRect.bottom) + bottom) / 2 },
      { x: left + 8, y: top + 8 },
      { x: right - 8, y: bottom - 8 }
    ].filter(point =>
      Number.isFinite(point.x) && Number.isFinite(point.y) &&
      point.x >= left && point.x < right && point.y >= top && point.y < bottom &&
      !(point.x >= cardRect.left && point.x <= cardRect.right &&
        point.y >= cardRect.top && point.y <= cardRect.bottom));
    const point = candidates.find(candidate => {
      const stack = document.elementsFromPoint(candidate.x, candidate.y);
      return stack.some(element => element === overlay || overlay.contains(element)) &&
        !stack.some(element => element === card || card.contains(element));
    });
    return {
      found: Boolean(point),
      point,
      ready: window.__doggHeist?.ready,
      readyState: document.readyState,
      documentScrollable: document.documentElement.scrollHeight > innerHeight + 1,
      card: {
        scrollTop: card.scrollTop,
        scrollHeight: card.scrollHeight,
        clientHeight: card.clientHeight
      }
    };
  });
  requireMeasurement(setup.found, 'an overlay point outside .intro-card at DOMContentLoaded');
  requireMeasurement(setup.ready === false, '__doggHeist.ready false at the first-paint scroll probe');

  const before = await page.evaluate(() => ({
    window: scrollY,
    document: document.scrollingElement?.scrollTop || 0,
    body: document.body.scrollTop || 0
  }));
  await page.mouse.move(setup.point.x, setup.point.y);
  const samples = [];
  for (const delta of [225, 225, 225, 225]) {
    await page.mouse.wheel(0, delta);
    await sleep(60);
    samples.push(await page.evaluate(() => {
      const card = document.querySelector('.intro-card');
      const style = card && getComputedStyle(card);
      const rect = card && card.getBoundingClientRect();
      return {
        window: scrollY,
        document: document.scrollingElement?.scrollTop || 0,
        body: document.body.scrollTop || 0,
        ready: window.__doggHeist?.ready,
        cardVisible: Boolean(card && !card.hidden && style.display !== 'none' &&
          style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0)
      };
    }));
  }
  return {
    setup,
    before,
    samples,
    totalWheel: 900,
    locked: samples.every(sample =>
      sample.window === before.window &&
      sample.document === before.document &&
      sample.body === before.body &&
      sample.ready === false &&
      sample.cardVisible)
  };
}

async function auditShortIntroCardAndUnlock(page) {
  const card = await page.evaluate(() => {
    const element = document.querySelector('.intro-card');
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      x: Math.max(1, Math.min(innerWidth - 1, rect.left + rect.width / 2)),
      y: Math.max(1, Math.min(innerHeight - 1, rect.top + rect.height / 2)),
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      page: document.scrollingElement?.scrollTop || 0
    };
  });
  requireMeasurement(card && card.scrollHeight > card.clientHeight + 1,
    'overflowing .intro-card on a short viewport');
  await page.mouse.move(card.x, card.y);
  for (const delta of [200, 200, 200]) await page.mouse.wheel(0, delta);
  await sleep(200);
  const cardAfter = await page.evaluate(() => {
    const element = document.querySelector('.intro-card');
    return {
      scrollTop: element?.scrollTop || 0,
      page: document.scrollingElement?.scrollTop || 0,
      ready: window.__doggHeist?.ready
    };
  });

  const autoDismissed = await poll(
    () => page.evaluate(() => {
      const overlay = document.getElementById('intro-overlay');
      const hidden = !overlay || overlay.hidden || overlay.hasAttribute('inert') ||
        overlay.getAttribute('aria-hidden') === 'true' ||
        getComputedStyle(overlay).display === 'none' ||
        getComputedStyle(overlay).visibility === 'hidden' ||
        Number(getComputedStyle(overlay).opacity) === 0 ||
        overlay.getBoundingClientRect().width === 0 ||
        overlay.getBoundingClientRect().height === 0;
      return {
        ready: window.__doggHeist?.ready === true,
        hidden
      };
    }),
    value => value.ready && value.hidden,
    4200,
    40
  );
  await finishHeistBoot(page, 'short-screen unlock page');
  await page.evaluate(() => {
    document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
    document.body.style.setProperty('scroll-behavior', 'auto', 'important');
    window.scrollTo(0, 0);
  });
  await page.mouse.move(8, Math.max(8, (await page.viewportSize()).height - 8));
  for (const delta of [250, 250, 250, 250]) await page.mouse.wheel(0, delta);
  await sleep(250);
  const pageAfter = await page.evaluate(() => ({
    window: scrollY,
    document: document.scrollingElement?.scrollTop || 0,
    scrollable: document.documentElement.scrollHeight > innerHeight + 1
  }));
  return {
    card,
    cardAfter,
    autoDismissed,
    pageAfter,
    cardScrolled: cardAfter.scrollTop > card.scrollTop &&
      cardAfter.page === card.page && cardAfter.ready === false,
    pageUnlocked: pageAfter.scrollable &&
      (pageAfter.window > 0 || pageAfter.document > 0)
  };
}

async function auditLandscapeIntroFocusReachability(page) {
  const intro = await markIntro(page);
  requireMeasurement(intro.found && intro.ready === false,
    'the 836x224 intro modal before readiness');
  const setup = await page.evaluate(() => {
    const modal = document.querySelector('[data-dogg-test-intro="true"]');
    const visible = element => {
      if (!element || element.hidden || element.hasAttribute('inert') ||
          element.getAttribute('aria-hidden') === 'true') return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    const controls = modal ? [...modal.querySelectorAll(
      'button, [role="button"], input[type="button"], input[type="submit"]'
    )].filter(visible) : [];
    const begin = controls.find(control => {
      const text = [
        control.id,
        control.getAttribute('aria-label'),
        control.getAttribute('title'),
        control.textContent,
        control.value
      ].filter(Boolean).join(' ');
      return /\b(begin|start|enter|continue|deploy|ready)\b/i.test(text);
    });
    if (!modal || !begin) return { found: false };
    begin.setAttribute('data-dogg-test-landscape-begin', 'true');
    const ancestors = [];
    for (let element = begin.parentElement; element; element = element.parentElement) {
      ancestors.push(element);
      if (element === modal) break;
    }
    const scrollables = ancestors.filter(element => {
      const style = getComputedStyle(element);
      return /(auto|scroll|overlay)/.test(style.overflowY) &&
        element.scrollHeight > element.clientHeight + 1;
    }).map((element, index) => {
      element.setAttribute('data-dogg-test-landscape-scroller', String(index));
      return {
        index,
        identity: `${element.tagName.toLowerCase()}#${element.id}.${String(element.className)}`,
        scrollTop: element.scrollTop,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight
      };
    });
    const card = begin.closest('.intro-card') || modal;
    card.setAttribute('data-dogg-test-landscape-card', 'true');
    return {
      found: true,
      ready: window.__doggHeist?.ready,
      viewport: { width: innerWidth, height: innerHeight },
      document: document.scrollingElement?.scrollTop || 0,
      window: scrollY,
      scrollables
    };
  });
  requireMeasurement(setup.found, 'the visible 836x224 Begin control');

  await page.locator('[data-dogg-test-landscape-card="true"]').focus();
  const wheelSurface = setup.scrollables.length ?
    page.locator('[data-dogg-test-landscape-scroller="0"]') :
    page.locator('[data-dogg-test-intro="true"]');
  const scrollerBox = await wheelSurface.boundingBox();
  requireMeasurement(scrollerBox, 'the visible modal/card wheel surface');
  await page.mouse.move(
    Math.max(1, Math.min(setup.viewport.width - 1, scrollerBox.x + scrollerBox.width / 2)),
    Math.max(1, Math.min(setup.viewport.height - 1, scrollerBox.y + scrollerBox.height / 2))
  );
  const wheelSamples = [];
  for (const delta of [1000, -1000]) {
    await page.mouse.wheel(0, delta);
    await sleep(80);
    wheelSamples.push(await page.evaluate(() => ({
      window: scrollY,
      document: document.scrollingElement?.scrollTop || 0,
      modal: [...document.querySelectorAll('[data-dogg-test-landscape-scroller]')]
        .map(element => element.scrollTop)
    })));
  }

  const measureFocus = () => page.evaluate(() => {
    const modal = document.querySelector('[data-dogg-test-intro="true"]');
    const begin = document.querySelector('[data-dogg-test-landscape-begin="true"]');
    const active = document.activeElement;
    const rect = active?.getBoundingClientRect();
    const beginRect = begin?.getBoundingClientRect();
    const style = active && getComputedStyle(active);
    const full = Boolean(rect && rect.left >= 0 && rect.top >= 0 &&
      rect.right <= innerWidth && rect.bottom <= innerHeight);
    const beginFull = Boolean(beginRect && beginRect.left >= 0 && beginRect.top >= 0 &&
      beginRect.right <= innerWidth && beginRect.bottom <= innerHeight);
    return {
      ready: window.__doggHeist?.ready,
      active: active?.id || active?.className || active?.tagName || '',
      beginFocused: active === begin,
      inside: Boolean(modal && active && modal.contains(active)),
      control: Boolean(active?.matches(
        'button, [role="button"], input, select, textarea, a[href]'
      )),
      visible: Boolean(rect && style && style.display !== 'none' &&
        style.visibility !== 'hidden' && Number(style.opacity) > 0 &&
        rect.width > 0 && rect.height > 0 && full),
      full,
      beginFull,
      skip: Boolean(active?.matches(
        '.skip-link, a[href="#game-board"], a[href="#app-shell"], a[href="#main"], a[href="#main-content"]'
      )),
      rect: rect ? {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom
      } : null,
      beginRect: beginRect ? {
        left: beginRect.left,
        top: beginRect.top,
        right: beginRect.right,
        bottom: beginRect.bottom
      } : null,
      window: scrollY,
      document: document.scrollingElement?.scrollTop || 0,
      modalScroll: [...document.querySelectorAll('[data-dogg-test-landscape-scroller]')]
        .map(element => ({
          scrollTop: element.scrollTop,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight
        }))
    };
  });
  const challenge = await measureFocus();
  const focusSamples = [];
  for (const key of ['Tab', 'Shift+Tab', 'Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    await page.evaluate(() => new Promise(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))));
    focusSamples.push(Object.assign({ key }, await measureFocus()));
  }
  const firstFocus = focusSamples[0];
  const focusScrolledModal = firstFocus.modalScroll.some((item, index) =>
    item.scrollTop !== challenge.modalScroll[index]?.scrollTop);
  const wheelPositions = [
    setup.scrollables.map(item => item.scrollTop),
    ...wheelSamples.map(sample => sample.modal)
  ];
  const wheelMovedModal = wheelPositions.some((positions, index) =>
    index > 0 && positions.some((value, itemIndex) =>
      value !== wheelPositions[index - 1][itemIndex]));
  const documentLocked = [setup, challenge, ...wheelSamples, ...focusSamples]
    .every(sample => sample.window === setup.window &&
      sample.document === setup.document);
  return {
    intro,
    setup,
    challenge,
    focusSamples,
    focusScrolledModal,
    wheelMovedModal,
    documentLocked,
    scrollabilityIfOutside: challenge.beginFull ||
      challenge.modalScroll.some(item => item.scrollHeight > item.clientHeight + 1),
    focusReachable: firstFocus.beginFocused && firstFocus.full &&
      (challenge.beginFull || focusScrolledModal),
    focusContained: focusSamples.every(sample =>
      sample.ready === false && sample.inside && sample.control &&
      sample.visible && !sample.skip)
  };
}

async function markIntro(page) {
  return page.evaluate(() => {
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return !element.hidden && !element.hasAttribute('inert') &&
        style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    document.querySelectorAll('[data-dogg-test-intro]').forEach(element =>
      element.removeAttribute('data-dogg-test-intro'));
    const dialogs = [...document.querySelectorAll(
      'dialog, [role="dialog"], [aria-modal="true"]'
    )].filter(visible).map(element => {
      const text = String(element.textContent || '').replace(/\s+/g, ' ').trim();
      const identity = `${element.id} ${element.className} ${text}`;
      const score = (/intro|brief|mission|operation|heist/i.test(identity) ? 20 : 0) +
        (/objective|agent|terminal|core/i.test(text) ? 10 : 0) +
        (element.matches('dialog[open], [aria-modal="true"]') ? 5 : 0);
      return { element, text, score };
    }).sort((a, b) => b.score - a.score);
    if (!dialogs.length) return { found: false, ready: window.__doggHeist?.ready };
    const chosen = dialogs[0];
    chosen.element.setAttribute('data-dogg-test-intro', 'true');
    return {
      found: true,
      ready: window.__doggHeist?.ready,
      text: chosen.text.slice(0, 5000),
      id: chosen.element.id,
      score: chosen.score
    };
  });
}

async function dismissIntro(page) {
  const action = await page.evaluate(() => {
    const dialog = document.querySelector('[data-dogg-test-intro="true"]');
    const surface = document.getElementById('intro-overlay') || dialog;
    const visible = element => {
      if (!element || element.hidden || element.hasAttribute('inert') ||
          element.getAttribute('aria-hidden') === 'true') return false;
      if (typeof element.checkVisibility === 'function') {
        return element.checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true
        });
      }
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    if (!visible(surface)) {
      return {
        found: false,
        autoDismissed: window.__doggHeist?.ready === true,
        label: 'auto-dismissed'
      };
    }
    if (!dialog) return { found: false, autoDismissed: false, label: '' };
    const controls = [...dialog.querySelectorAll(
      'button, [role="button"], input[type="button"], input[type="submit"]'
    )].filter(control => visible(control) && !control.disabled);
    const ranked = controls.map(control => {
      const label = [
        control.id,
        control.getAttribute('aria-label'),
        control.getAttribute('title'),
        control.textContent,
        control.value
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      const score = /\b(begin|start|enter|continue|deploy|accept|ready|play|dismiss|understood|briefing)\b/i.test(label) ?
        20 : /\b(close|ok|okay|done)\b/i.test(label) ? 10 : 0;
      return { control, label, score };
    }).sort((a, b) => b.score - a.score);
    if (!ranked.length || ranked[0].score === 0) {
      return { found: false, autoDismissed: false, label: '' };
    }
    ranked[0].control.setAttribute('data-dogg-test-intro-dismiss', 'true');
    return { found: true, autoDismissed: false, label: ranked[0].label };
  });
  if (action.autoDismissed) return action.label;
  if (!action.found) {
    const resolution = await poll(
      () => page.evaluate(() => {
        const surface = document.getElementById('intro-overlay');
        const control = document.getElementById('intro-start');
        const surfaceStyle = surface && getComputedStyle(surface);
        const surfaceRect = surface && surface.getBoundingClientRect();
        const visible = Boolean(surface && !surface.hidden &&
          surfaceStyle.display !== 'none' && surfaceStyle.visibility !== 'hidden' &&
          Number(surfaceStyle.opacity) > 0 && surfaceRect.width > 0 && surfaceRect.height > 0);
        const controlStyle = control && getComputedStyle(control);
        const controlRect = control && control.getBoundingClientRect();
        const controlReady = Boolean(visible && control && !control.disabled &&
          controlStyle.display !== 'none' && controlStyle.visibility !== 'hidden' &&
          Number(controlStyle.opacity) > 0 && controlRect.width > 0 && controlRect.height > 0);
        return {
          autoDismissed: !visible && window.__doggHeist?.ready === true,
          controlReady
        };
      }),
      value => value.autoDismissed || value.controlReady,
      3500,
      25
    );
    if (resolution.autoDismissed) return 'auto-dismissed';
    await page.locator('#intro-start').click();
    return 'intro-start';
  }
  requireMeasurement(action.found, 'a visible semantic intro dismissal control');
  try {
    await page.locator('[data-dogg-test-intro-dismiss="true"]').click({ timeout: 1200 });
  } catch (error) {
    const autoDismissed = await page.evaluate(() => {
      const surface = document.getElementById('intro-overlay') ||
        document.querySelector('[data-dogg-test-intro="true"]');
      const hidden = !surface || surface.hidden || surface.hasAttribute('inert') ||
        surface.getAttribute('aria-hidden') === 'true' ||
        getComputedStyle(surface).display === 'none' ||
        getComputedStyle(surface).visibility === 'hidden' ||
        Number(getComputedStyle(surface).opacity) === 0 ||
        surface.getBoundingClientRect().width === 0 ||
        surface.getBoundingClientRect().height === 0;
      return hidden && window.__doggHeist?.ready === true;
    });
    if (autoDismissed) return 'auto-dismissed';
    throw error;
  }
  return action.label;
}

async function finishHeistBoot(page, label, viewportCheck = false) {
  const ready = await page.evaluate(() => window.__doggHeist?.ready === true);
  if (!ready) {
    const intro = await markIntro(page);
    requireMeasurement(intro.found, `${label} intro before readiness`);
    await dismissIntro(page);
  }
  await page.waitForFunction(methods => {
    const api = window.__doggHeist;
    return Boolean(api && api.ready === true &&
      methods.every(method => typeof api[method] === 'function'));
  }, REQUIRED_METHODS, { timeout: 12000 });
  await page.waitForFunction(() => {
    const surface = document.getElementById('intro-overlay') ||
      document.querySelector('[data-dogg-test-intro="true"]');
    if (!surface) return true;
    if (surface.hidden || surface.hasAttribute('inert') ||
        surface.getAttribute('aria-hidden') === 'true') return true;
    if (typeof surface.checkVisibility === 'function') {
      return !surface.checkVisibility({
        checkOpacity: true,
        checkVisibilityCSS: true
      });
    }
    const style = getComputedStyle(surface);
    const rect = surface.getBoundingClientRect();
    return style.display === 'none' || style.visibility === 'hidden' ||
      Number(style.opacity) === 0 || rect.width === 0 || rect.height === 0;
  }, null, { timeout: 3000 });
  await installInspector(page);
  const state = await inspect(page);
  requireMeasurement(Number.isFinite(state.tick), `${label} logical tick`);
  requireMeasurement(Number.isFinite(state.frameCount), `${label} frame count`);
  if (viewportCheck) await page.evaluate(() => scrollTo(0, 0));
  return page;
}

async function auditIntroGate(page) {
  const intro = await markIntro(page);
  requireMeasurement(intro.found, 'the cold briefing modal');
  const forceTop = () => page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const originals = [root, body].filter(Boolean).map(element => ({
      element,
      value: element.style.getPropertyValue('scroll-behavior'),
      priority: element.style.getPropertyPriority('scroll-behavior')
    }));
    originals.forEach(({ element }) =>
      element.style.setProperty('scroll-behavior', 'auto', 'important'));
    window.scrollTo(0, 0);
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    originals.forEach(({ element, value, priority }) => {
      if (value) element.style.setProperty('scroll-behavior', value, priority);
      else element.style.removeProperty('scroll-behavior');
    });
  });
  await forceTop();
  await poll(
    () => page.evaluate(() => ({
      window: scrollY,
      document: document.scrollingElement?.scrollTop || 0
    })),
    position => position.window === 0 && position.document === 0,
    1000,
    20
  );
  const before = await page.evaluate(async () => {
    const dialog = document.querySelector('[data-dogg-test-intro="true"]');
    const api = window.__doggHeist;
    let state = {};
    try {
      state = api && typeof api.state === 'function' ? await Promise.resolve(api.state()) : {};
    } catch (error) {}
    const number = value => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      const match = String(value ?? '').match(/-?\d+/);
      return match ? Number(match[0]) : undefined;
    };
    const tick = number(state && (state.tick ?? state.currentTick ?? state.liveTick)) ??
      number(document.getElementById('tick-value')?.textContent);
    const frameCount = number(state && (state.frameCount ?? state.framesCount)) ??
      (Array.isArray(state && state.frames) ? state.frames.length : undefined);
    const hadTabindex = dialog.hasAttribute('tabindex');
    const tabindex = dialog.getAttribute('tabindex');
    if (!hadTabindex) dialog.setAttribute('tabindex', '-1');
    dialog.focus();
    const play = document.getElementById('play-toggle');
    const rect = dialog.getBoundingClientRect();
    const points = [
      { x: 8, y: 8 },
      { x: innerWidth - 8, y: 8 },
      { x: 8, y: innerHeight - 8 },
      { x: innerWidth - 8, y: innerHeight - 8 }
    ];
    const overlayPoint = points.find(point =>
      point.x < rect.left || point.x > rect.right ||
      point.y < rect.top || point.y > rect.bottom) ||
      { x: Math.max(1, Math.min(innerWidth - 1, rect.left + 2)),
        y: Math.max(1, Math.min(innerHeight - 1, rect.top + 2)) };
    return {
      ready: api?.ready,
      tick,
      frameCount,
      playing: Boolean(state && (state.playing ?? state.running)),
      playControl: [
        play?.getAttribute('aria-pressed'),
        play?.getAttribute('aria-label'),
        play?.textContent
      ].join('|'),
      scrollY,
      scrollable: document.documentElement.scrollHeight > innerHeight + 10,
      overlayPoint,
      hadTabindex,
      tabindex
    };
  });
  requireMeasurement(Number.isFinite(before.tick), 'the pre-ready logical tick');

  const trapped = [];
  for (let index = 0; index < 6; index++) {
    await page.keyboard.press('Tab');
    trapped.push(await page.evaluate(() => {
      const dialog = document.querySelector('[data-dogg-test-intro="true"]');
      return Boolean(dialog && dialog.contains(document.activeElement));
    }));
  }
  for (let index = 0; index < 3; index++) {
    await page.keyboard.press('Shift+Tab');
    trapped.push(await page.evaluate(() => {
      const dialog = document.querySelector('[data-dogg-test-intro="true"]');
      return Boolean(dialog && dialog.contains(document.activeElement));
    }));
  }

  await page.evaluate(() => document.querySelector('[data-dogg-test-intro="true"]')?.focus());
  await page.keyboard.press('.');
  await page.keyboard.press('Space');
  await forceTop();
  const wheelBefore = await page.evaluate(() => ({
    window: scrollY,
    document: document.scrollingElement?.scrollTop || 0,
    body: document.body.scrollTop || 0
  }));
  await page.mouse.move(before.overlayPoint.x, before.overlayPoint.y);
  await page.mouse.wheel(0, 800);
  await sleep(350);
  const wheelAfter = await page.evaluate(() => {
    const dialog = document.querySelector('[data-dogg-test-intro="true"]');
    const style = dialog && getComputedStyle(dialog);
    const rect = dialog && dialog.getBoundingClientRect();
    return {
      window: scrollY,
      document: document.scrollingElement?.scrollTop || 0,
      body: document.body.scrollTop || 0,
      modalVisible: Boolean(dialog && !dialog.hidden && style.display !== 'none' &&
        style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0)
    };
  });
  const after = await page.evaluate(async beforeTabindex => {
    const dialog = document.querySelector('[data-dogg-test-intro="true"]');
    const api = window.__doggHeist;
    let state = {};
    try {
      state = await Promise.resolve(api.state());
    } catch (error) {}
    const number = value => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      const match = String(value ?? '').match(/-?\d+/);
      return match ? Number(match[0]) : undefined;
    };
    const tick = number(state && (state.tick ?? state.currentTick ?? state.liveTick)) ??
      number(document.getElementById('tick-value')?.textContent);
    const frameCount = number(state && (state.frameCount ?? state.framesCount)) ??
      (Array.isArray(state && state.frames) ? state.frames.length : undefined);
    if (dialog && !beforeTabindex.hadTabindex) dialog.removeAttribute('tabindex');
    if (dialog && beforeTabindex.hadTabindex) {
      dialog.setAttribute('tabindex', beforeTabindex.tabindex);
    }
    const play = document.getElementById('play-toggle');
    return {
      ready: api.ready,
      tick,
      frameCount,
      playing: Boolean(state && (state.playing ?? state.running)),
      playControl: [
        play?.getAttribute('aria-pressed'),
        play?.getAttribute('aria-label'),
        play?.textContent
      ].join('|'),
      scrollY,
      activeInside: Boolean(dialog && dialog.contains(document.activeElement))
    };
  }, { hadTabindex: before.hadTabindex, tabindex: before.tabindex });

  return {
    intro,
    before,
    after,
    focusTrapped: trapped.every(Boolean),
    activationBlocked: before.tick === after.tick &&
      (before.frameCount === undefined || before.frameCount === after.frameCount) &&
      before.playing === after.playing && before.playControl === after.playControl,
    scrollBlocked: wheelBefore.window === wheelAfter.window &&
      wheelBefore.document === wheelAfter.document &&
      wheelBefore.body === wheelAfter.body &&
      wheelAfter.modalVisible,
    wheelBefore,
    wheelAfter
  };
}

async function focusHandoffState(page) {
  await page.evaluate(() => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element) return { useful: false, id: '', label: 'none' };
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const visible = style.display !== 'none' && style.visibility !== 'hidden' &&
      Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    const enabled = !element.disabled && element.getAttribute('aria-disabled') !== 'true';
    const interactive = element.matches(
      'button, input, select, textarea, a[href], [role="button"], [role="grid"], [role="gridcell"], [tabindex]:not([tabindex="-1"])'
    );
    const hiddenIntro = Boolean(element.closest(
      '[data-dogg-test-intro], [id*="intro" i], [class*="intro" i], [id*="brief" i], [class*="brief" i]'
    ));
    const label = [
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.textContent
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    return {
      useful: element !== document.body && element !== document.documentElement &&
        visible && enabled && interactive && !hiddenIntro && label.length > 0,
      id: element.id || '',
      label: label.slice(0, 100),
      visible,
      enabled,
      interactive,
      hiddenIntro,
      tag: element.tagName
    };
  });
}

async function installInspector(page) {
  await page.evaluate(() => {
    const pathValue = (root, path) => {
      let value = root;
      for (const key of path) {
        if (value == null || !Object.prototype.hasOwnProperty.call(Object(value), key)) return undefined;
        value = value[key];
      }
      return value;
    };
    const jsonClone = value => JSON.parse(JSON.stringify(value));
    const first = (roots, paths) => {
      for (const root of roots) {
        for (const candidate of paths) {
          const value = pathValue(root, candidate);
          if (value !== undefined && value !== null && value !== '') return value;
        }
      }
      return undefined;
    };
    const number = value => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string') {
        const match = value.match(/-?\d+(?:\.\d+)?/);
        if (match) return Number(match[0]);
      }
      return undefined;
    };
    const text = id => {
      const element = document.getElementById(id);
      return element ? String(element.textContent || element.value || '').trim() : '';
    };
    const asArray = container => {
      if (Array.isArray(container)) return container;
      if (!container || typeof container !== 'object') return [];
      return Object.entries(container).map(([key, value]) => {
        if (value && typeof value === 'object') return Object.assign({ __mapKey: key }, value);
        return { __mapKey: key, value };
      });
    };
    window.__doggTestInspect = async (includeExport = true) => {
      const api = window.__doggHeist;
      if (!api) throw new Error('window.__doggHeist is absent');
      const rawState = await Promise.resolve(api.state());
      if (!rawState || typeof rawState !== 'object') throw new Error('state() did not return an object');
      const state = jsonClone(rawState);
      let exportText = null;
      let exported = null;
      if (includeExport) {
        const rawExport = await Promise.resolve(api.exportState());
        exportText = typeof rawExport === 'string' ? rawExport : JSON.stringify(rawExport);
        exported = JSON.parse(exportText);
      }
      const roots = [state, exported, exported && exported.state, exported && exported.game].filter(Boolean);
      const dom = Object.fromEntries([
        'tick-value', 'branch-value', 'head-value', 'alarm-value', 'objective-value',
        'status-live', 'event-log'
      ].map(id => [id, text(id)]));
      const timeline = document.getElementById('timeline');

      const tick = number(first(roots, [
        ['liveTick'], ['currentTick'], ['tick'], ['clock', 'tick'], ['timeline', 'tick'],
        ['simulation', 'tick'], ['game', 'tick']
      ])) ?? number(dom['tick-value']);
      const viewTick = number(first(roots, [
        ['selectedTick'], ['viewTick'], ['scrubIndex'], ['cursor'], ['timeline', 'cursor'],
        ['timeline', 'selected'], ['view', 'tick']
      ])) ?? number(timeline && timeline.value);
      let head = first(roots, [
        ['headHash'], ['chainHead'], ['head'], ['chain', 'head'], ['timeline', 'head'],
        ['meta', 'head']
      ]);
      if (head && typeof head === 'object') head = head.hash || head.head || head.value;
      if (head === undefined) head = dom['head-value'];
      let branch = first(roots, [
        ['branchId'], ['currentBranch'], ['branch'], ['dimension'], ['timeline', 'branch'],
        ['meta', 'branch']
      ]);
      if (branch && typeof branch === 'object') branch = branch.id || branch.name || branch.value;
      if (branch === undefined) branch = dom['branch-value'];

      let frameCount = number(first(roots, [
        ['frameCount'], ['framesCount'], ['historyCount'], ['chainLength'], ['frames'],
        ['history'],
        ['timeline', 'frameCount']
      ]));
      if (frameCount === undefined) {
        for (const root of roots) {
          for (const candidate of [
            pathValue(root, ['frames']), pathValue(root, ['history']),
            pathValue(root, ['chain', 'frames']), pathValue(root, ['timeline', 'frames']),
            pathValue(root, ['ledger']), pathValue(root, ['chain'])
          ]) {
            if (Array.isArray(candidate)) {
              frameCount = candidate.length;
              break;
            }
            if (candidate && typeof candidate === 'object') {
              frameCount = Object.keys(candidate).length;
              break;
            }
            if (typeof candidate === 'string' && candidate.trim().includes('\n')) {
              frameCount = candidate.trim().split(/\n+/).length;
              break;
            }
          }
          if (frameCount !== undefined) break;
        }
      }

      const agentNames = ['agents', 'crew', 'operatives', 'players', 'doggs', 'dogs'];
      let agentContainer;
      for (const root of roots) {
        for (const name of agentNames) {
          for (const holder of [root, root.world, root.facility, root.simulation, root.game]) {
            if (holder && holder[name] != null) {
              agentContainer = holder[name];
              break;
            }
          }
          if (agentContainer) break;
        }
        if (agentContainer) break;
      }
      const agents = asArray(agentContainer).map(agent => {
        const identity = agent.id ?? agent.agentId ?? agent.callsign ?? agent.name ?? agent.__mapKey;
        return {
          id: identity == null ? '' : String(identity),
          identified: identity != null && String(identity).length > 0,
          state: jsonClone(agent)
        };
      });
      const seed = first(roots, [
        ['seed'], ['worldSeed'], ['facilitySeed'], ['world', 'seed'], ['facility', 'seed'],
        ['meta', 'seed']
      ]);

      return {
        state,
        exportText,
        exported,
        tick,
        viewTick,
        head: head == null ? '' : String(head),
        branch: branch == null ? '' : String(branch),
        frameCount,
        seed,
        agents,
        dom,
        timeline: timeline ? {
          min: number(timeline.min),
          max: number(timeline.max),
          value: number(timeline.value),
          step: number(timeline.step)
        } : null
      };
    };
  });
}

async function openHeist(context, label, viewportCheck = false) {
  const page = await navigateHeist(context, label);
  return finishHeistBoot(page, label, viewportCheck);
}

async function inspect(page, includeExport = true) {
  return page.evaluate(value => window.__doggTestInspect(value), includeExport);
}

async function tryApi(page, method, ...args) {
  return page.evaluate(async ({ method, args }) => {
    try {
      const value = await Promise.resolve(window.__doggHeist[method](...args));
      let clone = value;
      try {
        clone = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
      } catch (error) {
        clone = String(value);
      }
      return { threw: false, value: clone };
    } catch (error) {
      return { threw: true, error: String(error && (error.message || error)) };
    }
  }, { method, args });
}

async function api(page, method, ...args) {
  const outcome = await tryApi(page, method, ...args);
  if (outcome.threw) throw new Error(`${method}() threw: ${outcome.error}`);
  return outcome.value;
}

function mutationSucceeded(value) {
  if (value === true) return true;
  return Boolean(value && typeof value === 'object' &&
    (value.ok === true || value.success === true ||
      value.accepted === true || value.updated === true));
}

async function readSpeedSurface(page) {
  return page.evaluate(async () => {
    const api = window.__doggHeist;
    const rawState = await Promise.resolve(api.state());
    const rawExport = await Promise.resolve(api.exportState());
    const exported = typeof rawExport === 'string' ? JSON.parse(rawExport) : rawExport;
    const finite = values => {
      for (const value of values) {
        const number = Number(value);
        if (Number.isFinite(number)) return number;
      }
      return undefined;
    };
    const select = document.getElementById('speed-select');
    const rect = select?.getBoundingClientRect();
    const style = select && getComputedStyle(select);
    return {
      stateSpeed: finite([
        rawState?.speedMs,
        rawState?.tickIntervalMs,
        rawState?.intervalMs,
        rawState?.speed
      ]),
      exportSpeed: finite([
        exported?.data?.speedMs,
        exported?.data?.tickIntervalMs,
        exported?.data?.intervalMs,
        exported?.speedMs
      ]),
      select: {
        value: select?.value ?? '',
        selectedIndex: select?.selectedIndex ?? -1,
        selectedText: select?.selectedOptions?.[0]?.textContent?.trim() || '',
        visible: Boolean(select && style.display !== 'none' &&
          style.visibility !== 'hidden' && Number(style.opacity) > 0 &&
          rect.width > 0 && rect.height > 0),
        options: select ? [...select.options].map(option => ({
          value: option.value,
          text: option.textContent.trim(),
          selected: option.selected
        })) : []
      }
    };
  });
}

async function measureSpeedPacing(page, expectedMs, changes = 7) {
  return page.evaluate(async ({ expectedMs, changes }) => {
    const api = window.__doggHeist;
    await Promise.resolve(api.pause());
    const before = await Promise.resolve(api.state());
    const startTick = Number(before.tick ?? before.currentTick ?? before.liveTick);
    const started = performance.now();
    const samples = [];
    let lastTick = startTick;
    const deadline = started + Math.max(1600, expectedMs * (changes + 3) * 3);
    await Promise.resolve(api.play());
    try {
      while (samples.length < changes && performance.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 1));
        const state = await Promise.resolve(api.state());
        const tick = Number(state.tick ?? state.currentTick ?? state.liveTick);
        if (Number.isFinite(tick) && tick !== lastTick) {
          samples.push({ tick, at: performance.now() - started });
          lastTick = tick;
        }
      }
    } finally {
      await Promise.resolve(api.pause());
    }
    const intervals = [];
    for (let index = 1; index < samples.length; index++) {
      const tickDelta = samples[index].tick - samples[index - 1].tick;
      if (tickDelta > 0) {
        intervals.push((samples[index].at - samples[index - 1].at) / tickDelta);
      }
    }
    const sorted = [...intervals].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const measuredMedian = !sorted.length ? null :
      sorted.length % 2 ? sorted[middle] :
        (sorted[middle - 1] + sorted[middle]) / 2;
    return {
      expectedMs,
      startTick,
      endTick: lastTick,
      samples,
      intervals,
      median: measuredMedian
    };
  }, { expectedMs, changes });
}

function pacingMatches(measurement, expectedMs) {
  const tolerance = Math.max(8, expectedMs * 0.28);
  return measurement &&
    measurement.intervals.length >= 4 &&
    Number.isFinite(measurement.median) &&
    Math.abs(measurement.median - expectedMs) <= tolerance &&
    measurement.endTick - measurement.startTick >= 5;
}

async function rejectedTransactionalImport(
  page,
  mutatedJson,
  baseline,
  rejectionPattern = /\b(reject|invalid|impossible|transition|teleport|terminal|door|running|history|cursor|outcome|import)\b/i
) {
  const statusBefore = baseline.dom['status-live'];
  const logBefore = baseline.dom['event-log'];
  const outcome = await tryApi(page, 'importState', mutatedJson);
  await sleep(80);
  const after = await inspect(page);
  const stateCall = await tryApi(page, 'state');
  const statusDelta = after.dom['status-live'] !== statusBefore ?
    after.dom['status-live'] : '';
  const logDelta = after.dom['event-log'].startsWith(logBefore) ?
    after.dom['event-log'].slice(logBefore.length) :
    after.dom['event-log'] !== logBefore ? after.dom['event-log'] : '';
  const feedback = `${statusDelta} ${logDelta}`.replace(/\s+/g, ' ').trim();
  const rejected = explicitImportRejection(outcome) ||
    rejectionPattern.test(feedback);
  return {
    rejected,
    outcome,
    after,
    feedback,
    stateCallable: !stateCall.threw && stateCall.value &&
      typeof stateCall.value === 'object',
    unchanged: after.exportText === baseline.exportText &&
      after.head === baseline.head &&
      after.frameCount === baseline.frameCount &&
      after.tick === baseline.tick
  };
}

async function waitForTick(page, minimum, timeout = 6000) {
  return poll(() => inspect(page), state => Number.isFinite(state.tick) && state.tick >= minimum, timeout);
}

async function auditReachability(page, ids = REQUIRED_IDS) {
  return page.evaluate(async requested => {
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    const output = [];
    const scrollingElements = [document.documentElement, document.body].filter(Boolean);
    const originalScrollBehavior = scrollingElements.map(element => ({
      element,
      value: element.style.getPropertyValue('scroll-behavior'),
      priority: element.style.getPropertyPriority('scroll-behavior')
    }));
    for (const element of scrollingElements) {
      element.style.setProperty('scroll-behavior', 'auto', 'important');
    }
    const settledRect = async element => {
      let previous;
      let stableSamples = 0;
      let rect = element.getBoundingClientRect();
      const deadline = performance.now() + 750;
      while (performance.now() < deadline) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        rect = element.getBoundingClientRect();
        const sample = [scrollX, scrollY, rect.left, rect.top, rect.right, rect.bottom];
        const intersects = rect.right > 0 && rect.left < innerWidth &&
          rect.bottom > 0 && rect.top < innerHeight;
        if (intersects && previous &&
            sample.every((value, index) => Math.abs(value - previous[index]) < 0.5)) {
          stableSamples++;
        } else {
          stableSamples = 0;
        }
        if (stableSamples >= 1) break;
        previous = sample;
      }
      return rect;
    };
    try {
      for (const id of requested) {
        const element = document.getElementById(id);
        if (!element) {
          output.push({ id, exists: false, visible: false, reachable: false, width: 0, height: 0 });
          continue;
        }
        element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
        const rect = await settledRect(element);
        const left = Math.max(0, rect.left);
        const right = Math.min(innerWidth, rect.right);
        const top = Math.max(0, rect.top);
        const bottom = Math.min(innerHeight, rect.bottom);
        const intersects = right > left && bottom > top;
        let reachable = false;
        if (intersects) {
          const x = Math.min(innerWidth - 1, Math.max(0, (left + right) / 2));
          const y = Math.min(innerHeight - 1, Math.max(0, (top + bottom) / 2));
          reachable = document.elementsFromPoint(x, y).some(node =>
            node === element || element.contains(node));
        }
        output.push({
          id,
          exists: true,
          visible: visible(element),
          reachable,
          width: rect.width,
          height: rect.height,
          disabled: 'disabled' in element ? Boolean(element.disabled) : false
        });
      }
    } finally {
      for (const original of originalScrollBehavior) {
        if (original.value) {
          original.element.style.setProperty('scroll-behavior', original.value, original.priority);
        } else {
          original.element.style.removeProperty('scroll-behavior');
        }
      }
    }
    return output;
  }, ids);
}

async function auditPrimaryHitboxes(page) {
  return page.evaluate(async () => {
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    const controls = [...document.querySelectorAll(
      'button, select, input[type="button"], input[type="submit"], [role="button"]'
    )];
    const live = document.querySelector(
      '#return-live, #live-button, [data-action="return-live"], [data-action="live"]'
    ) || controls.find(control => {
      if (control.id === 'play-toggle') return false;
      const text = [
        control.id,
        control.getAttribute('aria-label'),
        control.getAttribute('title'),
        control.textContent,
        control.value
      ].filter(Boolean).join(' ');
      return /\b(return[-_\s]+(?:to[-_\s]+)?live|back[-_\s]+to[-_\s]+live|live[-_\s]+head)\b/i
        .test(text);
    });
    const requested = [
      ['play', document.getElementById('play-toggle')],
      ['step', document.getElementById('step-button')],
      ['restart', document.getElementById('restart-button')],
      ['speed', document.getElementById('speed-select')],
      ['live', live],
      ['fork', document.getElementById('fork-button')],
      ['export', document.getElementById('export-button')],
      ['import', document.getElementById('import-button')],
      ['help', document.getElementById('help-button')],
      ['timeline', document.getElementById('timeline')]
    ];
    const roots = [document.documentElement, document.body].filter(Boolean);
    const originals = roots.map(element => ({
      element,
      value: element.style.getPropertyValue('scroll-behavior'),
      priority: element.style.getPropertyPriority('scroll-behavior')
    }));
    roots.forEach(element => element.style.setProperty('scroll-behavior', 'auto', 'important'));
    const rows = [];
    try {
      for (const [name, element] of requested) {
        if (!element) {
          rows.push({ name, found: false, visible: false, reachable: false, height: 0 });
          continue;
        }
        element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const rect = element.getBoundingClientRect();
        const associated = name === 'timeline' ? [
          element.closest('label'),
          ...document.querySelectorAll('label[for="timeline"]')
        ].filter(Boolean) : [];
        const effectiveHeight = Math.max(
          rect.height,
          ...associated.map(candidate => candidate.getBoundingClientRect().height)
        );
        const left = Math.max(0, rect.left);
        const right = Math.min(innerWidth, rect.right);
        const top = Math.max(0, rect.top);
        const bottom = Math.min(innerHeight, rect.bottom);
        const intersects = right > left && bottom > top;
        const x = intersects ? (left + right) / 2 : -1;
        const y = intersects ? (top + bottom) / 2 : -1;
        const reachable = intersects && document.elementsFromPoint(x, y).some(node =>
          node === element || element.contains(node) ||
          associated.some(label => node === label || label.contains(node)));
        rows.push({
          name,
          id: element.id || '',
          found: true,
          visible: visible(element),
          reachable,
          height: effectiveHeight,
          disabled: Boolean(
            ('disabled' in element && element.disabled) ||
            element.getAttribute('aria-disabled') === 'true'
          )
        });
      }
    } finally {
      originals.forEach(({ element, value, priority }) => {
        if (value) element.style.setProperty('scroll-behavior', value, priority);
        else element.style.removeProperty('scroll-behavior');
      });
    }
    return {
      rows,
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth
    };
  });
}

async function inspectPovs(page) {
  return page.evaluate(async () => {
    const isVisible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    const simpleHash = text => {
      let hash = 2166136261;
      for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(16);
    };
    const stripIdentity = value => {
      if (Array.isArray(value)) return value.map(stripIdentity);
      if (value && typeof value === 'object') {
        const output = {};
        for (const key of Object.keys(value).sort()) {
          if (/^(id|agentId|agent|name|label|callsign|title|tick|time|timestamp|generatedAt|updatedAt)$/i.test(key)) continue;
          output[key] = stripIdentity(value[key]);
        }
        return output;
      }
      return value;
    };
    const stable = value => {
      if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
      if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
      }
      return JSON.stringify(value);
    };
    const cellElements = root => {
      let cells = [...root.querySelectorAll('[data-cell], [data-x][data-y]')];
      if (!cells.length) cells = [...root.querySelectorAll('.cell, .tile')];
      return [...new Set(cells)];
    };
    const cellState = (cell, index) => {
      const style = getComputedStyle(cell);
      const marker = [
        cell.dataset.visible, cell.dataset.known, cell.dataset.seen, cell.dataset.hidden,
        cell.getAttribute('aria-label'), cell.className, cell.textContent, style.opacity,
        style.visibility
      ].join('|');
      const unknown = cell.dataset.visible === 'false' || cell.dataset.known === 'false' ||
        cell.dataset.seen === 'false' || cell.dataset.hidden === 'true' ||
        /\b(fog|unknown|unseen|hidden|obscured|blind)\b/i.test(marker) ||
        /^[\s?·•]+$/.test(String(cell.textContent || ''));
      const coordinate = cell.dataset.cell ||
        (cell.dataset.x != null && cell.dataset.y != null ? `${cell.dataset.x},${cell.dataset.y}` : String(index));
      return {
        coordinate,
        unknown,
        content: String(cell.textContent || '').replace(/\s+/g, ' ').trim(),
        className: String(cell.className || '').replace(/\b(agent|pov)-?[\w-]*/ig, '')
      };
    };

    const grid = document.getElementById('pov-grid');
    const board = document.getElementById('game-board');
    if (!grid || !board) return { panels: [], views: [], universe: 0 };
    const selectors = [
      '[data-pov-agent]', '[data-agent-id]', '.pov-card', '.pov-panel', '[data-pov]'
    ];
    let panels = [];
    for (const selector of selectors) {
      const found = [...grid.querySelectorAll(selector)].filter(isVisible);
      if (found.length === 4) {
        panels = found;
        break;
      }
    }
    if (!panels.length) panels = [...grid.children].filter(isVisible);
    const boardCells = cellElements(board);

    const state = await Promise.resolve(window.__doggHeist.state());
    const holders = [state, state && state.world, state && state.facility, state && state.simulation].filter(Boolean);
    let viewContainer;
    for (const holder of holders) {
      for (const key of ['povs', 'perceptions', 'agentViews', 'views', 'observations']) {
        if (holder[key] != null) {
          viewContainer = holder[key];
          break;
        }
      }
      if (viewContainer) break;
    }
    if (!viewContainer) {
      const agents = state && (state.agents || state.crew || state.operatives || state.players);
      const entries = Array.isArray(agents) ? agents : Object.values(agents || {});
      if (entries.length) {
        const derived = entries.map(agent => agent &&
          (agent.pov || agent.perception || agent.view || agent.visibleCells || agent.knownCells));
        if (derived.every(Boolean)) viewContainer = derived;
      }
    }
    const views = Array.isArray(viewContainer) ? viewContainer :
      Object.entries(viewContainer || {}).map(([id, value]) =>
        value && typeof value === 'object' ? Object.assign({ id }, value) : { id, value });

    const countGrid = candidate => {
      if (!Array.isArray(candidate)) return 0;
      if (candidate.every(row => Array.isArray(row))) {
        return candidate.reduce((sum, row) => sum + row.length, 0);
      }
      return candidate.length;
    };
    let universe = boardCells.length;
    for (const holder of holders) {
      universe = Math.max(universe,
        countGrid(holder.grid), countGrid(holder.map), countGrid(holder.tiles));
      const width = Number(holder.width || holder.cols || holder.columns);
      const height = Number(holder.height || holder.rows);
      if (Number.isFinite(width) && Number.isFinite(height)) universe = Math.max(universe, width * height);
    }

    const viewData = views.map(view => {
      const explicit = Array.isArray(view) ? view : view &&
        (view.visibleCells || view.knownCells || view.seenCells ||
          view.cells || view.tiles || view.grid);
      let total = 0;
      let known = 0;
      if (Array.isArray(explicit) && explicit.every(row => Array.isArray(row))) {
        total = explicit.reduce((sum, row) => sum + row.length, 0);
        known = explicit.flat().filter(value =>
          value !== null && value !== undefined && value !== false &&
          !/^(?:\?|unknown|fog|unseen)$/i.test(String(value))).length;
      } else if (Array.isArray(explicit)) {
        known = explicit.length;
      } else if (explicit && typeof explicit === 'object') {
        const values = Object.values(explicit);
        total = values.length;
        known = values.filter(Boolean).length;
      }
      return {
        known,
        total,
        signature: simpleHash(stable(stripIdentity(view)))
      };
    });

    const panelData = panels.map(panel => {
      const cells = cellElements(panel).map(cellState);
      const canvases = [...panel.querySelectorAll('canvas')];
      const canvasSignature = canvases.map(canvas => {
        try {
          return simpleHash(canvas.toDataURL());
        } catch (error) {
          return `unreadable:${canvas.width}x${canvas.height}`;
        }
      }).join(',');
      return {
        known: cells.filter(cell => !cell.unknown).length,
        unknown: cells.filter(cell => cell.unknown).length,
        total: cells.length,
        signature: simpleHash(stable(cells) + '|' + canvasSignature),
        hasObservableSurface: cells.length > 0 || canvases.length > 0
      };
    });
    return { panels: panelData, views: viewData, universe };
  });
}

function coordinateFromBoardText(text) {
  const source = String(text || '');
  let match = source.match(/\b(?:x|col(?:umn)?)\s*[:=]?\s*(-?\d+).*?\b(?:y|row)\s*[:=]?\s*(-?\d+)/i);
  if (match) return { x: Number(match[1]), y: Number(match[2]) };
  match = source.match(/\brow\s*[:=]?\s*(-?\d+).*?\bcol(?:umn)?\s*[:=]?\s*(-?\d+)/i);
  if (match) return { x: Number(match[2]), y: Number(match[1]) };
  match = source.match(/(?:cell|tile|coordinate|cursor|at)?[^\d-]{0,15}(-?\d+)\s*[,/:]\s*(-?\d+)/i);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

async function moveBoardCursorTo(page, target, dimensions) {
  await page.locator('#game-board').focus();
  const tickBefore = (await inspect(page, false)).tick;
  let semantic = await readBoardSemantic(page);
  let current = coordinateFromBoardText(semantic.text);
  requireMeasurement(current, 'the board cursor coordinate in its accessible description');
  const opposite = {
    ArrowRight: 'ArrowLeft',
    ArrowLeft: 'ArrowRight',
    ArrowDown: 'ArrowUp',
    ArrowUp: 'ArrowDown'
  };
  const limit = Math.max(20, dimensions.cols * dimensions.rows * 2);
  let presses = 0;
  while ((current.x !== target.x || current.y !== target.y) && presses < limit) {
    const distance = Math.abs(target.x - current.x) + Math.abs(target.y - current.y);
    const preferred = [
      target.x > current.x && 'ArrowRight',
      target.x < current.x && 'ArrowLeft',
      target.y > current.y && 'ArrowDown',
      target.y < current.y && 'ArrowUp',
      'ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'
    ].filter(Boolean);
    let advanced = false;
    for (const key of [...new Set(preferred)]) {
      await page.keyboard.press(key);
      presses++;
      const candidateSemantic = await readBoardSemantic(page);
      const candidate = coordinateFromBoardText(candidateSemantic.text);
      requireMeasurement(candidate, `board cursor coordinate after ${key}`);
      const candidateDistance = Math.abs(target.x - candidate.x) + Math.abs(target.y - candidate.y);
      if (candidateDistance < distance) {
        current = candidate;
        semantic = candidateSemantic;
        advanced = true;
        break;
      }
      if (candidate.x !== current.x || candidate.y !== current.y) {
        await page.keyboard.press(opposite[key]);
        presses++;
        const restoredSemantic = await readBoardSemantic(page);
        const restored = coordinateFromBoardText(restoredSemantic.text);
        requireMeasurement(restored && restored.x === current.x && restored.y === current.y,
          `non-mutating cursor restoration after ${key}`);
        semantic = restoredSemantic;
      }
    }
    requireMeasurement(advanced, `a keyboard path from ${current.x},${current.y} to ${target.x},${target.y}`);
  }
  const tickAfter = (await inspect(page, false)).tick;
  requireMeasurement(current.x === target.x && current.y === target.y,
    `the board cursor reaching ${target.x},${target.y}`);
  requireMeasurement(tickAfter === tickBefore, 'board cursor navigation remaining non-mutating');
  return { semantic, coordinate: current, presses };
}

async function sampleCanvasCell(page, snapshot, target) {
  const dimensions = facilityDimensions(snapshot);
  requireMeasurement(dimensions, 'public facility dimensions for canvas sampling');
  requireMeasurement(target.x >= 0 && target.y >= 0 &&
    target.x < dimensions.cols && target.y < dimensions.rows,
  `target ${target.x},${target.y} inside the public facility`);
  const sample = await page.evaluate(({ target, dimensions }) => {
    const board = document.getElementById('game-board');
    const canvas = board instanceof HTMLCanvasElement ? board : board?.querySelector('canvas');
    if (!canvas || !canvas.width || !canvas.height) return null;
    const scratch = document.createElement('canvas');
    scratch.width = canvas.width;
    scratch.height = canvas.height;
    const context = scratch.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    try {
      context.drawImage(canvas, 0, 0);
    } catch (error) {
      return null;
    }
    const cellWidth = canvas.width / dimensions.cols;
    const cellHeight = canvas.height / dimensions.rows;
    const colors = [];
    let warningPixels = 0;
    let opaquePixels = 0;
    let hash = 2166136261;
    for (let row = 0; row < 15; row++) {
      for (let col = 0; col < 15; col++) {
        const x = Math.max(0, Math.min(canvas.width - 1,
          Math.floor((target.x + 0.06 + 0.88 * col / 14) * cellWidth)));
        const y = Math.max(0, Math.min(canvas.height - 1,
          Math.floor((target.y + 0.06 + 0.88 * row / 14) * cellHeight)));
        const pixel = [...context.getImageData(x, y, 1, 1).data];
        colors.push(pixel);
        for (const value of pixel) {
          hash ^= value;
          hash = Math.imul(hash, 16777619);
        }
        const [red, green, blue, alpha] = pixel;
        if (alpha > 20) opaquePixels++;
        if (alpha > 20 && (
          (red >= 150 && red > green * 1.16 && red > blue * 1.2) ||
          (red >= 170 && green >= 75 && green < red * 0.92 && blue < green * 0.85)
        )) warningPixels++;
      }
    }
    return {
      colors,
      hash: (hash >>> 0).toString(16),
      warningRatio: warningPixels / colors.length,
      opaqueRatio: opaquePixels / colors.length,
      canvas: { width: canvas.width, height: canvas.height },
      cell: { width: cellWidth, height: cellHeight }
    };
  }, { target, dimensions });
  requireMeasurement(sample && sample.colors.length === 225 && sample.opaqueRatio > 0.5,
    `readable target-specific canvas pixels at ${target.x},${target.y}`);
  return Object.assign(sample, { dimensions });
}

function canvasSampleDelta(before, after) {
  requireMeasurement(before.colors.length === after.colors.length, 'equal canvas sample grids');
  let changed = 0;
  let distance = 0;
  for (let index = 0; index < before.colors.length; index++) {
    const a = before.colors[index];
    const b = after.colors[index];
    const difference = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    distance += difference;
    if (difference >= 24) changed++;
  }
  return {
    changedRatio: changed / before.colors.length,
    meanDistance: distance / before.colors.length
  };
}

async function sampleCanvasCellCore(page, dimensions, target) {
  const sample = await page.evaluate(({ dimensions, target }) => {
    const board = document.getElementById('game-board');
    const canvas = board instanceof HTMLCanvasElement ? board : board?.querySelector('canvas');
    if (!canvas || !canvas.width || !canvas.height) return null;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    const cellWidth = canvas.width / dimensions.cols;
    const cellHeight = canvas.height / dimensions.rows;
    const colors = [];
    let warningPixels = 0;
    let hash = 2166136261;
    for (let row = 0; row < 11; row++) {
      for (let col = 0; col < 11; col++) {
        const x = Math.max(0, Math.min(canvas.width - 1,
          Math.floor((target.x + 0.25 + 0.5 * col / 10) * cellWidth)));
        const y = Math.max(0, Math.min(canvas.height - 1,
          Math.floor((target.y + 0.25 + 0.5 * row / 10) * cellHeight)));
        const pixel = [...context.getImageData(x, y, 1, 1).data];
        colors.push(pixel);
        for (const value of pixel) {
          hash ^= value;
          hash = Math.imul(hash, 16777619);
        }
        const [red, green, blue, alpha] = pixel;
        if (alpha > 20 && (
          (red >= 150 && red > green * 1.16 && red > blue * 1.2) ||
          (red >= 170 && green >= 75 && green < red * 0.92 && blue < green * 0.85)
        )) warningPixels++;
      }
    }
    return {
      colors,
      hash: (hash >>> 0).toString(16),
      warningRatio: warningPixels / colors.length
    };
  }, { dimensions, target });
  requireMeasurement(sample && sample.colors.length === 121,
    `readable core canvas pixels at ${target.x},${target.y}`);
  return sample;
}

function boardTacticalDisclosure(text) {
  return boardEnemyDisclosure(text) ||
    /\bcurrent\s+threat(?:\s+zone)?\b/i.test(text) ||
    /\bnext(?:-tick)?\s+(?:danger|threat|warning)\b/i.test(text) ||
    /\bdanger\s+predicted\b/i.test(text);
}

function boardEnemyDisclosure(text) {
  return /\b(?:guard|camera|laser)(?:[-\s#]*\d+)?\b/i.test(text) ||
    /\b(?:enemy|hostile|adversary)\s+(?:present|visible|detected|nearby|occupying|ahead)\b/i
      .test(text) ||
    /\bno\s+known\s+occupant\b/i.test(text) ||
    /\boccupants?:\s*(?!unknown\b|unseen\b|hidden\b)/i.test(text);
}

function normalizeFogSemantic(text) {
  return String(text || '')
    .replace(/\[\s*-?\d+\s*,\s*-?\d+\s*\]/g, '[x,y]')
    .replace(/\s+/g, ' ')
    .trim();
}

function unionPovCellSets(state) {
  const views = collectionEntries(povsOf(state));
  requireMeasurement(views.length > 0, 'public POVs for team-union visibility');
  const known = new Set();
  const visible = new Set();
  views.forEach(({ value }) => {
    const view = value && typeof value === 'object' ? value : {};
    for (const cell of normalizedCells(
      view.knownCells ?? view.seen ?? view.seenCells ?? view.known ?? view.cells
    ).cells) known.add(cell);
    for (const cell of normalizedCells(
      view.visibleCells ?? view.visible ?? view.currentlyVisible ?? view.inSight
    ).cells) visible.add(cell);
  });
  return { known, visible, viewCount: views.length };
}

async function auditSemanticFogPrivacy(page) {
  const seed = 'SEMANTIC-LEAK-01';
  const unseenGuardCell = { x: 7, y: 9 };
  const emptyFogCell = { x: 1, y: 1 };
  const rememberedCell = { x: 6, y: 4 };

  await api(page, 'pause');
  await api(page, 'restart', seed);
  await api(page, 'pause');
  const genesis = await inspect(page);
  requireMeasurement(genesis.tick === 0, `${seed} tick-0 genesis`);
  const dimensions = facilityDimensions(genesis);
  requireMeasurement(dimensions, `${seed} facility dimensions`);
  const genesisVisibility = unionPovCellSets(genesis.state);
  const rawGenesis = frameState(latestExportFrame(genesis.exported));
  requireMeasurement(rawGenesis, `${seed} sealed genesis state`);
  const guards = collectionEntries(rawGenesis.guards).map(({ value }) => value);
  const hiddenGuard = guards.find(guard =>
    String(guard?.id).toLowerCase() === 'guard-1' &&
    coordinateOf(guard)?.x === unseenGuardCell.x &&
    coordinateOf(guard)?.y === unseenGuardCell.y);
  requireMeasurement(hiddenGuard, 'sealed guard-1 at [7,9]');

  const occupied = new Set();
  for (const key of [
    'agents', 'guards', 'cameras', 'hazards', 'terminals', 'doors',
    'lures', 'decoyPosts'
  ]) {
    for (const { value } of collectionEntries(rawGenesis[key])) {
      const position = coordinateOf(value);
      if (position) occupied.add(`${position.x},${position.y}`);
    }
  }
  for (const value of [rawGenesis.core, rawGenesis.extraction]) {
    const position = coordinateOf(value);
    if (position) occupied.add(`${position.x},${position.y}`);
  }
  const tileAt = cell => rawGenesis.facility?.tiles?.[cell.y]?.[cell.x];
  const targetKey = `${unseenGuardCell.x},${unseenGuardCell.y}`;
  const emptyKey = `${emptyFogCell.x},${emptyFogCell.y}`;
  requireMeasurement(
    !genesisVisibility.visible.has(targetKey) &&
      !genesisVisibility.known.has(targetKey),
    'guard-1 cell absent from the public team-visibility union at tick 0'
  );
  requireMeasurement(
    !occupied.has(emptyKey) &&
      !genesisVisibility.visible.has(emptyKey) &&
      !genesisVisibility.known.has(emptyKey) &&
      tileAt(emptyFogCell) === tileAt(unseenGuardCell),
    'an empty unseen same-terrain fog control at [1,1]'
  );

  const liveThreats = [
    ...collectionEntries(rawGenesis.guards).map(({ value }) => value),
    ...collectionEntries(rawGenesis.cameras).map(({ value }) => value),
    ...collectionEntries(rawGenesis.hazards).map(({ value }) => value)
  ].filter(value => value && typeof value === 'object' && value.active !== false);
  const visibleThreat = liveThreats.find(value => {
    const position = coordinateOf(value);
    return position && genesisVisibility.visible.has(`${position.x},${position.y}`);
  });
  requireMeasurement(visibleThreat && coordinateOf(visibleThreat),
    'a currently visible enemy/threat control');
  const visibleThreatCell = coordinateOf(visibleThreat);

  const hiddenPixels = await sampleCanvasCell(page, genesis, unseenGuardCell);
  const emptyPixels = await sampleCanvasCell(page, genesis, emptyFogCell);
  const visiblePixels = await sampleCanvasCell(page, genesis, visibleThreatCell);
  const hiddenVsEmpty = canvasSampleDelta(hiddenPixels, emptyPixels);
  const visibleVsFog = canvasSampleDelta(emptyPixels, visiblePixels);

  const hiddenCursor = await moveBoardCursorTo(page, unseenGuardCell, dimensions);
  const emptyCursor = await moveBoardCursorTo(page, emptyFogCell, dimensions);
  const visibleCursor = await moveBoardCursorTo(page, visibleThreatCell, dimensions);
  const hiddenText = hiddenCursor.semantic.text;
  const emptyText = emptyCursor.semantic.text;
  const visibleText = visibleCursor.semantic.text;
  const visibleIdentity = String(visibleThreat.id || visibleThreat.name || '')
    .toLowerCase().replace(/[\s_-]+/g, '');
  const visibleNormalized = visibleText.toLowerCase().replace(/[\s_-]+/g, '');

  await api(page, 'restart', seed);
  await api(page, 'pause');
  const rememberedKey = `${rememberedCell.x},${rememberedCell.y}`;
  const openIntervals = new Map();
  const completedIntervals = [];
  for (let index = 0; index <= 45; index++) {
    const snapshot = await inspect(page, false);
    const visibility = unionPovCellSets(snapshot.state);
    for (const cell of visibility.known) {
      if (!visibility.visible.has(cell) && !openIntervals.has(cell)) {
        openIntervals.set(cell, snapshot.tick);
      } else if (visibility.visible.has(cell) && openIntervals.has(cell)) {
        completedIntervals.push({
          cell,
          start: openIntervals.get(cell),
          end: snapshot.tick
        });
        openIntervals.delete(cell);
      }
    }
    if (completedIntervals.some(interval => interval.cell === rememberedKey)) break;
    if (index < 45) await api(page, 'step', 1);
  }
  const rememberedInterval =
    completedIntervals.find(interval => interval.cell === rememberedKey) ||
    completedIntervals.sort((a, b) =>
      Math.abs(a.start - 11) - Math.abs(b.start - 11) ||
      b.end - b.start - (a.end - a.start) ||
      a.cell.localeCompare(b.cell))[0];
  requireMeasurement(rememberedInterval,
    'a public-union remembered interval that later becomes visible');
  const [rememberedX, rememberedY] = rememberedInterval.cell.split(',').map(Number);
  const observedRememberedCell = { x: rememberedX, y: rememberedY };

  await api(page, 'restart', seed);
  await api(page, 'pause');
  if (rememberedInterval.start > 0) {
    await api(page, 'step', rememberedInterval.start);
  }
  await moveBoardCursorTo(page, observedRememberedCell, dimensions);
  const rememberedSamples = [];
  let rememberedSnapshot = await inspect(page, false);
  let rememberedVisibility = unionPovCellSets(rememberedSnapshot.state);
  while (rememberedSnapshot.tick < rememberedInterval.end) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    const semantic = await readBoardSemantic(page);
    const pixels = await sampleCanvasCellCore(page, dimensions, observedRememberedCell);
    rememberedSamples.push({
      tick: rememberedSnapshot.tick,
      known: rememberedVisibility.known.has(rememberedInterval.cell),
      visible: rememberedVisibility.visible.has(rememberedInterval.cell),
      semantic: semantic.text,
      warningRatio: pixels.warningRatio,
      pixelHash: pixels.hash
    });
    await api(page, 'step', 1);
    rememberedSnapshot = await inspect(page, false);
    rememberedVisibility = unionPovCellSets(rememberedSnapshot.state);
  }

  return {
    seed,
    unseenGuardCell,
    emptyFogCell,
    hiddenGuardId: hiddenGuard.id,
    visibleThreat: {
      id: String(visibleThreat.id || visibleThreat.name || ''),
      cell: visibleThreatCell
    },
    hiddenText,
    emptyText,
    visibleText,
    hiddenUnknown: /\b(unknown|fog|unseen|hidden|obscured)\b/i.test(hiddenText),
    emptyUnknown: /\b(unknown|fog|unseen|hidden|obscured)\b/i.test(emptyText),
    hiddenNoDisclosure:
      !/\bguard[-\s#]*1\b/i.test(hiddenText) &&
      !boardTacticalDisclosure(hiddenText),
    emptyNoDisclosure: !boardTacticalDisclosure(emptyText),
    equivalentFogSemantics:
      normalizeFogSemantic(hiddenText) === normalizeFogSemantic(emptyText),
    equivalentFogPixels:
      hiddenPixels.hash === emptyPixels.hash &&
      hiddenVsEmpty.changedRatio === 0 &&
      hiddenVsEmpty.meanDistance === 0,
    visibleControlExposed:
      Boolean(visibleIdentity && visibleNormalized.includes(visibleIdentity)) &&
      /\b(occupants?|threat|danger|warning)\b/i.test(visibleText) &&
      visibleVsFog.changedRatio >= 0.03 &&
      visibleVsFog.meanDistance >= 3,
    hiddenPixels,
    emptyPixels,
    visiblePixels,
    hiddenVsEmpty,
    visibleVsFog,
    rememberedSamples,
    rememberedBecameVisible:
      rememberedSnapshot.tick === rememberedInterval.end &&
      rememberedVisibility.visible.has(rememberedInterval.cell),
    rememberedInterval,
    rememberedCell: observedRememberedCell,
    rememberedVisibleTick: rememberedSnapshot.tick,
    rememberedPrivate: rememberedSamples.length > 0 &&
      rememberedSamples[0].tick === rememberedInterval.start &&
      rememberedSamples.every(sample =>
        sample.known &&
        !sample.visible &&
        sample.warningRatio <= 0.005 &&
        /\b(unknown|fog|unseen|hidden|remembered|last seen|not currently visible)\b/i
          .test(sample.semantic) &&
        !boardTacticalDisclosure(sample.semantic))
  };
}

function povKnowledge(state, agentIds) {
  const container = povsOf(state);
  return collectionEntries(container).map(({ key, value }, index) => {
    const view = value && typeof value === 'object' ? value : {};
    const id = String(view.id ?? view.agentId ?? view.callsign ?? view.name ??
      (key.match(/^\d+$/) ? agentIds[index] : key) ?? key);
    return {
      id,
      known: normalizedCells(
        view.knownCells ?? view.seen ?? view.seenCells ?? view.known ?? view.cells
      ),
      visible: normalizedCells(
        view.visibleCells ?? view.visible ?? view.currentlyVisible ?? view.inSight
      )
    };
  });
}

async function measureRememberedTerminalCanvasContrast(page) {
  const snapshot = await inspect(page);
  const dimensions = facilityDimensions(snapshot);
  requireMeasurement(dimensions, 'public facility dimensions for POV pixel contrast');
  const policy = policyState(snapshot);
  const hackedTerminals = policy.terminals.filter(terminal => terminal.hacked);
  requireMeasurement(hackedTerminals.length > 0, 'a hacked terminal in current exported state');
  const agents = normalizedAgents(agentsOf(snapshot.state));
  const knowledge = povKnowledge(snapshot.state, agents.map(agent => agent.id));
  const rawState = frameState(latestExportFrame(snapshot.exported));
  const rawAgents = rawState ? normalizedAgents(agentsOf(rawState)) : [];
  const candidates = [];
  for (const agent of agents) {
    const view = knowledge.find(item => item.id === agent.id);
    const rawAgent = rawAgents.find(item => item.id === agent.id);
    const known = view?.known.cells.length ? view.known : rawAgent?.seen;
    const visible = view?.visible;
    const visibleMembershipKnown = visible &&
      (visible.cells.length > 0 || visible.count === 0);
    if (!known || !visibleMembershipKnown || !agent.position) continue;
    for (const terminal of hackedTerminals) {
      const key = `${terminal.position.x},${terminal.position.y}`;
      const knownHere = known.cells.includes(key);
      const visibleHere = visible.cells.includes(key);
      if (knownHere && !visibleHere) {
        candidates.push({
          id: agent.id,
          agent: agent.position,
          terminal: terminal.position,
          remembered: true,
          currentlyVisible: false,
          terminalHacked: terminal.hacked === true,
          knownCount: known.count,
          visibleCount: visible.count
        });
      }
    }
  }
  requireMeasurement(candidates.length > 0,
    'a hacked terminal known but not currently visible in a POV');

  const measurement = await page.evaluate(({ candidates, dimensions }) => {
    const grid = document.getElementById('pov-grid');
    if (!grid) return null;
    const panels = [...grid.querySelectorAll(
      '[data-pov-agent], [data-agent-id], .pov-card, .pov-panel, [data-pov]'
    )].filter(panel => {
      const style = getComputedStyle(panel);
      const rect = panel.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0 &&
        panel.querySelector('canvas');
    });
    const identity = panel => [
      panel.dataset.povAgent,
      panel.dataset.agentId,
      panel.dataset.pov,
      panel.getAttribute('aria-label'),
      panel.getAttribute('title'),
      panel.textContent
    ].filter(Boolean).join(' ');
    const entries = [];
    for (const candidate of candidates) {
      let panel = panels.find(item =>
        new RegExp(candidate.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
          .test(identity(item)));
      if (!panel) {
        const index = candidates.findIndex(item => item.id === candidate.id);
        panel = panels[index];
      }
      const canvas = panel?.querySelector('canvas');
      if (!canvas || !canvas.width || !canvas.height) continue;
      const rect = canvas.getBoundingClientRect();
      entries.push({ candidate, panel, canvas, rect, area: rect.width * rect.height });
    }
    entries.sort((a, b) => a.area - b.area);
    const chosen = entries[0];
    if (!chosen) return null;
    const scratch = document.createElement('canvas');
    scratch.width = chosen.canvas.width;
    scratch.height = chosen.canvas.height;
    const context = scratch.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(chosen.canvas, 0, 0);

    const pixel = (x, y) => [...context.getImageData(
      Math.max(0, Math.min(scratch.width - 1, Math.round(x))),
      Math.max(0, Math.min(scratch.height - 1, Math.round(y))),
      1,
      1
    ).data];
    const clusterKey = color =>
      color.slice(0, 3).map(channel => Math.round(channel / 16) * 16).join(',');
    const luminance = color => {
      const channel = value => {
        const unit = value / 255;
        return unit <= 0.03928 ? unit / 12.92 :
          Math.pow((unit + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(color[0]) +
        0.7152 * channel(color[1]) +
        0.0722 * channel(color[2]);
    };
    const ratio = (a, b) => {
      const one = luminance(a);
      const two = luminance(b);
      return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);
    };
    const dominant = colors => {
      const groups = new Map();
      for (const color of colors) {
        if (color[3] < 20) continue;
        const key = clusterKey(color);
        const group = groups.get(key) || { count: 0, total: [0, 0, 0] };
        group.count++;
        group.total[0] += color[0];
        group.total[1] += color[1];
        group.total[2] += color[2];
        groups.set(key, group);
      }
      return [...groups.values()].map(group => ({
        count: group.count,
        color: group.total.map(total => Math.round(total / group.count))
      })).sort((a, b) => b.count - a.count);
    };
    const transforms = [
      {
        name: 'orthogonal',
        center: point => ({
          x: (point.x + 0.5) * scratch.width / dimensions.cols,
          y: (point.y + 0.5) * scratch.height / dimensions.rows
        }),
        half: {
          x: scratch.width / dimensions.cols / 2,
          y: scratch.height / dimensions.rows / 2
        }
      },
      {
        name: 'diamond',
        center: point => {
          const halfX = scratch.width / (dimensions.cols + dimensions.rows);
          const halfY = scratch.height / (dimensions.cols + dimensions.rows);
          return {
            x: (point.x - point.y + dimensions.rows) * halfX,
            y: (point.x + point.y + 1) * halfY
          };
        },
        half: {
          x: scratch.width / (dimensions.cols + dimensions.rows),
          y: scratch.height / (dimensions.cols + dimensions.rows)
        }
      },
      {
        name: 'diamond-mirrored',
        center: point => {
          const halfX = scratch.width / (dimensions.cols + dimensions.rows);
          const halfY = scratch.height / (dimensions.cols + dimensions.rows);
          return {
            x: (point.y - point.x + dimensions.cols) * halfX,
            y: (point.x + point.y + 1) * halfY
          };
        },
        half: {
          x: scratch.width / (dimensions.cols + dimensions.rows),
          y: scratch.height / (dimensions.cols + dimensions.rows)
        }
      }
    ];
    const sample = (transform, point) => {
      const center = transform.center(point);
      const inner = [];
      const ring = [];
      for (let gy = -10; gy <= 10; gy++) {
        for (let gx = -10; gx <= 10; gx++) {
          const nx = gx / 10;
          const ny = gy / 10;
          const distance = transform.name === 'orthogonal' ?
            Math.max(Math.abs(nx), Math.abs(ny)) :
            Math.abs(nx) + Math.abs(ny);
          const color = pixel(
            center.x + nx * transform.half.x * 0.9,
            center.y + ny * transform.half.y * 0.9
          );
          if (distance <= 0.50) inner.push(color);
          if (distance >= 0.72 && distance <= 0.95) ring.push(color);
        }
      }
      const backgrounds = dominant(ring);
      const glyphs = dominant(inner);
      const background = backgrounds[0];
      const glyphCandidates = glyphs.filter(group =>
        group.count >= 2 && background && Math.hypot(
          group.color[0] - background.color[0],
          group.color[1] - background.color[1],
          group.color[2] - background.color[2]
        ) >= 28).slice(0, 8).map(group => Object.assign({}, group, {
        contrast: ratio(group.color, background.color)
      })).sort((a, b) => b.contrast - a.contrast || b.count - a.count);
      const glyph = glyphCandidates[0];
      return {
        center,
        background,
        glyph,
        glyphCandidates,
        contrast: glyph && background ? ratio(glyph.color, background.color) : 0,
        score: glyph && background ?
          glyph.count * Math.min(10, ratio(glyph.color, background.color)) : 0
      };
    };
    const calibrated = transforms.map(transform => ({
      transform,
      own: sample(transform, chosen.candidate.agent)
    })).sort((a, b) => b.own.score - a.own.score)[0];
    if (!calibrated || calibrated.own.score <= 0) return null;
    const terminal = sample(calibrated.transform, chosen.candidate.terminal);
    if (!terminal.glyph || !terminal.background) return null;
    const lowGlyph = terminal.glyph.color.map((channel, index) =>
      Math.round(channel * 0.1 + terminal.background.color[index] * 0.9));
    return {
      agentId: chosen.candidate.id,
      terminal: chosen.candidate.terminal,
      remembered: chosen.candidate.remembered,
      currentlyVisible: chosen.candidate.currentlyVisible,
      terminalHacked: chosen.candidate.terminalHacked,
      knownCount: chosen.candidate.knownCount,
      visibleCount: chosen.candidate.visibleCount,
      css: { width: chosen.rect.width, height: chosen.rect.height },
      backing: { width: scratch.width, height: scratch.height },
      transform: calibrated.transform.name,
      ownScore: calibrated.own.score,
      ownContrast: calibrated.own.contrast,
      ownGlyphCount: calibrated.own.glyph?.count || 0,
      ownBackgroundCount: calibrated.own.background?.count || 0,
      center: terminal.center,
      glyph: terminal.glyph,
      background: terminal.background,
      clusterDistance: Math.hypot(
        terminal.glyph.color[0] - terminal.background.color[0],
        terminal.glyph.color[1] - terminal.background.color[1],
        terminal.glyph.color[2] - terminal.background.color[2]
      ),
      contrast: terminal.contrast,
      lowContrastControl: ratio(lowGlyph, terminal.background.color)
    };
  }, { candidates, dimensions });
  requireMeasurement(measurement, 'target-specific POV canvas glyph/background clusters');
  return measurement;
}

function exportedDoors(state) {
  const doors = [];
  walkJson(state, (value, trail) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const identity = [
      value.id, value.name, value.type, value.kind, value.label, trail.join('.')
    ].filter(Boolean).join(' ');
    if (!/\bdoors?\b/i.test(identity)) return;
    const position = coordinateOf(value);
    if (!position) return;
    const status = String(value.status || value.state || '');
    const open = value.open === true || /\bopen\b/i.test(status);
    const locked = value.locked === true || /\blocked\b/i.test(status);
    doors.push({
      id: String(value.id || value.name || value.label || `${position.x},${position.y}`),
      position,
      open,
      locked,
      status
    });
  });
  return [...new Map(doors.map(door =>
    [`${door.id}|${door.position.x},${door.position.y}`, door])).values()];
}

async function measureDoorCanvasContrast(page, preferredTransform) {
  const snapshot = await inspect(page);
  const dimensions = facilityDimensions(snapshot);
  requireMeasurement(dimensions, 'public facility dimensions for door pixel contrast');
  const rawState = frameState(latestExportFrame(snapshot.exported));
  requireMeasurement(rawState, 'current exported frame for door pixel contrast');
  const doors = exportedDoors(rawState);
  requireMeasurement(doors.length > 0, 'doors in current exported state');
  const agents = normalizedAgents(agentsOf(snapshot.state));
  const rawAgents = normalizedAgents(agentsOf(rawState));
  const knowledge = povKnowledge(snapshot.state, agents.map(agent => agent.id));
  const remembered = [];
  const visible = [];
  for (const agent of agents) {
    const view = knowledge.find(item => item.id === agent.id);
    const rawAgent = rawAgents.find(item => item.id === agent.id);
    const known = view?.known.cells.length ? view.known : rawAgent?.seen;
    const current = view?.visible;
    if (!agent.position || !known || !current ||
        (!current.cells.length && current.count > 0)) continue;
    for (const door of doors) {
      const key = `${door.position.x},${door.position.y}`;
      const candidate = {
        id: agent.id,
        agent: agent.position,
        target: door.position,
        doorId: door.id,
        open: door.open,
        locked: door.locked,
        known: known.cells.includes(key),
        visible: current.cells.includes(key)
      };
      if (candidate.known && !candidate.visible) remembered.push(candidate);
      if (candidate.visible && (candidate.open || candidate.locked)) visible.push(candidate);
    }
  }
  remembered.sort((a, b) => {
    const preferred = candidate =>
      /d-west-south/i.test(candidate.doorId) ||
      (candidate.target.x === 6 && candidate.target.y === 8);
    return Number(preferred(b)) - Number(preferred(a));
  });
  requireMeasurement(remembered.length > 0, 'a remembered, currently hidden door');
  requireMeasurement(visible.length > 0, 'a currently visible open or locked door');

  const measurements = await page.evaluate(({ targets, dimensions, preferredTransform }) => {
    const grid = document.getElementById('pov-grid');
    if (!grid) return [];
    const panels = [...grid.querySelectorAll(
      '[data-pov-agent], [data-agent-id], .pov-card, .pov-panel, [data-pov]'
    )].filter(panel => panel.querySelector('canvas'));
    const identity = panel => [
      panel.dataset.povAgent, panel.dataset.agentId, panel.dataset.pov,
      panel.getAttribute('aria-label'), panel.textContent
    ].filter(Boolean).join(' ');
    const clusterKey = color =>
      color.slice(0, 3).map(channel => Math.round(channel / 16) * 16).join(',');
    const luminance = color => {
      const channel = value => {
        const unit = value / 255;
        return unit <= 0.03928 ? unit / 12.92 :
          Math.pow((unit + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(color[0]) +
        0.7152 * channel(color[1]) +
        0.0722 * channel(color[2]);
    };
    const ratio = (a, b) => {
      const one = luminance(a);
      const two = luminance(b);
      return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);
    };
    const dominant = colors => {
      const groups = new Map();
      for (const color of colors) {
        if (color[3] < 20) continue;
        const key = clusterKey(color);
        const group = groups.get(key) || { count: 0, total: [0, 0, 0] };
        group.count++;
        group.total[0] += color[0];
        group.total[1] += color[1];
        group.total[2] += color[2];
        groups.set(key, group);
      }
      return [...groups.values()].map(group => ({
        count: group.count,
        color: group.total.map(total => Math.round(total / group.count))
      })).sort((a, b) => b.count - a.count);
    };
    const targetIds = [...new Set(targets.map(target => target.id))];
    const output = [];
    for (const target of targets) {
      const panel = panels.find(item =>
        new RegExp(target.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
          .test(identity(item))) || panels[targetIds.indexOf(target.id)];
      const canvas = panel?.querySelector('canvas');
      if (!canvas || !canvas.width || !canvas.height) continue;
      const scratch = document.createElement('canvas');
      scratch.width = canvas.width;
      scratch.height = canvas.height;
      const context = scratch.getContext('2d', { willReadFrequently: true });
      if (!context) continue;
      context.drawImage(canvas, 0, 0);
      const half = preferredTransform === 'orthogonal' ? {
        x: scratch.width / dimensions.cols / 2,
        y: scratch.height / dimensions.rows / 2
      } : {
        x: scratch.width / (dimensions.cols + dimensions.rows),
        y: scratch.height / (dimensions.cols + dimensions.rows)
      };
      const center = preferredTransform === 'orthogonal' ? {
        x: (target.target.x + 0.5) * scratch.width / dimensions.cols,
        y: (target.target.y + 0.5) * scratch.height / dimensions.rows
      } : preferredTransform === 'diamond-mirrored' ? {
        x: (target.target.y - target.target.x + dimensions.cols) * half.x,
        y: (target.target.x + target.target.y + 1) * half.y
      } : {
        x: (target.target.x - target.target.y + dimensions.rows) * half.x,
        y: (target.target.x + target.target.y + 1) * half.y
      };
      const inner = [];
      const ring = [];
      for (let gy = -10; gy <= 10; gy++) {
        for (let gx = -10; gx <= 10; gx++) {
          const nx = gx / 10;
          const ny = gy / 10;
          const distance = preferredTransform === 'orthogonal' ?
            Math.max(Math.abs(nx), Math.abs(ny)) :
            Math.abs(nx) + Math.abs(ny);
          const x = Math.max(0, Math.min(scratch.width - 1,
            Math.round(center.x + nx * half.x * 0.9)));
          const y = Math.max(0, Math.min(scratch.height - 1,
            Math.round(center.y + ny * half.y * 0.9)));
          const color = [...context.getImageData(x, y, 1, 1).data];
          if (distance <= 0.50) inner.push(color);
          if (distance >= 0.72 && distance <= 0.95) ring.push(color);
        }
      }
      const background = dominant(ring)[0];
      const glyphCandidates = dominant(inner).filter(group =>
        group.count >= 2 && background && Math.hypot(
          group.color[0] - background.color[0],
          group.color[1] - background.color[1],
          group.color[2] - background.color[2]
        ) >= 28).slice(0, 8).map(group => Object.assign({}, group, {
        contrast: ratio(group.color, background.color)
      })).sort((a, b) => b.contrast - a.contrast || b.count - a.count);
      const glyph = glyphCandidates[0];
      if (!glyph || !background) continue;
      const lowGlyph = glyph.color.map((channel, index) =>
        Math.round(channel * 0.1 + background.color[index] * 0.9));
      output.push(Object.assign({}, target, {
        transform: preferredTransform,
        css: {
          width: canvas.getBoundingClientRect().width,
          height: canvas.getBoundingClientRect().height
        },
        glyph,
        glyphCandidates,
        background,
        clusterDistance: Math.hypot(
          glyph.color[0] - background.color[0],
          glyph.color[1] - background.color[1],
          glyph.color[2] - background.color[2]
        ),
        contrast: ratio(glyph.color, background.color),
        lowContrastControl: ratio(lowGlyph, background.color)
      }));
    }
    return output;
  }, {
    targets: [
      Object.assign({ mode: 'remembered' }, remembered[0]),
      Object.assign({ mode: 'visible' }, visible[0])
    ],
    dimensions,
    preferredTransform
  });
  const rememberedMeasurement = measurements.find(item => item.mode === 'remembered');
  const visibleMeasurement = measurements.find(item => item.mode === 'visible');
  requireMeasurement(rememberedMeasurement, 'remembered door stroke/background clusters');
  requireMeasurement(visibleMeasurement, 'visible open/locked door stroke/background clusters');
  return {
    remembered: rememberedMeasurement,
    visible: visibleMeasurement
  };
}

function tacticalObjects(state) {
  const targets = [];
  const add = (type, id, position, details = {}) => {
    if (!position) return;
    targets.push(Object.assign({
      type,
      id: String(id || `${type}-${position.x}-${position.y}`),
      position
    }, details));
  };
  walkJson(state, (value, trail) => {
    const context = trail.join('.');
    if (Array.isArray(value) && /(laser|hazard)/i.test(context)) {
      for (const cell of normalizedCells(value).cells) {
        const position = coordinateOf(cell);
        if (position) add('laser-hazard', context, position);
      }
      return;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        /(frames|history|chain|ledger|replay)/i.test(context)) return;
    const identity = [
      value.id, value.name, value.type, value.kind, value.role, value.label, context
    ].filter(Boolean).join(' ');
    const position = coordinateOf(value);
    if (!position) return;
    if (/\bterminals?\b/i.test(identity)) {
      add(completionFlag(value) ? 'terminal-hacked' : 'terminal-unhacked',
        value.id || value.name, position);
    } else if (/\b(?:extraction|extract|exit)\b/i.test(identity)) {
      add('extraction', value.id || value.name, position);
    } else if (/\b(?:vault[-_\s]?core|data[-_\s]?core|core)\b/i.test(identity)) {
      add('core', value.id || value.name, position);
    } else if (/\bguards?\b/i.test(identity)) {
      add('guard', value.id || value.name, position);
    } else if (/\bcameras?\b/i.test(identity)) {
      add('camera', value.id || value.name, position);
    } else if (/\b(?:lasers?|hazards?)\b/i.test(identity)) {
      add('laser-hazard', value.id || value.name, position);
    } else if (/\bdoors?\b/i.test(identity)) {
      add('door', value.id || value.name, position, {
        open: value.open === true || /\bopen\b/i.test(String(value.status || value.state || '')),
        locked: value.locked === true || /\blocked\b/i.test(String(value.status || value.state || ''))
      });
    }
  });
  return [...new Map(targets.map(target =>
    [`${target.type}|${target.position.x},${target.position.y}`, target])).values()];
}

async function measureTacticalMarkerSet(page, preferredTransform, phase) {
  const snapshot = await inspect(page);
  const dimensions = facilityDimensions(snapshot);
  requireMeasurement(dimensions, `${phase} facility dimensions for tactical marker audit`);
  const rawState = frameState(latestExportFrame(snapshot.exported));
  requireMeasurement(rawState, `${phase} current exported frame for tactical marker audit`);
  const agents = normalizedAgents(agentsOf(snapshot.state));
  const rawAgents = normalizedAgents(agentsOf(rawState));
  const knowledge = povKnowledge(snapshot.state, agents.map(agent => agent.id));
  const fixtures = tacticalObjects(rawState);
  const candidates = [];
  for (const agent of agents) {
    if (agent.position) {
      candidates.push({
        key: `agent:${agent.id}`,
        type: 'agent',
        id: agent.id,
        panelAgentId: agent.id,
        position: agent.position,
        visibility: 'self',
        phase
      });
    }
  }
  for (const fixture of fixtures) {
    const eligible = [];
    for (const agent of agents) {
      const view = knowledge.find(item => item.id === agent.id);
      const rawAgent = rawAgents.find(item => item.id === agent.id);
      const known = view?.known.cells.length ? view.known : rawAgent?.seen;
      const visible = view?.visible;
      if (!known || !visible || (!visible.cells.length && visible.count > 0)) continue;
      const cell = `${fixture.position.x},${fixture.position.y}`;
      if (visible.cells.includes(cell)) {
        eligible.push({ panelAgentId: agent.id, visibility: 'visible', score: 30 });
      } else if (known.cells.includes(cell)) {
        eligible.push({ panelAgentId: agent.id, visibility: 'remembered', score: 20 });
      }
    }
    if (!eligible.length) continue;
    for (const eligibleView of eligible) {
      candidates.push(Object.assign({}, fixture, eligibleView, {
        key: fixture.type,
        phase
      }));
    }
  }

  const measured = await page.evaluate(({ candidates, dimensions, preferredTransform }) => {
    const grid = document.getElementById('pov-grid');
    if (!grid) return [];
    const panels = [...grid.querySelectorAll(
      '[data-pov-agent], [data-agent-id], .pov-card, .pov-panel, [data-pov]'
    )].filter(panel => panel.querySelector('canvas'));
    const panelIdentity = panel => [
      panel.dataset.povAgent, panel.dataset.agentId, panel.dataset.pov,
      panel.getAttribute('aria-label'), panel.textContent
    ].filter(Boolean).join(' ');
    const panelIds = [...new Set(candidates.map(candidate => candidate.panelAgentId))];
    const canvases = new Map();
    const getCanvas = candidate => {
      const panel = panels.find(item =>
        new RegExp(candidate.panelAgentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
          .test(panelIdentity(item))) || panels[panelIds.indexOf(candidate.panelAgentId)];
      const canvas = panel?.querySelector('canvas');
      if (!canvas || !canvas.width || !canvas.height) return null;
      if (canvases.has(canvas)) return canvases.get(canvas);
      const scratch = document.createElement('canvas');
      scratch.width = canvas.width;
      scratch.height = canvas.height;
      const context = scratch.getContext('2d', { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(canvas, 0, 0);
      const entry = {
        context,
        width: scratch.width,
        height: scratch.height,
        css: {
          width: canvas.getBoundingClientRect().width,
          height: canvas.getBoundingClientRect().height
        }
      };
      canvases.set(canvas, entry);
      return entry;
    };
    const luminance = color => {
      const channel = value => {
        const unit = value / 255;
        return unit <= 0.03928 ? unit / 12.92 :
          Math.pow((unit + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(color[0]) +
        0.7152 * channel(color[1]) +
        0.0722 * channel(color[2]);
    };
    const ratio = (a, b) => {
      const one = luminance(a);
      const two = luminance(b);
      return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);
    };
    const dominant = colors => {
      const groups = new Map();
      for (const color of colors) {
        if (color[3] < 20) continue;
        const key = color.slice(0, 3).map(channel =>
          Math.round(channel / 16) * 16).join(',');
        const group = groups.get(key) || { count: 0, total: [0, 0, 0] };
        group.count++;
        group.total[0] += color[0];
        group.total[1] += color[1];
        group.total[2] += color[2];
        groups.set(key, group);
      }
      return [...groups.values()].map(group => ({
        count: group.count,
        color: group.total.map(total => Math.round(total / group.count))
      })).sort((a, b) => b.count - a.count);
    };
    const output = [];
    for (const candidate of candidates) {
      const canvas = getCanvas(candidate);
      if (!canvas) continue;
      const half = preferredTransform === 'orthogonal' ? {
        x: canvas.width / dimensions.cols / 2,
        y: canvas.height / dimensions.rows / 2
      } : {
        x: canvas.width / (dimensions.cols + dimensions.rows),
        y: canvas.height / (dimensions.cols + dimensions.rows)
      };
      const center = preferredTransform === 'orthogonal' ? {
        x: (candidate.position.x + 0.5) * canvas.width / dimensions.cols,
        y: (candidate.position.y + 0.5) * canvas.height / dimensions.rows
      } : preferredTransform === 'diamond-mirrored' ? {
        x: (candidate.position.y - candidate.position.x + dimensions.cols) * half.x,
        y: (candidate.position.x + candidate.position.y + 1) * half.y
      } : {
        x: (candidate.position.x - candidate.position.y + dimensions.rows) * half.x,
        y: (candidate.position.x + candidate.position.y + 1) * half.y
      };
      const inner = [];
      const ring = [];
      for (let gy = -10; gy <= 10; gy++) {
        for (let gx = -10; gx <= 10; gx++) {
          const nx = gx / 10;
          const ny = gy / 10;
          const distance = preferredTransform === 'orthogonal' ?
            Math.max(Math.abs(nx), Math.abs(ny)) :
            Math.abs(nx) + Math.abs(ny);
          const x = Math.max(0, Math.min(canvas.width - 1,
            Math.round(center.x + nx * half.x * 0.9)));
          const y = Math.max(0, Math.min(canvas.height - 1,
            Math.round(center.y + ny * half.y * 0.9)));
          const color = [...canvas.context.getImageData(x, y, 1, 1).data];
          if (distance <= 0.50) inner.push(color);
          if (distance >= 0.72 && distance <= 0.95) ring.push(color);
        }
      }
      const background = dominant(ring)[0];
      const glyphCandidates = dominant(inner).filter(group =>
        group.count >= 2 && background && Math.hypot(
          group.color[0] - background.color[0],
          group.color[1] - background.color[1],
          group.color[2] - background.color[2]
        ) >= 28).slice(0, 8).map(group => Object.assign({}, group, {
        contrast: ratio(group.color, background.color)
      })).sort((a, b) => b.contrast - a.contrast || b.count - a.count);
      const glyph = glyphCandidates[0];
      if (!background || !glyph) continue;
      const lowGlyph = glyph.color.map((channel, index) =>
        Math.round(channel * 0.1 + background.color[index] * 0.9));
      output.push(Object.assign({}, candidate, {
        transform: preferredTransform,
        css: canvas.css,
        glyph,
        background,
        glyphCandidates,
        clusterDistance: Math.hypot(
          glyph.color[0] - background.color[0],
          glyph.color[1] - background.color[1],
          glyph.color[2] - background.color[2]
        ),
        glyphFraction: glyph.count / inner.length,
        contrast: ratio(glyph.color, background.color),
        lowContrastControl: ratio(lowGlyph, background.color)
      }));
    }
    return output;
  }, { candidates, dimensions, preferredTransform });
  return { phase, candidates, measured };
}

async function readBoardSemantic(page) {
  return page.locator('#game-board').evaluate(board => {
    const referenced = attribute => String(board.getAttribute(attribute) || '')
      .split(/\s+/).filter(Boolean)
      .map(id => document.getElementById(id)?.textContent || '').join(' ');
    const activeId = board.getAttribute('aria-activedescendant');
    const active = activeId && document.getElementById(activeId);
    return {
      text: [
        board.getAttribute('aria-label'),
        board.getAttribute('aria-description'),
        referenced('aria-labelledby'),
        referenced('aria-describedby'),
        active && active.getAttribute('aria-label'),
        active && active.getAttribute('aria-description'),
        active && active.textContent,
        board.getAttribute('data-cursor'),
        board.getAttribute('data-coordinate')
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
      activeId: activeId || ''
    };
  });
}

async function readBoardAccessibilitySnapshot(page) {
  const state = await inspect(page, false);
  const aria = await page.locator('#game-board').evaluate(board => {
    const ids = String(board.getAttribute('aria-describedby') || '')
      .split(/\s+/).filter(Boolean);
    const selected = document.querySelector(
      '#agent-list [aria-pressed="true"], #agent-list .agent-button.selected'
    );
    const selectedName = selected && (
      selected.querySelector('.agent-name, .agent-label, [data-agent-name]')?.textContent ||
      selected.getAttribute('data-agent-id') ||
      selected.getAttribute('aria-label') ||
      selected.textContent
    );
    return {
      label: String(board.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(),
      describedBy: ids,
      description: ids.map(id => document.getElementById(id)?.textContent || '')
        .join(' ').replace(/\s+/g, ' ').trim(),
      selectedName: String(selectedName || '').replace(/\s+/g, ' ').trim(),
      focusOnBoard: document.activeElement === board,
      activeId: document.activeElement?.id || ''
    };
  });
  const currentFrameTick = Number(state.state?.currentFrame?.tick);
  const displayedTick = Number(
    state.state?.currentFrame?.tick ?? state.state?.tick ?? state.viewTick
  );
  const liveTick = Number(state.state?.liveTick ?? state.tick);
  const currentFrameIndex = Number(state.state?.currentFrame?.index);
  requireMeasurement(Number.isFinite(displayedTick),
    'displayed board tick from state().currentFrame.tick/state.tick/viewTick');
  return Object.assign({
    tick: displayedTick,
    currentFrameTick: Number.isFinite(currentFrameTick) ? currentFrameTick : undefined,
    liveTick,
    head: state.head,
    frameCount: state.frameCount,
    currentFrameIndex: Number.isFinite(currentFrameIndex) ? currentFrameIndex : undefined
  }, aria);
}

function boardAccessibilityConsistent(snapshot) {
  if (!snapshot.label || !snapshot.description || !snapshot.selectedName ||
      !snapshot.describedBy.length) return false;
  const tickPattern = new RegExp(`\\b(?:tick|turn)\\s*#?\\s*${snapshot.tick}\\b`, 'i');
  const escapedName = snapshot.selectedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const selectedPattern = new RegExp(escapedName, 'i');
  const labelCoordinate = coordinateFromBoardText(snapshot.label);
  const descriptionCoordinate = coordinateFromBoardText(snapshot.description);
  const coordinateConsistent = !labelCoordinate ||
    (descriptionCoordinate &&
      labelCoordinate.x === descriptionCoordinate.x &&
      labelCoordinate.y === descriptionCoordinate.y);
  const ignored = new Set([
    'board', 'game', 'arrow', 'arrows', 'keys', 'press', 'use', 'move',
    'cursor', 'selected', 'current'
  ]);
  const labelTokens = snapshot.label.toLowerCase().match(/[a-z]{4,}/g) || [];
  const semanticToken = labelTokens.find(token =>
    !ignored.has(token) && snapshot.description.toLowerCase().includes(token));
  return tickPattern.test(snapshot.description) &&
    selectedPattern.test(snapshot.description) &&
    coordinateConsistent &&
    Boolean(labelCoordinate || semanticToken);
}

async function readPovSemanticLabels(page) {
  return page.evaluate(() => {
    const grid = document.getElementById('pov-grid');
    if (!grid) return [];
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    const selectors = ['[data-pov-agent]', '[data-agent-id]', '.pov-card', '.pov-panel', '[data-pov]'];
    let panels = [];
    for (const selector of selectors) {
      const found = [...grid.querySelectorAll(selector)].filter(visible);
      if (found.length === 4) {
        panels = found;
        break;
      }
    }
    if (!panels.length) panels = [...grid.children].filter(visible);
    const referenced = (element, attribute) => String(element.getAttribute(attribute) || '')
      .split(/\s+/).filter(Boolean)
      .map(id => document.getElementById(id)?.textContent || '').join(' ');
    return panels.map(panel => [
      panel.getAttribute('aria-label'),
      panel.getAttribute('aria-description'),
      referenced(panel, 'aria-labelledby'),
      referenced(panel, 'aria-describedby'),
      panel.getAttribute('title')
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim());
  });
}

async function hasSelectedAgentControl(page) {
  return page.evaluate(() => {
    const list = document.getElementById('agent-list');
    if (!list) return false;
    return Boolean(list.querySelector('[aria-pressed="true"]') ||
      list.querySelector('.agent-button.selected'));
  });
}

async function measureMobileTargeting(page) {
  return page.evaluate(async () => {
    const state = await Promise.resolve(window.__doggHeist.state());
    const board = document.getElementById('game-board');
    if (!board) return { measurable: false };
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    const dimensionCandidates = [];
    const walk = (value, trail = [], depth = 0) => {
      if (!value || typeof value !== 'object' || depth > 7) return;
      if (Array.isArray(value) && value.length && value.every(row => Array.isArray(row))) {
        dimensionCandidates.push({
          cols: Math.max(...value.map(row => row.length)),
          rows: value.length,
          score: /facility|map|grid|board|layout/i.test(trail.join('.')) ? 20 : 1,
          source: trail.join('.')
        });
      }
      if (!Array.isArray(value)) {
        const cols = Number(value.width ?? value.cols ?? value.columns);
        const rows = Number(value.height ?? value.rows);
        if (Number.isFinite(cols) && Number.isFinite(rows) && cols > 1 && rows > 1 &&
            cols <= 200 && rows <= 200) {
          dimensionCandidates.push({
            cols,
            rows,
            score: /facility|map|grid|board|layout/i.test(trail.join('.')) ? 30 : 2,
            source: trail.join('.')
          });
        }
      }
      for (const [key, child] of Object.entries(value)) {
        if (child && typeof child === 'object') walk(child, trail.concat(key), depth + 1);
      }
    };
    walk(state);
    dimensionCandidates.sort((a, b) => b.score - a.score);
    const dimensions = dimensionCandidates[0];
    if (!dimensions) return { measurable: false };

    const roots = [document.documentElement, document.body].filter(Boolean);
    const originals = roots.map(element => ({
      element,
      value: element.style.getPropertyValue('scroll-behavior'),
      priority: element.style.getPropertyPriority('scroll-behavior')
    }));
    roots.forEach(element => element.style.setProperty('scroll-behavior', 'auto', 'important'));
    board.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const cells = [...board.querySelectorAll(
      '[data-cell], [data-coordinate], [data-x][data-y], [data-col][data-row], [role="gridcell"]'
    )].filter(visible);
    const cellSizes = cells.map(element => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height, element, rect };
    }).filter(size => size.width > 0 && size.height > 0 &&
      size.rect.right > 0 && size.rect.left < innerWidth &&
      size.rect.bottom > 0 && size.rect.top < innerHeight);
    const boardRect = board.getBoundingClientRect();
    const visual = board.querySelector('canvas, svg, [role="grid"]') || board;
    const visualRect = visual.getBoundingClientRect();
    const contentWidth = Math.max(board.scrollWidth, visual.scrollWidth || 0, visualRect.width, boardRect.width);
    const contentHeight = Math.max(board.scrollHeight, visual.scrollHeight || 0, visualRect.height, boardRect.height);
    const calculatedScale = Math.min(
      contentWidth / dimensions.cols,
      contentHeight / dimensions.rows
    );
    const cellScales = cellSizes.map(size => Math.min(size.width, size.height))
      .sort((a, b) => a - b);
    const renderedCellScale = cellScales.length ?
      cellScales[Math.floor(cellScales.length / 2)] : calculatedScale;

    const targetingControls = [...document.querySelectorAll(
      'button, [role="button"], [role="gridcell"], [aria-label], [data-action]'
    )].filter(element => {
      if (!visible(element) || element === board) return false;
      const rect = element.getBoundingClientRect();
      if (rect.right <= 0 || rect.left >= innerWidth || rect.bottom <= 0 || rect.top >= innerHeight) {
        return false;
      }
      const semanticControl = element.matches('button, [role="button"], [role="gridcell"], [data-action]') ||
        (element.hasAttribute('aria-label') && element.tabIndex >= 0);
      if (!semanticControl || Math.max(rect.width, rect.height) > 180) return false;
      const semantics = [
        element.id, element.className, element.getAttribute('aria-label'),
        element.getAttribute('title'), element.getAttribute('data-action'), element.textContent
      ].filter(Boolean).join(' ');
      return /\b(target|aim|cursor|cell|tile|move|pan|select|up|down|left|right)\b/i.test(semantics);
    }).map(element => {
      const rect = element.getBoundingClientRect();
      return { element, rect, scale: Math.min(rect.width, rect.height) };
    }).filter(control => control.scale >= 40);

    let target;
    const visibleCell = cellSizes.find(size =>
      size.rect.left >= 0 && size.rect.right <= innerWidth &&
      size.rect.top >= 0 && size.rect.bottom <= innerHeight);
    if (renderedCellScale < 40 && targetingControls.length) {
      const control = targetingControls[0];
      target = {
        x: control.rect.left + control.rect.width / 2,
        y: control.rect.top + control.rect.height / 2,
        kind: 'control',
        size: control.scale
      };
    } else if (visibleCell) {
      target = {
        x: visibleCell.rect.left + visibleCell.rect.width / 2,
        y: visibleCell.rect.top + visibleCell.rect.height / 2,
        kind: 'cell',
        size: Math.min(visibleCell.rect.width, visibleCell.rect.height)
      };
    } else if (boardRect.right > 0 && boardRect.left < innerWidth &&
        boardRect.bottom > 0 && boardRect.top < innerHeight) {
      const left = Math.max(0, boardRect.left);
      const right = Math.min(innerWidth, boardRect.right);
      const top = Math.max(0, boardRect.top);
      const bottom = Math.min(innerHeight, boardRect.bottom);
      target = { x: (left + right) / 2, y: (top + bottom) / 2, kind: 'board', size: calculatedScale };
    } else if (targetingControls.length) {
      const control = targetingControls[0];
      target = {
        x: control.rect.left + control.rect.width / 2,
        y: control.rect.top + control.rect.height / 2,
        kind: 'control',
        size: control.scale
      };
    }
    for (const original of originals) {
      if (original.value) {
        original.element.style.setProperty('scroll-behavior', original.value, original.priority);
      } else {
        original.element.style.removeProperty('scroll-behavior');
      }
    }
    return {
      measurable: true,
      dimensions,
      renderedCellScale,
      accessibleTargetScale: targetingControls.length ?
        Math.max(...targetingControls.map(control => control.scale)) : 0,
      target,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth
    };
  });
}

async function measureContrast(page, mode, roles = []) {
  return page.evaluate(({ mode, roles }) => {
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    const colorCanvas = document.createElement('canvas');
    colorCanvas.width = colorCanvas.height = 1;
    const colorContext = colorCanvas.getContext('2d', { willReadFrequently: true });
    const parse = value => {
      const match = String(value || '').match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?/i);
      if (match) {
        return {
          r: Number(match[1]),
          g: Number(match[2]),
          b: Number(match[3]),
          a: match[4] === undefined ? 1 : Number(match[4])
        };
      }
      if (!colorContext || !value) return null;
      try {
        colorContext.clearRect(0, 0, 1, 1);
        colorContext.fillStyle = 'rgba(0, 0, 0, 0)';
        colorContext.fillStyle = value;
        colorContext.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = colorContext.getImageData(0, 0, 1, 1).data;
        return { r, g, b, a: a / 255 };
      } catch (error) {
        return null;
      }
    };
    const over = (front, back) => {
      const alpha = front.a + back.a * (1 - front.a);
      if (!alpha) return { r: 0, g: 0, b: 0, a: 0 };
      return {
        r: (front.r * front.a + back.r * back.a * (1 - front.a)) / alpha,
        g: (front.g * front.a + back.g * back.a * (1 - front.a)) / alpha,
        b: (front.b * front.a + back.b * back.a * (1 - front.a)) / alpha,
        a: alpha
      };
    };
    const effectiveBackground = element => {
      const chain = [];
      for (let node = element; node; node = node.parentElement) chain.push(node);
      let color = { r: 255, g: 255, b: 255, a: 1 };
      for (const node of chain.reverse()) {
        const next = parse(getComputedStyle(node).backgroundColor);
        if (next && next.a > 0) color = over(next, color);
      }
      return color;
    };
    const luminance = color => {
      const channel = value => {
        const unit = value / 255;
        return unit <= 0.03928 ? unit / 12.92 : Math.pow((unit + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
    };
    const measurement = element => {
      const style = getComputedStyle(element);
      const background = effectiveBackground(element);
      const parsedForeground = parse(style.color);
      if (!parsedForeground) return null;
      let opacity = 1;
      for (let node = element; node; node = node.parentElement) {
        opacity *= Number(getComputedStyle(node).opacity || 1);
      }
      const foreground = over(Object.assign({}, parsedForeground, {
        a: parsedForeground.a * opacity
      }), background);
      const light = Math.max(luminance(foreground), luminance(background));
      const dark = Math.min(luminance(foreground), luminance(background));
      return {
        ratio: (light + 0.05) / (dark + 0.05),
        text: String(element.textContent || element.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 100),
        fontSize: style.fontSize,
        color: style.color,
        background: `rgb(${Math.round(background.r)}, ${Math.round(background.g)}, ${Math.round(background.b)})`
      };
    };
    const all = [...document.querySelectorAll('body *')].filter(visible);
    const bodyStyle = getComputedStyle(document.body);
    const rootStyle = getComputedStyle(document.documentElement);
    const theme = [
      bodyStyle.color, bodyStyle.backgroundColor,
      rootStyle.color, rootStyle.backgroundColor
    ].join('|');
    if (mode === 'intro') {
      const dialog = document.querySelector('[data-dogg-test-intro="true"]');
      if (!dialog) return { theme, intro: null };
      const candidates = [...dialog.querySelectorAll(
        '[class*="muted" i], [class*="subtitle" i], [class*="lede" i], [data-tone="muted"], small, p'
      )].filter(element => visible(element) && String(element.textContent || '').trim().length >= 20)
        .map(element => {
          const identity = `${element.className} ${element.getAttribute('data-tone') || ''}`;
          const score = /muted|subtitle|lede/i.test(identity) ? 20 :
            parseFloat(getComputedStyle(element).fontSize) <= 16 ? 5 : 1;
          return { element, score };
        }).sort((a, b) => b.score - a.score);
      return {
        theme,
        intro: candidates.length ? measurement(candidates[0].element) : null
      };
    }

    const roleMeasurements = [];
    for (const role of roles) {
      const escaped = String(role).trim().toLowerCase();
      const candidates = all.filter(element => {
        const text = String(element.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        return text === escaped || (text.includes(escaped) && text.length <= escaped.length + 20);
      }).map(element => {
        const identity = `${element.className} ${element.id} ${element.getAttribute('data-role') || ''}`;
        return { element, score: /role/i.test(identity) ? 20 : 1 };
      }).sort((a, b) => b.score - a.score);
      if (candidates.length) roleMeasurements.push(measurement(candidates[0].element));
    }
    const statusCandidates = all.filter(element => {
      const identity = [
        element.id, element.className, element.getAttribute('data-status'),
        element.getAttribute('aria-label'), element.textContent
      ].filter(Boolean).join(' ');
      return /\b(active|live|running|paused|ready)\b/i.test(identity) &&
        /status|badge|pill|live/i.test(identity);
    }).map(element => {
      const identity = `${element.id} ${element.className}`;
      return { element, score: /active|status-live|live-status/i.test(identity) ? 20 : 1 };
    }).sort((a, b) => b.score - a.score);
    const neutralStatusElement = document.getElementById('status-live');
    const neutralStatus = neutralStatusElement && visible(neutralStatusElement) ?
      measurement(neutralStatusElement) : null;
    const agentList = document.getElementById('agent-list');
    const selectedAgent = agentList && (
      agentList.querySelector('[aria-pressed="true"]') ||
      agentList.querySelector('.agent-button.selected')
    );
    const selectedContainer = selectedAgent &&
      (selectedAgent.closest('[data-agent-id], .agent-item, li') || selectedAgent);
    const cooldown = selectedAgent && (
      selectedAgent.querySelector('.agent-cooldown[data-agent-cooldown]') ||
      selectedContainer.querySelector('.agent-cooldown[data-agent-cooldown]')
    );
    return {
      theme,
      roles: roleMeasurements.filter(Boolean),
      status: statusCandidates.length ? measurement(statusCandidates[0].element) : null,
      neutralStatus,
      selectedControlFound: Boolean(selectedAgent && visible(selectedAgent)),
      selectedMetadata: cooldown && visible(cooldown) ? measurement(cooldown) : null
    };
  }, { mode, roles });
}

async function measureElementContrast(page, selector) {
  return page.evaluate(css => {
    const element = document.querySelector(css);
    if (!element) return { found: false, selector: css };
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const visible = !element.hidden && style.display !== 'none' &&
      style.visibility !== 'hidden' && Number(style.opacity) > 0 &&
      rect.width > 0 && rect.height > 0;
    if (!visible) return { found: true, visible: false, selector: css };
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const parse = value => {
      const match = String(value || '').match(
        /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?/i
      );
      if (match) {
        return {
          r: Number(match[1]),
          g: Number(match[2]),
          b: Number(match[3]),
          a: match[4] === undefined ? 1 : Number(match[4])
        };
      }
      if (!context || !value) return null;
      try {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = 'rgba(0, 0, 0, 0)';
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
        return { r, g, b, a: a / 255 };
      } catch (error) {
        return null;
      }
    };
    const over = (front, back) => {
      const alpha = front.a + back.a * (1 - front.a);
      if (!alpha) return { r: 0, g: 0, b: 0, a: 0 };
      return {
        r: (front.r * front.a + back.r * back.a * (1 - front.a)) / alpha,
        g: (front.g * front.a + back.g * back.a * (1 - front.a)) / alpha,
        b: (front.b * front.a + back.b * back.a * (1 - front.a)) / alpha,
        a: alpha
      };
    };
    const chain = [];
    for (let node = element; node; node = node.parentElement) chain.push(node);
    let background = { r: 255, g: 255, b: 255, a: 1 };
    for (const node of chain.reverse()) {
      const next = parse(getComputedStyle(node).backgroundColor);
      if (next && next.a > 0) background = over(next, background);
    }
    const foregroundColor = parse(style.color);
    if (!foregroundColor) return { found: true, visible: true, measurable: false, selector: css };
    let opacity = foregroundColor.a;
    for (let node = element; node; node = node.parentElement) {
      opacity *= Number(getComputedStyle(node).opacity || 1);
    }
    const foreground = over(Object.assign({}, foregroundColor, { a: opacity }), background);
    const luminance = color => {
      const channel = value => {
        const unit = value / 255;
        return unit <= 0.03928 ? unit / 12.92 :
          Math.pow((unit + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(color.r) +
        0.7152 * channel(color.g) +
        0.0722 * channel(color.b);
    };
    const foregroundLuminance = luminance(foreground);
    const backgroundLuminance = luminance(background);
    return {
      found: true,
      visible: true,
      measurable: true,
      selector: css,
      disabled: Boolean(
        ('disabled' in element && element.disabled) ||
        element.getAttribute('aria-disabled') === 'true'
      ),
      cursor: style.cursor,
      opacity: Number(style.opacity),
      textDecoration: style.textDecorationLine,
      ratio: (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
        (Math.min(foregroundLuminance, backgroundLuminance) + 0.05),
      text: String(element.textContent || element.getAttribute('aria-label') || '')
        .replace(/\s+/g, ' ').trim().slice(0, 120),
      color: style.color,
      background: `rgb(${Math.round(background.r)}, ${Math.round(background.g)}, ${Math.round(background.b)})`
    };
  }, selector);
}

async function measureDisabledControlContrast(page, kind) {
  const marker = await page.evaluate(targetKind => {
    const controls = [...document.querySelectorAll(
      'button, input[type="button"], input[type="submit"], [role="button"]'
    )];
    let element;
    if (targetKind === 'fork') {
      element = document.getElementById('fork-button');
    } else if (targetKind === 'play') {
      element = document.getElementById('play-toggle');
    } else if (targetKind === 'return-live') {
      element = document.querySelector(
        '#return-live, #live-button, [data-action="return-live"], [data-action="live"]'
      ) || controls.find(control => {
        if (control.id === 'play-toggle') return false;
        const text = [
          control.id,
          control.getAttribute('aria-label'),
          control.getAttribute('title'),
          control.textContent,
          control.value
        ].filter(Boolean).join(' ');
        return /\b(return[-_\s]+(?:to[-_\s]+)?live|back[-_\s]+to[-_\s]+live|live[-_\s]+head)\b/i.test(text);
      });
    }
    if (!element) return { found: false };
    document.querySelectorAll('[data-dogg-test-disabled-contrast]')
      .forEach(node => node.removeAttribute('data-dogg-test-disabled-contrast'));
    element.setAttribute('data-dogg-test-disabled-contrast', targetKind);
    return {
      found: true,
      disabled: Boolean(
        ('disabled' in element && element.disabled) ||
        element.getAttribute('aria-disabled') === 'true'
      )
    };
  }, kind);
  requireMeasurement(marker.found, `the ${kind} control for disabled contrast`);
  const measured = await measureElementContrast(
    page,
    `[data-dogg-test-disabled-contrast="${kind}"]`
  );
  return Object.assign({ kind }, measured);
}

async function scanSmallTextContrast(page, stateName) {
  return page.evaluate(state => {
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return !element.hidden && !element.closest('[hidden], [aria-hidden="true"], [inert]') &&
        style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    const disabled = element => Boolean(
      element.closest('[disabled], [aria-disabled="true"]') ||
      ('disabled' in element && element.disabled)
    );
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const parse = value => {
      const match = String(value || '').match(
        /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?/i
      );
      if (match) {
        return {
          r: Number(match[1]),
          g: Number(match[2]),
          b: Number(match[3]),
          a: match[4] === undefined ? 1 : Number(match[4])
        };
      }
      if (!context || !value) return null;
      try {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = 'rgba(0, 0, 0, 0)';
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
        return { r, g, b, a: a / 255 };
      } catch (error) {
        return null;
      }
    };
    const over = (front, back) => {
      const alpha = front.a + back.a * (1 - front.a);
      if (!alpha) return { r: 0, g: 0, b: 0, a: 0 };
      return {
        r: (front.r * front.a + back.r * back.a * (1 - front.a)) / alpha,
        g: (front.g * front.a + back.g * back.a * (1 - front.a)) / alpha,
        b: (front.b * front.a + back.b * back.a * (1 - front.a)) / alpha,
        a: alpha
      };
    };
    const effectiveBackground = element => {
      const chain = [];
      for (let node = element; node; node = node.parentElement) chain.push(node);
      let color = { r: 255, g: 255, b: 255, a: 1 };
      for (const node of chain.reverse()) {
        const next = parse(getComputedStyle(node).backgroundColor);
        if (next && next.a > 0) color = over(next, color);
      }
      return color;
    };
    const luminance = color => {
      const channel = value => {
        const unit = value / 255;
        return unit <= 0.03928 ? unit / 12.92 :
          Math.pow((unit + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(color.r) +
        0.7152 * channel(color.g) +
        0.0722 * channel(color.b);
    };
    const directText = element => {
      if (element instanceof HTMLSelectElement) {
        return element.selectedOptions[0]?.textContent || '';
      }
      if (element instanceof HTMLInputElement &&
          /^(?:button|submit|reset)$/i.test(element.type)) return element.value;
      const text = [...element.childNodes]
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent || '').join(' ').replace(/\s+/g, ' ').trim();
      if (text) return text;
      if (!element.children.length) {
        return String(element.textContent || '').replace(/\s+/g, ' ').trim();
      }
      return '';
    };
    const meaningful = text => {
      const value = String(text || '').replace(/\s+/g, ' ').trim();
      return /[\p{L}\p{N}]/u.test(value) &&
        !/^[\s•·●○◦▪▫|—–\-_=+<>()[\]{}]+$/u.test(value);
    };
    const selector = element => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const classes = [...element.classList].slice(0, 3)
        .map(name => `.${CSS.escape(name)}`).join('');
      const parent = element.parentElement;
      if (!parent) return element.tagName.toLowerCase() + classes;
      const siblings = [...parent.children].filter(child => child.tagName === element.tagName);
      const suffix = siblings.length > 1 ?
        `:nth-of-type(${siblings.indexOf(element) + 1})` : '';
      return `${element.tagName.toLowerCase()}${classes}${suffix}`;
    };
    const selectedControl = document.querySelector(
      '#agent-list [aria-pressed="true"], #agent-list .agent-button.selected'
    );
    const rows = [];
    for (const element of document.querySelectorAll('body *')) {
      if (!visible(element) || disabled(element) ||
          element.matches('script, style, noscript, canvas, svg, path, option')) continue;
      const text = directText(element);
      if (!meaningful(text)) continue;
      const style = getComputedStyle(element);
      const fontSize = parseFloat(style.fontSize);
      if (!Number.isFinite(fontSize) || fontSize >= 14) continue;
      const foregroundColor = parse(style.color);
      if (!foregroundColor) continue;
      const background = effectiveBackground(element);
      let opacity = foregroundColor.a;
      for (let node = element; node; node = node.parentElement) {
        opacity *= Number(getComputedStyle(node).opacity || 1);
      }
      const foreground = over(Object.assign({}, foregroundColor, { a: opacity }), background);
      const foregroundLuminance = luminance(foreground);
      const backgroundLuminance = luminance(background);
      const ratio = (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
        (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
      rows.push({
        selector: selector(element),
        text: text.slice(0, 120),
        ratio,
        fontSize,
        element
      });
    }

    const measuredWithin = css => rows.some(row =>
      row.element.matches(css) || Boolean(row.element.closest(css)));
    const selectedWithin = css => Boolean(selectedControl) && rows.some(row =>
      selectedControl.contains(row.element) &&
      (row.element.matches(css) || Boolean(row.element.closest(css))));
    const coverage = {
      boardTip: measuredWithin('#board-tip, .board-tip, [data-board-tip]'),
      legendItem: measuredWithin('.legend-item, [data-legend-item]'),
      selectedAgentLabel: Boolean(selectedControl) && rows.some(row =>
        selectedControl.contains(row.element) &&
        !row.element.matches('.agent-role, .agent-intent, .agent-cooldown, [data-agent-cooldown]') &&
        !row.element.closest('.agent-role, .agent-intent, .agent-cooldown, [data-agent-cooldown]')),
      selectedAgentIntent: selectedWithin(
        '.agent-intent, [data-agent-intent], [class*="agent"][class*="intent"]'
      ),
      selectedAgentCooldown: selectedWithin(
        '.agent-cooldown[data-agent-cooldown], [data-agent-cooldown]'
      ),
      eyebrow: measuredWithin('.eyebrow, [data-eyebrow]'),
      sectionKicker: measuredWithin('.section-kicker, [data-section-kicker]'),
      status: measuredWithin('#status-live, .status-label, [data-status-label]'),
      micro: measuredWithin('.micro, .micro-label, [data-micro]'),
      eventLogText: measuredWithin('#event-log li, #event-log li strong'),
      povIntent: measuredWithin(
        '#pov-grid .intent, #pov-grid [data-intent], .pov-intent'
      ),
      stepMark: measuredWithin('.step-mark')
    };
    const serialized = rows.map(({ element, ...row }) => row)
      .sort((a, b) => a.ratio - b.ratio);
    return {
      state,
      count: serialized.length,
      worst: serialized[0] || null,
      failures: serialized.filter(row => row.ratio < 4.5).slice(0, 20),
      coverage,
      missingCoverage: Object.entries(coverage)
        .filter(([, present]) => !present).map(([name]) => name)
    };
  }, stateName);
}

async function visibleHelp(page) {
  return page.evaluate(() => {
    const button = document.getElementById('help-button');
    const candidates = [];
    const controlled = button && button.getAttribute('aria-controls');
    if (controlled) {
      const controlledElement = document.getElementById(controlled);
      if (controlledElement) {
        candidates.push(controlledElement.closest(
          'dialog[open], [role="dialog"], [aria-modal="true"]'
        ) || controlledElement);
      }
    }
    candidates.push(...document.querySelectorAll(
      'dialog[open], [role="dialog"], [aria-modal="true"]'
    ));
    const unique = [...new Set(candidates)].filter(element =>
      element && element !== button &&
      element !== document.documentElement && element !== document.body &&
      !candidates.some(other => other && other !== element && other.contains(element)));
    const visible = unique.filter(element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return !element.hidden && !element.hasAttribute('inert') &&
        style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    });
    return {
      count: visible.length,
      text: visible.map(element => String(element.textContent || '').trim()).join(' ').slice(0, 5000),
      expanded: button && button.getAttribute('aria-expanded')
    };
  });
}

async function clickVisibleHelpClose(page) {
  const close = await page.evaluate(() => {
    const helpButton = document.getElementById('help-button');
    const controlled = helpButton && helpButton.getAttribute('aria-controls');
    const candidates = [];
    if (controlled) {
      const controlledElement = document.getElementById(controlled);
      if (controlledElement) {
        candidates.push(controlledElement.closest(
          'dialog[open], [role="dialog"], [aria-modal="true"]'
        ) || controlledElement);
      }
    }
    candidates.push(...document.querySelectorAll(
      'dialog[open], [role="dialog"], [aria-modal="true"]'
    ));
    const visible = element => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return !element.hidden && !element.hasAttribute('inert') &&
        style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    for (const surface of [...new Set(candidates)].filter(element =>
      element && element !== helpButton &&
      element !== document.documentElement && element !== document.body &&
      !candidates.some(other => other && other !== element && other.contains(element)) &&
      visible(element))) {
      const controls = [...surface.querySelectorAll(
        'button, [role="button"], input[type="button"], input[type="submit"]'
      )];
      for (const control of controls) {
        if (control === helpButton || !visible(control)) continue;
        const semantics = [
          control.id,
          control.getAttribute('aria-label'),
          control.getAttribute('title'),
          control.getAttribute('data-action'),
          control.textContent,
          control.value,
          control.closest('form[method="dialog"]') ? 'dialog close' : ''
        ].filter(Boolean).join(' ');
        if (control.id === 'help-close' ||
            /\b(close|dismiss|done|got it|okay|ok)\b|×/i.test(semantics)) {
          control.setAttribute('data-dogg-test-help-close', 'true');
          return { found: true, semantics: semantics.replace(/\s+/g, ' ').trim() };
        }
      }
    }
    return { found: false, semantics: '' };
  });
  requireMeasurement(close.found, 'a visible semantic close control inside the help dialog');
  await page.locator('[data-dogg-test-help-close="true"]').click();
  return close.semantics;
}

async function focusInsideVisibleHelp(page) {
  return page.evaluate(() => {
    const helpButton = document.getElementById('help-button');
    const controlled = helpButton && helpButton.getAttribute('aria-controls');
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return !element.hidden && !element.disabled &&
        style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    const candidates = [...document.querySelectorAll(
      'dialog[open], [role="dialog"], [aria-modal="true"]'
    )];
    if (controlled) {
      const controlledElement = document.getElementById(controlled);
      if (controlledElement) {
        candidates.push(controlledElement.closest(
          'dialog[open], [role="dialog"], [aria-modal="true"]'
        ) || controlledElement);
      }
    }
    const surfaces = [...new Set(candidates)].filter(element =>
      element && element !== document.documentElement && element !== document.body &&
      !candidates.some(other => other && other !== element && other.contains(element)) &&
      visible(element)).filter(element =>
      /\b(help|keyboard|controls?|terminals?|objective)\b/i.test(element.textContent || ''))
      .sort((a, b) => {
        const score = element => element.matches('dialog[open], [aria-modal="true"], [role="dialog"]') ?
          20 : element.hasAttribute('popover') ? 10 : 0;
        return score(b) - score(a);
      });
    const surface = surfaces[0];
    if (!surface) return false;
    const control = [...surface.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )].find(visible);
    (control || surface).focus();
    return surface.contains(document.activeElement);
  });
}

async function auditHelpContainment(page) {
  const initialScroll = await page.evaluate(() => ({
    window: scrollY,
    document: document.scrollingElement?.scrollTop || 0
  }));
  requireMeasurement(initialScroll.window > 0 || initialScroll.document > 0,
    'a scrolled short page before opening Help');
  await page.locator('#help-button').focus();
  await page.evaluate(position => {
    document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
    document.body.style.setProperty('scroll-behavior', 'auto', 'important');
    window.scrollTo(0, Math.max(position.window, position.document));
  }, initialScroll);
  const startScroll = await page.evaluate(() => ({
    window: scrollY,
    document: document.scrollingElement?.scrollTop || 0
  }));
  await page.keyboard.press('h');
  await poll(() => visibleHelp(page), value => value.count > 0, 2000);
  const dialogInfo = await page.evaluate(() => {
    const helpButton = document.getElementById('help-button');
    const controlled = helpButton && helpButton.getAttribute('aria-controls');
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    const candidates = [...document.querySelectorAll(
      'dialog[open], [role="dialog"], [aria-modal="true"]'
    )];
    if (controlled) {
      const controlledElement = document.getElementById(controlled);
      if (controlledElement) {
        candidates.push(controlledElement.closest(
          'dialog[open], [role="dialog"], [aria-modal="true"]'
        ) || controlledElement);
      }
    }
    const dialogs = [...new Set(candidates)].filter(element =>
      element && element !== document.documentElement && element !== document.body &&
      !candidates.some(other => other && other !== element && other.contains(element)) &&
      visible(element)).filter(element =>
      /\b(help|keyboard|controls?|terminals?|objective)\b/i.test(element.textContent || ''));
    const dialog = dialogs.sort((a, b) =>
      Number(b.matches('dialog[open], [aria-modal="true"], [role="dialog"]')) -
      Number(a.matches('dialog[open], [aria-modal="true"], [role="dialog"]')))[0];
    if (!dialog) return { found: false };
    dialog.setAttribute('data-dogg-test-help-dialog', 'true');
    const close = [...dialog.querySelectorAll(
      'button, [role="button"], input[type="button"], input[type="submit"]'
    )].find(control => {
      const semantics = [
        control.id,
        control.getAttribute('aria-label'),
        control.getAttribute('title'),
        control.textContent,
        control.value
      ].filter(Boolean).join(' ');
      return visible(control) &&
        (control.id === 'help-close' || /\b(close|dismiss|done|okay|ok)\b|×/i.test(semantics));
    });
    if (!close) return { found: false };
    close.setAttribute('data-dogg-test-help-close-focus', 'true');
    const rect = dialog.getBoundingClientRect();
    const points = [
      { x: 8, y: 8 },
      { x: innerWidth - 8, y: 8 },
      { x: 8, y: innerHeight - 8 },
      { x: innerWidth - 8, y: innerHeight - 8 }
    ];
    const backdrop = points.find(point =>
      !(point.x >= rect.left && point.x <= rect.right &&
        point.y >= rect.top && point.y <= rect.bottom));
    const scrollers = [dialog, ...dialog.querySelectorAll('*')].filter(element => {
      const style = getComputedStyle(element);
      return visible(element) && element.scrollHeight > element.clientHeight + 1 &&
        /(auto|scroll)/.test(style.overflowY);
    }).sort((a, b) =>
      (a.getBoundingClientRect().width * a.getBoundingClientRect().height) -
      (b.getBoundingClientRect().width * b.getBoundingClientRect().height));
    const scroller = scrollers[0];
    if (scroller) scroller.setAttribute('data-dogg-test-help-scroller', 'true');
    return {
      found: true,
      backdrop,
      scroller: scroller ? {
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
        rect: {
          left: scroller.getBoundingClientRect().left,
          top: scroller.getBoundingClientRect().top,
          width: scroller.getBoundingClientRect().width,
          height: scroller.getBoundingClientRect().height
        }
      } : null
    };
  });
  requireMeasurement(dialogInfo.found && dialogInfo.backdrop,
    'visible Help dialog, Close control, and backdrop point');
  requireMeasurement(dialogInfo.scroller, 'overflowing Help content on the short viewport');

  await page.locator('[data-dogg-test-help-close-focus="true"]').focus();
  const focusSamples = [];
  for (const key of [
    'Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab'
  ]) {
    await page.keyboard.press(key);
    focusSamples.push(await page.evaluate(() => {
      const dialog = document.querySelector('[data-dogg-test-help-dialog="true"]');
      return {
        inside: Boolean(dialog && dialog.contains(document.activeElement)),
        active: document.activeElement?.id || document.activeElement?.tagName || ''
      };
    }));
  }

  const beforeBackdropWheel = await page.evaluate(() => ({
    window: scrollY,
    document: document.scrollingElement?.scrollTop || 0
  }));
  await page.mouse.move(dialogInfo.backdrop.x, dialogInfo.backdrop.y);
  for (const delta of [200, 200, 200, 200]) await page.mouse.wheel(0, delta);
  await sleep(180);
  const afterBackdropWheel = await page.evaluate(() => ({
    window: scrollY,
    document: document.scrollingElement?.scrollTop || 0,
    dialogVisible: Boolean(document.querySelector('[data-dogg-test-help-dialog="true"]'))
  }));

  const scrollerCenter = {
    x: Math.max(1, Math.min((await page.viewportSize()).width - 1,
      dialogInfo.scroller.rect.left + dialogInfo.scroller.rect.width / 2)),
    y: Math.max(1, Math.min((await page.viewportSize()).height - 1,
      dialogInfo.scroller.rect.top + dialogInfo.scroller.rect.height / 2))
  };
  await page.mouse.move(scrollerCenter.x, scrollerCenter.y);
  for (const delta of [200, 200, 200]) await page.mouse.wheel(0, delta);
  await sleep(180);
  const afterContentWheel = await page.evaluate(() => ({
    scrollTop: document.querySelector('[data-dogg-test-help-scroller="true"]')?.scrollTop || 0,
    window: scrollY,
    document: document.scrollingElement?.scrollTop || 0
  }));

  await page.locator('[data-dogg-test-help-close-focus="true"]').focus();
  await page.keyboard.press('h');
  await poll(() => visibleHelp(page), value => value.count === 0, 2000);
  const afterH = {
    scroll: await page.evaluate(() => ({
      window: scrollY,
      document: document.scrollingElement?.scrollTop || 0
    })),
    focus: await focusHandoffState(page)
  };
  await page.keyboard.press('h');
  await poll(() => visibleHelp(page), value => value.count > 0, 2000);
  await focusInsideVisibleHelp(page);
  await page.keyboard.press('Escape');
  await poll(() => visibleHelp(page), value => value.count === 0, 2000);
  const afterEscape = {
    scroll: await page.evaluate(() => ({
      window: scrollY,
      document: document.scrollingElement?.scrollTop || 0
    })),
    focus: await focusHandoffState(page)
  };
  return {
    startScroll,
    focusTrapped: focusSamples.every(sample => sample.inside),
    focusSamples,
    backdropLocked:
      beforeBackdropWheel.window === afterBackdropWheel.window &&
      beforeBackdropWheel.document === afterBackdropWheel.document &&
      afterBackdropWheel.dialogVisible,
    contentScrolled: afterContentWheel.scrollTop > dialogInfo.scroller.scrollTop &&
      afterContentWheel.window === beforeBackdropWheel.window &&
      afterContentWheel.document === beforeBackdropWheel.document,
    hRestored: afterH.scroll.window === startScroll.window &&
      afterH.scroll.document === startScroll.document && afterH.focus.useful,
    escapeRestored: afterEscape.scroll.window === startScroll.window &&
      afterEscape.scroll.document === startScroll.document && afterEscape.focus.useful,
    afterH,
    afterEscape
  };
}

async function auditShortSkipTarget(page) {
  const skip = page.locator(
    '.skip-link, a[href="#game-board"], a[href="#app-shell"], a[href="#main"], a[href="#main-content"]'
  ).first();
  requireMeasurement(await skip.count() === 1, 'the short-screen skip link');
  await skip.focus();
  await page.evaluate(() => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const before = await skip.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return {
      height: rect.height,
      width: rect.width,
      href: element.getAttribute('href'),
      focused: document.activeElement === element
    };
  });
  requireMeasurement(before.href && before.href.startsWith('#'),
    'a same-page short-screen skip target');
  await page.keyboard.press('Enter');
  await poll(() => page.evaluate(() => ({
    hash: location.hash,
    boardFocused: document.activeElement === document.getElementById('game-board') ||
      Boolean(document.getElementById('game-board')?.contains(document.activeElement))
  })), value => value.boardFocused, 1500, 25);
  const after = await page.evaluate(() => ({
    hash: location.hash,
    boardFocused: document.activeElement === document.getElementById('game-board') ||
      Boolean(document.getElementById('game-board')?.contains(document.activeElement))
  }));
  return { before, after };
}

async function auditImmediateLandscapeSkip(page) {
  await page.evaluate(() => {
    const roots = [document.documentElement, document.body].filter(Boolean);
    const originals = roots.map(element => ({
      element,
      value: element.style.getPropertyValue('scroll-behavior'),
      priority: element.style.getPropertyPriority('scroll-behavior')
    }));
    roots.forEach(element => element.style.setProperty('scroll-behavior', 'auto', 'important'));
    window.scrollTo(0, 0);
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    originals.forEach(({ element, value, priority }) => {
      if (value) element.style.setProperty('scroll-behavior', value, priority);
      else element.style.removeProperty('scroll-behavior');
    });
  });
  const skip = page.locator(
    '.skip-link, a[href="#game-board"], a[href="#app-shell"], a[href="#main"], a[href="#main-content"]'
  ).first();
  requireMeasurement(await skip.count() === 1, 'the 836x224 skip link');
  await skip.focus();
  const before = await page.evaluate(() => ({
    hash: location.hash,
    window: scrollY,
    document: document.scrollingElement?.scrollTop || 0,
    viewport: { width: innerWidth, height: innerHeight }
  }));
  requireMeasurement(before.window === 0 && before.document === 0,
    'the landscape skip starting at scrollY 0');
  await page.keyboard.press('Enter');
  const after = await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => {
      const board = document.getElementById('game-board');
      const rect = board?.getBoundingClientRect();
      resolve({
        hash: location.hash,
        boardFocused: document.activeElement === board ||
          Boolean(board?.contains(document.activeElement)),
        boardIntersects: Boolean(rect && rect.right > 0 && rect.left < innerWidth &&
          rect.bottom > 0 && rect.top < innerHeight),
        boardRect: rect ? {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom
        } : null,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        viewport: { width: innerWidth, height: innerHeight }
      });
    });
  }));
  return { before, after };
}

async function deterministicRun(page, seed) {
  await api(page, 'pause');
  await api(page, 'restart', seed);
  await api(page, 'pause');
  const start = await inspect(page);
  requireMeasurement(start.agents.length === 4, `four agents after restart(${seed})`);
  const ids = start.agents.map(agent => agent.id).sort();
  const directiveResult = await api(page, 'queueDirective', ids[0], 1, 1);
  const queued = await inspect(page);
  const directiveAccepted = directiveResult !== undefined && directiveResult !== false &&
    !(directiveResult && typeof directiveResult === 'object' &&
      (directiveResult.ok === false || directiveResult.accepted === false));
  const queueObserved = directiveAccepted ||
    stable(canonicalProjection(queued.state)) !== stable(canonicalProjection(start.state)) ||
    queued.dom['status-live'] !== start.dom['status-live'] ||
    queued.dom['event-log'] !== start.dom['event-log'];
  await api(page, 'step', 1);
  await api(page, 'queueDirective', ids[1], 2, 2);
  await api(page, 'step', 3);
  await api(page, 'pause');
  const finished = await inspect(page);
  finished.queueObserved = queueObserved;
  return finished;
}

async function readDownload(download) {
  const stream = await download.createReadStream();
  requireMeasurement(stream, 'the export download stream');
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function runSuite() {
  requireMeasurement(fs.existsSync(ARTIFACT), `${ARTIFACT} (DOGG_HEIST_ROOT=${ROOT})`);
  browser = await chromium.launch();

  const slowStream = await auditSlowStreamFirstPaint(browser);
  result('slow-stream parser delay keeps focus and skip action inside intro',
    slowStream.parserHeld && slowStream.acknowledged && slowStream.pendingShield &&
      slowStream.queuedReady.ready === true &&
      slowStream.queuedAdvanced.running &&
      slowStream.queuedAdvanced.tick > slowStream.queuedReady.tick &&
      slowStream.skipAfter.hash === slowStream.href &&
      slowStream.skipAfter.targetExists,
    `parser tabs ${slowStream.parserSamples.map(sample => sample.active).join('→')}; ack ${slowStream.acknowledged}/shield ${slowStream.pendingShield}; queued tick ${slowStream.queuedReady.tick}→${slowStream.queuedAdvanced.tick}; pre-hash "${slowStream.before.hash}", post-skip "${slowStream.skipAfter.hash}"`);
  result('pre-ready Skip queues until intro release and lands on the board',
    slowStream.parserHeld &&
      slowStream.preReadySkipHeld &&
      Boolean(slowStream.queuedReady.release) &&
      slowStream.queuedRelease.ready === true &&
      slowStream.queuedRelease.introVisible === false &&
      slowStream.queuedRelease.hash === slowStream.href &&
      slowStream.queuedRelease.boardFocused &&
      slowStream.queuedRelease.boardIntersects,
    `immediate hash "${slowStream.queuedSkipBefore.hash}"→"${slowStream.queuedSkipImmediate.hash}", focus ${slowStream.queuedSkipBefore.active}→${slowStream.queuedSkipImmediate.active}, scroll ${slowStream.queuedSkipBefore.scroll.document}→${slowStream.queuedSkipImmediate.scroll.document}; release ${slowStream.queuedRelease.source || 'current'} ${slowStream.queuedRelease.hash} focus=${slowStream.queuedRelease.active} intersects=${slowStream.queuedRelease.boardIntersects}`);
  const repeatedIntroActivations = [];
  for (const mode of ['double-click', 'double-enter', 'double-touch']) {
    repeatedIntroActivations.push(await auditRepeatedIntroActivation(browser, mode));
  }
  result('repeated Begin activation starts exactly one unchanged-seed operation',
    repeatedIntroActivations.every(run =>
      run.shield.acknowledged &&
      stable(run.beforeSeed) === stable(run.afterSeed) &&
      (run.beforeBranch === undefined ||
        stable(run.beforeBranch) === stable(run.afterBranch)) &&
      run.hashUnchanged && run.running && run.tickAdvanced &&
      run.oneStart && run.noDirective),
    repeatedIntroActivations.map(run =>
      `${run.mode} seed ${String(run.beforeSeed)}→${String(run.afterSeed)} branch ${String(run.beforeBranch)}→${String(run.afterBranch)} tick ${run.readyTick}→${run.advancedTick} shield=${run.shield.acknowledged} directive-free=${run.noDirective}`).join(' | '));

  const firstPaintContext = await browser.newContext({
    viewport: { width: 390, height: 420 },
    hasTouch: true,
    isMobile: true
  });
  await serve(firstPaintContext);
  const firstPaintPage = await navigateHeistAtDomContentLoaded(
    firstPaintContext,
    'first-paint intro page'
  );
  const firstPaintScroll = await auditFirstPaintIntroScroll(firstPaintPage);
  result('pre-ready first-paint overlay blocks repeated real wheel input',
    firstPaintScroll.totalWheel >= 800 && firstPaintScroll.locked,
    `${firstPaintScroll.setup.readyState}; wheel ${firstPaintScroll.totalWheel}px at ${firstPaintScroll.setup.point.x.toFixed(0)},${firstPaintScroll.setup.point.y.toFixed(0)}; document ${firstPaintScroll.before.document}→${firstPaintScroll.samples.map(sample => sample.document).join('/')}`);
  const shortIntro = await auditShortIntroCardAndUnlock(firstPaintPage);
  result('short intro card scrolls and normal auto-dismiss unlocks the page',
    shortIntro.cardScrolled && shortIntro.autoDismissed.ready &&
      shortIntro.autoDismissed.hidden && shortIntro.pageUnlocked,
    `card ${shortIntro.card.scrollTop}→${shortIntro.cardAfter.scrollTop} of ${shortIntro.card.scrollHeight}/${shortIntro.card.clientHeight}; auto ready/hidden ${shortIntro.autoDismissed.ready}/${shortIntro.autoDismissed.hidden}; page ${shortIntro.card.page}→${shortIntro.pageAfter.document}`);
  const helpContainment = await auditHelpContainment(firstPaintPage);
  result('short Help dialog traps focus and separates backdrop/content scrolling',
    helpContainment.focusTrapped && helpContainment.backdropLocked &&
      helpContainment.contentScrolled && helpContainment.hRestored &&
      helpContainment.escapeRestored,
    `focus ${helpContainment.focusSamples.map(sample => sample.active).join('→')}; backdrop ${helpContainment.backdropLocked}; content ${helpContainment.contentScrolled}; H ${helpContainment.afterH.focus.id || helpContainment.afterH.focus.tag}; Escape ${helpContainment.afterEscape.focus.id || helpContainment.afterEscape.focus.tag}`);
  const shortSkip = await auditShortSkipTarget(firstPaintPage);
  result('short-screen skip target is 44px and reaches the board',
    shortSkip.before.focused && shortSkip.before.height >= 44 &&
      shortSkip.after.boardFocused,
    `${shortSkip.before.width.toFixed(1)}x${shortSkip.before.height.toFixed(1)} ${shortSkip.before.href}; hash ${shortSkip.after.hash}`);
  await firstPaintContext.close();

  const landscapeIntroContext = await browser.newContext({
    viewport: { width: 836, height: 224 },
    screen: { width: 836, height: 224 },
    hasTouch: true,
    isMobile: true
  });
  await serve(landscapeIntroContext);
  const landscapeIntroPage = await navigateHeist(
    landscapeIntroContext,
    '836x224 intro focus page'
  );
  const landscapeIntroFocus = await auditLandscapeIntroFocusReachability(
    landscapeIntroPage
  );
  const initialBegin = landscapeIntroFocus.challenge.beginRect;
  const focusedBegin = landscapeIntroFocus.focusSamples[0].rect;
  result('836x224 intro keeps focused Begin visible and Skip unreachable',
    landscapeIntroFocus.setup.viewport.width === 836 &&
      landscapeIntroFocus.setup.viewport.height === 224 &&
      landscapeIntroFocus.scrollabilityIfOutside &&
      (landscapeIntroFocus.challenge.beginFull ||
        landscapeIntroFocus.wheelMovedModal) &&
      landscapeIntroFocus.documentLocked &&
      landscapeIntroFocus.focusReachable &&
      landscapeIntroFocus.focusContained,
    `Begin ${JSON.stringify(initialBegin)}→${JSON.stringify(focusedBegin)}; modal scroll ${landscapeIntroFocus.challenge.modalScroll.map(item => item.scrollTop).join('/')}→${landscapeIntroFocus.focusSamples[0].modalScroll.map(item => item.scrollTop).join('/')}; keys ${landscapeIntroFocus.focusSamples.map(sample => `${sample.key}:${sample.active}:${sample.full}`).join('→')}; document locked=${landscapeIntroFocus.documentLocked}`);
  await landscapeIntroContext.close();

  const immediateSkipContext = await browser.newContext({
    viewport: { width: 836, height: 224 },
    screen: { width: 836, height: 224 },
    hasTouch: true,
    isMobile: true
  });
  await serve(immediateSkipContext);
  const immediateSkipPage = await openHeist(
    immediateSkipContext,
    '836x224 immediate skip page'
  );
  const immediateSkip = await auditImmediateLandscapeSkip(immediateSkipPage);
  result('836x224 skip reaches the focused visible board within one frame',
    immediateSkip.before.viewport.width === 836 &&
      immediateSkip.before.viewport.height === 224 &&
      immediateSkip.after.hash === '#game-board' &&
      immediateSkip.after.boardFocused &&
      immediateSkip.after.boardIntersects &&
      immediateSkip.after.documentWidth <= immediateSkip.after.viewport.width + 1 &&
      immediateSkip.after.bodyWidth <= immediateSkip.after.viewport.width + 1,
    `hash ${immediateSkip.after.hash}; focused ${immediateSkip.after.boardFocused}; rect ${JSON.stringify(immediateSkip.after.boardRect)}; width ${Math.max(immediateSkip.after.documentWidth, immediateSkip.after.bodyWidth)}/${immediateSkip.after.viewport.width}`);
  await immediateSkipContext.close();

  const primaryContext = await browser.newContext({
    viewport: { width: 1100, height: 800 },
    acceptDownloads: true
  });
  await serve(primaryContext);
  const page = await navigateHeist(primaryContext, 'primary cold boot');
  const introGate = await auditIntroGate(page);
  const introDismissal = await dismissIntro(page);
  await finishHeistBoot(page, 'primary cold boot');
  const readyAfterIntro = await page.evaluate(() => window.__doggHeist.ready === true);
  const activeLineFocus = await focusHandoffState(page);
  const postIntroScrollable = await page.evaluate(() =>
    document.documentElement.scrollHeight > innerHeight + 10);
  result('intro modal traps focus and gates the hidden runtime',
    introGate.before.ready === false && introGate.after.ready === false &&
      introGate.focusTrapped && introGate.activationBlocked && introGate.scrollBlocked &&
      (introGate.before.scrollable || postIntroScrollable) &&
      readyAfterIntro,
    `${introDismissal}; focus trapped ${introGate.focusTrapped}; tick held ${introGate.before.tick}; scroll ${introGate.before.scrollY}`);
  result('intro overlay blocks a real wheel from scrolling the document',
    introGate.scrollBlocked && introGate.wheelBefore.window === 0 &&
      introGate.wheelBefore.document === 0 && introGate.wheelAfter.modalVisible,
    `mouse at ${introGate.before.overlayPoint.x},${introGate.before.overlayPoint.y}; window ${introGate.wheelBefore.window}→${introGate.wheelAfter.window}, document ${introGate.wheelBefore.document}→${introGate.wheelAfter.document}`);

  await api(page, 'pause');
  requireMeasurement(activeLineFocus.id === 'play-toggle',
    `intro focus handoff to Play (received ${activeLineFocus.tag}#${activeLineFocus.id})`);
  const playFocusBefore = await inspect(page);
  const playFocusSamples = [];
  for (let press = 0; press < 3; press++) {
    await page.keyboard.press('.');
    await sleep(60);
    playFocusSamples.push(await page.evaluate(() => ({
      id: document.activeElement?.id || '',
      disabled: Boolean(document.activeElement &&
        (('disabled' in document.activeElement && document.activeElement.disabled) ||
          document.activeElement.getAttribute('aria-disabled') === 'true'))
    })));
  }
  const playFocusAfter = await inspect(page);
  await page.keyboard.press('h');
  const playHelpOpened = await poll(() => visibleHelp(page), value => value.count > 0, 2000);
  await page.keyboard.press('Escape');
  await poll(() => visibleHelp(page), value => value.count === 0, 2000);
  const focusAfterHelp = await page.evaluate(() => document.activeElement?.id || '');
  await api(page, 'setSpeed', 140);
  await api(page, 'pause');
  const nativeSpaceBefore = await inspect(page);
  await page.keyboard.press('Space');
  const nativeSpacePlayed = await waitForTick(page, nativeSpaceBefore.tick + 1, 4000);
  await page.keyboard.press('Space');
  const nativeSpaceHeld = await inspect(page);
  await sleep(450);
  const nativeSpaceHeldAfter = await inspect(page);
  await api(page, 'pause');
  result('Play focus preserves repeated and non-native global shortcuts',
    playFocusAfter.tick - playFocusBefore.tick === 3 &&
      playFocusAfter.frameCount - playFocusBefore.frameCount === 3 &&
      playFocusSamples.every(sample =>
        sample.id === 'play-toggle' && !sample.disabled) &&
      playHelpOpened.count > 0 && focusAfterHelp === 'play-toggle' &&
      nativeSpacePlayed.tick > nativeSpaceBefore.tick &&
      nativeSpaceHeldAfter.tick === nativeSpaceHeld.tick &&
      nativeSpaceHeldAfter.frameCount === nativeSpaceHeld.frameCount,
    `dots +${playFocusAfter.tick - playFocusBefore.tick}; focus ${playFocusSamples.map(sample => sample.id).join('→')}; H help ${playHelpOpened.count}; Space ${nativeSpaceBefore.tick}→${nativeSpacePlayed.tick} held ${nativeSpaceHeld.tick}`);

  const reach = await auditReachability(page);
  const coldContextDependent = new Set(['fork-button', 'step-button']);
  const unusable = reach.filter(item => !item.exists || !item.visible || !item.reachable ||
    (/-button$|play-toggle|speed-select|timeline/.test(item.id) && item.disabled &&
      !coldContextDependent.has(item.id)));
  const cold = await inspect(page);
  const coldValues = ['tick-value', 'branch-value', 'head-value', 'alarm-value', 'objective-value']
    .filter(id => !cold.dom[id]);
  result('cold boot is ready, measurable, and visibly reachable',
    unusable.length === 0 && coldValues.length === 0,
    unusable.length ? `unusable: ${unusable.map(item => item.id).join(', ')}` :
      coldValues.length ? `empty: ${coldValues.join(', ')}` :
        `${REQUIRED_IDS.length} controls; tick ${cold.tick}; ${cold.frameCount} frames`);

  await api(page, 'pause');
  await api(page, 'setSpeed', 180);
  await api(page, 'pause');
  const agentsBefore = await inspect(page);
  const identities = agentsBefore.agents.map(agent => agent.id);
  result('exactly four distinct agents are exposed',
    identities.length === 4 && agentsBefore.agents.every(agent => agent.identified) &&
      new Set(identities).size === 4,
    identities.join(', ') || 'no measurable agents');

  const wallStart = Date.now();
  await page.locator('#play-toggle').click();
  const played = await waitForTick(page, agentsBefore.tick + 2, 8000);
  await page.locator('#play-toggle').click();
  const visiblePauseBefore = await inspect(page);
  await sleep(550);
  const visiblePauseAfter = await inspect(page);
  await api(page, 'pause');
  const wallElapsed = Date.now() - wallStart;
  const beforeAgents = new Map(agentsBefore.agents.map(agent =>
    [agent.id, stable(materialProjection(agent.state))]));
  const changedAgents = played.agents.filter(agent =>
    beforeAgents.has(agent.id) &&
      beforeAgents.get(agent.id) !== stable(materialProjection(agent.state))).length;
  result('wall-clock play advances autonomously',
    played.tick - agentsBefore.tick >= 2 && changedAgents >= 1 &&
      visiblePauseAfter.tick === visiblePauseBefore.tick,
    `+${played.tick - agentsBefore.tick} ticks in ${wallElapsed}ms; ${changedAgents}/4 agent states changed; visible pause held ${visiblePauseBefore.tick}`);

  const heldBefore = await inspect(page);
  await sleep(750);
  const heldAfter = await inspect(page);
  result('pause holds the live line over real time',
    heldAfter.tick === heldBefore.tick && heldAfter.frameCount === heldBefore.frameCount &&
      heldAfter.head === heldBefore.head,
    `tick ${heldBefore.tick}→${heldAfter.tick}, frames ${heldBefore.frameCount}→${heldAfter.frameCount}`);

  const apiStepBefore = heldAfter;
  await api(page, 'step', 3);
  await sleep(150);
  const apiStepAfter = await inspect(page);
  result('step(count) advances exactly the requested count',
    apiStepAfter.tick - apiStepBefore.tick === 3 &&
      apiStepAfter.frameCount - apiStepBefore.frameCount === 3,
    `ticks +${apiStepAfter.tick - apiStepBefore.tick}; frames +${apiStepAfter.frameCount - apiStepBefore.frameCount}`);

  const buttonStepBefore = apiStepAfter;
  await page.locator('#step-button').click();
  await sleep(150);
  const buttonStepAfter = await inspect(page);
  result('the visible step button advances one logical tick',
    buttonStepAfter.tick - buttonStepBefore.tick === 1 &&
      buttonStepAfter.frameCount - buttonStepBefore.frameCount === 1,
    `ticks +${buttonStepAfter.tick - buttonStepBefore.tick}; frames +${buttonStepAfter.frameCount - buttonStepBefore.frameCount}`);

  await page.evaluate(() => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  });
  const keyStepBefore = await inspect(page);
  await page.keyboard.press('.');
  await sleep(150);
  const keyStepAfter = await inspect(page);
  result('the keyboard step path advances exactly one tick',
    keyStepAfter.tick - keyStepBefore.tick === 1 &&
      keyStepAfter.frameCount - keyStepBefore.frameCount === 1,
    `.: tick ${keyStepBefore.tick}→${keyStepAfter.tick}`);

  await api(page, 'pause');
  await page.locator('#game-board').focus();
  const repeatedStepBefore = await inspect(page);
  const repeatedFocus = [];
  for (let press = 0; press < 3; press++) {
    await page.keyboard.press('.');
    await sleep(60);
    repeatedFocus.push(await page.evaluate(() => {
      const element = document.activeElement;
      const interactive = Boolean(element && element.matches(
        'button, input, select, textarea, a[href], [contenteditable="true"], [role="button"]'
      ));
      const disabled = Boolean(element &&
        (('disabled' in element && element.disabled) ||
          element.getAttribute('aria-disabled') === 'true'));
      const editing = Boolean(element && element.matches(
        'input:not([type="range"]), select, textarea, [contenteditable="true"]'
      ));
      return {
        id: element?.id || '',
        tag: element?.tagName || '',
        blocking: disabled || editing ||
          (interactive && element?.id !== 'game-board')
      };
    }));
  }
  const repeatedStepAfter = await inspect(page);
  result('three repeated step shortcuts advance exactly three times without refocus',
    repeatedStepAfter.tick - repeatedStepBefore.tick === 3 &&
      repeatedStepAfter.frameCount - repeatedStepBefore.frameCount === 3 &&
      repeatedFocus.every(focus => !focus.blocking),
    `tick +${repeatedStepAfter.tick - repeatedStepBefore.tick}, frames +${repeatedStepAfter.frameCount - repeatedStepBefore.frameCount}; focus ${repeatedFocus.map(focus => `${focus.tag}#${focus.id || '-'}`).join(' → ')}`);

  await page.evaluate(() => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  });
  await api(page, 'setSpeed', 140);
  await api(page, 'pause');
  const keyPlayBefore = await inspect(page);
  await page.keyboard.press('Space');
  const keyPlayed = await waitForTick(page, keyPlayBefore.tick + 1, 6000);
  await page.keyboard.press('Space');
  const keyHeld = await inspect(page);
  await sleep(500);
  const keyHeldLater = await inspect(page);
  await api(page, 'pause');
  result('the keyboard play/pause path uses the wall clock and stops',
    keyPlayed.tick > keyPlayBefore.tick && keyHeldLater.tick === keyHeld.tick,
    `Space: ${keyPlayBefore.tick}→${keyPlayed.tick}, held at ${keyHeld.tick}`);

  const speed = await page.locator('#speed-select').evaluate(select => ({
    current: select.value,
    options: [...select.options].map(option => ({ value: option.value, text: option.textContent.trim() }))
  }));
  requireMeasurement(speed.options.length >= 2, 'at least two visible speed choices');
  const otherSpeed = speed.options.find(option => option.value !== speed.current);
  requireMeasurement(otherSpeed, 'a different visible speed choice');
  await page.locator('#speed-select').selectOption(otherSpeed.value);
  await api(page, 'pause');
  const throttledBefore = await inspect(page);
  const cdp = await primaryContext.newCDPSession(page);
  try {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.locator('#step-button').click();
    await sleep(250);
  } finally {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
  const throttledAfter = await inspect(page);
  await api(page, 'setSpeed', 137);
  await api(page, 'pause');
  const setSpeedBefore = await inspect(page);
  await api(page, 'step', 1);
  await sleep(150);
  const setSpeedAfter = await inspect(page);
  result('speed changes and render throttling cannot multiply one step',
    throttledAfter.tick - throttledBefore.tick === 1 &&
      throttledAfter.frameCount - throttledBefore.frameCount === 1 &&
      setSpeedAfter.tick - setSpeedBefore.tick === 1 &&
      setSpeedAfter.frameCount - setSpeedBefore.frameCount === 1,
    `${otherSpeed.text} at 4× CPU: +${throttledAfter.tick - throttledBefore.tick}; setSpeed(137): +${setSpeedAfter.tick - setSpeedBefore.tick}`);

  const customSpeedRuns = [];
  for (const requested of [10, 137]) {
    await api(page, 'pause');
    const returned = await api(page, 'setSpeed', requested);
    const surface = await readSpeedSurface(page);
    const pacing = await measureSpeedPacing(page, requested);
    customSpeedRuns.push({ requested, returned, surface, pacing });
  }
  const customBeforePreset = await readSpeedSurface(page);
  const preset = customBeforePreset.select.options
    .filter(option =>
      Number.isFinite(Number(option.value)) &&
      ![10, 137].includes(Number(option.value)) &&
      !/\bcustom\b/i.test(option.text))
    .sort((a, b) => Number(a.value) - Number(b.value))[0];
  requireMeasurement(preset, 'a visible preset speed after setSpeed(137)');
  await page.locator('#speed-select').selectOption(preset.value);
  const presetSurface = await poll(
    () => readSpeedSurface(page),
    value => value.select.value === preset.value &&
      value.exportSpeed === Number(preset.value),
    1500,
    20
  );
  const presetPacing = await measureSpeedPacing(page, Number(preset.value));
  const staleCustomOptions = presetSurface.select.options.filter(option =>
    /\bcustom\b/i.test(option.text) || [10, 137].includes(Number(option.value)));

  await api(page, 'pause');
  const arbitraryReturn = await api(page, 'setSpeed', 137);
  const arbitrarySource = await readSpeedSurface(page);
  const arbitraryExport = await api(page, 'exportState');
  const arbitraryExportText = typeof arbitraryExport === 'string' ?
    arbitraryExport : JSON.stringify(arbitraryExport);
  const speedImportContext = await browser.newContext({
    viewport: { width: 1000, height: 720 }
  });
  await serve(speedImportContext);
  const speedImportPage = await openHeist(speedImportContext, 'custom-speed import page');
  await api(speedImportPage, 'pause');
  const arbitraryImport = await api(speedImportPage, 'importState', arbitraryExportText);
  await api(speedImportPage, 'pause');
  const arbitraryImported = await readSpeedSurface(speedImportPage);
  const importedPacing = await measureSpeedPacing(speedImportPage, 137);
  await speedImportContext.close();

  const customSpeedTruth = customSpeedRuns.every(run =>
    mutationSucceeded(run.returned) &&
    run.surface.exportSpeed === run.requested &&
    (run.surface.stateSpeed == null || run.surface.stateSpeed === run.requested) &&
    run.surface.select.visible &&
    run.surface.select.value === String(run.requested) &&
    /\bcustom\b/i.test(run.surface.select.selectedText) &&
    new RegExp(`\\b${run.requested}\\s*ms\\b`, 'i')
      .test(run.surface.select.selectedText) &&
    pacingMatches(run.pacing, run.requested));
  const presetTruth =
    customBeforePreset.select.value === '137' &&
    /\bcustom\b/i.test(customBeforePreset.select.selectedText) &&
    /\b137\s*ms\b/i.test(customBeforePreset.select.selectedText) &&
    presetSurface.select.visible &&
    presetSurface.select.value === preset.value &&
    presetSurface.select.selectedText === preset.text &&
    presetSurface.exportSpeed === Number(preset.value) &&
    (presetSurface.stateSpeed == null ||
      presetSurface.stateSpeed === Number(preset.value)) &&
    staleCustomOptions.every(option => !option.selected) &&
    pacingMatches(presetPacing, Number(preset.value));
  const importedSpeedTruth =
    mutationSucceeded(arbitraryReturn) &&
    arbitrarySource.exportSpeed === 137 &&
    mutationSucceeded(arbitraryImport) &&
    arbitraryImported.exportSpeed === 137 &&
    (arbitraryImported.stateSpeed == null || arbitraryImported.stateSpeed === 137) &&
    arbitraryImported.select.visible &&
    arbitraryImported.select.value === '137' &&
    /\bcustom\b/i.test(arbitraryImported.select.selectedText) &&
    /\b137\s*ms\b/i.test(arbitraryImported.select.selectedText) &&
    pacingMatches(importedPacing, 137);
  result('setSpeed keeps custom UI, preset, export, and pacing truthful',
    customSpeedTruth && presetTruth && importedSpeedTruth,
    `${customSpeedRuns.map(run => `${run.requested}ms ret=${mutationSucceeded(run.returned)} state=${run.surface.exportSpeed} select="${run.surface.select.value}/${run.surface.select.selectedText}" pace=${Number(run.pacing.median).toFixed(1)}`).join(' | ')}; preset ${preset.value} "${presetSurface.select.selectedText}" pace=${Number(presetPacing.median).toFixed(1)} stale=${staleCustomOptions.map(option => `${option.value}:${option.selected}`).join(',') || 'removed'}; import ${arbitraryImported.exportSpeed} "${arbitraryImported.select.value}/${arbitraryImported.select.selectedText}" pace=${Number(importedPacing.median).toFixed(1)}`);

  const fogPrivacy = await auditSemanticFogPrivacy(page);
  const fogPrivacyChecks = {
    hiddenUnknown: fogPrivacy.hiddenUnknown,
    emptyUnknown: fogPrivacy.emptyUnknown,
    hiddenNoDisclosure: fogPrivacy.hiddenNoDisclosure,
    emptyNoDisclosure: fogPrivacy.emptyNoDisclosure,
    equivalentFogSemantics: fogPrivacy.equivalentFogSemantics,
    equivalentFogPixels: fogPrivacy.equivalentFogPixels,
    visibleControlExposed: fogPrivacy.visibleControlExposed,
    rememberedPrivate: fogPrivacy.rememberedPrivate,
    rememberedBecameVisible: fogPrivacy.rememberedBecameVisible
  };
  result('SEMANTIC-LEAK-01 keeps unseen and remembered tactics private',
    Object.values(fogPrivacyChecks).every(Boolean),
    `${Object.entries(fogPrivacyChecks).map(([name, passed]) => `${name}=${passed}`).join(', ')}; hidden pixels ${fogPrivacy.hiddenPixels.hash}/${fogPrivacy.emptyPixels.hash}; visible ${fogPrivacy.visibleThreat.id}@${fogPrivacy.visibleThreat.cell.x},${fogPrivacy.visibleThreat.cell.y} Δ${(fogPrivacy.visibleVsFog.changedRatio * 100).toFixed(1)}%; remembered ${fogPrivacy.rememberedInterval.cell}@${fogPrivacy.rememberedInterval.start}-${fogPrivacy.rememberedInterval.end} ${fogPrivacy.rememberedSamples.map(sample => `${sample.tick}:${sample.known}/${sample.visible}/${sample.warningRatio.toFixed(3)}`).join(',')}→visible@${fogPrivacy.rememberedVisibleTick}`);

  const sameA = await deterministicRun(page, 'dogg-heist-repeatable-42');
  const sameB = await deterministicRun(page, 'dogg-heist-repeatable-42');
  result('queueDirective is observable rather than a decorative API',
    sameA.queueObserved && sameB.queueObserved,
    'a fixed agent destination changed returned/UI state before stepping');
  requireMeasurement(sameA.head && sameB.head, 'deterministic head hashes');
  requireMeasurement(/^(?:sha256:)?[0-9a-f]{64}$/i.test(sameA.head), 'a SHA-256-sized head hash');
  result('same seed plus the same directives is byte-deterministic',
    stable(canonicalProjection(sameA.state)) === stable(canonicalProjection(sameB.state)) &&
      sameA.head === sameB.head && sameA.frameCount === sameB.frameCount,
    `head ${sameA.head.slice(0, 12)}…; ${sameA.frameCount} frames`);

  const different = await deterministicRun(page, 'dogg-heist-different-99');
  const materialA = stable(materialProjection(sameA.state));
  const materialDifferent = stable(materialProjection(different.state));
  requireMeasurement(materialA.length > 20 && materialDifferent.length > 20,
    'material facility/state independent of seed and hash metadata');
  result('a different seed materially changes the facility/state',
    different.head !== sameA.head && materialDifferent !== materialA,
    `head ${sameA.head.slice(0, 10)}…→${different.head.slice(0, 10)}…; material ${materialA.length}/${materialDifferent.length} bytes`);

  const pov = await inspectPovs(page);
  const povRows = Array.from({ length: 4 }, (_, index) => {
    const panel = pov.panels[index] || {};
    const view = pov.views[index] || {};
    const known = panel.known || view.known || 0;
    const total = panel.total || view.total || pov.universe;
    const partial = (panel.known > 0 && panel.unknown > 0) ||
      (view.known > 0 && ((view.total > view.known) || (pov.universe > view.known)));
    const signature = (view.known > 0 || view.total > 0) ? view.signature : panel.signature;
    return { known, total, partial, signature, observable: panel.hasObservableSurface || view.known > 0 || view.total > 0 };
  });
  const povSignatures = povRows.map(row => row.signature);
  const eachDiffers = povSignatures.every((signature, index) =>
    signature && povSignatures.some((other, otherIndex) => otherIndex !== index && other !== signature));
  result('all four POVs are observable, partial, and not one omniscient copy',
    pov.panels.length === 4 && povRows.every(row => row.observable && row.partial) && eachDiffers,
    `universe ${pov.universe}; ${povRows.map(row => `${row.known}/${row.total}`).join(', ')}; ${new Set(povSignatures).size} signatures`);

  await api(page, 'pause');
  const boardStateBefore = await inspect(page, false);
  await page.locator('#game-board').focus();
  const boardSemanticBefore = await readBoardSemantic(page);
  await page.keyboard.press('ArrowRight');
  await sleep(100);
  const boardSemanticAfter = await readBoardSemantic(page);
  const boardStateAfter = await inspect(page, false);
  const coordinateContext = /(?:\b(cell|tile|row|column|coordinate|x|y)\b[^\d-]{0,20}-?\d+|\(?-?\d+\s*[,/:]\s*-?\d+\)?)/i;
  const tileContext = /\b(threat|danger|safe|guard|camera|laser|terminal|core|wall|floor|objective|agent|loot|alarm)\b/i;
  result('board cursor exposes changing coordinate and tile semantics',
    boardSemanticBefore.text && boardSemanticAfter.text &&
      boardSemanticAfter.text !== boardSemanticBefore.text &&
      coordinateContext.test(boardSemanticAfter.text) && tileContext.test(boardSemanticAfter.text) &&
      boardStateAfter.tick === boardStateBefore.tick && boardStateAfter.head === boardStateBefore.head,
    `${boardSemanticBefore.text.slice(0, 70)} → ${boardSemanticAfter.text.slice(0, 100)}`);

  await page.locator('#game-board').focus();
  const describedInitial = await readBoardAccessibilitySnapshot(page);
  requireMeasurement(describedInitial.selectedName,
    'the selected agent named in the board accessibility state');
  await page.keyboard.press('.');
  await sleep(100);
  const describedAfterStep = await readBoardAccessibilitySnapshot(page);
  const otherAgent = await page.evaluate(() => {
    const list = document.getElementById('agent-list');
    const selected = list?.querySelector(
      '[aria-pressed="true"], .agent-button.selected'
    );
    const candidate = [...(list?.querySelectorAll(
      '.agent-button, button, [role="button"]'
    ) || [])].find(element => element !== selected && !element.disabled &&
      element.getAttribute('aria-disabled') !== 'true');
    if (!candidate) return false;
    candidate.setAttribute('data-dogg-test-other-agent', 'true');
    return true;
  });
  requireMeasurement(otherAgent, 'another selectable agent for board description');
  await page.locator('[data-dogg-test-other-agent="true"]').click();
  await page.locator('#game-board').focus();
  const describedAfterAgent = await readBoardAccessibilitySnapshot(page);
  const describedLive = await inspect(page);
  const describedLiveIndex = Number(describedLive.state?.currentFrame?.index);
  requireMeasurement(Number.isFinite(describedLiveIndex),
    'state().currentFrame.index at the live board frame');
  const describedFrames = exportedFrames(describedLive.exported).frames;
  const describedPriorFrame = describedFrames.map((frame, index) => {
    const state = frameState(frame);
    const exportedIndex = Number(frame.index ?? frame.frameIndex ?? index);
    return {
      index: Number.isFinite(exportedIndex) ? exportedIndex : index,
      tick: state ? tickOf(state) : undefined
    };
  }).filter(frame =>
    frame.index < describedLiveIndex &&
    Number.isFinite(frame.tick) &&
    frame.tick !== describedAfterAgent.tick).reverse()[0];
  requireMeasurement(describedPriorFrame,
    'a prior exported frame index with a tick distinct from the live tick');
  await api(page, 'scrub', describedPriorFrame.index);
  await page.locator('#game-board').focus();
  const describedAfterScrub = await readBoardAccessibilitySnapshot(page);
  const staleTick = (description, tick) =>
    new RegExp(`\\b(?:tick|turn)\\s*#?\\s*${tick}\\b`, 'i').test(description);
  const staleName = new RegExp(
    describedInitial.selectedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    'i'
  );
  result('board accessible description follows tick, agent, and scrub renders',
    describedInitial.focusOnBoard &&
      describedInitial.currentFrameTick === describedInitial.tick &&
      boardAccessibilityConsistent(describedInitial) &&
      describedAfterStep.focusOnBoard &&
      describedAfterStep.currentFrameTick === describedAfterStep.tick &&
      boardAccessibilityConsistent(describedAfterStep) &&
      describedAfterStep.tick - describedInitial.tick === 1 &&
      !staleTick(describedAfterStep.description, describedInitial.tick) &&
      describedAfterAgent.focusOnBoard &&
      describedAfterAgent.currentFrameTick === describedAfterAgent.tick &&
      boardAccessibilityConsistent(describedAfterAgent) &&
      describedAfterAgent.selectedName !== describedInitial.selectedName &&
      !staleName.test(describedAfterAgent.description) &&
      describedAfterScrub.focusOnBoard &&
      describedAfterScrub.currentFrameTick === describedAfterScrub.tick &&
      boardAccessibilityConsistent(describedAfterScrub) &&
      describedAfterScrub.currentFrameIndex === describedPriorFrame.index &&
      describedAfterScrub.tick === describedPriorFrame.tick &&
      describedAfterScrub.liveTick === describedAfterAgent.liveTick &&
      describedAfterScrub.liveTick !== describedAfterScrub.tick &&
      describedAfterScrub.selectedName === describedAfterAgent.selectedName &&
      !staleTick(describedAfterScrub.description, describedAfterAgent.tick) &&
      !staleName.test(describedAfterScrub.description),
    `tick ${describedInitial.tick}→${describedAfterStep.tick}; agent ${describedInitial.selectedName}→${describedAfterAgent.selectedName}; scrub frame ${describedLiveIndex}→${describedPriorFrame.index}, displayed ${describedAfterAgent.tick}→${describedAfterScrub.tick}, live ${describedAfterAgent.liveTick}→${describedAfterScrub.liveTick}`);
  await api(page, 'scrub', describedLiveIndex);
  const describedRestored = await inspect(page, false);
  const describedRestoredTick = Number(
    describedRestored.state?.tick ?? describedRestored.state?.currentFrame?.tick
  );
  requireMeasurement(
    Number(describedRestored.state?.currentFrame?.index) === describedLiveIndex &&
      describedRestoredTick === describedAfterAgent.tick,
    'returning to the actual live frame index after the ARIA scrub check'
  );
  await api(page, 'pause');

  const povSemanticLabels = await readPovSemanticLabels(page);
  const agentNames = different.agents.flatMap(agent => [
    agent.id, agent.state.name, agent.state.callsign
  ]).filter(Boolean).map(String);
  const identityPattern = agentNames.length ?
    new RegExp(agentNames.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'ig') :
    null;
  const normalizedPovLabels = povSemanticLabels.map(label =>
    (identityPattern ? label.replace(identityPattern, '') : label).replace(/\s+/g, ' ').trim());
  const semanticPartial = label => /\d/.test(label) &&
    /\b(visible|known|partial|fog|unseen|hidden)\b/i.test(label) &&
    /\b(threat|danger|guard|camera|laser|terminal|objective|core|alarm|safe)\b/i.test(label);
  const semanticPovsDiffer = normalizedPovLabels.every((label, index) =>
    label && normalizedPovLabels.some((other, otherIndex) => otherIndex !== index && other !== label));
  result('each POV label quantifies a distinct partial tactical view',
    povSemanticLabels.length === 4 && povSemanticLabels.every(semanticPartial) && semanticPovsDiffer,
    povSemanticLabels.map(label => label.slice(0, 70)).join(' | '));

  await api(page, 'restart', 'ADVERSARY-000');
  await api(page, 'pause');
  await api(page, 'setSpeed', 20);
  await api(page, 'pause');
  let dangerSnapshot = await inspect(page, false);
  while (dangerSnapshot.tick < 16) {
    await api(page, 'step', 1);
    dangerSnapshot = await inspect(page, false);
  }
  requireMeasurement(dangerSnapshot.tick === 16, 'ADVERSARY-000 tick 16 baseline');
  dangerSnapshot = await inspect(page);
  const dangerTarget = { x: 7, y: 7 };
  const dangerDimensions = facilityDimensions(dangerSnapshot);
  requireMeasurement(dangerDimensions, 'ADVERSARY-000 public facility dimensions');
  const cipherAt16 = agentNamed(dangerSnapshot, 'Cipher');
  const cipherPosition16 = cipherAt16 && coordinateOf(cipherAt16.state);
  requireMeasurement(cipherPosition16, 'Cipher position at tick 16');
  await moveBoardCursorTo(page, dangerTarget, dangerDimensions);
  const targetPixels16 = await sampleCanvasCell(page, dangerSnapshot, dangerTarget);

  await api(page, 'step', 1);
  const dangerAt17 = await inspect(page);
  requireMeasurement(dangerAt17.tick === 17, 'ADVERSARY-000 tick 17 danger preview');
  const cursorAtTarget = await moveBoardCursorTo(page, dangerTarget, dangerDimensions);
  const targetPixels17 = await sampleCanvasCell(page, dangerAt17, dangerTarget);
  const targetPixelDelta = canvasSampleDelta(targetPixels16, targetPixels17);
  const targetSemanticWarning =
    /\b(danger|threat|warning|warned|unsafe|risk|guard|camera|laser|alarm|marked|red|amber)\b/i
      .test(cursorAtTarget.semantic.text);
  const eventLog17 = dangerAt17.dom['event-log'];

  await api(page, 'step', 1);
  const dangerAt18 = await inspect(page);
  const cipherAt18 = agentNamed(dangerAt18, 'Cipher');
  const cipherPosition18 = cipherAt18 && coordinateOf(cipherAt18.state);
  requireMeasurement(cipherPosition18, 'Cipher position at tick 18');
  const eventLog18 = dangerAt18.dom['event-log'];
  const eventDelta = eventLog18.startsWith(eventLog17) ?
    eventLog18.slice(eventLog17.length) :
    eventLog18.includes(eventLog17) ? eventLog18.replace(eventLog17, '') : eventLog18;
  const dangerChecks = {
    tick18: dangerAt18.tick === 18,
    movedToTarget:
      (cipherPosition16.x !== dangerTarget.x || cipherPosition16.y !== dangerTarget.y) &&
      cipherPosition18.x === dangerTarget.x && cipherPosition18.y === dangerTarget.y,
    cursorOnTarget: cursorAtTarget.coordinate.x === dangerTarget.x &&
      cursorAtTarget.coordinate.y === dangerTarget.y,
    semanticWarning: targetSemanticWarning,
    targetPixelsChanged: targetPixelDelta.changedRatio >= 0.02 &&
      targetPixelDelta.meanDistance >= 4,
    newEventMarkedCipher: /\bmarked\s+cipher\b|\bcipher\b.{0,30}\bmarked\b/i.test(eventDelta)
  };
  const dangerTransition = Object.values(dangerChecks).every(Boolean);
  dangerSnapshot = dangerAt18;
  result('ADVERSARY-000 warns Cipher target before the marked transition',
    dangerTransition,
    `${Object.entries(dangerChecks).map(([name, passed]) => `${name}=${passed}`).join(', ')}; target 7,7 pixels ${targetPixels16.hash}→${targetPixels17.hash}, changed ${(targetPixelDelta.changedRatio * 100).toFixed(1)}%; event ${eventDelta.replace(/\s+/g, ' ').slice(-90)}`);

  const validVerification = await tryApi(page, 'verifyChain');
  result('the honest hash chain verifies',
    verificationPassed(validVerification),
    verificationPassed(validVerification) ? `${dangerSnapshot.tick} ticks` :
      (validVerification.error || JSON.stringify(validVerification.value)));

  const beforeRestartButton = await inspect(page);
  await page.locator('#restart-button').click();
  await api(page, 'pause');
  await sleep(150);
  const afterRestartButton = await inspect(page);
  result('the visible restart button starts a fresh line',
    afterRestartButton.tick < beforeRestartButton.tick &&
      afterRestartButton.frameCount < beforeRestartButton.frameCount &&
      afterRestartButton.head !== beforeRestartButton.head,
    `tick ${beforeRestartButton.tick}→${afterRestartButton.tick}; frames ${beforeRestartButton.frameCount}→${afterRestartButton.frameCount}`);

  await api(page, 'restart', 'dogg-heist-history-7');
  await api(page, 'pause');
  await api(page, 'step', 8);
  const liveBeforeScrub = await inspect(page);
  requireMeasurement(liveBeforeScrub.frameCount >= 6, 'enough history to scrub and fork');
  const timelineBeforeKey = await page.locator('#timeline').evaluate(input => Number(input.value));
  await page.locator('#timeline').focus();
  await page.keyboard.press('ArrowLeft');
  const timelineAfterKey = await poll(
    () => page.locator('#timeline').evaluate(input => Number(input.value)),
    value => Number.isFinite(value) && value < timelineBeforeKey,
    2500
  );
  const afterTimelineKey = await inspect(page);
  result('the timeline has a working keyboard history path',
    timelineAfterKey < timelineBeforeKey &&
      afterTimelineKey.head === liveBeforeScrub.head &&
      afterTimelineKey.frameCount === liveBeforeScrub.frameCount,
    `timeline ${timelineBeforeKey}→${timelineAfterKey}; live head held`);

  const targetTick = Math.max(1, liveBeforeScrub.tick - 4);
  await api(page, 'scrub', targetTick);
  await sleep(100);
  const scrubbed = await inspect(page);
  const selectedTick = [scrubbed.viewTick, scrubbed.timeline && scrubbed.timeline.value, scrubbed.tick]
    .find(value => value === targetTick);
  result('scrub changes only the historical view, not the live line',
    selectedTick === targetTick &&
      scrubbed.head === liveBeforeScrub.head &&
      scrubbed.frameCount === liveBeforeScrub.frameCount,
    `selected ${targetTick}; head ${scrubbed.head.slice(0, 10)}…; ${scrubbed.frameCount} frames`);

  const oldBranch = scrubbed.branch;
  const forkUsable = await page.locator('#fork-button').isEnabled();
  await page.locator('#fork-button').click();
  await api(page, 'pause');
  await sleep(150);
  const forked = await inspect(page);
  result('visible fork creates a branch and truncates the old future',
    forkUsable && oldBranch && forked.branch && forked.branch !== oldBranch &&
      forked.frameCount < liveBeforeScrub.frameCount &&
      forked.tick <= targetTick + 1,
    `enabled after scrub: ${forkUsable}; branch ${oldBranch}→${forked.branch}; tick ${forked.tick}; frames ${liveBeforeScrub.frameCount}→${forked.frameCount}`);

  const continuedBefore = forked;
  await page.locator('#step-button').click();
  await sleep(150);
  const continued = await inspect(page);
  result('the fork continues from the selected historical tick',
    continued.branch === forked.branch &&
      continued.tick - continuedBefore.tick === 1 &&
      continued.frameCount - continuedBefore.frameCount === 1,
    `branch ${continued.branch}; tick ${continuedBefore.tick}→${continued.tick}`);

  await api(page, 'step', 2);
  const apiForkFuture = await inspect(page);
  const apiForkTarget = Math.max(1, apiForkFuture.tick - 1);
  await api(page, 'scrub', apiForkTarget);
  const apiForkOldBranch = (await inspect(page)).branch;
  await api(page, 'fork');
  await api(page, 'pause');
  const apiForked = await inspect(page);
  result('the public fork() method is real',
    apiForked.branch !== apiForkOldBranch &&
      apiForked.frameCount < apiForkFuture.frameCount,
    `branch ${apiForkOldBranch}→${apiForked.branch}; frames ${apiForkFuture.frameCount}→${apiForked.frameCount}`);

  const forkDirectiveAgent = apiForked.agents[0];
  const forkDirectiveFrom = forkDirectiveAgent && coordinateOf(forkDirectiveAgent.state);
  const forkRawState = frameState(latestExportFrame(apiForked.exported));
  const forkTraversable = forkRawState && traversableCells(forkRawState);
  const forkOccupied = new Set(apiForked.agents.map(agent => coordinateOf(agent.state))
    .filter(Boolean).map(position => `${position.x},${position.y}`));
  const forkDirectiveAt = forkTraversable && forkDirectiveFrom &&
    forkTraversable.cells.filter(cell =>
      !forkOccupied.has(`${cell.x},${cell.y}`) &&
      (cell.x !== forkDirectiveFrom.x || cell.y !== forkDirectiveFrom.y))
      .sort((a, b) =>
        (Math.abs(a.x - forkDirectiveFrom.x) + Math.abs(a.y - forkDirectiveFrom.y)) -
        (Math.abs(b.x - forkDirectiveFrom.x) + Math.abs(b.y - forkDirectiveFrom.y)))[0];
  requireMeasurement(forkDirectiveAgent && forkDirectiveFrom && forkDirectiveAt,
    'an agent position for a valid post-fork directive');
  const forkDirectiveResult = await api(
    page,
    'queueDirective',
    forkDirectiveAgent.id,
    forkDirectiveAt.x,
    forkDirectiveAt.y
  );
  await api(page, 'step', 1);
  await api(page, 'pause');
  const roundTripSource = await inspect(page);
  const apiExport = await api(page, 'exportState');
  const apiExportText = typeof apiExport === 'string' ? apiExport : JSON.stringify(apiExport);
  requireMeasurement(apiExportText && typeof JSON.parse(apiExportText) === 'object',
    'exportState() JSON');

  const downloadPromise = page.waitForEvent('download', { timeout: 4000 });
  await page.locator('#export-button').click();
  const download = await downloadPromise;
  const downloadedText = await readDownload(download);
  const downloadedObject = JSON.parse(downloadedText);
  result('the visible export button emits nonempty JSON',
    downloadedText.length > 100 && downloadedObject && typeof downloadedObject === 'object',
    `${download.suggestedFilename()}; ${downloadedText.length} bytes`);

  const roundTripContext = await browser.newContext({ viewport: { width: 1000, height: 720 } });
  await serve(roundTripContext);
  const roundTripPage = await openHeist(roundTripContext, 'fresh import page');
  await api(roundTripPage, 'pause');
  await api(roundTripPage, 'importState', downloadedText);
  await api(roundTripPage, 'pause');
  const roundTripped = await inspect(roundTripPage);
  result('export/import round-trips exactly in a fresh context',
    stable(roundTripped.state) === stable(roundTripSource.state) &&
      roundTripped.head === roundTripSource.head &&
      roundTripped.branch === roundTripSource.branch &&
      roundTripped.frameCount === roundTripSource.frameCount &&
      roundTripped.tick === roundTripSource.tick,
    `tick ${roundTripped.tick}; ${roundTripped.frameCount} frames; head ${roundTripped.head.slice(0, 12)}…`);
  const forkDirectiveAccepted = forkDirectiveResult !== false &&
    !(forkDirectiveResult && typeof forkDirectiveResult === 'object' &&
      (forkDirectiveResult.ok === false || forkDirectiveResult.accepted === false));
  result('a valid directive-bearing fork export still imports',
    forkDirectiveAccepted &&
      roundTripped.exportText === roundTripSource.exportText &&
      roundTripped.branch === apiForked.branch &&
      roundTripped.head === roundTripSource.head,
    `${forkDirectiveAgent.id} ${forkDirectiveFrom.x},${forkDirectiveFrom.y}→${forkDirectiveAt.x},${forkDirectiveAt.y}; branch ${roundTripped.branch}; ${roundTripped.frameCount} frames`);

  const roundTripVerification = await tryApi(roundTripPage, 'verifyChain');
  result('the imported fresh-context chain still verifies',
    verificationPassed(roundTripVerification),
    verificationPassed(roundTripVerification) ? 'verified' :
      (roundTripVerification.error || JSON.stringify(roundTripVerification.value)));

  const semanticBaseline = await inspect(roundTripPage);
  const teleportMutation = fullyRehashedSemanticMutation(
    semanticBaseline.exportText,
    'teleport'
  );
  const teleportAttempt = await rejectedTransactionalImport(
    roundTripPage,
    teleportMutation.json,
    semanticBaseline
  );
  const fixtureMutation = fullyRehashedSemanticMutation(
    semanticBaseline.exportText,
    'fixture'
  );
  const fixtureAttempt = await rejectedTransactionalImport(
    roundTripPage,
    fixtureMutation.json,
    semanticBaseline
  );
  const semanticRecoveryBefore = await inspect(roundTripPage);
  await api(roundTripPage, 'step', 1);
  const semanticRecoveryAfter = await inspect(roundTripPage);
  result('fully rehashed impossible transitions reject transactionally',
    teleportAttempt.rejected && teleportAttempt.unchanged && teleportAttempt.stateCallable &&
      fixtureAttempt.rejected && fixtureAttempt.unchanged && fixtureAttempt.stateCallable &&
      semanticRecoveryAfter.tick - semanticRecoveryBefore.tick === 1 &&
      semanticRecoveryAfter.frameCount - semanticRecoveryBefore.frameCount === 1,
    `frame ${teleportMutation.frameIndex} ${teleportMutation.detail}; ${fixtureMutation.detail}; ${teleportMutation.frameHashKey}/${teleportMutation.parentKey}; recovery +${semanticRecoveryAfter.tick - semanticRecoveryBefore.tick}`);

  const corruption = mutateExportedHash(downloadedText);
  const beforeCorruption = await inspect(roundTripPage);
  const corruptImport = await tryApi(roundTripPage, 'importState', corruption.json);
  await api(roundTripPage, 'pause');
  const afterCorruption = await inspect(roundTripPage);
  const corruptVerification = await tryApi(roundTripPage, 'verifyChain');
  const visiblyRejected = /reject|invalid|corrupt|hash|chain|verify|tamper|fail|error/i.test(
    `${afterCorruption.dom['status-live']} ${afterCorruption.dom['event-log']}`);
  const unchangedAfterReject = afterCorruption.head === beforeCorruption.head &&
    afterCorruption.frameCount === beforeCorruption.frameCount;
  result('a deliberately corrupted exported hash cannot become a valid line',
    explicitImportRejection(corruptImport) ||
      (unchangedAfterReject && visiblyRejected) ||
      verificationFailed(corruptVerification),
    `${corruption.path}: ${corruptImport.threw ? 'import threw' :
      explicitImportRejection(corruptImport) ? 'import rejected' :
        unchangedAfterReject && visiblyRejected ? 'visible rejection, state held' :
          verificationFailed(corruptVerification) ? 'verifyChain failed' : 'corruption was accepted'}`);
  await roundTripContext.close();

  const beforeMalformed = await inspect(page);
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 4000 });
  await page.locator('#import-button').click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'malformed-dogg-heist.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{ this is not valid JSON ')
  });
  const malformedSurface = await poll(async () => {
    const snapshot = await inspect(page);
    return {
      snapshot,
      text: `${snapshot.dom['status-live']} ${snapshot.dom['event-log']}`
    };
  }, value => /reject|invalid|malformed|parse|import|fail|error/i.test(value.text) &&
    value.text !== `${beforeMalformed.dom['status-live']} ${beforeMalformed.dom['event-log']}`, 3000);
  const afterMalformed = malformedSurface.snapshot;
  result('malformed visible import is rejected without destroying the game',
    afterMalformed.head === beforeMalformed.head &&
      afterMalformed.frameCount === beforeMalformed.frameCount &&
      afterMalformed.tick === beforeMalformed.tick &&
      stable(materialProjection(afterMalformed.state)) === stable(materialProjection(beforeMalformed.state)),
    malformedSurface.text.replace(/\s+/g, ' ').slice(-180));

  await api(page, 'pause');
  const deepBefore = await inspect(page);
  const deepBeforeExportValue = await api(page, 'exportState');
  const deepBeforeExport = typeof deepBeforeExportValue === 'string' ?
    deepBeforeExportValue : JSON.stringify(deepBeforeExportValue);
  const semanticMutation = invalidRoleImport(deepBeforeExport);
  const deepStatusBefore = deepBefore.dom['status-live'];
  const deepLogBefore = deepBefore.dom['event-log'];
  const semanticImport = await tryApi(page, 'importState', semanticMutation.json);
  let semanticSurface;
  try {
    semanticSurface = await poll(async () => {
      const snapshot = await inspect(page);
      const statusDelta = snapshot.dom['status-live'] !== deepStatusBefore ?
        snapshot.dom['status-live'] : '';
      const log = snapshot.dom['event-log'];
      const logDelta = log.startsWith(deepLogBefore) ? log.slice(deepLogBefore.length) :
        log !== deepLogBefore ? log : '';
      return {
        snapshot,
        text: `${statusDelta} ${logDelta}`.trim()
      };
    }, value => /\b(role|agent|semantic|invalid|unsupported|reject|import)\b/i.test(value.text), 2500);
  } catch (error) {
    const snapshot = await inspect(page);
    const statusDelta = snapshot.dom['status-live'] !== deepStatusBefore ?
      snapshot.dom['status-live'] : '';
    const log = snapshot.dom['event-log'];
    const logDelta = log.startsWith(deepLogBefore) ? log.slice(deepLogBefore.length) :
      log !== deepLogBefore ? log : '';
    semanticSurface = {
      snapshot,
      text: `${statusDelta} ${logDelta}`.trim()
    };
  }
  const deepAfter = semanticSurface.snapshot;
  const deepAfterExportValue = await api(page, 'exportState');
  const deepAfterExport = typeof deepAfterExportValue === 'string' ?
    deepAfterExportValue : JSON.stringify(deepAfterExportValue);
  const stateStillWorks = await tryApi(page, 'state');
  const deepStepBefore = await inspect(page);
  await api(page, 'step', 1);
  await sleep(100);
  const deepStepAfter = await inspect(page);
  const semanticVisible =
    /\b(role|agent|semantic|invalid|unsupported|reject|import)\b/i.test(semanticSurface.text);
  result('checksum-valid invalid role import is deeply transactional',
    semanticVisible &&
      (explicitImportRejection(semanticImport) ||
        (deepAfter.head === deepBefore.head && deepAfter.frameCount === deepBefore.frameCount)) &&
      deepAfterExport === deepBeforeExport &&
      deepAfter.head === deepBefore.head &&
      deepAfter.frameCount === deepBefore.frameCount &&
      deepAfter.tick === deepBefore.tick &&
      !stateStillWorks.threw && stateStillWorks.value && typeof stateStillWorks.value === 'object' &&
      deepStepAfter.tick - deepStepBefore.tick === 1 &&
      deepStepAfter.frameCount - deepStepBefore.frameCount === 1,
    `${semanticMutation.rolePath}; checksum ${semanticMutation.checksumPath} (${semanticMutation.checksumScope}); ${semanticSurface.text.replace(/\s+/g, ' ').slice(-130)}`);

  await api(page, 'pause');
  const oversizeBefore = await inspect(page);
  const oversizeBeforeExportValue = await api(page, 'exportState');
  const oversizeBeforeExport = typeof oversizeBeforeExportValue === 'string' ?
    oversizeBeforeExportValue : JSON.stringify(oversizeBeforeExportValue);
  const tooLarge = oversizedImport(oversizeBeforeExport);
  await page.evaluate(() => {
    const status = document.getElementById('status-live');
    const log = document.getElementById('event-log');
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    const text = () => {
      const alerts = [...document.querySelectorAll(
        '[role="alert"], [aria-live="assertive"], [class*="error" i], [class*="toast" i]'
      )].filter(visible).map(element => element.textContent || '').join(' ');
      return `${status?.textContent || ''} ${log?.textContent || ''} ${alerts}`.replace(/\s+/g, ' ');
    };
    window.__doggOversizeProbe = {
      base: text(),
      changeAt: null,
      errorAt: null,
      text: ''
    };
    document.addEventListener('change', event => {
      if (event.target instanceof HTMLInputElement && event.target.type === 'file') {
        window.__doggOversizeProbe.changeAt = performance.now();
      }
    }, true);
    const observer = new MutationObserver(() => {
      const current = text();
      if (current !== window.__doggOversizeProbe.base &&
          /\b(too large|oversize|size limit|8\s*(?:mi?b|megabyte)|maximum import|exceeds)\b/i.test(current)) {
        window.__doggOversizeProbe.errorAt ??= performance.now();
        window.__doggOversizeProbe.text = current;
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  const oversizedChooserPromise = page.waitForEvent('filechooser', { timeout: 4000 });
  await page.locator('#import-button').click();
  const oversizedChooser = await oversizedChooserPromise;
  await oversizedChooser.setFiles({
    name: 'oversized-dogg-heist.json',
    mimeType: 'application/json',
    buffer: Buffer.from(tooLarge.json)
  });
  let oversizeTiming;
  try {
    oversizeTiming = await poll(
      () => page.evaluate(() => window.__doggOversizeProbe),
      probe => Number.isFinite(probe?.changeAt) && Number.isFinite(probe?.errorAt),
      1100,
      20
    );
  } catch (error) {
    oversizeTiming = await page.evaluate(() => window.__doggOversizeProbe);
  }
  await api(page, 'pause');
  const oversizeAfter = await inspect(page);
  const oversizeAfterExportValue = await api(page, 'exportState');
  const oversizeAfterExport = typeof oversizeAfterExportValue === 'string' ?
    oversizeAfterExportValue : JSON.stringify(oversizeAfterExportValue);
  await api(page, 'setSpeed', 120);
  await api(page, 'play');
  const oversizePlayed = await waitForTick(page, oversizeAfter.tick + 1, 3000);
  await api(page, 'pause');
  const oversizeDelay = Number.isFinite(oversizeTiming?.changeAt) &&
    Number.isFinite(oversizeTiming?.errorAt) ?
    oversizeTiming.errorAt - oversizeTiming.changeAt : Infinity;
  result('oversized import is rejected promptly without poisoning play',
    tooLarge.bytes > 8 * 1024 * 1024 && tooLarge.bytes < 9 * 1024 * 1024 &&
      oversizeDelay >= 0 && oversizeDelay < 750 &&
      /\b(too large|oversize|size limit|8\s*(?:mi?b|megabyte)|maximum import|exceeds)\b/i.test(oversizeTiming?.text || '') &&
      oversizeAfterExport === oversizeBeforeExport &&
      oversizeAfter.head === oversizeBefore.head &&
      oversizeAfter.frameCount === oversizeBefore.frameCount &&
      oversizeAfter.tick === oversizeBefore.tick &&
      oversizePlayed.tick > oversizeAfter.tick,
    `${(tooLarge.bytes / 1048576).toFixed(2)} MiB; rejected in ${Number.isFinite(oversizeDelay) ? oversizeDelay.toFixed(1) : 'unmeasured'}ms; checksum ${tooLarge.checksumPath}`);

  const longSessionStarted = Date.now();
  const longContext = await browser.newContext({ viewport: { width: 1000, height: 720 } });
  await denyStorage(longContext);
  await serve(longContext);
  const longPage = await openHeist(longContext, 'long-session page');
  await api(longPage, 'restart', 'LONG-SESSION-760');
  await api(longPage, 'pause');
  await api(longPage, 'setSpeed', 1);
  const longStart = await inspect(longPage);
  const longRaw = frameState(latestExportFrame(longStart.exported));
  requireMeasurement(longRaw, 'current raw state for long-session directives');
  const longAgents = longStart.agents;
  requireMeasurement(longAgents.length === 4, 'four agents for the long session');
  const longCells = traversableCells(longRaw).cells;
  requireMeasurement(longCells.length >= 4, 'legal traversable long-session directive targets');
  const longSafeTargets = new Map(longAgents.map(agent => {
    const current = coordinateOf(agent.state);
    const exact = current && longCells.find(cell =>
      cell.x === current.x && cell.y === current.y);
    const nearest = current && [...longCells].sort((a, b) =>
      (Math.abs(a.x - current.x) + Math.abs(a.y - current.y)) -
      (Math.abs(b.x - current.x) + Math.abs(b.y - current.y)))[0];
    return [agent.id, exact || nearest];
  }));
  requireMeasurement([...longSafeTargets.values()].every(Boolean),
    'one legal hold-position target per long-session agent');
  const longDirectives = Array.from({ length: 760 }, (_, index) => {
    const agent = longAgents[index % longAgents.length];
    const target = longSafeTargets.get(agent.id);
    return {
      agentId: agent.id,
      x: Number(target.x),
      y: Number(target.y)
    };
  });
  const queuedLong = await longPage.evaluate(async directives => {
    const accepted = value => value !== false &&
      !(value && typeof value === 'object' &&
        (value.ok === false || value.accepted === false || value.queued === false));
    let count = 0;
    let rejection;
    for (let index = 0; index < directives.length; index++) {
      const directive = directives[index];
      try {
        const value = await Promise.resolve(window.__doggHeist.queueDirective(
          directive.agentId,
          directive.x,
          directive.y
        ));
        if (!accepted(value)) {
          rejection = { index, value };
          break;
        }
        count++;
      } catch (error) {
        rejection = { index, error: String(error && (error.message || error)) };
        break;
      }
    }
    return { count, rejection };
  }, longDirectives);
  requireMeasurement(queuedLong.count === 760 && !queuedLong.rejection,
    `760 legal directives queued (accepted ${queuedLong.count})`);
  const longTickBudget = 900;
  const longStep = await tryApi(longPage, 'step', longTickBudget);
  requireMeasurement(!longStep.threw, `long-session step(${longTickBudget})`);
  await api(longPage, 'pause');
  const longSnapshot = await inspect(longPage);
  const longVerification = await tryApi(longPage, 'verifyChain');
  const longExport = longSnapshot.exportText;
  const longBytes = Buffer.byteLength(longExport, 'utf8');
  const resultingTicks = longSnapshot.tick - longStart.tick;
  const expectedLongFrames = longStart.frameCount + queuedLong.count + resultingTicks;
  const longStopEvidence = isTerminalOutcome(topLevelOutcomeOf(longSnapshot.state)) ||
    resultingTicks === longTickBudget ||
    /\b(max.?ticks|limit|cap|terminal|outcome)\b/i.test(JSON.stringify(longStep.value || ''));
  requireMeasurement(verificationPassed(longVerification),
    'the long-session hash chain');
  requireMeasurement(resultingTicks > 0 && resultingTicks <= longTickBudget && longStopEvidence,
    `legal ticks stopping at terminal/maxTicks (${resultingTicks}/${longTickBudget})`);
  requireMeasurement(longSnapshot.frameCount === expectedLongFrames &&
    longSnapshot.frameCount > 760,
  `genesis + directives + legal ticks (${longSnapshot.frameCount} = ${longStart.frameCount} + ${queuedLong.count} + ${resultingTicks})`);
  requireMeasurement(longBytes > 4 * 1024 * 1024 && longBytes <= 8 * 1024 * 1024,
    `a valid long export above 4 MiB and within 8 MiB (${longBytes} bytes)`);

  const longImportContext = await browser.newContext({ viewport: { width: 1000, height: 720 } });
  await denyStorage(longImportContext);
  await serve(longImportContext);
  const longImportPage = await openHeist(longImportContext, 'long-session import page');
  await api(longImportPage, 'pause');
  const longImportOutcome = await tryApi(longImportPage, 'importState', longExport);
  requireMeasurement(!longImportOutcome.threw && !explicitImportRejection(longImportOutcome),
    'fresh-context import of the valid >4 MiB session');
  await api(longImportPage, 'pause');
  const longImported = await inspect(longImportPage);
  const longImportedVerification = await tryApi(longImportPage, 'verifyChain');
  result('760-directive legal session round-trips above 4 MiB',
    longImported.exportText === longExport &&
      longImported.head === longSnapshot.head &&
      longImported.frameCount === longSnapshot.frameCount &&
      longImported.tick === longSnapshot.tick &&
      verificationPassed(longImportedVerification),
    `${queuedLong.count} directives + ${resultingTicks} legal ticks + ${longStart.frameCount} genesis = ${longSnapshot.frameCount} frames; ${longBytes} bytes (${(longBytes / 1048576).toFixed(2)} MiB); ${String(topLevelOutcomeOf(longSnapshot.state))}; ${Date.now() - longSessionStarted}ms`);
  await longImportContext.close();

  const exposedLimits = exposedRuntimeLimits(longSnapshot);
  let frameCapProbePass = true;
  let frameCapProbeDetail = 'no exposed frame cap';
  if (exposedLimits.frame && exposedLimits.frame.value <= 2000) {
    if (longSnapshot.frameCount === exposedLimits.frame.value) {
      const frameCapBaseline = await inspect(longPage);
      const frameCapExtra = await tryApi(longPage, 'step', 1);
      await sleep(80);
      const frameCapAfter = await inspect(longPage);
      const frameCapSurface =
        `${frameCapBaseline.dom['status-live']} ${frameCapBaseline.dom['event-log']} ` +
        `${frameCapAfter.dom['status-live']} ${frameCapAfter.dom['event-log']}`;
      frameCapProbePass =
        (frameCapExtra.threw || frameCapExtra.value === false ||
          /\b(limit|cap|capacity|full|maximum)\b/i.test(frameCapSurface)) &&
        frameCapAfter.exportText === frameCapBaseline.exportText &&
        frameCapAfter.head === frameCapBaseline.head &&
        frameCapAfter.frameCount === frameCapBaseline.frameCount &&
        frameCapAfter.tick === frameCapBaseline.tick;
      frameCapProbeDetail =
        `${exposedLimits.frame.path}=${exposedLimits.frame.value}, exact=${frameCapAfter.exportText === frameCapBaseline.exportText}`;
    } else {
      frameCapProbeDetail =
        `${exposedLimits.frame.path}=${exposedLimits.frame.value}, terminal stopped at ${longSnapshot.frameCount} before cap`;
    }
  }
  await api(longPage, 'restart', 'DIRECTIVE-CAP-PROBE');
  await api(longPage, 'pause');
  const capStart = await inspect(longPage);
  const capAgent = capStart.agents[0];
  const capPosition = coordinateOf(capAgent?.state);
  requireMeasurement(capAgent && capPosition, 'an agent for directive-cap probing');
  const capAttempts = Math.min(
    Math.max((exposedLimits.directive?.value || 900) + 2, 722),
    1500
  );
  const capBatch = await longPage.evaluate(async ({ count, directive }) => {
    const rejected = value => value === false ||
      Boolean(value && typeof value === 'object' &&
        (value.ok === false || value.accepted === false || value.queued === false));
    let accepted = 0;
    let firstRejected = null;
    for (let index = 0; index < count; index++) {
      try {
        const value = await Promise.resolve(window.__doggHeist.queueDirective(
          directive.agentId,
          directive.x,
          directive.y
        ));
        if (rejected(value)) {
          firstRejected = { index, value };
          break;
        }
        accepted++;
      } catch (error) {
        firstRejected = { index, error: String(error && (error.message || error)) };
        break;
      }
    }
    return { accepted, firstRejected };
  }, {
    count: capAttempts,
    directive: { agentId: capAgent.id, x: capPosition.x, y: capPosition.y }
  });
  let capProbePass = true;
  let capProbeDetail = `no exposed directive rejection through ${capBatch.accepted}`;
  if (capBatch.firstRejected) {
    const capBaseline = await inspect(longPage);
    const capExtra = await tryApi(
      longPage,
      'queueDirective',
      capAgent.id,
      capPosition.x,
      capPosition.y
    );
    await sleep(80);
    const capAfter = await inspect(longPage);
    const capVerification = await tryApi(longPage, 'verifyChain');
    const capStatusDelta = capBaseline.dom['status-live'] !== capStart.dom['status-live'] ?
      capBaseline.dom['status-live'] : '';
    const capLogDelta = capBaseline.dom['event-log'].startsWith(capStart.dom['event-log']) ?
      capBaseline.dom['event-log'].slice(capStart.dom['event-log'].length) :
      capBaseline.dom['event-log'] !== capStart.dom['event-log'] ?
        capBaseline.dom['event-log'] : '';
    const capSurface = `${capStatusDelta} ${capLogDelta}`;
    capProbePass = explicitImportRejection(capExtra) &&
      capAfter.exportText === capBaseline.exportText &&
      capAfter.head === capBaseline.head &&
      capAfter.frameCount === capBaseline.frameCount &&
      capAfter.tick === capBaseline.tick &&
      verificationPassed(capVerification) &&
      /\b(limit|cap|capacity|full|too many)\b/i.test(capSurface);
    capProbeDetail =
      `rejected at ${capBatch.firstRejected.index}; second reject ${explicitImportRejection(capExtra)}; exact ${capAfter.exportText === capBaseline.exportText}`;
  } else if (exposedLimits.directive) {
    capProbePass = false;
    capProbeDetail =
      `${exposedLimits.directive.path}=${exposedLimits.directive.value} exposed but ${capAttempts} directives did not reject`;
  }
  result('exposed directive cap rejects visibly without mutating the line',
    capProbePass && frameCapProbePass,
    `${capProbeDetail}; ${frameCapProbeDetail}`);
  await longContext.close();

  await page.locator('#help-button').click();
  const helpOpened = await poll(() => visibleHelp(page), value => value.count > 0, 2500);
  const helpCloseControl = await clickVisibleHelpClose(page);
  const helpClosedByControl = await poll(() => visibleHelp(page), value => value.count === 0, 2500);
  await page.locator('#help-button').click();
  await poll(() => visibleHelp(page), value => value.count > 0, 2500);
  await page.keyboard.press('Escape');
  const helpClosedByEscape = await poll(() => visibleHelp(page), value => value.count === 0, 2500);
  result('help opens, closes, and Escape dismisses it',
    helpOpened.count > 0 && helpClosedByControl.count === 0 && helpClosedByEscape.count === 0 &&
      /help|control|keyboard|key|play|step/i.test(helpOpened.text),
    `${helpCloseControl}; ${helpOpened.text.replace(/\s+/g, ' ').slice(0, 100)}`);

  await page.evaluate(() => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  });
  await page.keyboard.press('h');
  const helpOpenedByH = await poll(() => visibleHelp(page), value => value.count > 0, 2500);
  const helpFocusInside = await focusInsideVisibleHelp(page);
  await page.keyboard.press('h');
  const helpClosedByH = await poll(() => visibleHelp(page), value => value.count === 0, 2500);
  const amberUnhacked = /(?:amber.{0,60}(?:marks?|means?|denotes?|indicates?)?\s*unhacked\s+terminals?|unhacked\s+terminals?.{0,60}amber)/i
    .test(helpOpenedByH.text);
  const greenUnhacked = /(?:green\s+(?:marks?|means?|denotes?|indicates?)?\s*unhacked\s+terminals?|unhacked\s+terminals?\s+(?:are|is|show|display|appear|glow|use|=|:)\s*green)/i
    .test(helpOpenedByH.text);
  result('help tells the amber truth and H toggles from modal focus',
    helpOpenedByH.count > 0 && helpFocusInside && helpClosedByH.count === 0 &&
      amberUnhacked && !greenUnhacked,
    `focus inside ${helpFocusInside}; amber ${amberUnhacked}; green ${greenUnhacked}`);

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    colorScheme: 'light'
  });
  await serve(mobileContext);
  const mobilePage = await openHeist(mobileContext, '390x844 page', true);
  const mobileReach = await auditReachability(mobilePage);
  const mobileLayout = await mobilePage.evaluate(() => ({
    innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth
  }));
  const mobileBad = mobileReach.filter(item => !item.exists || !item.visible || !item.reachable);
  result('390x844 has no horizontal overflow and every surface remains reachable',
    mobileLayout.documentWidth <= mobileLayout.innerWidth + 1 &&
      mobileLayout.bodyWidth <= mobileLayout.innerWidth + 1 &&
      mobileBad.length === 0,
    `${mobileLayout.documentWidth}/${mobileLayout.innerWidth}px; ${mobileBad.length ? `blocked: ${mobileBad.map(item => item.id).join(', ')}` : `${mobileReach.length} reachable`}`);
  const mobilePrimaryIds = new Set([
    'play-toggle', 'step-button', 'restart-button', 'speed-select', 'timeline',
    'fork-button', 'export-button', 'import-button', 'help-button'
  ]);
  const mobileTimelineHitHeight = await mobilePage.evaluate(() => {
    const timeline = document.getElementById('timeline');
    if (!timeline) return 0;
    const candidates = [
      timeline,
      timeline.closest('label'),
      ...document.querySelectorAll('label[for="timeline"]')
    ].filter(Boolean);
    return Math.max(...candidates.map(element => element.getBoundingClientRect().height));
  });
  const mobilePrimaryTargets = mobileReach.filter(item => mobilePrimaryIds.has(item.id))
    .map(item => Object.assign({}, item, {
      effectiveHeight: item.id === 'timeline' ?
        Math.max(item.height, mobileTimelineHitHeight) : item.height
    }));
  const shortestMobileTarget = mobilePrimaryTargets.length ?
    Math.min(...mobilePrimaryTargets.map(item => item.effectiveHeight)) : 0;
  result('mobile primary controls expose 44px hit targets',
    mobilePrimaryTargets.length === mobilePrimaryIds.size &&
      mobilePrimaryTargets.every(item =>
        item.exists && item.visible && item.reachable && item.effectiveHeight >= 44),
    `minimum ${shortestMobileTarget.toFixed(1)}px; ${mobilePrimaryTargets.map(item => `${item.id}:${item.effectiveHeight.toFixed(1)}`).join(', ')}`);

  await api(mobilePage, 'pause');
  const mobileTarget = await measureMobileTargeting(mobilePage);
  requireMeasurement(mobileTarget.measurable && mobileTarget.target,
    'public facility dimensions and a visible mobile target');
  const mobileTouchBefore = await inspect(mobilePage);
  await mobilePage.touchscreen.tap(mobileTarget.target.x, mobileTarget.target.y);
  let mobileTouchAfter;
  try {
    mobileTouchAfter = await poll(async () => {
      const snapshot = await inspect(mobilePage);
      const statusDelta = snapshot.dom['status-live'] !== mobileTouchBefore.dom['status-live'] ?
        snapshot.dom['status-live'] : '';
      const log = snapshot.dom['event-log'];
      const logDelta = log.startsWith(mobileTouchBefore.dom['event-log']) ?
        log.slice(mobileTouchBefore.dom['event-log'].length) :
        log !== mobileTouchBefore.dom['event-log'] ? log : '';
      const stateChanged = stable(materialProjection(snapshot.state)) !==
        stable(materialProjection(mobileTouchBefore.state));
      const text = `${statusDelta} ${logDelta}`.trim();
      const directiveEvidence = stateChanged ||
        /\b(directive|queued|route|move order|ordered|target set|destination)\b/i.test(text);
      return {
        snapshot,
        stateChanged,
        directiveEvidence,
        text
      };
    }, value => value.directiveEvidence, 1800, 40);
  } catch (error) {
    const snapshot = await inspect(mobilePage);
    mobileTouchAfter = {
      snapshot,
      stateChanged: false,
      directiveEvidence: false,
      text: ''
    };
  }
  const mobileStepBefore = mobileTouchAfter.snapshot;
  await api(mobilePage, 'step', 1);
  await sleep(100);
  const mobileStepAfter = await inspect(mobilePage);
  result('mobile board exposes a 40px target and accepts a real touch directive',
    (mobileTarget.renderedCellScale >= 40 || mobileTarget.accessibleTargetScale >= 40) &&
      mobileTarget.target.size >= 40 &&
      mobileTarget.documentWidth <= mobileTarget.viewportWidth + 1 &&
      mobileTouchAfter.directiveEvidence &&
      mobileTouchAfter.snapshot.tick === mobileTouchBefore.tick &&
      mobileStepAfter.tick - mobileStepBefore.tick === 1 &&
      mobileStepAfter.frameCount - mobileStepBefore.frameCount === 1,
    `${mobileTarget.dimensions.cols}x${mobileTarget.dimensions.rows} via ${mobileTarget.dimensions.source}; cell ${mobileTarget.renderedCellScale.toFixed(1)}px, control ${mobileTarget.accessibleTargetScale.toFixed(1)}px; ${mobileTarget.target.kind}`);

  await api(mobilePage, 'restart', 'WATCH-000');
  await api(mobilePage, 'pause');
  await api(mobilePage, 'setSpeed', 20);
  let watchSnapshot = await inspect(mobilePage, false);
  let watchLevel;
  while (watchSnapshot.tick <= 50) {
    watchLevel = await mobilePage.locator('#alarm-value').getAttribute('data-level');
    if (watchLevel === 'watch' || watchSnapshot.tick === 50) break;
    await api(mobilePage, 'step', 1);
    watchSnapshot = await inspect(mobilePage, false);
  }
  requireMeasurement(watchLevel === 'watch',
    `WATCH-000 reaching alarm watch by tick 50 (last tick ${watchSnapshot.tick}, level ${watchLevel})`);
  const watchContrast = await measureElementContrast(
    mobilePage,
    '#alarm-value[data-level="watch"]'
  );

  await api(mobilePage, 'restart', 'ADVERSARY-007');
  await api(mobilePage, 'pause');
  await api(mobilePage, 'setSpeed', 20);
  let wonSnapshot = await inspect(mobilePage, false);
  while (wonSnapshot.tick < 13) {
    await api(mobilePage, 'step', 1);
    wonSnapshot = await inspect(mobilePage, false);
  }
  const mobilePovMarkerContrast =
    await measureRememberedTerminalCanvasContrast(mobilePage);
  const mobileDoorContrast = await measureDoorCanvasContrast(
    mobilePage,
    mobilePovMarkerContrast.transform
  );
  const mobileTacticalActive = await measureTacticalMarkerSet(
    mobilePage,
    mobilePovMarkerContrast.transform,
    'active'
  );
  for (let batch = 0; batch < 12; batch++) {
    const won = await mobilePage.locator('#objective-value').getAttribute('data-outcome');
    if (won === 'won') break;
    await api(mobilePage, 'step', 8);
    wonSnapshot = await inspect(mobilePage, false);
  }
  const wonOutcome = await mobilePage.locator('#objective-value').getAttribute('data-outcome');
  const wonContrast = await measureElementContrast(
    mobilePage,
    '#objective-value[data-outcome="won"]'
  );
  const mobileTacticalCompleted = await measureTacticalMarkerSet(
    mobilePage,
    mobilePovMarkerContrast.transform,
    'completed'
  );
  const mobileLight = await mobilePage.evaluate(() =>
    matchMedia('(prefers-color-scheme: light)').matches &&
    innerWidth === 390 && innerHeight === 844);
  result('mobile light watch alarm and won objective meet 4.5:1',
    mobileLight && watchLevel === 'watch' && wonOutcome === 'won' &&
      watchContrast.found && watchContrast.visible && watchContrast.measurable &&
      wonContrast.found && wonContrast.visible && wonContrast.measurable &&
      watchContrast.ratio >= 4.5 && wonContrast.ratio >= 4.5,
    `watch tick ${watchSnapshot.tick}: ${watchContrast.ratio?.toFixed(2) || 'missing'}:1 "${watchContrast.text || ''}"; won tick ${wonSnapshot.tick}: ${wonContrast.ratio?.toFixed(2) || 'missing'}:1 "${wonContrast.text || ''}"`);
  await mobileContext.close();

  const hitboxLayouts = [
    {
      name: 'desktop 1432x735',
      options: { viewport: { width: 1432, height: 735 } }
    },
    {
      name: 'mobile landscape 844x390',
      options: {
        viewport: { width: 844, height: 390 },
        screen: { width: 844, height: 390 },
        hasTouch: true,
        isMobile: true
      }
    }
  ];
  const hitboxMeasurements = [];
  for (const layout of hitboxLayouts) {
    const context = await browser.newContext(layout.options);
    await serve(context);
    const layoutPage = await openHeist(context, `${layout.name} hitbox page`);
    const measured = await auditPrimaryHitboxes(layoutPage);
    hitboxMeasurements.push(Object.assign({ name: layout.name }, measured));
    await context.close();
  }
  result('desktop and landscape primary controls expose 44px hitboxes',
    hitboxMeasurements.every(measurement =>
      measurement.rows.length === 10 &&
      measurement.rows.every(row =>
        row.found && row.visible && row.reachable && row.height >= 44) &&
      measurement.documentWidth <= measurement.viewport.width + 1 &&
      measurement.bodyWidth <= measurement.viewport.width + 1),
    hitboxMeasurements.map(measurement =>
      `${measurement.name} min ${Math.min(...measurement.rows.map(row => row.height)).toFixed(1)}px overflow ${Math.max(measurement.documentWidth, measurement.bodyWidth) - measurement.viewport.width}px; ${measurement.rows.map(row => `${row.name}:${row.height.toFixed(0)}`).join(',')}`).join(' | '));

  const contrastByTheme = {};
  for (const scheme of ['light', 'dark']) {
    const contrastContext = await browser.newContext({
      viewport: { width: 1000, height: 760 },
      colorScheme: scheme
    });
    await serve(contrastContext);
    const contrastPage = await navigateHeist(contrastContext, `${scheme} contrast page`);
    const contrastIntro = await markIntro(contrastPage);
    requireMeasurement(contrastIntro.found && contrastIntro.ready !== true,
      `${scheme} intro muted-copy contrast before readiness`);
    const introContrast = await measureContrast(contrastPage, 'intro');
    await dismissIntro(contrastPage);
    await finishHeistBoot(contrastPage, `${scheme} contrast page`);
    const contrastState = await inspect(contrastPage, false);
    const roles = contrastState.agents.map(agent => agent.state &&
      (agent.state.role || agent.state.agentRole))
      .filter(role => typeof role === 'string' && role.trim()).map(role => role.trim());
    requireMeasurement(roles.length === 4, `${scheme} four public agent roles`);
    await api(contrastPage, 'pause');
    await api(contrastPage, 'setSpeed', 120);
    await api(contrastPage, 'play');
    await waitForTick(contrastPage, contrastState.tick + 1, 3000);
    const readyContrast = await measureContrast(contrastPage, 'ready', roles);
    await api(contrastPage, 'pause');
    const selectedForContrast = await hasSelectedAgentControl(contrastPage);
    const neutralContrast = await measureContrast(contrastPage, 'ready', roles);
    const disabledReturnLive = await measureDisabledControlContrast(
      contrastPage,
      'return-live'
    );
    const disabledFork = await measureDisabledControlContrast(contrastPage, 'fork');
    const activeSmallText = await scanSmallTextContrast(contrastPage, 'active');
    await api(contrastPage, 'restart', 'ADVERSARY-007');
    await api(contrastPage, 'pause');
    await api(contrastPage, 'setSpeed', 20);
    let completedContrastState = await inspect(contrastPage, false);
    while (completedContrastState.tick < 13) {
      await api(contrastPage, 'step', 1);
      completedContrastState = await inspect(contrastPage, false);
    }
    const povMarkerContrast = await measureRememberedTerminalCanvasContrast(contrastPage);
    const doorContrast = await measureDoorCanvasContrast(
      contrastPage,
      povMarkerContrast.transform
    );
    const tacticalActive = await measureTacticalMarkerSet(
      contrastPage,
      povMarkerContrast.transform,
      'active'
    );
    for (let batch = 0;
      batch < 12 && !isTerminalOutcome(topLevelOutcomeOf(completedContrastState.state));
      batch++) {
      await api(contrastPage, 'step', 8);
      completedContrastState = await inspect(contrastPage, false);
    }
    requireMeasurement(isTerminalOutcome(topLevelOutcomeOf(completedContrastState.state)),
      `${scheme} completed representative state for systematic contrast`);
    const disabledTerminalPlay = await measureDisabledControlContrast(
      contrastPage,
      'play'
    );
    const completedSmallText = await scanSmallTextContrast(contrastPage, 'completed');
    const tacticalCompleted = await measureTacticalMarkerSet(
      contrastPage,
      povMarkerContrast.transform,
      'completed'
    );
    contrastByTheme[scheme] = {
      intro: introContrast.intro,
      roles: readyContrast.roles,
      status: readyContrast.status,
      neutralStatus: neutralContrast.neutralStatus,
      selectedControlFound: neutralContrast.selectedControlFound,
      selectedMetadata: neutralContrast.selectedMetadata,
      selectedForContrast,
      activeSmallText,
      completedSmallText,
      povMarkerContrast,
      doorContrast,
      tacticalActive,
      tacticalCompleted,
      disabledReturnLive,
      disabledFork,
      disabledTerminalPlay,
      theme: `${introContrast.theme}|${readyContrast.theme}`
    };
    await contrastContext.close();
  }
  const contrastMeasurements = ['light', 'dark'].flatMap(scheme => {
    const measured = contrastByTheme[scheme];
    return [measured.intro, measured.status, ...measured.roles].filter(Boolean)
      .map(entry => ({ scheme, entry }));
  });
  const contrastMinimum = contrastMeasurements.length ?
    Math.min(...contrastMeasurements.map(item => item.entry.ratio)) : 0;
  result('small role, active-status, and intro-muted text meet 4.5:1 in both themes',
    ['light', 'dark'].every(scheme => {
      const measured = contrastByTheme[scheme];
      return measured.intro && measured.status && measured.roles.length === 4 &&
        [measured.intro, measured.status, ...measured.roles].every(entry =>
          entry.ratio >= 4.5 && parseFloat(entry.fontSize) < 24);
    }) &&
      contrastByTheme.light.theme !== contrastByTheme.dark.theme,
    `minimum ${contrastMinimum.toFixed(2)}:1; light ${contrastByTheme.light.theme}; dark ${contrastByTheme.dark.theme}`);
  const darkSpecificContrast = contrastByTheme.dark;
  result('dark neutral status and selected-agent metadata meet 4.5:1',
    darkSpecificContrast.selectedForContrast &&
      darkSpecificContrast.selectedControlFound &&
      darkSpecificContrast.neutralStatus && darkSpecificContrast.selectedMetadata &&
      darkSpecificContrast.neutralStatus.ratio >= 4.5 &&
      darkSpecificContrast.selectedMetadata.ratio >= 4.5 &&
      parseFloat(darkSpecificContrast.neutralStatus.fontSize) < 24 &&
      parseFloat(darkSpecificContrast.selectedMetadata.fontSize) < 24 &&
      darkSpecificContrast.neutralStatus.text.length > 0 &&
      /\b(cooldown|ready|available|wait|tick|turn)\b|\d/i.test(darkSpecificContrast.selectedMetadata.text),
    `status ${darkSpecificContrast.neutralStatus?.ratio.toFixed(2) || 'missing'}:1 (${darkSpecificContrast.neutralStatus?.text || 'none'}); metadata ${darkSpecificContrast.selectedMetadata?.ratio.toFixed(2) || 'missing'}:1 (${darkSpecificContrast.selectedMetadata?.text || 'none'})`);
  const disabledContrastMeasurements = ['light', 'dark'].flatMap(scheme => [
    Object.assign({ scheme }, contrastByTheme[scheme].disabledReturnLive),
    Object.assign({ scheme }, contrastByTheme[scheme].disabledFork),
    Object.assign({ scheme }, contrastByTheme[scheme].disabledTerminalPlay)
  ]);
  result('disabled controls retain 4.5:1 contrast and explicit disabled cues',
    disabledContrastMeasurements.every(measurement =>
      measurement.found && measurement.visible && measurement.measurable &&
      measurement.disabled && measurement.ratio >= 4.5),
    disabledContrastMeasurements.map(measurement =>
      `${measurement.scheme}/${measurement.kind} ${measurement.ratio?.toFixed(2) || 'missing'}:1 disabled=${measurement.disabled} cursor=${measurement.cursor}`).join(' | '));
  const systematicScans = ['light', 'dark'].flatMap(scheme => [
    Object.assign({ scheme }, contrastByTheme[scheme].activeSmallText),
    Object.assign({ scheme }, contrastByTheme[scheme].completedSmallText)
  ]);
  const systematicWorst = systematicScans
    .map(scan => scan.worst && Object.assign({ scheme: scan.scheme, state: scan.state }, scan.worst))
    .filter(Boolean).sort((a, b) => a.ratio - b.ratio)[0];
  const systematicFailures = systematicScans.flatMap(scan =>
    scan.failures.map(failure => Object.assign({
      scheme: scan.scheme,
      state: scan.state
    }, failure)));
  const systematicCoverageMissing = ['light', 'dark'].flatMap(scheme => {
    const active = contrastByTheme[scheme].activeSmallText;
    const completed = contrastByTheme[scheme].completedSmallText;
    const missing = Object.keys(active.coverage).filter(name => {
      if (name === 'stepMark') return !completed.coverage.stepMark;
      if (name === 'eventLogText') return false;
      return !active.coverage[name] && !completed.coverage[name];
    }).map(name => `${scheme}:${name}`);
    if (!active.coverage.eventLogText) missing.push(`${scheme}:active-eventLogText`);
    if (!completed.coverage.eventLogText) missing.push(`${scheme}:completed-eventLogText`);
    return [...new Set(missing)];
  });
  result('systematic sub-14px text contrast passes active and completed themes',
    systematicScans.length === 4 &&
      systematicScans.every(scan =>
        scan.count > 0 && scan.failures.length === 0) &&
      systematicCoverageMissing.length === 0,
    systematicFailures.length ?
      `${systematicFailures[0].scheme}/${systematicFailures[0].state} ${systematicFailures[0].ratio.toFixed(2)}:1 ${systematicFailures[0].selector} "${systematicFailures[0].text}"` :
      systematicCoverageMissing.length ?
        `unmeasured required text: ${systematicCoverageMissing.join(', ')}` :
        `worst ${systematicWorst?.scheme}/${systematicWorst?.state} ${systematicWorst?.ratio.toFixed(2)}:1 ${systematicWorst?.selector} "${systematicWorst?.text}" across ${systematicScans.reduce((sum, scan) => sum + scan.count, 0)} labels`);
  const rememberedTerminalMeasurements = [
    Object.assign({ mode: 'light' }, contrastByTheme.light.povMarkerContrast),
    Object.assign({ mode: 'dark' }, contrastByTheme.dark.povMarkerContrast),
    Object.assign({ mode: 'mobile-light' }, mobilePovMarkerContrast)
  ];
  const smallestRememberedTerminal = [...rememberedTerminalMeasurements]
    .sort((a, b) => a.css.width * a.css.height - b.css.width * b.css.height)[0];
  result('remembered hacked-terminal glyph has 4.5:1 canvas contrast',
    rememberedTerminalMeasurements.every(measurement =>
      measurement.remembered === true &&
      measurement.currentlyVisible === false &&
      measurement.terminalHacked === true &&
      measurement.knownCount > 0 &&
      measurement.ownScore >= 8 &&
      measurement.ownGlyphCount >= 2 &&
      measurement.ownBackgroundCount >= 2 &&
      measurement.clusterDistance >= 28 &&
      measurement.glyph.count >= 2 &&
      measurement.background.count >= 2 &&
      measurement.contrast >= 4.5 &&
      measurement.lowContrastControl < 4.5) &&
      smallestRememberedTerminal.contrast >= 4.5,
    rememberedTerminalMeasurements.map(measurement =>
      `${measurement.mode} ${measurement.css.width.toFixed(0)}x${measurement.css.height.toFixed(0)} ${measurement.transform} calibration ${measurement.ownScore.toFixed(1)} contrast ${measurement.contrast.toFixed(2)}:1 distance ${measurement.clusterDistance.toFixed(1)} glyph rgb(${measurement.glyph.color.join(',')}) / cell-bg rgb(${measurement.background.color.join(',')}) low-control ${measurement.lowContrastControl.toFixed(2)}:1`).join(' | '));
  const doorMeasurements = [
    { mode: 'light', pair: contrastByTheme.light.doorContrast },
    { mode: 'dark', pair: contrastByTheme.dark.doorContrast },
    { mode: 'mobile-light', pair: mobileDoorContrast }
  ].flatMap(entry => [
    Object.assign({ theme: entry.mode }, entry.pair.remembered),
    Object.assign({ theme: entry.mode }, entry.pair.visible)
  ]);
  const doorContrastPass = doorMeasurements.every(measurement =>
    measurement.clusterDistance >= 28 &&
    measurement.glyph.count >= 2 &&
    measurement.background.count >= 2 &&
    measurement.contrast >= 4.5 &&
    measurement.lowContrastControl < 4.5 &&
    (measurement.mode === 'remembered' ?
      measurement.known && !measurement.visible :
      measurement.visible && (measurement.open || measurement.locked)));
  if (!doorContrastPass) {
    console.log('door glyph candidates:', JSON.stringify(doorMeasurements.map(measurement => ({
      theme: measurement.theme,
      mode: measurement.mode,
      door: measurement.doorId,
      background: measurement.background,
      candidates: measurement.glyphCandidates
    }))));
  }
  result('POV door strokes retain 4.5:1 contrast in remembered and visible states',
    doorContrastPass,
    doorMeasurements.map(measurement =>
      `${measurement.theme}/${measurement.mode} ${measurement.doorId}@${measurement.target.x},${measurement.target.y} ${measurement.open ? 'open' : measurement.locked ? 'locked' : measurement.status || 'door'} ${measurement.contrast.toFixed(2)}:1 rgb(${measurement.glyph.color.join(',')})/rgb(${measurement.background.color.join(',')}) low ${measurement.lowContrastControl.toFixed(2)}`).join(' | '));
  const tacticalModes = [
    {
      mode: 'light',
      phases: [
        contrastByTheme.light.tacticalActive,
        contrastByTheme.light.tacticalCompleted
      ]
    },
    {
      mode: 'dark',
      phases: [
        contrastByTheme.dark.tacticalActive,
        contrastByTheme.dark.tacticalCompleted
      ]
    },
    {
      mode: 'mobile-light',
      phases: [mobileTacticalActive, mobileTacticalCompleted]
    }
  ];
  const requiredFixtureTypes = [
    'extraction', 'terminal-unhacked', 'terminal-hacked',
    'core', 'guard', 'camera', 'laser-hazard'
  ];
  const tacticalMeasurements = [];
  const tacticalMissing = [];
  for (const mode of tacticalModes) {
    const candidates = mode.phases.flatMap(phase => phase.candidates);
    const measured = mode.phases.flatMap(phase => phase.measured);
    const agentKeys = [...new Set(candidates.filter(candidate => candidate.type === 'agent')
      .map(candidate => candidate.key))];
    if (agentKeys.length !== 4) tacticalMissing.push(`${mode.mode}:four-agents(${agentKeys.length})`);
    const requiredKeys = [...agentKeys, ...requiredFixtureTypes];
    if (candidates.some(candidate => candidate.type === 'door')) requiredKeys.push('door');
    for (const key of requiredKeys) {
      const options = measured.filter(measurement => measurement.key === key)
        .sort((a, b) =>
          a.css.width * a.css.height - b.css.width * b.css.height);
      if (!options.length) {
        tacticalMissing.push(`${mode.mode}:${key}`);
      } else {
        tacticalMeasurements.push(Object.assign({ mode: mode.mode }, options[0]));
      }
    }
  }
  requireMeasurement(tacticalMissing.length === 0,
    `all tactical marker types measurable (${tacticalMissing.join(', ')})`);
  const tacticalFailures = tacticalMeasurements.map(measurement => {
    const checks = {
      glyphSamples: measurement.glyph.count >= 2,
      backgroundSamples: measurement.background.count >= 2,
      distinctClusters: measurement.clusterDistance >= 28,
      glyphPresent: measurement.glyphFraction > 0,
      contrast: measurement.contrast >= 4.5,
      lowControlFails: measurement.lowContrastControl < 4.5,
      semanticVisibility: measurement.type === 'agent' ||
        measurement.visibility === 'visible' ||
        measurement.visibility === 'remembered'
    };
    return {
      measurement,
      checks,
      failed: Object.entries(checks)
        .filter(([, passed]) => !passed).map(([name]) => name)
    };
  }).filter(entry => entry.failed.length);
  const tacticalContrastPass = tacticalFailures.length === 0;
  if (!tacticalContrastPass) {
    console.log('tactical marker failures:', JSON.stringify(tacticalFailures.map(entry => ({
      mode: entry.measurement.mode,
      key: entry.measurement.key,
      phase: entry.measurement.phase,
      visibility: entry.measurement.visibility,
      failed: entry.failed,
      values: {
        glyphSamples: entry.measurement.glyph.count,
        backgroundSamples: entry.measurement.background.count,
        clusterDistance: entry.measurement.clusterDistance,
        glyphFraction: entry.measurement.glyphFraction,
        contrast: entry.measurement.contrast,
        lowContrastControl: entry.measurement.lowContrastControl
      },
      background: entry.measurement.background,
      candidates: entry.measurement.glyphCandidates
    }))));
  }
  result('all tactical POV markers retain 4.5:1 target-specific pixel contrast',
    tacticalContrastPass,
    tacticalFailures.length ?
      tacticalFailures.map(entry =>
        `${entry.measurement.mode}/${entry.measurement.key} failed ${entry.failed.join(',')} (glyph ${entry.measurement.glyph.count}, bg ${entry.measurement.background.count}, distance ${entry.measurement.clusterDistance.toFixed(1)}, fraction ${entry.measurement.glyphFraction.toFixed(3)}, contrast ${entry.measurement.contrast.toFixed(2)}, low ${entry.measurement.lowContrastControl.toFixed(2)})`).join(' | ') :
      tacticalMeasurements.map(measurement =>
        `${measurement.mode}/${measurement.key}@${measurement.position.x},${measurement.position.y} ${measurement.phase}/${measurement.visibility} ${measurement.css.width.toFixed(0)}x${measurement.css.height.toFixed(0)} ${measurement.contrast.toFixed(2)}:1 low ${measurement.lowContrastControl.toFixed(2)}`).join(' | '));

  const policyContext = await browser.newContext({ viewport: { width: 1000, height: 720 } });
  await serve(policyContext);
  const policyPage = await openHeist(policyContext, 'ADVERSARY-007 policy page');
  await api(policyPage, 'restart', 'ADVERSARY-007');
  await api(policyPage, 'pause');
  await api(policyPage, 'setSpeed', 20);
  await api(policyPage, 'pause');
  let policySnapshot = await inspect(policyPage);
  while (policySnapshot.tick < 13) {
    await api(policyPage, 'step', 1);
    policySnapshot = await inspect(policyPage);
  }
  requireMeasurement(policySnapshot.tick === 13, 'ADVERSARY-007 tick 13 policy frame');
  const thresholdPolicy = policyState(policySnapshot);
  requireMeasurement(thresholdPolicy.terminals.length > 2,
    'ADVERSARY-007 current exported frame terminals, including untouched extras');
  const thresholdCoreIntent = thresholdPolicy.agentIntent.find(agent =>
    /\b(core|vault)\b/i.test(agent.text));
  let priorPolicyFeedback =
    `${policySnapshot.dom['status-live']} ${policySnapshot.dom['event-log']}`;
  let postThresholdSnapshot = policySnapshot;
  let postThresholdPolicy = thresholdPolicy;
  let extraTerminalHacked = false;
  let acquisitionEvidence = '';
  for (let step = 0; step < 10 && !acquisitionEvidence; step++) {
    await api(policyPage, 'step', 1);
    postThresholdSnapshot = await inspect(policyPage);
    postThresholdPolicy = policyState(postThresholdSnapshot);
    if (postThresholdPolicy.hacked > thresholdPolicy.hacked) extraTerminalHacked = true;
    const feedback = `${postThresholdSnapshot.dom['status-live']} ${postThresholdSnapshot.dom['event-log']}`;
    const feedbackDelta = feedback.startsWith(priorPolicyFeedback) ?
      feedback.slice(priorPolicyFeedback.length) :
      feedback.includes(priorPolicyFeedback) ? feedback.replace(priorPolicyFeedback, '') : feedback;
    if (/\b(core|vault)\b.{0,80}\b(hacked|acquired|secured|stolen|reached|complete)\b|\b(hacked|acquired|secured|stolen|reached|complete)\b.{0,80}\b(core|vault)\b/i
      .test(feedbackDelta) || /\b(win|won|victory|success)\b/i.test(String(postThresholdPolicy.outcome ?? ''))) {
      acquisitionEvidence = feedbackDelta.replace(/\s+/g, ' ').slice(-140) ||
        String(postThresholdPolicy.outcome);
    }
    priorPolicyFeedback = feedback;
  }
  result('ADVERSARY-007 pursues the core without hacking surplus terminals',
    thresholdPolicy.required === 2 && thresholdPolicy.hacked === 2 &&
      thresholdPolicy.untouched.length > 0 && Boolean(thresholdCoreIntent) &&
      !extraTerminalHacked,
    `tick 13: 2/2 with ${thresholdPolicy.untouched.length} untouched; ${thresholdCoreIntent ? `${thresholdCoreIntent.id}: ${thresholdCoreIntent.text}` : 'no core/vault intent'}; ${acquisitionEvidence || 'pursuit observed before acquisition'}`);

  let terminalSnapshot = postThresholdSnapshot;
  for (let step = 0; step < 120 && !isTerminalOutcome(outcomeOf(terminalSnapshot.state)); step++) {
    await api(policyPage, 'step', 1);
    terminalSnapshot = await inspect(policyPage, false);
  }
  requireMeasurement(isTerminalOutcome(outcomeOf(terminalSnapshot.state)),
    'a deterministic win/loss for history coherence');
  terminalSnapshot = await inspect(policyPage);
  await sleep(100);
  const terminalStorageState = await policyContext.storageState();
  const postTerminalFork = appendPostTerminalFrame(terminalSnapshot.exportText, 'fork');
  const postTerminalForkAttempt = await rejectedTransactionalImport(
    policyPage,
    postTerminalFork.json,
    terminalSnapshot
  );
  const postTerminalDirective = appendPostTerminalFrame(
    terminalSnapshot.exportText,
    'directive'
  );
  const postTerminalDirectiveAttempt = postTerminalDirective ?
    await rejectedTransactionalImport(
      policyPage,
      postTerminalDirective.json,
      terminalSnapshot
    ) : null;
  result('fully rehashed post-terminal fork and directive frames are rejected',
    postTerminalForkAttempt.rejected &&
      postTerminalForkAttempt.unchanged &&
      postTerminalForkAttempt.stateCallable &&
      (!postTerminalDirectiveAttempt ||
        (postTerminalDirectiveAttempt.rejected &&
          postTerminalDirectiveAttempt.unchanged &&
          postTerminalDirectiveAttempt.stateCallable)),
    `fork tick ${postTerminalFork.tick}: ${postTerminalFork.detail}; directive ${postTerminalDirective ? `${postTerminalDirective.tick}: ${postTerminalDirective.detail}` : 'not represented by this runtime'}`);
  const frameBundle = exportedFrames(terminalSnapshot.exported);
  const inspectedFrames = frameBundle.frames.map((frame, index) => {
    const state = frameState(frame);
    return state ? { index, state, projection: rawFrameProjection(state) } : null;
  }).filter(Boolean);
  const terminalTick = tickOf(terminalSnapshot.state);
  const historicalFrame = [...inspectedFrames].reverse().find(candidate =>
    Number.isFinite(candidate.projection.tick) &&
    candidate.projection.tick < terminalTick &&
    candidate.projection.agents.length > 0 &&
    candidate.projection.objective.terminalCount > 0 &&
    candidate.projection.povs.length === candidate.projection.agents.length &&
    candidate.projection.povs.some(pov => pov.seen.count > 0));
  requireMeasurement(historicalFrame, 'a complete prior exported frame to inspect');
  await api(policyPage, 'scrub', historicalFrame.index);
  await sleep(100);
  const historicalView = await inspect(policyPage);
  const coherence = historyCoherence(
    historicalView.state,
    historicalFrame.projection,
    historicalView.dom['objective-value']
  );
  const liveMetadata = liveMetadataOf(historicalView.state);
  result('scrubbed state is coherent with its frame while retaining the live head',
    coherence.tickMatch && coherence.outcomeMatch && coherence.agentMatch &&
      coherence.objectiveMatch && coherence.povMatch &&
      liveMetadata && liveMetadata.head === terminalSnapshot.head,
    `frame ${historicalFrame.index}/tick ${historicalFrame.projection.tick}; t:${coherence.tickMatch} o:${coherence.outcomeMatch} a:${coherence.agentMatch} obj:${coherence.objectiveMatch} pov:${coherence.povMatch}; raw ${historicalFrame.projection.objective.hacked}/${historicalFrame.projection.objective.required} c${Number(historicalFrame.projection.objective.coreComplete)} x${historicalFrame.projection.objective.extractedAgents}/${historicalFrame.projection.objective.totalAgents}, public ${coherence.publicObjective.terminalsHacked}/${coherence.publicObjective.terminalsRequired} c${Number(coherence.publicObjective.coreAcquired)} x${coherence.publicObjective.extractedAgents}/${coherence.publicObjective.totalAgents}; live ${liveMetadata?.source || 'missing'}`);

  const terminalRunning = runningImport(terminalSnapshot.exportText);
  const terminalRunningAttempt = await rejectedTransactionalImport(
    policyPage,
    terminalRunning.json,
    historicalView
  );
  const historicalRunning = runningImport(historicalView.exportText);
  const historicalRunningAttempt = await rejectedTransactionalImport(
    policyPage,
    historicalRunning.json,
    historicalView
  );
  await api(policyPage, 'restart', 'running-import-recovery');
  await api(policyPage, 'pause');
  const runningRecoveryBefore = await inspect(policyPage);
  await api(policyPage, 'step', 1);
  const runningRecoveryAfter = await inspect(policyPage);
  result('checksum-valid impossible running modes reject transactionally',
    terminalRunningAttempt.rejected && terminalRunningAttempt.unchanged &&
      terminalRunningAttempt.stateCallable &&
      historicalRunningAttempt.rejected && historicalRunningAttempt.unchanged &&
      historicalRunningAttempt.stateCallable &&
      runningRecoveryAfter.tick - runningRecoveryBefore.tick === 1 &&
      runningRecoveryAfter.frameCount - runningRecoveryBefore.frameCount === 1,
    `terminal ${terminalRunningAttempt.rejected}/${terminalRunningAttempt.unchanged}; history ${historicalRunningAttempt.rejected}/${historicalRunningAttempt.unchanged}; recovery +${runningRecoveryAfter.tick - runningRecoveryBefore.tick}; ${terminalRunningAttempt.feedback || historicalRunningAttempt.feedback}`);

  await api(policyPage, 'setSpeed', 5000);
  await api(policyPage, 'pause');
  const activeRunningBaseline = await inspect(policyPage);
  const activeRunning = runningImport(activeRunningBaseline.exportText);
  const activeRunningOutcome = await tryApi(policyPage, 'importState', activeRunning.json);
  const activeRunningAfter = await inspect(policyPage);
  const activeRunningFlag = activeRunningAfter.state.running === true ||
    activeRunningAfter.state.playing === true ||
    activeRunningAfter.exported?.data?.running === true;
  await api(policyPage, 'pause');
  result('checksum-valid active live-head running import remains valid',
    !activeRunningOutcome.threw && !explicitImportRejection(activeRunningOutcome) &&
      activeRunningFlag &&
      activeRunningAfter.head === activeRunningBaseline.head &&
      activeRunningAfter.frameCount === activeRunningBaseline.frameCount &&
      activeRunningAfter.tick === activeRunningBaseline.tick,
    `running ${activeRunningFlag}; tick ${activeRunningBaseline.tick}→${activeRunningAfter.tick}; frames ${activeRunningBaseline.frameCount}→${activeRunningAfter.frameCount}; checksum ${activeRunning.checksumScope}:${activeRunning.checksumPath}`);
  await policyContext.close();

  const restoredContext = await browser.newContext({
    viewport: { width: 1000, height: 720 },
    storageState: terminalStorageState
  });
  await serve(restoredContext);
  const restoredPage = await navigateHeist(restoredContext, 'restored terminal focus page');
  const restoredIntro = await markIntro(restoredPage);
  requireMeasurement(restoredIntro.found && restoredIntro.ready === false,
    'the pre-ready intro over a restored terminal line');
  let restoredVia = 'storage';
  let restoredPlayDisabledBefore = await restoredPage.locator('#play-toggle').isDisabled();
  if (!restoredPlayDisabledBefore) {
    restoredVia = 'pre-ready import';
    await tryApi(restoredPage, 'importState', terminalSnapshot.exportText);
    await sleep(100);
    restoredPlayDisabledBefore = await restoredPage.locator('#play-toggle').isDisabled();
  }
  await dismissIntro(restoredPage);
  await finishHeistBoot(restoredPage, 'restored terminal focus page');
  const restoredFocus = await focusHandoffState(restoredPage);
  const restoredLine = await inspect(restoredPage, false);
  const restoredPlayDisabledAfter = await restoredPage.locator('#play-toggle').isDisabled();
  result('intro dismissal hands focus to a useful enabled control on active and terminal lines',
    activeLineFocus.useful && restoredFocus.useful &&
      restoredPlayDisabledBefore && restoredPlayDisabledAfter &&
      isTerminalOutcome(topLevelOutcomeOf(restoredLine.state)),
    `${restoredVia}; active ${activeLineFocus.tag}#${activeLineFocus.id} "${activeLineFocus.label}"; terminal ${restoredFocus.tag}#${restoredFocus.id} "${restoredFocus.label}"; play disabled ${restoredPlayDisabledBefore}/${restoredPlayDisabledAfter}`);
  await restoredContext.close();

  const deniedContext = await browser.newContext({ viewport: { width: 900, height: 700 } });
  await deniedContext.addInitScript(() => {
    const denied = () => {
      throw new DOMException('Storage denied by black-box test', 'SecurityError');
    };
    for (const method of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) {
      Object.defineProperty(Storage.prototype, method, {
        configurable: true,
        writable: true,
        value: denied
      });
    }
    Object.defineProperty(Storage.prototype, 'length', { configurable: true, get: denied });
  });
  await serve(deniedContext);
  const deniedPage = await openHeist(deniedContext, 'storage-denied page');
  await api(deniedPage, 'pause');
  const deniedBefore = await inspect(deniedPage);
  await api(deniedPage, 'step', 2);
  const deniedStepped = await inspect(deniedPage);
  await api(deniedPage, 'play');
  const deniedPlayed = await waitForTick(deniedPage, deniedStepped.tick + 1, 7000);
  await api(deniedPage, 'pause');
  const deniedSurface = await deniedPage.evaluate(async () => {
    const state = await Promise.resolve(window.__doggHeist.state());
    return [
      document.getElementById('status-live')?.textContent || '',
      document.getElementById('event-log')?.textContent || '',
      document.body.innerText,
      JSON.stringify(state && (state.persistence || state.storage || state.degraded || ''))
    ].join(' ').replace(/\s+/g, ' ');
  });
  result('storage denial degrades visibly while the game stays playable',
    deniedStepped.tick - deniedBefore.tick === 2 &&
      deniedStepped.frameCount - deniedBefore.frameCount === 2 &&
      deniedPlayed.tick > deniedStepped.tick &&
      /(storage|persist|saving|save).{0,60}(denied|unavailable|disabled|degraded|failed|not available|session|memory)|(?:denied|unavailable|disabled|degraded|failed).{0,60}(storage|persist|saving|save)/i.test(deniedSurface),
    `ticks ${deniedBefore.tick}→${deniedStepped.tick}→${deniedPlayed.tick}; ${deniedSurface.slice(0, 150)}`);
  await deniedContext.close();

  await primaryContext.close();
}

(async () => {
  const started = Date.now();
  let fatal;
  let timeoutHandle;
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error('suite exceeded its 88 second hard deadline')),
      88000
    );
  });
  try {
    await Promise.race([runSuite(), timeout]);
  } catch (error) {
    fatal = error;
    result('suite completed every required measurement', false, error && (error.stack || error.message || error));
  } finally {
    clearTimeout(timeoutHandle);
    if (browser) await browser.close().catch(() => {});
  }

  result('no page errors in any context', pageErrors.length === 0,
    pageErrors.length ? pageErrors.slice(0, 5).join(' | ') : 'zero');
  const elapsed = Date.now() - started;
  result('runtime stays under 90 seconds', elapsed < 90000, `${(elapsed / 1000).toFixed(2)}s`);

  console.log('\nTick Tock DOGG Heist — black-box checks');
  console.log('status  check                                             measurement');
  console.log('------  ------------------------------------------------  ------------------------------');
  for (const check of results) {
    const name = check.name.length > 48 ? `${check.name.slice(0, 47)}…` : check.name;
    const detail = check.detail.replace(/\s+/g, ' ').slice(0, 150);
    console.log(`${check.passed ? 'PASS  ' : 'FAIL  '}  ${name.padEnd(48)}  ${detail}`);
  }
  const failures = results.filter(check => !check.passed);
  console.log(`\n${results.length - failures.length}/${results.length} passed · ${(elapsed / 1000).toFixed(2)}s · root ${ROOT}`);
  if (fatal) console.error(`fatal: ${fatal.message || fatal}`);
  process.exitCode = failures.length ? 1 : 0;
})();

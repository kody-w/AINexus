'use strict';

// Tick Tock DOGG Heist, from the outside. This suite intentionally knows nothing about the
// implementation: it serves the requested repository root at the production origin, opens the
// visible controls, and measures only the DOM and the documented window.__doggHeist contract.
const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

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

function oversizedImport(json) {
  const parsed = JSON.parse(json);
  const convention = findChecksumConvention(parsed);
  const targetBytes = 4 * 1024 * 1024 + 64 * 1024;
  parsed.importPadding = 'x'.repeat(Math.max(1, targetBytes - Buffer.byteLength(json, 'utf8')));
  rewriteChecksum(parsed, convention);
  let output = JSON.stringify(parsed);
  if (Buffer.byteLength(output, 'utf8') <= 4 * 1024 * 1024) {
    parsed.importPadding += 'x'.repeat(128 * 1024);
    rewriteChecksum(parsed, convention);
    output = JSON.stringify(parsed);
  }
  requireMeasurement(Buffer.byteLength(output, 'utf8') > 4 * 1024 * 1024,
    'a bounded import payload just over 4 MiB');
  return {
    json: output,
    bytes: Buffer.byteLength(output, 'utf8'),
    checksumPath: convention.path.join('.')
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

  const intro = await markIntro(page);
  requireMeasurement(intro.found, 'the short-screen intro dialog before dismissal');
  await dismissIntro(page);
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
    pageAfter,
    cardScrolled: cardAfter.scrollTop > card.scrollTop &&
      cardAfter.page === card.page && cardAfter.ready === false,
    pageUnlocked: pageAfter.scrollable &&
      (pageAfter.window > 0 || pageAfter.document > 0)
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
    if (!dialog) return { found: false, label: '' };
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return !element.hidden && !element.disabled &&
        style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    const controls = [...dialog.querySelectorAll(
      'button, [role="button"], input[type="button"], input[type="submit"]'
    )].filter(visible);
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
    if (!ranked.length || ranked[0].score === 0) return { found: false, label: '' };
    ranked[0].control.setAttribute('data-dogg-test-intro-dismiss', 'true');
    return { found: true, label: ranked[0].label };
  });
  requireMeasurement(action.found, 'a visible semantic intro dismissal control');
  await page.locator('[data-dogg-test-intro-dismiss="true"]').click();
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
      eventIntent: measuredWithin(
        '#event-log .intent, #event-log [data-intent], .event-intent'
      ),
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
    if (controlled) candidates.push(document.getElementById(controlled));
    candidates.push(...document.querySelectorAll(
      'dialog, [role="dialog"], [aria-modal="true"], [popover], [id*="help" i], [class*="help" i]'
    ));
    const unique = [...new Set(candidates)].filter(element => element && element !== button);
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
    if (controlled) candidates.push(document.getElementById(controlled));
    candidates.push(...document.querySelectorAll(
      'dialog, [role="dialog"], [aria-modal="true"], [popover], [id*="help" i], [class*="help" i]'
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
      element && element !== helpButton && visible(element))) {
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
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return !element.hidden && !element.disabled &&
        style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    const surfaces = [...document.querySelectorAll(
      'dialog, [role="dialog"], [aria-modal="true"], [popover], [id*="help" i], [class*="help" i]'
    )].filter(visible).filter(element =>
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
  result('short intro card scrolls while the dismissed page unlocks',
    shortIntro.cardScrolled && shortIntro.pageUnlocked,
    `card ${shortIntro.card.scrollTop}→${shortIntro.cardAfter.scrollTop} of ${shortIntro.card.scrollHeight}/${shortIntro.card.clientHeight}; page ${shortIntro.card.page}→${shortIntro.pageAfter.document}`);
  await firstPaintContext.close();

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

  const roundTripVerification = await tryApi(roundTripPage, 'verifyChain');
  result('the imported fresh-context chain still verifies',
    verificationPassed(roundTripVerification),
    verificationPassed(roundTripVerification) ? 'verified' :
      (roundTripVerification.error || JSON.stringify(roundTripVerification.value)));

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
          /\b(too large|oversize|size limit|4\s*(?:mi?b|megabyte)|maximum import|exceeds)\b/i.test(current)) {
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
    tooLarge.bytes > 4 * 1024 * 1024 && tooLarge.bytes < 5 * 1024 * 1024 &&
      oversizeDelay >= 0 && oversizeDelay < 750 &&
      /\b(too large|oversize|size limit|4\s*(?:mi?b|megabyte)|maximum import|exceeds)\b/i.test(oversizeTiming?.text || '') &&
      oversizeAfterExport === oversizeBeforeExport &&
      oversizeAfter.head === oversizeBefore.head &&
      oversizeAfter.frameCount === oversizeBefore.frameCount &&
      oversizeAfter.tick === oversizeBefore.tick &&
      oversizePlayed.tick > oversizeAfter.tick,
    `${(tooLarge.bytes / 1048576).toFixed(2)} MiB; rejected in ${Number.isFinite(oversizeDelay) ? oversizeDelay.toFixed(1) : 'unmeasured'}ms; checksum ${tooLarge.checksumPath}`);

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
    isMobile: true
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
  await mobileContext.close();

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
    const activeSmallText = await scanSmallTextContrast(contrastPage, 'active');
    await api(contrastPage, 'restart', 'ADVERSARY-007');
    await api(contrastPage, 'pause');
    await api(contrastPage, 'setSpeed', 20);
    let completedContrastState = await inspect(contrastPage, false);
    for (let batch = 0;
      batch < 12 && !isTerminalOutcome(topLevelOutcomeOf(completedContrastState.state));
      batch++) {
      await api(contrastPage, 'step', 8);
      completedContrastState = await inspect(contrastPage, false);
    }
    requireMeasurement(isTerminalOutcome(topLevelOutcomeOf(completedContrastState.state)),
      `${scheme} completed representative state for systematic contrast`);
    const completedSmallText = await scanSmallTextContrast(contrastPage, 'completed');
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
    return Object.keys(active.coverage).filter(name => {
      if (name === 'stepMark') return !completed.coverage.stepMark;
      return !active.coverage[name] && !completed.coverage[name];
    }).map(name => `${scheme}:${name}`);
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
  const historicalView = await inspect(policyPage, false);
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

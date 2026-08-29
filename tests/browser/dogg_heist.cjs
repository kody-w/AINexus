'use strict';

// Tick Tock DOGG Heist, from the outside. This suite intentionally knows nothing about the
// implementation: it serves the requested repository root at the production origin, opens the
// visible controls, and measures only the DOM and the documented window.__doggHeist contract.
const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');

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
  const page = await context.newPage();
  watchPage(page, label);
  const response = await page.goto(PAGE_URL, { timeout: 20000, waitUntil: 'domcontentloaded' });
  requireMeasurement(response && response.status() === 200, `${label} HTTP 200`);
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
          output.push({ id, exists: false, visible: false, reachable: false });
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

  const primaryContext = await browser.newContext({
    viewport: { width: 1100, height: 800 },
    acceptDownloads: true
  });
  await serve(primaryContext);
  const page = await openHeist(primaryContext, 'primary cold boot');

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

  const validVerification = await tryApi(page, 'verifyChain');
  result('the honest hash chain verifies',
    verificationPassed(validVerification),
    verificationPassed(validVerification) ? `${different.frameCount} frames` :
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

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
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
  await mobileContext.close();

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

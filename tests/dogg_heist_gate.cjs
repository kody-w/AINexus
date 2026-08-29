#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT = path.join(ROOT, 'dogg-heist.html');
const BROWSER_TEST = path.join(ROOT, 'tests', 'browser', 'dogg_heist.cjs');
const TEMP_PREFIX = '.dogg-heist-gate-';
const BROWSER_TIMEOUT_MS = 180_000;

const REQUIRED_IDS = [
  'play-toggle',
  'step-button',
  'restart-button',
  'speed-select',
  'timeline',
  'fork-button',
  'export-button',
  'import-button',
  'help-button',
  'game-board',
  'pov-grid',
  'status-live',
  'tick-value',
  'branch-value',
  'head-value',
  'alarm-value',
  'objective-value',
  'event-log'
];

const REQUIRED_API_METHODS = [
  'state',
  'play',
  'pause',
  'step',
  'restart',
  'scrub',
  'fork',
  'exportState',
  'importState',
  'queueDirective',
  'verifyChain',
  'setSpeed'
];

const results = [];
const temporaryRoots = new Set();

function oneLine(value, limit = 700) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function record(name, passed, detail = '') {
  const result = { name, passed: Boolean(passed), detail: oneLine(detail) };
  results.push(result);
  console.log(`${result.passed ? 'PASS' : 'FAIL'} ${name}${result.detail ? ` — ${result.detail}` : ''}`);
  return result.passed;
}

function inspectFile(file) {
  try {
    const stat = fs.statSync(file);
    return {
      exists: true,
      regular: stat.isFile(),
      size: stat.size,
      error: ''
    };
  } catch (error) {
    return {
      exists: false,
      regular: false,
      size: 0,
      error: error.message
    };
  }
}

function readText(file) {
  try {
    return { ok: true, text: fs.readFileSync(file, 'utf8'), error: '' };
  } catch (error) {
    return { ok: false, text: '', error: error.message };
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function commandSummary(run) {
  if (run.error) return `could not start: ${run.error.message}`;
  if (run.signal) return `terminated by ${run.signal}`;
  const output = oneLine(`${run.stdout || ''}\n${run.stderr || ''}`, 900);
  return `exit ${run.status}${output ? `; ${output}` : ''}`;
}

function runNodeCheck(file) {
  return spawnSync(process.execPath, ['--check', file], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024
  });
}

function runBrowserTest(candidateRoot) {
  return spawnSync(process.execPath, [BROWSER_TEST], {
    cwd: ROOT,
    env: {
      ...process.env,
      DOGG_HEIST_ROOT: candidateRoot
    },
    encoding: 'utf8',
    timeout: BROWSER_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024
  });
}

function createTemporaryRoot(label) {
  const directory = fs.mkdtempSync(path.join(ROOT, `${TEMP_PREFIX}${label}-`));
  temporaryRoots.add(directory);
  return directory;
}

function removeTemporaryRoot(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
  if (!fs.existsSync(directory)) temporaryRoots.delete(directory);
}

function cleanupTemporaryRoots() {
  const failures = [];
  for (const directory of [...temporaryRoots]) {
    try {
      removeTemporaryRoot(directory);
    } catch (error) {
      failures.push(`${path.basename(directory)}: ${error.message}`);
    }
  }
  return failures;
}

function copyRepository(destinationContainer) {
  const destination = path.join(destinationContainer, 'root');
  const copiedBrowserTest = path.join(destination, 'tests', 'browser', 'dogg_heist.cjs');
  fs.mkdirSync(path.dirname(copiedBrowserTest), { recursive: true });
  fs.copyFileSync(
    ARTIFACT,
    path.join(destination, 'dogg-heist.html'),
    fs.constants.COPYFILE_FICLONE || 0
  );
  fs.copyFileSync(BROWSER_TEST, copiedBrowserTest, fs.constants.COPYFILE_FICLONE || 0);
  return destination;
}

function findTagEnd(source, start) {
  let quote = '';
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }
  return -1;
}

function parseHtml(source) {
  const errors = [];
  const scripts = [];
  const tags = [];
  let cursor = 0;

  while (cursor < source.length) {
    const start = source.indexOf('<', cursor);
    if (start === -1) break;

    if (source.startsWith('<!--', start)) {
      const end = source.indexOf('-->', start + 4);
      if (end === -1) {
        errors.push('unterminated HTML comment');
        break;
      }
      cursor = end + 3;
      continue;
    }

    const end = findTagEnd(source, start);
    if (end === -1) {
      errors.push(`unterminated tag at byte ${start}`);
      break;
    }

    const raw = source.slice(start, end + 1);
    if (/^<![^-]/.test(raw) || /^<\?/.test(raw)) {
      cursor = end + 1;
      continue;
    }

    const match = raw.match(/^<\s*(\/?)\s*([A-Za-z][\w:-]*)([\s\S]*?)>$/);
    if (!match) {
      errors.push(`malformed tag at byte ${start}`);
      cursor = end + 1;
      continue;
    }

    const closing = Boolean(match[1]);
    const name = match[2].toLowerCase();
    const attributes = match[3] || '';
    const selfClosing = !closing && /\/\s*$/.test(attributes);

    if (closing && attributes.trim()) {
      errors.push(`closing </${name}> tag has attributes`);
    }

    if (!closing && !selfClosing && (name === 'script' || name === 'style')) {
      const closePattern = new RegExp(`<\\/\\s*${name}\\s*>`, 'i');
      const remainder = source.slice(end + 1);
      const closeMatch = closePattern.exec(remainder);
      if (!closeMatch) {
        errors.push(`missing </${name}>`);
        break;
      }
      const closeStart = end + 1 + closeMatch.index;
      const closeEnd = closeStart + closeMatch[0].length;
      tags.push({ name, closing: false, attributes, start, end });
      tags.push({ name, closing: true, attributes: '', start: closeStart, end: closeEnd - 1 });
      if (name === 'script') {
        scripts.push({
          attributes,
          content: source.slice(end + 1, closeStart),
          start,
          end: closeEnd
        });
      }
      cursor = closeEnd;
      continue;
    }

    if (selfClosing && (name === 'script' || name === 'style')) {
      errors.push(`<${name}> cannot be self-closing in HTML`);
    }
    tags.push({ name, closing, attributes, start, end });
    cursor = end + 1;
  }

  return { errors, scripts, tags };
}

function validateHtmlStructure(source, parsed) {
  const errors = [...parsed.errors];
  const positions = {};

  for (const name of ['html', 'head', 'body']) {
    const opens = parsed.tags.filter(tag => tag.name === name && !tag.closing);
    const closes = parsed.tags.filter(tag => tag.name === name && tag.closing);
    if (opens.length !== 1 || closes.length !== 1) {
      errors.push(`expected one <${name}> and one </${name}>, found ${opens.length}/${closes.length}`);
    } else {
      positions[name] = { open: opens[0].start, close: closes[0].start };
    }
  }

  if (positions.html && positions.head && positions.body) {
    const ordered =
      positions.html.open < positions.head.open &&
      positions.head.open < positions.head.close &&
      positions.head.close < positions.body.open &&
      positions.body.open < positions.body.close &&
      positions.body.close < positions.html.close;
    if (!ordered) errors.push('<html>, <head>, and <body> are not properly ordered');
  }

  if (source.includes('\u0000')) errors.push('contains a NUL byte');
  return {
    ok: errors.length === 0,
    detail: errors.length ? errors.join('; ') : `${parsed.tags.length} tags and ${parsed.scripts.length} script blocks parsed`
  };
}

function attributeValue(attributes, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = attributes.match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match ? match[2] : null;
}

function validateVisibleIds(parsed) {
  const counts = new Map();
  for (const tag of parsed.tags) {
    if (tag.closing) continue;
    const id = attributeValue(tag.attributes, 'id');
    if (id !== null) counts.set(id, (counts.get(id) || 0) + 1);
  }

  const missing = REQUIRED_IDS.filter(id => !counts.has(id));
  const duplicated = REQUIRED_IDS.filter(id => (counts.get(id) || 0) !== 1 && counts.has(id));
  const errors = [];
  if (missing.length) errors.push(`missing IDs: ${missing.join(', ')}`);
  if (duplicated.length) {
    errors.push(`IDs not unique: ${duplicated.map(id => `${id} (${counts.get(id)})`).join(', ')}`);
  }
  return {
    ok: errors.length === 0,
    detail: errors.length ? errors.join('; ') : `${REQUIRED_IDS.length} required IDs occur exactly once in markup`
  };
}

function apiMemberAppears(source, member) {
  const escaped = member.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [
    new RegExp(`\\.\\s*${escaped}(?![A-Za-z0-9_$])`),
    new RegExp(`\\[\\s*["']${escaped}["']\\s*\\]`),
    new RegExp(`["']${escaped}["']\\s*(?=[:,\\]])`),
    new RegExp(`(?:^|[{,;]\\s*)${escaped}\\s*(?=[:(,}])`, 'm')
  ].some(pattern => pattern.test(source));
}

function validateArtifactApi(source) {
  const errors = [];
  if (!/window\s*\.\s*__doggHeist(?![A-Za-z0-9_$])/.test(source)) {
    errors.push('missing literal window.__doggHeist exposure');
  }
  if (!apiMemberAppears(source, 'ready')) errors.push('missing readiness member "ready"');
  const missing = REQUIRED_API_METHODS.filter(member => !apiMemberAppears(source, member));
  if (missing.length) errors.push(`missing API member tokens: ${missing.join(', ')}`);
  return {
    ok: errors.length === 0,
    detail: errors.length ? errors.join('; ') : `ready plus ${REQUIRED_API_METHODS.length} API methods found`
  };
}

function validateBrowserContract(source) {
  const errors = [];
  if (!/process\s*\.\s*env\s*(?:\.\s*DOGG_HEIST_ROOT|\[\s*["']DOGG_HEIST_ROOT["']\s*\])/.test(source)) {
    errors.push('does not read DOGG_HEIST_ROOT from process.env');
  }
  if (!source.includes('__doggHeist')) errors.push('does not exercise window.__doggHeist');
  if (
    !/\(\s*["'](?:playwright|@playwright\/test)["']\s*\)/.test(source) ||
    !/\b(?:chromium|firefox|webkit)\s*\.\s*launch\s*\(/.test(source)
  ) {
    errors.push('does not launch Playwright itself');
  }
  if (/dogg_heist_gate/.test(source)) errors.push('must not invoke or import the acceptance gate');
  return {
    ok: errors.length === 0,
    detail: errors.length ? errors.join('; ') : 'independent Playwright test names DOGG_HEIST_ROOT'
  };
}

function validateBrowserCoverage(source) {
  const errors = [];
  const missingIds = REQUIRED_IDS.filter(id => !source.includes(id));
  const missingMembers = ['ready', ...REQUIRED_API_METHODS].filter(member => !apiMemberAppears(source, member));
  if (missingIds.length) errors.push(`test omits IDs: ${missingIds.join(', ')}`);
  if (missingMembers.length) errors.push(`test omits API members: ${missingMembers.join(', ')}`);
  if (!/(?:isVisible|toBeVisible|getComputedStyle|checkVisibility|getBoundingClientRect|boundingBox|offset(?:Width|Height)|client(?:Width|Height))/.test(source)) {
    errors.push('test has no explicit visibility measurement');
  }
  return {
    ok: errors.length === 0,
    detail: errors.length
      ? errors.join('; ')
      : `${REQUIRED_IDS.length} IDs, readiness, every API method, and visibility are covered`
  };
}

function scriptType(attributes) {
  return (attributeValue(attributes, 'type') || '').trim().toLowerCase();
}

function hasAttribute(attributes, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s*=|\\s|\\/|$)`, 'i').test(attributes);
}

function validateInlineScripts(parsed) {
  const errors = [];
  const executable = [];

  for (let index = 0; index < parsed.scripts.length; index += 1) {
    const script = parsed.scripts[index];
    const type = scriptType(script.attributes);
    const content = script.content.trim();
    if (!content) continue;

    if (type === 'application/json' || type === 'application/ld+json' || type === 'importmap') {
      try {
        JSON.parse(content);
      } catch (error) {
        errors.push(`script ${index + 1} contains invalid ${type}: ${error.message}`);
      }
      continue;
    }

    const isJavaScript =
      !type ||
      type === 'module' ||
      /(?:java|ecma)script/.test(type);
    if (!isJavaScript || hasAttribute(script.attributes, 'src')) continue;
    executable.push({ index, content, module: type === 'module' });
  }

  if (!executable.length) errors.push('no executable inline JavaScript found');
  if (errors.length) return { ok: false, detail: errors.join('; ') };

  let scratch = '';
  try {
    scratch = createTemporaryRoot('syntax');
    for (const script of executable) {
      const extension = script.module ? 'mjs' : 'cjs';
      const file = path.join(scratch, `inline-${script.index + 1}.${extension}`);
      fs.writeFileSync(file, script.content);
      const run = runNodeCheck(file);
      if (run.error || run.signal || run.status !== 0) {
        errors.push(`inline script ${script.index + 1}: ${commandSummary(run)}`);
      }
    }
  } catch (error) {
    errors.push(`could not syntax-check inline scripts: ${error.message}`);
  } finally {
    if (scratch) {
      try {
        removeTemporaryRoot(scratch);
      } catch (error) {
        errors.push(`could not remove syntax scratch root: ${error.message}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    detail: errors.length ? errors.join('; ') : `${executable.length} executable inline script blocks pass node --check`
  };
}

function replaceMatches(source, pattern, replacement) {
  let count = 0;
  const content = source.replace(pattern, (...args) => {
    count += 1;
    return typeof replacement === 'function' ? replacement(...args) : replacement;
  });
  return { content, count };
}

const mutations = [
  {
    key: 'api-namespace',
    label: 'public API removal mutation',
    mutate(source) {
      const target = /window\s*\.\s*__doggHeist(?![A-Za-z0-9_$])/g;
      const changed = replaceMatches(source, target, 'window.__doggHeistMutation');
      return {
        ...changed,
        valid:
          changed.count > 0 &&
          !/window\s*\.\s*__doggHeist(?![A-Za-z0-9_$])/.test(changed.content),
        detail: `renamed ${changed.count} exact window.__doggHeist reference(s)`
      };
    }
  },
  {
    key: 'timeline-id',
    label: 'timeline ID mutation',
    mutate(source) {
      const target = /(\bid\s*=\s*)(["'])timeline\2/g;
      const changed = replaceMatches(source, target, (whole, prefix, quote) =>
        `${prefix}${quote}timeline-mutated${quote}`);
      return {
        ...changed,
        valid: changed.count === 1 && !target.test(changed.content),
        detail: `renamed ${changed.count} exact timeline id attribute(s)`
      };
    }
  },
  {
    key: 'verify-chain-disabled',
    label: 'chain verification behavior mutation',
    mutate(source) {
      const bodyClose = /<\/body\s*>/gi;
      const matches = [...source.matchAll(bodyClose)];
      if (
        matches.length !== 1 ||
        !/window\s*\.\s*__doggHeist(?![A-Za-z0-9_$])/.test(source) ||
        !apiMemberAppears(source, 'verifyChain')
      ) {
        return {
          content: source,
          count: 0,
          valid: false,
          detail: 'exact </body>, window.__doggHeist, and verifyChain targets were not all present'
        };
      }

      const injection = `
<script data-dogg-heist-gate-mutation="verify-chain-disabled">
(() => {
  'use strict';
  const disabled = function doggHeistVerifyChainDisabledByMutation() {
    throw new Error('DOGG_HEIST_VERIFY_CHAIN_DISABLED_BY_MUTATION');
  };
  const disableVerifyChain = api => {
    if ((typeof api !== 'object' || api === null) && typeof api !== 'function') return api;
    try {
      Object.defineProperty(api, 'verifyChain', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: disabled
      });
    } catch (error) {
      try { api.verifyChain = disabled; } catch (ignored) {}
    }
    return api;
  };
  let current;
  try { current = window.__doggHeist; } catch (error) {}
  try {
    Object.defineProperty(window, '__doggHeist', {
      configurable: true,
      enumerable: true,
      get() { return disableVerifyChain(current); },
      set(value) { current = disableVerifyChain(value); }
    });
  } catch (error) {
    const timer = window.setInterval(() => disableVerifyChain(window.__doggHeist), 0);
    window.setTimeout(() => window.clearInterval(timer), 30000);
  }
  disableVerifyChain(current);
})();
</script>
`;
      const at = matches[0].index;
      const content = `${source.slice(0, at)}${injection}${source.slice(at)}`;
      return {
        content,
        count: 1,
        valid:
          content !== source &&
          content.includes('data-dogg-heist-gate-mutation="verify-chain-disabled"'),
        detail: 'installed one exact runtime override for window.__doggHeist.verifyChain'
      };
    }
  }
];

function exerciseCopiedControl(originalHash, baselinePassed) {
  let directory = '';
  let result = { ok: false, detail: 'control was not run' };
  try {
    directory = createTemporaryRoot('copy-control');
    const copiedRoot = copyRepository(directory);
    const copiedArtifact = fs.readFileSync(path.join(copiedRoot, 'dogg-heist.html'), 'utf8');
    if (sha256(copiedArtifact) !== originalHash) {
      result = { ok: false, detail: 'copied artifact differs before any mutation' };
    } else {
      const run = runBrowserTest(copiedRoot);
      result = {
        ok: baselinePassed && !run.error && !run.signal && run.status === 0,
        detail: baselinePassed
          ? commandSummary(run)
          : `original baseline was not green; copied-root result was ${commandSummary(run)}`
      };
    }
  } catch (error) {
    result = { ok: false, detail: `could not create copied-root control: ${error.message}` };
  } finally {
    if (directory) {
      try {
        removeTemporaryRoot(directory);
      } catch (error) {
        result = { ok: false, detail: `${result.detail}; cleanup failed: ${error.message}` };
      }
    }
  }
  return result;
}

function exerciseMutation(spec, originalSource, originalHash, evidenceControlPassed) {
  let directory = '';
  let application = { ok: false, detail: 'mutation was not applied' };
  let rejection = { ok: false, detail: 'browser test was not run' };

  try {
    directory = createTemporaryRoot(spec.key);
    const copiedRoot = copyRepository(directory);
    const copiedArtifactPath = path.join(copiedRoot, 'dogg-heist.html');
    const copiedSource = fs.readFileSync(copiedArtifactPath, 'utf8');

    if (sha256(copiedSource) !== originalHash || copiedSource !== originalSource) {
      application = { ok: false, detail: 'isolated root was not a faithful copy before mutation' };
      rejection = { ok: false, detail: 'no mutation evidence without a faithful copy' };
    } else {
      const mutation = spec.mutate(copiedSource);
      const changedHash = sha256(mutation.content);
      application = {
        ok:
          mutation.valid &&
          mutation.count > 0 &&
          mutation.content !== copiedSource &&
          changedHash !== originalHash,
        detail: `${mutation.detail}; ${originalHash.slice(0, 12)} → ${changedHash.slice(0, 12)}`
      };

      if (application.ok) {
        fs.writeFileSync(copiedArtifactPath, mutation.content);
        const persisted = fs.readFileSync(copiedArtifactPath, 'utf8');
        if (sha256(persisted) !== changedHash) {
          application = { ok: false, detail: 'mutated artifact did not persist byte-for-byte' };
          rejection = { ok: false, detail: 'browser test not run because mutation did not persist' };
        } else {
          const run = runBrowserTest(copiedRoot);
          rejection = {
            ok:
              evidenceControlPassed &&
              !run.error &&
              !run.signal &&
              Number.isInteger(run.status) &&
              run.status !== 0,
            detail: evidenceControlPassed
              ? commandSummary(run)
              : `green baseline/copy control unavailable; result ${commandSummary(run)} is not mutation evidence`
          };
        }
      } else {
        rejection = { ok: false, detail: 'browser test not run because the exact mutation did not apply' };
      }
    }
  } catch (error) {
    application = { ok: false, detail: `mutation setup failed: ${error.message}` };
    rejection = { ok: false, detail: 'browser test not run because mutation setup failed' };
  } finally {
    if (directory) {
      try {
        removeTemporaryRoot(directory);
      } catch (error) {
        application = { ok: false, detail: `${application.detail}; cleanup failed: ${error.message}` };
        rejection = { ok: false, detail: `${rejection.detail}; cleanup failed: ${error.message}` };
      }
    }
  }

  return { application, rejection };
}

function main() {
  const artifactInfo = inspectFile(ARTIFACT);
  const browserInfo = inspectFile(BROWSER_TEST);

  record(
    'artifact file exists',
    artifactInfo.exists && artifactInfo.regular,
    artifactInfo.exists ? `${artifactInfo.size} bytes` : artifactInfo.error
  );
  record(
    'artifact file is non-empty',
    artifactInfo.exists && artifactInfo.regular && artifactInfo.size > 0,
    `${artifactInfo.size} bytes`
  );
  record(
    'browser test file exists',
    browserInfo.exists && browserInfo.regular,
    browserInfo.exists ? `${browserInfo.size} bytes` : browserInfo.error
  );
  record(
    'browser test file is non-empty',
    browserInfo.exists && browserInfo.regular && browserInfo.size > 0,
    `${browserInfo.size} bytes`
  );

  const artifactRead = artifactInfo.regular && artifactInfo.size > 0
    ? readText(ARTIFACT)
    : { ok: false, text: '', error: 'artifact prerequisite failed' };
  const browserRead = browserInfo.regular && browserInfo.size > 0
    ? readText(BROWSER_TEST)
    : { ok: false, text: '', error: 'browser test prerequisite failed' };

  const parsed = artifactRead.ok
    ? parseHtml(artifactRead.text)
    : { errors: [artifactRead.error], scripts: [], tags: [] };
  const htmlValidation = artifactRead.ok
    ? validateHtmlStructure(artifactRead.text, parsed)
    : { ok: false, detail: artifactRead.error };
  record('artifact HTML syntax is valid', htmlValidation.ok, htmlValidation.detail);

  const inlineValidation = artifactRead.ok
    ? validateInlineScripts(parsed)
    : { ok: false, detail: artifactRead.error };
  record('artifact inline JavaScript syntax is valid', inlineValidation.ok, inlineValidation.detail);

  let browserSyntax = { ok: false, detail: browserRead.error };
  if (browserRead.ok) {
    const run = runNodeCheck(BROWSER_TEST);
    browserSyntax = {
      ok: !run.error && !run.signal && run.status === 0,
      detail: commandSummary(run)
    };
  }
  record('browser test JavaScript syntax is valid', browserSyntax.ok, browserSyntax.detail);

  const visibleValidation = artifactRead.ok
    ? validateVisibleIds(parsed)
    : { ok: false, detail: artifactRead.error };
  record('artifact has the complete visible ID contract', visibleValidation.ok, visibleValidation.detail);

  const apiValidation = artifactRead.ok
    ? validateArtifactApi(artifactRead.text)
    : { ok: false, detail: artifactRead.error };
  record('artifact has the complete public API source contract', apiValidation.ok, apiValidation.detail);

  const browserContract = browserRead.ok
    ? validateBrowserContract(browserRead.text)
    : { ok: false, detail: browserRead.error };
  record('browser test is independent and honors the root contract', browserContract.ok, browserContract.detail);

  const browserCoverage = browserRead.ok
    ? validateBrowserCoverage(browserRead.text)
    : { ok: false, detail: browserRead.error };
  record('browser test names every visible and public surface', browserCoverage.ok, browserCoverage.detail);

  let baseline = { ok: false, detail: 'browser test prerequisite failed' };
  if (browserRead.ok) {
    const run = runBrowserTest(ROOT);
    baseline = {
      ok: !run.error && !run.signal && run.status === 0,
      detail: commandSummary(run)
    };
  }
  record('independent browser baseline exits zero', baseline.ok, baseline.detail);

  const originalSource = artifactRead.text;
  const originalHash = artifactRead.ok ? sha256(originalSource) : '';
  const copiedControl = artifactRead.ok && browserRead.ok
    ? exerciseCopiedControl(originalHash, baseline.ok)
    : { ok: false, detail: 'artifact or browser test prerequisite failed' };
  record('isolated copied-root control stays green', copiedControl.ok, copiedControl.detail);

  for (const spec of mutations) {
    const outcome = artifactRead.ok && browserRead.ok
      ? exerciseMutation(
        spec,
        originalSource,
        originalHash,
        baseline.ok && copiedControl.ok
      )
      : {
        application: { ok: false, detail: 'artifact or browser test prerequisite failed' },
        rejection: { ok: false, detail: 'mutation could not be run' }
      };
    record(`${spec.label} changes the copied artifact`, outcome.application.ok, outcome.application.detail);
    record(`${spec.label} is rejected by the browser test`, outcome.rejection.ok, outcome.rejection.detail);
  }

  const artifactAfter = artifactRead.ok ? readText(ARTIFACT) : { ok: false, text: '', error: artifactRead.error };
  record(
    'mutation runs leave the source artifact unchanged',
    artifactRead.ok && artifactAfter.ok && sha256(artifactAfter.text) === originalHash,
    artifactAfter.ok ? originalHash.slice(0, 12) : artifactAfter.error
  );

  const cleanupFailures = cleanupTemporaryRoots();
  record(
    'temporary gate roots are cleaned',
    cleanupFailures.length === 0 && temporaryRoots.size === 0,
    cleanupFailures.length ? cleanupFailures.join('; ') : 'no temporary roots remain'
  );

  const passed = results.filter(result => result.passed).length;
  const failed = results.length - passed;
  console.log('');
  if (failed === 0) {
    console.log(`PERFECT ${passed}/${results.length}`);
    return 0;
  }
  console.log(`NOT PERFECT ${passed}/${results.length} — ${failed} failed`);
  return 1;
}

try {
  process.exitCode = main();
} catch (error) {
  const cleanupFailures = cleanupTemporaryRoots();
  console.error(`GATE CRASH — ${error && error.stack ? error.stack : error}`);
  if (cleanupFailures.length) {
    console.error(`GATE CRASH CLEANUP — ${cleanupFailures.join('; ')}`);
  }
  const passed = results.filter(result => result.passed).length;
  console.log(`NOT PERFECT ${passed}/${results.length} — gate crash`);
  process.exitCode = 2;
}

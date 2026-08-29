/* run_suites.cjs — run every browser suite and report a number that means something.
 *
 * "21 of 21 suites pass" was not a fact worth having: five of them asserted NOTHING. They printed
 * pages of diagnostics and exited 0 whatever happened, so they counted toward the total while
 * protecting nothing at all. A suite that cannot fail is worse than a missing suite, because the
 * total it inflates is the number people trust.
 *
 * So a suite here fails if it exits non-zero, AND if it produced no checks. Silence is a failure.
 *
 *   node tools/run_suites.cjs            # all of them
 *   node tools/run_suites.cjs tiles forge  # just these
 */
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'tests', 'browser');
const only = process.argv.slice(2);
const suites = fs.readdirSync(DIR).filter(f => f.endsWith('.cjs'))
  .filter(f => !only.length || only.includes(path.basename(f, '.cjs'))).sort();

// Suites word their checks differently — '  ✓ x', '  ok   x', '  ok x'. The first version of this
// required TWO spaces after 'ok' and so reported views_live as SILENT when it has five checks. A
// checker that cries wolf gets ignored, which costs more than the gap it was built to close.
const CHECK = /(^\s*✓\s)|(^\s{2,}ok\s)/gm;
const BAD = /(^\s*✗\s)|(^\s{2,}FAIL\s)/gm;
const results = [];
const run = (f) => {
  try { return { out: execFileSync('node', [path.join(DIR, f)], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 600000 }), code: 0 }; }
  catch (e) { return { out: (e.stdout || '') + (e.stderr || ''), code: e.status == null ? -1 : e.status }; }
};
const judge = (out, code) => {
  const checks = (out.match(CHECK) || []).length;
  const failed = (out.match(BAD) || []).length;
  return { checks, failed, verdict: code !== 0 ? 'EXIT ' + code : failed ? 'RED' : checks === 0 ? 'SILENT' : 'ok' };
};
console.log(`running ${suites.length} suites from tests/browser\n`);
for (const f of suites) {
  const name = path.basename(f, '.cjs');
  const t0 = Date.now();
  let { out, code } = run(f);
  let j = judge(out, code);
  // Ten of these download ~10MB of Pyodide from a CDN, and a sweep runs them back to back. A
  // fetch that times out under that load is weather, not a defect — but hiding a retry would
  // make the sweep lie in the other direction, so a suite that needed one is LABELLED, never
  // silently forgiven. A suite that fails twice is a failure.
  let flaky = false;
  if (j.verdict !== 'ok') {
    const again = run(f);
    const j2 = judge(again.out, again.code);
    if (j2.verdict === 'ok') { flaky = true; out = again.out; j = j2; }
  }
  const secs = Math.round((Date.now() - t0) / 1000);
  results.push({ name, ...j, code, secs, flaky });
  const mark = j.verdict === 'ok' ? (flaky ? '~' : '✓') : '✗';
  console.log(`  ${mark} ${name.padEnd(22)} ${String(j.checks).padStart(3)} checks  ${String(secs).padStart(3)}s  ${j.verdict === 'ok' ? (flaky ? 'passed only on retry' : '') : j.verdict}`);
  if (j.verdict !== 'ok') {
    // Print the TAIL, not a filter. Filtering for /Error/ once reduced a CI failure to the single
    // line "name: 'Error'" — technically a match, and useless. The last lines are where the reason
    // actually is, and a red run nobody can diagnose is barely better than a red run nobody sees.
    const failed = out.split('\n').filter(l => BAD.test(l));
    for (const line of failed.slice(0, 6)) console.log('      ' + line.trim().slice(0, 160));
    // 8 lines of tail is exactly a node stack trace and nothing else, so a suite that printed
    // WHY it was about to fail had that explanation pushed off the end by the trace itself.
    if (!failed.length) for (const line of out.split('\n').filter(l => l.trim()).slice(-30)) console.log('      | ' + line.trim().slice(0, 200));
  }
}
const bad = results.filter(r => r.verdict !== 'ok');
const total = results.reduce((n, r) => n + r.checks, 0);
console.log(`\n${total} checks across ${results.length} suites`);
const silent = results.filter(r => r.verdict === 'SILENT');
if (silent.length) console.log(`${silent.length} asserted nothing: ${silent.map(r => r.name).join(', ')}`);
const flakes = results.filter(r => r.flaky);
if (flakes.length) console.log(`${flakes.length} needed a retry: ${flakes.map(r => r.name).join(', ')}`);
console.log(bad.length ? `\n✗ ${bad.length} suite(s) not ok: ${bad.map(r => r.name + ' (' + r.verdict + ')').join(', ')}`
                       : `\n✓ every suite ran, asserted something, and passed`);
process.exit(bad.length ? 1 : 0);

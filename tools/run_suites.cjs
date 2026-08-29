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

const CHECK = /(^\s*✓ )|(^\s{2,}ok\s )/gm;
const BAD = /(^\s*✗ )|(^\s{2,}FAIL\s )/gm;
const results = [];
console.log(`running ${suites.length} suites from tests/browser\n`);
for (const f of suites) {
  const name = path.basename(f, '.cjs');
  let out = '', code = 0;
  const t0 = Date.now();
  try { out = execFileSync('node', [path.join(DIR, f)], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 600000 }); }
  catch (e) { out = (e.stdout || '') + (e.stderr || ''); code = e.status == null ? -1 : e.status; }
  const checks = (out.match(CHECK) || []).length;
  const failed = (out.match(BAD) || []).length;
  // a suite that asserts nothing is not a passing suite
  const verdict = code !== 0 ? 'EXIT ' + code : failed ? 'RED' : checks === 0 ? 'SILENT' : 'ok';
  results.push({ name, checks, failed, code, verdict, secs: Math.round((Date.now() - t0) / 1000) });
  console.log(`  ${verdict === 'ok' ? '✓' : '✗'} ${name.padEnd(22)} ${String(checks).padStart(3)} checks  ${String(results.at(-1).secs).padStart(3)}s  ${verdict === 'ok' ? '' : verdict}`);
  if (verdict !== 'ok') for (const line of out.split('\n').filter(l => BAD.test(l) || /Error|error:/.test(l)).slice(0, 4)) console.log('      ' + line.trim().slice(0, 150));
}
const bad = results.filter(r => r.verdict !== 'ok');
const total = results.reduce((n, r) => n + r.checks, 0);
console.log(`\n${total} checks across ${results.length} suites`);
const silent = results.filter(r => r.verdict === 'SILENT');
if (silent.length) console.log(`${silent.length} asserted nothing: ${silent.map(r => r.name).join(', ')}`);
console.log(bad.length ? `\n✗ ${bad.length} suite(s) not ok: ${bad.map(r => r.name + ' (' + r.verdict + ')').join(', ')}`
                       : `\n✓ every suite ran, asserted something, and passed`);
process.exit(bad.length ? 1 : 0);

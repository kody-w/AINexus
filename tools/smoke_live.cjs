/* smoke_live.cjs — every published page, on the LIVE origin, with nothing intercepted.
 *
 * The browser suites serve this repo from disk through request interception, which is what makes
 * them fast and deterministic — and it means they cannot see a page that is broken only once it
 * is deployed. This is the other half: load all of them from kody-w.github.io and require a 200,
 * no page error, and no subresource that 404s.
 *
 * It found eight pages fetching a world tree that did not exist — five shipping the literal
 * template placeholder REPO_OWNER = 'yourusername' and two pointing at a repo that was never
 * created. Every visitor got a 404 on every load, their portals had nothing to offer, and nothing
 * anywhere said so, because a failed fetch is not a page error.
 *
 *   node tools/smoke_live.cjs                  # all of them
 *   node tools/smoke_live.cjs learn.html proof.html
 *   ORIGIN=http://localhost:8000 node tools/smoke_live.cjs
 */
const { createRequire } = require('module');
const _req = (() => {
  for (const base of [process.env.PLAYWRIGHT_DIR, require('path').join(process.env.HOME || '', 'Documents/GitHub/aaa-fps')]) {
    if (!base) continue;
    try { const r = createRequire(require('path').join(base, 'package.json')); r.resolve('playwright'); return r; } catch (e) {}
  }
  return require;
})();
const { chromium } = _req('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const ORIGIN = (process.env.ORIGIN || 'https://kody-w.github.io/AINexus').replace(/\/$/, '');
const only = process.argv.slice(2);
const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'))
  .filter(f => !only.length || only.includes(f)).sort();
if (only.length && pages.length !== only.length) {
  console.log('no such page: ' + only.filter(n => !pages.includes(n)).join(', '));
  process.exit(1);
}
(async () => {
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1000, height: 700 } });
const rows = [];
console.log(`${pages.length} pages against ${ORIGIN}\n`);
for (const f of pages) {
  const p = await ctx.newPage();
  const errs = [], bad = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) bad.push(r.status() + '  ' + r.url()); });
  let status = 0;
  try { const r = await p.goto(ORIGIN + '/' + encodeURIComponent(f), { timeout: 45000, waitUntil: 'domcontentloaded' }); status = r ? r.status() : 0; }
  catch (e) { errs.push('NAV: ' + e.message.split('\n')[0]); }
  await p.waitForTimeout(2600);
  rows.push({ f, status, errs: errs.slice(0, 2), bad: [...new Set(bad)].slice(0, 3) });
  await p.close();
}
await b.close();
const broken = rows.filter(r => r.status !== 200 || r.errs.length);
const missing = rows.filter(r => r.bad.length);
console.log(`  200 and no page error          : ${rows.length - broken.length}/${rows.length}`);
console.log(`  pages with a failing subresource: ${missing.length}`);
for (const r of broken) console.log(`\n  ✗ ${r.f}  [${r.status}]\n      ${r.errs.join('\n      ').slice(0, 300)}`);
for (const r of missing) console.log(`\n  ✗ ${r.f}\n      ${r.bad.join('\n      ').slice(0, 300)}`);
// count PAGES, not findings — one page that both fails to load and 404s a subresource is one
// broken page, and reporting it as two is the same small dishonesty as mislabelling a finding
const bads = new Set([...broken, ...missing].map(r => r.f)).size;
console.log(bads ? `\n✗ ${bads} page(s) are broken for real visitors` : '\n✓ every published page loads clean on the live origin');
process.exit(bads ? 1 : 0);
})();

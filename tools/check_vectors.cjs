/* check_vectors.cjs — does this implementation still produce the published bytes?
 *
 * The vectors are the spec's teeth. If WEARING.md and the code ever drift apart, this is what
 * says so — and it diffs whole frames rather than hashes, so a failure tells you WHICH field
 * moved instead of only that something did.
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
const T = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.py':'text/plain' };
(async () => {
const V = JSON.parse(fs.readFileSync(path.join(ROOT, 'WEARING-VECTORS.json'), 'utf8'));
const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.route('https://kody-w.github.io/AINexus/**', r => { const u = new URL(r.request().url());
  const f = path.join(ROOT, decodeURIComponent(u.pathname).replace(/^\/AINexus/, ''));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.fulfill({ status: 404, body: 'no' });
  r.fulfill({ status: 200, contentType: T[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) }); });
const p = await ctx.newPage();
await p.goto('https://kody-w.github.io/AINexus/frontier.html', { timeout: 60000 });
await p.waitForTimeout(2500);

const got = await p.evaluate(async (V) => {
  const H = window.NexusHerd, F = window.NexusFrames;
  // the record is rebuilt from its own contents, so a drift in frame-building shows up too
  const rebuilt = await F.buildFrame({
    kind: V.record.kind, streamId: V.record.stream_id, seq: V.record.seq,
    utc: V.record.utc, prev: V.record.prev, payload: V.record.payload });
  const out = [];
  for (const v of V.vectors) {
    const t = await H.wear(V.record, v.key, { cast: V.roster });
    out.push({ key: v.key, frame: t.frame, octets: t.drawn });
  }
  return { recordHash: rebuilt.frame_hash, tiles: out };
}, V);
await b.close();

let bad = 0;
console.log('record rebuilt from its own contents:',
  got.recordHash === V.record.frame_hash ? 'matches' : 'MOVED — ' + got.recordHash);
if (got.recordHash !== V.record.frame_hash) bad++;
console.log();
for (let i = 0; i < V.vectors.length; i++) {
  const want = V.vectors[i], have = got.tiles[i];
  const w = JSON.stringify(want.tile), h = JSON.stringify(have.frame);
  const key = (want.key || '(empty)');
  if (w === h && want.octets_drawn === have.octets) {
    console.log('  ✓ ' + key);
    continue;
  }
  bad++;
  console.log('  ✗ ' + key);
  if (want.octets_drawn !== have.octets)
    console.log('      octets drawn: expected ' + want.octets_drawn + ', got ' + have.octets);
  // name the field that moved, rather than only the hash
  for (const k of Object.keys(want.tile)) {
    const a = JSON.stringify(want.tile[k]), bq = JSON.stringify(have.frame[k]);
    if (a !== bq) console.log('      ' + k + ':\n        expected ' + String(a).slice(0, 160)
                              + '\n        got      ' + String(bq).slice(0, 160));
  }
}
console.log('\n' + (bad ? '✗ ' + bad + ' of ' + (V.vectors.length + 1) + ' checks failed — WEARING.md and the code have drifted'
                        : '✓ all ' + V.vectors.length + ' vectors reproduce exactly'));
process.exit(bad ? 1 : 0);
})();

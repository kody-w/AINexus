/* make_vectors.cjs — the test vectors for WEARING, produced by the implementation itself.
 *
 * A spec that cannot be checked is an opinion. These are a fixed record, a fixed roster, and a
 * set of keys, with the complete resulting tile for each — so anybody implementing wearing in
 * any language can diff their bytes against ours and know, rather than hope.
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
const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.route('https://kody-w.github.io/AINexus/**', r => { const u = new URL(r.request().url());
  const f = path.join(ROOT, decodeURIComponent(u.pathname).replace(/^\/AINexus/, ''));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.fulfill({ status: 404, body: 'no' });
  r.fulfill({ status: 200, contentType: T[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) }); });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('https://kody-w.github.io/AINexus/frontier.html', { timeout: 60000 });
await p.waitForTimeout(2500);

const out = await p.evaluate(async () => {
  const H = window.NexusHerd, F = window.NexusFrames;
  // THE RECORD. Pinned byte for byte in the spec so every implementation starts from the same
  // place. A body-stream, because a record is an organism's biography.
  const ROSTER = ['ada', 'bo', 'cy', 'del', 'eze'];
  const record = await F.buildFrame({
    kind: 'body.pulse',
    streamId: 'rappid:@kody-w/ainexus:' + '00112233445566778899aabbccddeeff'.repeat(2),
    seq: 0, utc: '2026-01-01T00:00:00.000Z', prev: null,
    payload: { asserts: { note: 'the wearing test record' }, requires: { players: ROSTER } },
  });
  const KEYS = ['0', '1', '7', 'the-night-the-power-went', 'a room with two moons',
                'seven-chairs-six-people', '', 'é-accented-key', '9007199254740991'];
  const tiles = [];
  for (const k of KEYS) {
    const a = await H.wear(record, k, { cast: ROSTER });
    const bb = await H.wear(record, k, { cast: ROSTER });
    tiles.push({ key: k, stable: a.hash === bb.hash, octets_drawn: a.drawn, tile: a.frame });
  }
  return { record, roster: ROSTER, tiles };
});
await b.close();
const vectors = {
  spec: 'wearing/1',
  note: 'wear(record, key) -> tile. Same record + same key = these exact bytes, in any language.',
  produced_by: 'kody-w/AINexus tools/make_vectors.cjs',
  hash_spaces: { particle: 'rapp/1:particle', wave: 'rapp/1:wave' },
  record: out.record,
  roster: out.roster,
  vectors: out.tiles,
};
const f = path.join(ROOT, 'WEARING-VECTORS.json');
fs.writeFileSync(f, JSON.stringify(vectors, null, 1) + '\n');
console.log('record frame_hash :', out.record.frame_hash);
console.log('roster            :', out.roster.join(', '));
console.log('vectors           :', out.tiles.length, '· all stable:', out.tiles.every(t => t.stable));
for (const t of out.tiles) {
  console.log(`  ${JSON.stringify(t.key).padEnd(28)} -> ${t.tile.frame_hash.slice(0,16)}…  ${String(t.octets_drawn).padStart(3)} octets  ${t.tile.payload.asserts.cast.length} in it, ${t.tile.payload.asserts.lens}`);
}
console.log('\n' + path.relative(ROOT, f));
if (errs.length) console.log('page errors:', errs.slice(0,3));
})();

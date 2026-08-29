/* check_spec_tables.cjs — the tables in WEARING.md must match WEARING-VECTORS.json.
 *
 * tools/check_vectors.cjs proves the CODE still produces the published vectors. Nothing proved
 * that the SPEC still describes them: the tables in §8 are hand-written, and a hand-written hash
 * is a hash that can rot. A reader implementing from the document reads the table, not the JSON —
 * so a stale table sends them chasing a hash nothing produces any more.
 *
 *   node tools/check_spec_tables.cjs
 */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const V = JSON.parse(fs.readFileSync(path.join(ROOT, 'WEARING-VECTORS.json'), 'utf8'));
const md = fs.readFileSync(path.join(ROOT, 'WEARING.md'), 'utf8');
let bad = 0, checked = 0;
const ok = (what, cond) => { console.log((cond ? '  ok   ' : '  FAIL ') + what); if (!cond) bad++; checked++; };

// every record hash the document quotes must be a record the vectors actually carry
const records = { [V.record.frame_hash]: 'the five-name record' };
if (V.solo) records[V.solo.record.frame_hash] = 'the single-player record';
for (const [h, label] of Object.entries(records))
  ok(`§8 quotes ${label} (${h.slice(0, 12)}…)`, md.includes(h));

// every row: hash prefix, octet count, cast size, lens and mood must match the tile itself.
// Rows are matched WITHIN their own section: key `0` appears in both tables, and comparing the
// single-player row against the five-name vector is how a checker fools itself.
const ROW = /^\|\s*`([^`]*)`\s*\|\s*`([0-9a-f]{8,})…`\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*([a-z]+)\s*\|\s*([^|]+?)\s*\|$/gm;
const cut = md.indexOf('### The single-player record');
const sections = [
  { name: 'the five-name record', md: cut < 0 ? md : md.slice(0, cut), vectors: V.vectors },
  { name: 'the single-player record', md: cut < 0 ? '' : md.slice(cut), vectors: (V.solo || {}).vectors || [] },
];
let rowCount = 0;
for (const sec of sections) {
  if (!sec.vectors.length) continue;
  const rows = [...sec.md.matchAll(ROW)];
  rowCount += rows.length;
  console.log(`\n${sec.name}: ${rows.length} rows · ${sec.vectors.length} vectors`);
  ok(`every vector in ${sec.name} has a row`, rows.length === sec.vectors.length);
  for (const m of rows) {
    const [, key, hash, octets, present, lens, mood] = m;
    const k = key === '(empty)' ? '' : key;
    const v = sec.vectors.find(x => x.key === k);
    if (!v) { console.log(`  FAIL  row \`${key}\` names a key no vector in this section has`); bad++; checked++; continue; }
    const a = v.tile.payload.asserts;
    const same = v.tile.frame_hash.startsWith(hash) && +octets === v.octets_drawn
      && +present === a.cast.length && lens === a.lens && a.mood.startsWith(mood.replace(/\s+$/, ''));
    ok(`row \`${key}\` matches its vector`, same);
    if (!same) {
      console.log(`        hash    doc ${hash}…  json ${v.tile.frame_hash.slice(0, hash.length)}…`);
      console.log(`        octets  doc ${octets}  json ${v.octets_drawn}`);
      console.log(`        present doc ${present}  json ${a.cast.length}`);
      console.log(`        lens    doc ${lens}  json ${a.lens}`);
      console.log(`        mood    doc ${mood}\n                json ${a.mood}`);
    }
  }
}
const all = [...V.vectors, ...(V.solo ? V.solo.vectors : [])];
ok('no vector is left undocumented', rowCount === all.length);

console.log('\n' + (bad ? `✗ ${bad} of ${checked} checks failed — WEARING.md no longer describes its own vectors`
                        : `✓ all ${checked} checks pass — the document and the vectors agree`));
process.exit(bad ? 1 : 0);

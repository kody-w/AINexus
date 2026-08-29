/* record_proof.cjs — run the claims and keep what happened.
 *
 * Not prose about what the system can do. The system doing it, recorded, with every hash it
 * produced, so a reader can recompute them rather than trust them. The bundle this writes is
 * played by proof.html, which re-verifies the chain in the reader's own browser.
 *
 *   node tools/record_proof.cjs
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
const T = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.webp':'image/webp','.py':'text/plain' };

(async () => {
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1000, height: 640 } });
await ctx.route('https://kody-w.github.io/AINexus/**', r => { const u = new URL(r.request().url());
  const f = path.join(ROOT, decodeURIComponent(u.pathname).replace(/^\/AINexus/, ''));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.fulfill({ status: 404, body: 'no' });
  r.fulfill({ status: 200, contentType: T[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) }); });

// EVERY page reports its errors. This used to listen on the frontier page alone, so the three
// resident pages and the house page could throw all they liked and the footer still read clean.
const errs = [];
ctx.on('page', pg => pg.on('pageerror', e => errs.push(e.message)));
const p = await ctx.newPage();
p.on('pageerror', e => errs.push(e.message));
await p.goto('https://kody-w.github.io/AINexus/frontier.html', { timeout: 60000 });
await p.waitForTimeout(2500);
console.log('running the claims…');

const bundle = await p.evaluate(async () => {
  const H = window.NexusHerd, F = window.NexusFrames, B = window.NexusBrainstem;
  await B.initPyodide(() => {});
  const registry = await (await fetch('state/worlds.json')).json();
  const reg = JSON.stringify(registry);
  const CAST = ['mara', 'devon', 'kit', 'ola'];
  for (const id of CAST) await H.join({ id, persona: 'You are ' + id + '.' });

  const parent = await F.buildFrame({
    // a registered kind on a conformant body-stream: the record is an organism's biography, and
    // 'nexus.ensemble' was never a kind — the registry is exact-match (rapp/1 §6.1.1)
    kind: 'body.pulse', streamId: 'rappid:@kody-w/ainexus:' + 'ab'.repeat(32), seq: 0,
    utc: '2026-08-29T00:00:00.000Z',
    payload: { asserts: { directed: CAST.length, note: 'the one record everything below descends from' },
               requires: { players: CAST } }, prev: null });

  const KEYS = ['the-drowned-hall', 'a-room-with-two-moons', 'nobody-came-back',
                'the-long-night', 'seven-chairs-six-people'];

  // hash the bytes we actually hold, so "checked" means checked
  const sha256 = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(x => x.toString(16).padStart(2, '0')).join('');

  // ── claim 1: a key wears a record into a world, and does it the same way twice ──
  const worlds = [];
  for (const key of KEYS) {
    const t1 = await H.wear(parent, key);
    const t2 = await H.wear(parent, key);
    // PASS 1 tells us which published world this key reaches for. We cannot hash a file before
    // knowing which file it is, and the forge is what chooses — so ask, then go and read it.
    const probe = await H.slosh(t1, [{ lens: 'WorldForge', args: { registry: reg, key } }]);
    const file = probe.tile.provenance.adapted_from_file;
    // PASS 2 hands the forge the hash of the bytes we really fetched. Without this the forge was
    // being asked to verify against nothing, and every world in the recording carried
    // sha256_verified: false under a page that said the bytes had been checked.
    const bytes = new Uint8Array(await (await fetch(file, { cache: 'no-cache' })).arrayBuffer());
    const actual = await sha256(bytes);
    const args = { registry: reg, key, template_sha256: actual };
    const f1 = await H.slosh(t1, [{ lens: 'WorldForge', args }]);
    const f2 = await H.slosh(t2, [{ lens: 'WorldForge', args }]);
    worlds.push({
      key,
      // both runs' hashes travel in the bundle, so the PAGE can assert they agree rather than
      // reading a boolean the recorder decided for it
      tile: { hash: t1.frame.frame_hash, hash2: t2.frame.frame_hash,
              payload_hash: t1.frame.payload_hash, frame: t1.frame },
      world: f1.tile.world,
      cast: t1.cast.map(c => ({ id: c.id, at: c.at, standing: c.standing, where: c.where })),
      mood: f1.tile.mood,
      provenance: f1.tile.provenance,
      source: { file, bytes: bytes.length, sha256: actual },
      forged: { hash: f1.frame.frame_hash, hash2: f2.frame.frame_hash },
      frame: f1.frame,
    });
  }

  // ── claim 2: worlds shape a creature, in order ──
  const creature = { name: 'kit', traits: { reach_milli: 1000, stamina_milli: 1000, trust_milli: 600 } };
  const moon = await H.slosh(await H.wear(parent, 'moon'), [{ lens: 'LensGravity', args: { g: 0.16 } }]);
  const dark = await H.slosh(await H.wear(parent, 'dark'), [{ lens: 'LensDayNight', args: { hour: 'night' } }]);
  const dead = await H.slosh(await H.wear(parent, 'dead'), [{ lens: 'LensCataclysm', args: { degree: 3 } }]);
  const forward = await H.sloshAgent(creature, [moon, dark, dead]);
  const backward = await H.sloshAgent(creature, [dead, dark, moon]);

  // ── claim 3: bytes that fail their hash are refused ──
  // The digest handed over used to be a literal string of zeroes, which meant the heading
  // "bytes that fail their hash are refused" sat above a run in which no bytes were read and no
  // hash was computed. Now: fetch the real template, change one byte of it, hash THAT, and see
  // what the forge does. The number the page prints under "got" is a real digest of real bytes.
  const tam = await H.wear(parent, 'tamper');
  const tamProbe = await H.slosh(tam, [{ lens: 'WorldForge', args: { registry: reg, key: 'tamper' } }]);
  const tamFile = tamProbe.tile.provenance.adapted_from_file;
  const clean = new Uint8Array(await (await fetch(tamFile, { cache: 'no-cache' })).arrayBuffer());
  const altered = new Uint8Array(clean.length + 1);
  altered.set(clean); altered[clean.length] = 0x0a;      // one byte added; nothing else touched
  const alteredHash = await sha256(altered);
  const refused = JSON.parse(await B.callAgent('WorldForge', {
    tile: JSON.stringify(tam.frame.payload.asserts), registry: reg, key: 'tamper',
    template_sha256: alteredHash }));

  return {
    parent, registryCount: registry.count, worlds,
    shaping: { start: creature.traits, forward: forward.organism, backward: backward.organism,
               order: forward.organism.shaped_by.map(s => s.world),
               differs: JSON.stringify(forward.organism) !== JSON.stringify(backward.organism) },
    refusal: { status: refused.status, generator: refused.generator, reason: refused.reason,
               expected: refused.expected_sha256, actual: refused.actual_sha256,
               file: tamFile, cleanBytes: clean.length, alteredBytes: altered.length },
    cost: H.cost(),
  };
});

// ── claim 4: the residents are really there, and the cameras see them ──
console.log('recording the house…');
const stills = [];
const holoPages = [];
for (let i = 0; i < 3; i++) {
  const q = await ctx.newPage();
  await q.goto('https://kody-w.github.io/AINexus/index.html#as=' + encodeURIComponent('🤖 ' + ['mara','devon','kit'][i]), { timeout: 60000 });
  await q.addScriptTag({ url: 'https://kody-w.github.io/AINexus/ai/holo.js' });
  await q.waitForTimeout(900);
  await q.evaluate((k) => {
    const w = window.worldNavigator; if (w && w.camera) w.camera.position.set([-3,2,9][k], 2, [1,3,-6][k]);
    window.NexusHolo.publish({ id: ['mara','devon','kit'][k], name: ['mara','devon','kit'][k] });
  }, i);
  holoPages.push(q);
}
const h = await ctx.newPage();
await h.goto('https://kody-w.github.io/AINexus/house.html', { timeout: 60000 });
await h.waitForFunction(() => window.__houseReady && window.__houseReady(), null, { timeout: 45000 }).catch(() => {});
await h.waitForTimeout(5000);
const seen = await h.evaluate(() => {
  const w = document.getElementById('world').contentWindow;
  return { survey: w.NexusCams.survey().map(s => ({ name: s.name, score: s.score, people: s.people.map(p => p.name) })),
           residents: w.NexusHolo.present().map(p => ({ name: p.name, painted: p.painted })) };
});
const outDir = path.join(ROOT, 'proof', 'latest');
fs.mkdirSync(outDir, { recursive: true });
for (let i = 0; i < 3; i++) {
  await h.waitForTimeout(1400);
  const f = 'house-' + i + '.png';
  await h.screenshot({ path: path.join(outDir, f) });
  stills.push(f);
}
await b.close();

const proof = Object.assign({ recorded: new Date().toISOString(), house: seen, stills, pageErrors: errs.slice(0, 5) }, bundle);
fs.writeFileSync(path.join(outDir, 'proof.json'), JSON.stringify(proof, null, 1));
console.log(`\n${proof.worlds.length} worlds forged from spoken keys`);
for (const w of proof.worlds) console.log(`  ${w.key.padEnd(24)} -> ${String(w.world.called).padEnd(16)} from ${w.provenance.adapted_from_file}  ${w.provenance.sha256_verified ? 'bytes verified' : 'UNVERIFIED'}`);
const verified = proof.worlds.filter(w => w.provenance.sha256_verified).length;
console.log(`\nbytes verified: ${verified}/${proof.worlds.length}`);
console.log(`refusal: ${proof.refusal.status} (${proof.refusal.file}, ${proof.refusal.cleanBytes} -> ${proof.refusal.alteredBytes} bytes)`);
console.log(`cameras: ${seen.survey.length}, residents painted: ${seen.residents.filter(r => r.painted).length}/${seen.residents.length}`);
console.log(`  ${path.relative(ROOT, path.join(outDir, 'proof.json'))}`);
})();

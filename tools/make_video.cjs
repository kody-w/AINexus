/* make_video.cjs — turn a recording into a video: everyone's view at once, focus moving around.
 *
 * Plays views.html against a manifest, screenshots it at a steady rate, and hands the frames to
 * ffmpeg. The layout, the magnification and the rotation all happen in the page, because a
 * browser is a better compositor than a filtergraph and the result is the same thing a person
 * would see if they opened it.
 *
 *   node tools/make_video.cjs [--manifest recordings/latest/manifest.json] [--seconds 24] [--fps 12] [--hold 2400]
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
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.webp':'image/webp','.py':'text/plain' };
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const MANIFEST = arg('manifest', 'recordings/latest/manifest.json');
const SECONDS = +arg('seconds', 20), FPS = +arg('fps', 12), HOLD = +arg('hold', 2400);
const OUT = arg('out', path.join(ROOT, 'recordings', 'views.mp4'));

(async () => {
const shotDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'nexus-video-'));
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await ctx.route('https://kody-w.github.io/AINexus/**', r => {
  const u = new URL(r.request().url());
  const f = path.join(ROOT, decodeURIComponent(u.pathname).replace(/^\/AINexus/, ''));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.fulfill({ status: 404, body: 'no' });
  r.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
});
const p = await ctx.newPage();
const url = 'https://kody-w.github.io/AINexus/views.html?manifest=' + encodeURIComponent(MANIFEST)
          + '&hold=' + HOLD + '&fps=' + Math.max(4, Math.round(FPS / 2)) + '&live=0&loop=1';
await p.goto(url, { timeout: 45000 });
await p.waitForFunction(() => window.__viewsReady, null, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(700);

const total = SECONDS * FPS;
console.log(`capturing ${total} frames…`);
const seen = new Set();
for (let i = 0; i < total; i++) {
  const f = path.join(shotDir, String(i).padStart(5, '0') + '.png');
  await p.screenshot({ path: f });
  const who = await p.evaluate(() => document.getElementById('who').textContent).catch(() => '');
  if (who) seen.add(who);
  await p.waitForTimeout(Math.max(0, 1000 / FPS - 55));
  if (i % (FPS * 4) === 0) process.stdout.write('  ' + i + '/' + total + '\r');
}
await b.close();
console.log('\nfocus visited: ' + [...seen].join(', '));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
execFileSync('ffmpeg', ['-y', '-framerate', String(FPS), '-i', path.join(shotDir, '%05d.png'),
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', OUT],
  { stdio: ['ignore', 'ignore', 'pipe'] });
const mb = (fs.statSync(OUT).size / 1048576).toFixed(2);
console.log(`${OUT}  (${mb}MB, ${SECONDS}s @ ${FPS}fps)`);
fs.rmSync(shotDir, { recursive: true, force: true });
})();

// shared gate: load a world page headlessly, fail on page errors, screenshot it
import http from 'http'; import fs from 'fs'; import path from 'path';
import { chromium } from 'playwright';
const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('usage: node tools-verify.mjs <file.html>'); process.exit(2); }
const srv = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]); if (u === '/') u = '/' + file;
  fs.readFile(path.join(process.cwd(), u), (e, d) => { if (e) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': u.endsWith('.html') ? 'text/html' : 'application/json' }); res.end(d); });
});
srv.listen(0, '127.0.0.1', async () => {
  const port = srv.address().port;
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  pg.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
  await pg.route('https://raw.githubusercontent.com/kody-w/AINexus/main/**', route => {
    const rel = route.request().url().split('/main/')[1].split('?')[0];
    route.fulfill({ path: path.join(process.cwd(), decodeURIComponent(rel)), contentType: 'application/json' }).catch(() => route.abort());
  });
  await pg.goto(`http://127.0.0.1:${port}/${encodeURIComponent(file)}`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  await pg.waitForTimeout(5000);
  await pg.screenshot({ path: `shot-${file.replace(/[^a-z0-9]/gi, '_')}.png` });
  console.log(JSON.stringify({ file, pageErrors: errors, ok: errors.length === 0 }));
  await b.close(); srv.close(); process.exit(errors.length === 0 ? 0 : 1);
});

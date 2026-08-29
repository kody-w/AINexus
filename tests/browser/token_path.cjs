// Where the credential goes. `ai/copilot_auth.js` holds a visitor's own GitHub token and the
// Copilot token minted from it, and hands thoughts — not credentials — to the players. This
// suite is the trace of that token: every address it is carried to, every string it could be
// printed into, and every state the flow is allowed to claim it is in.
//
// NOTHING HERE COMPLETES A SIGN-IN AND NOTHING HERE IS A REAL TOKEN. `copilot_auth.cjs` is the
// live half — it knocks once on the real door and asserts only that the page handles whichever
// answer it gets, because that door is rate-limited and belongs to somebody else. This half is
// the opposite: the door is replaced by a stub inside the page, so every answer a real door can
// give — a refusal with a 200, a 429 of HTML, a slow_down, a 401 mid-session — can be held still
// and asserted flatly, and the live endpoint is never touched at all. The two fake tokens below
// are strings shaped like credentials so that the "did it leak" checks are not vacuous; neither
// has ever been a credential.
//
// The four questions it answers:
//   1. does the token ever reach a URL, a log, an error, the DOM — anywhere but a header?
//   2. can the destination it is carried to be chosen by anything other than this file?
//   3. does the flow ever claim a state it is not in?
//   4. when the credential dies mid-session, does that surface once, or loop against a live door?
//
// Resolve playwright from wherever it actually lives (see copilot_auth.cjs — NODE_PATH alone
// finds `playwright` but not the `playwright-core` it requires).
const { createRequire } = require('module');
const _req = (() => {
  for (const base of [process.env.PLAYWRIGHT_DIR,
                      require('path').join(process.env.HOME || '', 'Documents/GitHub/aaa-fps')]) {
    if (!base) continue;
    try { const r = createRequire(require('path').join(base, 'package.json')); r.resolve('playwright'); return r; }
    catch (e) {}
  }
  return require;
})();
const { chromium } = _req('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const T = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css' };
let pass = 0, fail = 0;
const ok = (what, cond) => { console.log((cond ? '  ✓ ' : '  ✗ ') + what); cond ? pass++ : fail++; };

// Shaped like credentials, and never one. If either of these strings turns up in a URL, a log
// line, an error or the document, the module put it there.
const FAKE_GHU = 'ghu_thisIsNotACredential000000000000000000';
const FAKE_CPT = 'tid=notacredential;exp=1;sku=none;sig=notasignature';
// The address a hostile value would want the token sent to. Nothing dials it; it only ever has
// to be absent from every URL the page builds.
const STRANGER = 'someone-elses.example';

// A page that is nothing but the module under test — the real frontier boots a world, a camera
// and a peer room, none of which has anything to do with where a token goes.
const HARNESS = '/AINexus/__token_path_probe.html';
const HARNESS_HTML = '<!doctype html><meta charset="utf-8"><title>token path probe</title>'
                   + '<script src="ai/copilot_auth.js"></script>';

(async () => {
const b = await chromium.launch();
// The production origin, because that is the origin whose localStorage the estate shares.
const ctx = await b.newContext({ viewport: { width: 900, height: 600 } });
await ctx.route('https://kody-w.github.io/AINexus/**', r => {
  const u = new URL(r.request().url());
  if (decodeURIComponent(u.pathname) === HARNESS) return r.fulfill({ status:200, contentType:'text/html', body:HARNESS_HTML });
  const f = path.join(ROOT, decodeURIComponent(u.pathname).replace(/^\/AINexus/, ''));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.fulfill({ status:404, body:'no' });
  r.fulfill({ status:200, contentType:T[path.extname(f)]||'application/octet-stream', body:fs.readFileSync(f) });
});
const p = await ctx.newPage();
const errs = [], logged = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => logged.push(m.type() + ' ' + m.text()));
// Belt and braces: if anything actually left the browser, this records it. Nothing should.
const escaped = [];
p.on('request', r => { if (!r.url().startsWith('https://kody-w.github.io/')) escaped.push(r.url()); });

await p.goto('https://kody-w.github.io' + HARNESS, { timeout: 45000 });
await p.waitForFunction(() => !!window.NexusAuth, null, { timeout: 15000 });

// ── the door, replaced ───────────────────────────────────────────────────
// Every answer below is one a real device/token/chat endpoint gives. `window.__mode` chooses
// which; `window.__net` is the receipt of everything the module tried to send, headers included,
// which is the only way to prove where a token did and did not travel.
await p.evaluate(({ ghu, cpt, stranger }) => {
  window.__net = []; window.__mode = 'pending'; window.__endpoint = 'https://api.individual.githubcopilot.com';
  window.__ghu = ghu; window.__cpt = cpt; window.__stranger = stranger;
  window.fetch = async (url, init) => {
    const u = String(url), o = init || {};
    window.__net.push({ url: u, method: o.method || 'GET',
                        headers: JSON.parse(JSON.stringify(o.headers || {})),
                        body: typeof o.body === 'string' ? o.body : '' });
    const M = window.__mode;
    let r = { status: 404, body: 'no such door' };
    if (/\/api\/auth\/device$/.test(u)) {
      r = M === 'nocode'
        ? { status: 200, body: '{"error":"device_flow_disabled","error_description":"this app cannot start a device flow"}' }
        : { status: 200, body: JSON.stringify({ device_code:'DEV-NOT-REAL', user_code:'WXYZ-1234',
              verification_uri:'https://github.com/login/device', interval:5, expires_in:900 }) };
    } else if (/\/api\/auth\/device\/poll$/.test(u)) {
      r = M === 'slowdown'  ? { status: 200, body: '{"error":"slow_down","interval":30}' }
        : M === 'ratelimit' ? { status: 429, body: '<html><head><title>429</title></head><body>Too Many Requests</body></html>' }
        : { status: 200, body: '{"error":"authorization_pending"}' };
    } else if (/\/api\/copilot\/token$/.test(u)) {
      r = M === '401'  ? { status: 401, body: 'Bad credentials' }
        : M === '403'  ? { status: 403, body: 'no Copilot subscription for this account' }
        // an upstream that echoes the request back inside its error, which is how a credential
        // gets into a log without anybody ever writing a line that prints one
        : M === 'echo' ? { status: 500, body: 'upstream refused the request {"authorization":"Bearer ' + ghu + '"}' }
        : { status: 200, body: JSON.stringify({ token: cpt, endpoints: { api: window.__endpoint },
                                                expires_at: Math.floor(Date.now()/1000) + 600 }) };
    } else if (/\/api\/copilot\/chat/.test(u)) {
      r = { status: 200, body: JSON.stringify({ choices: [{ message: { content: 'a thought' } }] }) };
    }
    const body = String(r.body);
    return { ok: r.status >= 200 && r.status < 300, status: r.status,
             text: async () => body, json: async () => JSON.parse(body) };
  };
  window.__plant = (s) => localStorage.setItem('rapp_settings', JSON.stringify(s));
  window.__signedIn = (extra) => window.__plant(Object.assign(
    { ghuToken: window.__ghu, copilotToken: window.__cpt, copilotExpiresAt: Date.now() + 600000,
      copilotEndpoint: 'https://api.individual.githubcopilot.com' }, extra || {}));
}, { ghu: FAKE_GHU, cpt: FAKE_CPT, stranger: STRANGER });

// ── 1. the destination, under everything that can be stored in the shared key ────────────────
// `rapp_settings` is one key shared by every tool on this origin, and `copilotEndpoint` is the
// host the worker is told to hand the thought — and therefore the seat — on to. Whatever is in
// that slot, the address this file builds must still be Copilot's.
const dest = await p.evaluate(() => {
  const cases = [
    ['https://api.individual.githubcopilot.com',      'the ordinary individual seat'],
    ['https://api.business.githubcopilot.com',        'a business seat'],
    ['https://api.enterprise.githubcopilot.com/v1',   'an enterprise seat with a path'],
    ['https://' + window.__stranger,                  'a host that is simply not Copilot'],
    ['http://api.individual.githubcopilot.com',       'the right host, downgraded to plain http'],
    ['https://api.githubcopilot.com.' + window.__stranger, 'a name that only STARTS like Copilot'],
    ['https://not-githubcopilot.com',                 'a name that ends with the right letters'],
    ['https://api.githubcopilot.com@' + window.__stranger, 'Copilot parked in front of a stranger'],
    ['//' + window.__stranger,                        'no scheme at all'],
    ['',                                              'nothing'],
    [null,                                            'null'],
    [{ toString() { return 'https://' + window.__stranger; } }, 'an object that stringifies to a host'],
  ];
  const out = [];
  for (const [ep, what] of cases) {
    window.__signedIn({ copilotEndpoint: ep });
    const u = window.NexusAuth.chatUrl();
    out.push({ what, stored: String(ep), url: u,
               endpoint: new URL(u).searchParams.get('endpoint'),
               toWorker: u.indexOf(window.NexusAuth.AUTH_WORKER_URL + '/api/copilot/chat?') === 0 });
  }
  return out;
});
console.log('1. the address the token is carried to, per stored endpoint:');
for (const d of dest) console.log('   ' + (d.what + ' ').padEnd(42, '·') + ' ' + d.endpoint);
const copilotHost = (u) => { try { const h = new URL(u); return h.protocol === 'https:' &&
  (h.hostname === 'githubcopilot.com' || h.hostname.endsWith('.githubcopilot.com')); } catch (e) { return false; } };

// ── 2. a whole turn of thought, and the receipt for it ───────────────────────────────────────
const turn = await p.evaluate(async () => {
  window.__mode = 'ok'; window.__net = [];
  window.__signedIn({ copilotEndpoint: 'https://' + window.__stranger });   // planted by "another tool"
  const said = await window.NexusAuth.chat([{ role: 'user', content: 'hello' }]);
  return { said, net: window.__net };
});
console.log('2. one thought, one request  :', turn.net.map(n => n.method + ' ' + n.url.split('?')[0]).join(', '));

// the exchange leg: a stale copilot token, so the ghu_ itself has to travel
const mint = await p.evaluate(async () => {
  window.__mode = 'ok'; window.__net = [];
  window.__endpoint = 'https://' + window.__stranger;      // the WORKER proposes a hostile host
  window.__signedIn({ copilotToken: null, copilotExpiresAt: 0 });
  const tok = await window.NexusAuth.ensureToken();
  return { got: tok === window.__cpt, net: window.__net,
           stored: JSON.parse(localStorage.getItem('rapp_settings')).copilotEndpoint };
});
console.log('   minting a chat token      :', mint.net.map(n => n.method + ' ' + n.url.split('?')[0]).join(', '));
console.log('   the worker offered        :', 'https://' + STRANGER, '→ stored:', mint.stored);

// everything the page tried to send, across both legs, flattened for the leak checks
const everySent = turn.net.concat(mint.net);
const inUrl = everySent.some(n => n.url.includes(FAKE_GHU) || n.url.includes(FAKE_CPT)
                               || /ghu_|tid=/.test(n.url));
const inBody = everySent.some(n => n.body.includes(FAKE_GHU) || n.body.includes(FAKE_CPT));
const authHeaders = everySent.map(n => String(n.headers.Authorization || n.headers.authorization || ''));
const offOrigin = everySent.filter(n => n.url.indexOf('https://rapp-auth.kwildfeuer.workers.dev/') !== 0);

// ── 3. an error that carries a credential back ───────────────────────────────────────────────
const echoed = await p.evaluate(async () => {
  window.__mode = 'echo'; window.__signedIn({ copilotToken: null, copilotExpiresAt: 0 });
  try { await window.NexusAuth.ensureToken(); return { threw: false, message: '' }; }
  catch (e) { return { threw: true, message: e.message }; }
});
console.log('3. an upstream error echoing the request back:', JSON.stringify(echoed.message));

// ── 4. the flow's own honesty ────────────────────────────────────────────────────────────────
const start = await p.evaluate(async () => {
  const out = {};
  window.__mode = 'nocode';
  try { const r = await window.NexusAuth.startDeviceLogin(); out.refusal = { threw: false, got: JSON.stringify(r) }; }
  catch (e) { out.refusal = { threw: true, message: e.message }; }
  window.__mode = 'pending';
  try { const r = await window.NexusAuth.startDeviceLogin(); out.good = { threw: false, code: r.user_code, interval: r.interval }; }
  catch (e) { out.good = { threw: true, message: e.message }; }
  return out;
});
console.log('4. a 200 that carries no code:', JSON.stringify(start.refusal));
console.log('   a 200 that carries one    :', JSON.stringify(start.good));

// ── 5. the poll, against a door that is a third party with a clock ───────────────────────────
// A caller with its own timer cannot hear `slow_down`. So: twelve polls in a tight loop, and
// then a slow_down, and then twelve more. The receipt says how many times the door was knocked.
const gate = await p.evaluate(async () => {
  const knocks = () => window.__net.filter(n => /\/api\/auth\/device\/poll$/.test(n.url)).length;
  const out = {};
  window.__mode = 'pending'; window.__net = [];
  await window.NexusAuth.startDeviceLogin();
  const rapid = [];
  for (let i = 0; i < 12; i++) rapid.push(await window.NexusAuth.pollDeviceLogin());
  out.rapid = { knocks: knocks(), allNull: rapid.every(x => x === null) };
  await new Promise(r => setTimeout(r, 4500));            // longer than the stated interval
  await window.NexusAuth.pollDeviceLogin();
  out.afterTheWait = knocks();                            // the gate is a wait, not a wall

  window.__mode = 'slowdown'; window.__net = [];
  await window.NexusAuth.startDeviceLogin();
  await new Promise(r => setTimeout(r, 4500));
  await window.NexusAuth.pollDeviceLogin();               // this one is told to slow down
  const afterSlow = knocks();
  const more = [];
  for (let i = 0; i < 12; i++) more.push(await window.NexusAuth.pollDeviceLogin());
  await new Promise(r => setTimeout(r, 4500));            // past the ORIGINAL interval
  more.push(await window.NexusAuth.pollDeviceLogin());
  out.slowDown = { knocksAtOnce: afterSlow, knocksAfter: knocks(), alive: more.every(x => x === null) };
  return out;
});
console.log('5. twelve polls in a tight loop knocked', gate.rapid.knocks, 'time(s); after the interval,', gate.afterTheWait);
console.log('   after a slow_down: ' + gate.slowDown.knocksAtOnce + ' knock(s), then thirteen more polls →',
            gate.slowDown.knocksAfter, 'knock(s)');

// ── 6. a 429 of HTML, which is what a proxy under load actually returns ──────────────────────
const weather = await p.evaluate(async () => {
  window.__mode = 'ratelimit'; window.__net = [];
  await window.NexusAuth.startDeviceLogin();
  await new Promise(r => setTimeout(r, 4500));
  try { const r = await window.NexusAuth.pollDeviceLogin(); return { threw: false, got: r }; }
  catch (e) { return { threw: true, message: e.message }; }
});
console.log('6. a 429 carrying HTML       :', JSON.stringify(weather));

// ── 7. the credential dies mid-session ───────────────────────────────────────────────────────
const revoked = await p.evaluate(async () => {
  window.__mode = '401'; window.__net = [];
  window.__signedIn({ copilotToken: null, copilotExpiresAt: 0 });
  const before = window.NexusAuth.hasToken();
  let first = '';
  try { await window.NexusAuth.chat([{ role: 'user', content: 'hi' }]); } catch (e) { first = e.message; }
  const knocksAfterFirst = window.__net.length;
  const after = [];
  for (let i = 0; i < 5; i++) { try { await window.NexusAuth.chat([{ role: 'user', content: 'hi' }]); after.push('(no throw)'); }
                                catch (e) { after.push(e.message); } }
  return { before, first, after, held: window.NexusAuth.hasToken(), still: window.NexusAuth.signedIn(),
           knocksAfterFirst, knocksTotal: window.__net.length,
           left: JSON.parse(localStorage.getItem('rapp_settings') || '{}') };
});
console.log('7. a token revoked mid-session:', JSON.stringify(revoked.first));
console.log('   five more thoughts after it:', JSON.stringify(revoked.after[0]), '· knocks on the live door:',
            revoked.knocksTotal - revoked.knocksAfterFirst);

const seat = await p.evaluate(async () => {
  window.__mode = '403'; window.__signedIn({ copilotToken: null, copilotExpiresAt: 0 });
  const hadOne = window.NexusAuth.hasToken();
  let msg = ''; try { await window.NexusAuth.ensureToken(); } catch (e) { msg = e.message; }
  return { hadOne, msg, held: window.NexusAuth.hasToken() };
});
console.log('   an account with no Copilot :', JSON.stringify(seat.msg));

// holding a credential is not being signed in — the module says so in a comment, so make it true
const honesty = await p.evaluate(async () => {
  window.__mode = '401'; window.__signedIn({ copilotToken: null, copilotExpiresAt: 0 });
  const claimed = window.NexusAuth.hasToken();
  const truth = await window.NexusAuth.verify();
  return { claimed, truth, after: window.NexusAuth.hasToken() };
});
console.log('   hasToken', honesty.claimed, '· verify', honesty.truth, '· hasToken after', honesty.after);

// ── 8. everywhere a credential could have been left behind ───────────────────────────────────
const residue = await p.evaluate(() => ({
  dom: document.documentElement.outerHTML,
  attrs: [...document.querySelectorAll('*')].map(e => [...e.attributes].map(a => a.value).join(' ')).join(' '),
}));
const leakedToDom = residue.dom.includes(FAKE_GHU) || residue.dom.includes(FAKE_CPT)
                 || residue.attrs.includes(FAKE_GHU) || residue.attrs.includes(FAKE_CPT);
const leakedToConsole = logged.some(l => l.includes(FAKE_GHU) || l.includes(FAKE_CPT));
const leakedToError = errs.some(e => e.includes(FAKE_GHU) || e.includes(FAKE_CPT));

console.log('\nchecks:');
// 1 — the destination
ok('every chat URL is the worker in this file and nothing else',
   dest.length === 12 && dest.every(d => d.toWorker));
ok('and every endpoint it names is a Copilot host over https, whatever was in the shared key',
   dest.every(d => copilotHost(d.endpoint)));
ok('a stranger\'s host in `rapp_settings` never reaches the address bar — not as a host, a suffix, a '
   + 'prefix, a userinfo or a scheme-less string',
   dest.every(d => !d.url.includes(STRANGER)));
ok('the check is a filter and not a wall: a real business seat and an enterprise seat survive it',
   dest[1].endpoint === 'https://api.business.githubcopilot.com'
   && dest[2].endpoint === 'https://api.enterprise.githubcopilot.com/v1');

// 2 — where the token actually went
ok('a thought is one request, and it goes to the worker origin only',
   turn.net.length === 1 && offOrigin.length === 0 && turn.said === 'a thought');
ok('the credential travelled in an Authorization header — so the next check is not vacuous',
   authHeaders.includes('Bearer ' + FAKE_CPT) && authHeaders.includes('Bearer ' + FAKE_GHU));
ok('and appears in no URL: not the path, not the query, nowhere history or a referrer would keep it', !inUrl);
ok('and in no request body', !inBody);
ok('nothing at all left this origin except to the worker', escaped.length === 0);
ok('an endpoint the WORKER proposes is checked too — a hostile one is not written into the shared key',
   mint.got === true && copilotHost(mint.stored) && !String(mint.stored).includes(STRANGER));

// 3 — errors
ok('a credential echoed back inside an upstream error is scrubbed before it becomes a message',
   echoed.threw && !echoed.message.includes(FAKE_GHU) && echoed.message.includes('[redacted]'));

// 4 — the flow's honesty
ok('a 200 carrying a refusal instead of a code is a refusal, not a code — so no panel can open on `undefined`',
   start.refusal.threw === true && /device flow|device_flow/i.test(start.refusal.message));
ok('and a 200 that does carry a code still starts the flow', start.good.threw === false
   && /^[A-Z0-9]{3,8}-[A-Z0-9]{3,8}$/.test(String(start.good.code)) && start.good.interval === 5);

// 5 — the third party's clock
ok('twelve polls in a tight loop knock on the live door exactly once', gate.rapid.knocks === 1 && gate.rapid.allNull);
ok('the gate is a wait and not a wall: past the interval, the next poll goes through', gate.afterTheWait === 2);
ok('a slow_down widens the wait rather than being ignored — thirteen further polls, and past the '
   + 'ORIGINAL interval, still no second knock',
   gate.slowDown.knocksAtOnce === 1 && gate.slowDown.knocksAfter === 1 && gate.slowDown.alive);

// 6 — weather
ok('a 429 of HTML is weather: the flow keeps waiting instead of dying on a JSON parse',
   weather.threw === false && weather.got === null);

// 7 — death and revocation
ok('a revoked credential surfaces once, in words a person can act on',
   /sign-in expired/.test(revoked.first));
ok('and is cleared, so nothing is left looking capable and unable to think',
   revoked.held === false && revoked.still === false && !revoked.left.ghuToken && !revoked.left.copilotToken);
ok('five more thoughts after it die locally — the live door is not knocked on again',
   revoked.knocksTotal === revoked.knocksAfterFirst && revoked.after.every(m => /not signed in/.test(m)));
ok('an account Copilot will not serve is told THAT, not that its sign-in expired',
   seat.hadOne && /Copilot/.test(seat.msg) && !/expired/.test(seat.msg));
ok('holding a token is not being signed in: hasToken says yes, verify says no, and the dead one is gone',
   honesty.claimed === true && honesty.truth === false && honesty.after === false);

// 8 — residue
ok('no credential in the document or in any element attribute', !leakedToDom);
ok('no credential on the console', !leakedToConsole);
ok('no credential inside an uncaught error', !leakedToError);
console.log('page errors:', errs.slice(0, 3));
ok('the page threw nothing — every refusal above was handled, not escaped', errs.length === 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await b.close();
process.exit(fail ? 1 : 0);
})();

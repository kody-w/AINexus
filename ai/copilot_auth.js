/* copilot_auth.js — the same front door Heimdall uses (kody-w/heimdall doorman).
 *
 * An AI player standing in this world needs somewhere to think. Until now that meant running
 * a brainstem on localhost, which means the minds only exist on the machine that built them.
 * This is the other door: the GitHub device-code flow, which hands back a ghu_* token that
 * Copilot will exchange for a chat session — so a visitor's OWN Copilot seat powers the
 * players, straight from a static page, with nothing installed.
 *
 *   1. POST /api/auth/device        -> user_code + verification_uri
 *   2. the person types that code at github.com/login/device
 *   3. POST /api/auth/device/poll   -> access_token (ghu_*), every `interval` seconds
 *   4. GET  /api/copilot/token      -> a short-lived chat token
 *   5. chat -> /api/copilot/chat?endpoint=<api>
 *
 * It is the DEVICE-CODE flow, not the OAuth web flow — only device-code produces a token
 * Copilot will exchange. The worker exists to add the CORS headers Pages cannot.
 *
 * IT SHARES ONE KEY WITH THE REST OF THE ESTATE. Settings live under `rapp_settings`, the same
 * key Heimdall's doorman and the canonical brainstem UI use — and they are all served from
 * kody-w.github.io, so they are the same origin and the same storage. Signing in once at any
 * of those doors signs you in at all of them. No token ever leaves the browser except to the
 * worker that mints the next one.
 *
 * NOTHING HERE SPENDS ANYTHING BY ITSELF: it uses the seat the visitor already has, there is
 * no separate meter, and starting the flow costs nothing until a person types the code.
 */
(function (root) {
  'use strict';

  const AUTH_WORKER_URL = 'https://rapp-auth.kwildfeuer.workers.dev';
  const COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
  const COPILOT_DEFAULT_API = 'https://api.individual.githubcopilot.com';
  const STORAGE_KEY = 'rapp_settings';
  const DEFAULT_MODEL = 'claude-sonnet-4';

  // A CREDENTIAL MUST NEVER RIDE OUT ON AN ERROR. The bodies below come from a proxy this page
  // does not own, and an Error thrown here becomes a line in the HUD, a console entry, and
  // sometimes a pasted bug report — every one of them somewhere a token would then live forever.
  // So anything token-shaped is scrubbed before it can leave inside a message. Redact first,
  // truncate second: slicing first can cut a token in half and leave the half that still reads
  // as one.
  const CREDENTIAL = /(gh[uposr]_[A-Za-z0-9_]{6,}|tid=[^\s"']+|[Bb]earer\s+[\w.~+/=-]+)/g;
  // Cut on a character, not a code unit. slice() counts UTF-16 units, so an API body severed
  // between the halves of an emoji becomes an unpaired surrogate — and these strings reach Error
  // messages that become HUD lines and, downstream, a rapp/1 frame that would then refuse to build.
  const clean = t => {
    const s0 = String(t == null ? '' : t).replace(CREDENTIAL, '[redacted]');
    if (s0.length <= 200) return s0;
    const c = s0.charCodeAt(199);
    return s0.slice(0, (c >= 0xD800 && c <= 0xDBFF) ? 199 : 200);
  };

  // WHERE THE TOKEN IS ALLOWED TO GO. The worker's address is a constant above and nothing can
  // move it. The address the worker PROXIES to is a different matter: it arrives from
  // `rapp_settings` — a key every tool on this origin can write, which this module itself fills
  // in from a worker response. A destination read out of shared, writable state is a destination
  // somebody else can choose, and a bearer token posted to a host of their choosing is the whole
  // seat, so a stored endpoint earns nothing by being stored: https, and Copilot's own host, or
  // the default stands. Parsed with `new URL` rather than compared as a string, because that is
  // what actually resolves the near-misses — and `.origin` drops anything smuggled in front of
  // the host, which is the oldest way to make a hostile address read like a friendly one.
  // AND IT SAYS WHICH ADDRESS IT THREW AWAY. Refusing an endpoint nobody vouched for is right,
  // but doing it in silence means that the day GitHub serves this API from a host that is not
  // *.githubcopilot.com — it served Copilot from copilot-proxy.githubusercontent.com for years —
  // the only symptom is thoughts failing against a host nobody chose, with nothing anywhere
  // saying the address GitHub sent was discarded. Once per distinct address, so a poll loop
  // cannot turn this into a wall.
  const announced = new Set();
  function copilotApi(raw) {
    const instead = (why) => {
      const k = String(raw);
      if (!announced.has(k)) {
        announced.add(k);
        try { console.warn('[NexusAuth] copilot endpoint ' + JSON.stringify(clean(k)) + ' ' + why
                           + ' — using ' + COPILOT_DEFAULT_API + ' instead'); } catch (e) {}
      }
      return COPILOT_DEFAULT_API;
    };
    try {
      const u = new URL(String(raw));
      if (u.protocol !== 'https:') return instead('is not https');
      const h = u.hostname.toLowerCase();
      if (h !== 'githubcopilot.com' && !h.endsWith('.githubcopilot.com')) {
        return instead('is not a githubcopilot.com host');
      }
      return u.origin + u.pathname.replace(/\/+$/, '');
    } catch (e) { return instead('is not a URL'); }
  }

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function saveSettings(patch) {
    try {
      const s = Object.assign(loadSettings(), patch);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      return s;
    } catch (e) { return loadSettings(); }
  }
  const getToken = () => loadSettings().ghuToken || null;
  // HOLDING A TOKEN IS NOT BEING SIGNED IN. A ghu_ that has expired or been revoked still sits
  // in storage looking exactly like a good one, so a check for "is a string present" will
  // happily report a mind that does not exist. This is the cheap, honest answer — there IS a
  // credential here — and `verify()` below is the true one.
  const hasToken = () => !!getToken();
  const signedIn = hasToken;

  let pending = null;

  async function startDeviceLogin() {
    const r = await fetch(AUTH_WORKER_URL + '/api/auth/device', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: COPILOT_CLIENT_ID, scope: 'read:user' }),
    });
    if (!r.ok) throw new Error('device start ' + r.status + ': ' + clean(await r.text()));
    // A 200 IS NOT A CODE. GitHub's OAuth endpoints answer some refusals with a 200 and an
    // `error` in the body, and the worker forwards what it is handed — so a flow that trusts the
    // status alone hands the panel `undefined`, opens it, and leaves a person reading a
    // placeholder that will never become a code. Either there is a code here, or this did not
    // start and says so.
    const d = await r.json().catch(() => ({}));
    if (!d.user_code || !d.verification_uri) {
      throw new Error(clean(d.error_description || d.error || 'the door answered without a code'));
    }
    const interval = Math.max(5, Math.min(60, Number(d.interval) || 5));
    pending = { device_code: d.device_code, interval, next: 0,
                expires_at: Date.now() + (d.expires_in || 900) * 1000 };
    return { user_code: d.user_code, verification_uri: d.verification_uri, interval };
  }

  // returns the token once the person has authorised, null while still waiting
  //
  // THE WAIT IS KEPT IN HERE, NOT IN THE CALLER. This runs against a live, rate-limited endpoint
  // on somebody else's clock: GitHub states how often it will answer (`interval`) and says
  // `slow_down` when even that was too fast — and the answer to `slow_down` is to wait LONGER,
  // not to ask again. A caller keeping its own timer cannot hear either of those, so the door is
  // held shut here instead: called too early this returns null WITHOUT touching the network, so
  // no loop above can hammer a third party. The gate sits just inside the interval so a caller
  // already polling at the right cadence is never pushed a whole round back by timer jitter.
  async function pollDeviceLogin() {
    if (!pending) return null;
    if (Date.now() > pending.expires_at) { pending = null; throw new Error('that code expired — start again'); }
    if (Date.now() < pending.next) return null;
    pending.next = Date.now() + pending.interval * 800;   // claimed BEFORE the await, so two
    const r = await fetch(AUTH_WORKER_URL + '/api/auth/device/poll', {   // overlapping calls are
      method: 'POST', headers: { 'Content-Type': 'application/json' },   // still one knock
      body: JSON.stringify({ device_code: pending.device_code, client_id: COPILOT_CLIENT_ID }),
    });
    const d = await r.json().catch(() => null);
    if (!pending) return null;                            // signed out while this was in flight
    // A RATE LIMIT IS WEATHER, NOT A REFUSAL — and a 429 arrives as a proxy's HTML often as not,
    // so it must not reach a JSON parse and come back as a syntax error in the panel. The code in
    // the person's hand is still good: back off and keep waiting rather than tearing down a flow
    // that was never rejected.
    if (r.status === 429 || (d && d.error === 'slow_down')) {
      pending.interval = Math.max(5, Math.min(60, Number(d && d.interval) || pending.interval + 5));
      pending.next = Date.now() + pending.interval * 1000;
      return null;
    }
    if (!d) throw new Error('the sign-in door answered ' + r.status + ' with nothing readable');
    if (d.access_token) { saveSettings({ ghuToken: d.access_token }); pending = null; return d.access_token; }
    if (d.error === 'authorization_pending') return null;
    if (d.error) { pending = null; throw new Error(clean(d.error_description || d.error)); }
    return null;
  }

  // The credential cannot buy a thought, so stop presenting it as a mind — and say WHICH failure
  // it was. 401 is a dead token; 403 is a live account Copilot will not serve, and telling that
  // person their sign-in expired sends them round the whole sign-in loop again for nothing.
  function dead(status) {
    signOut();
    return new Error(status === 403 ? 'GitHub will not serve Copilot to that account — signed out'
                                    : 'sign-in expired — grant a mind again');
  }

  async function exchange() {
    const ghu = getToken();
    if (!ghu) throw new Error('not signed in');
    const r = await fetch(AUTH_WORKER_URL + '/api/copilot/token', { headers: { Authorization: 'Bearer ' + ghu } });
    if (r.status === 401 || r.status === 403) throw dead(r.status);
    if (!r.ok) throw new Error('copilot exchange ' + r.status + ': ' + clean(await r.text()));
    const d = await r.json().catch(() => ({}));
    if (!d.token) throw new Error('Copilot returned no token');
    // The endpoint is checked on the way IN as well as on the way out: a host that never lands in
    // shared storage is one no other tool on this origin can read back and believe.
    saveSettings({ copilotToken: d.token,
      copilotEndpoint: copilotApi((d.endpoints && d.endpoints.api) || COPILOT_DEFAULT_API),
      copilotExpiresAt: (d.expires_at || (Date.now() / 1000 + 600)) * 1000 });
    return d.token;
  }

  async function ensureToken() {
    const s = loadSettings();
    if (s.copilotToken && Date.now() < (s.copilotExpiresAt || 0) - 60000) return s.copilotToken;
    return exchange();
  }

  // The token rides in a header to the worker and nowhere else — the only thing in this URL is
  // which Copilot host the worker should hand the thought on to, and `copilotApi` is why that
  // cannot be turned into an address of somebody else's choosing.
  const chatUrl = () => AUTH_WORKER_URL + '/api/copilot/chat?endpoint=' +
    encodeURIComponent(copilotApi(loadSettings().copilotEndpoint || COPILOT_DEFAULT_API));

  // One turn of thought: messages in, the assistant's reply out. Pass `tools` and the model can
  // CALL something instead of describing it; pass `raw` to get the whole message back, because a
  // tool call lives in message.tool_calls and would be thrown away by returning only the text.
  async function chat(messages, opts) {
    const o = opts || {};
    const tok = await ensureToken();
    const body = { model: o.model || loadSettings().model || DEFAULT_MODEL, messages,
                   temperature: o.temperature === undefined ? 0.7 : o.temperature,
                   max_tokens: o.max_tokens || 600, stream: false };
    if (o.tools && o.tools.length) { body.tools = o.tools; body.tool_choice = o.tool_choice || 'auto'; }
    const r = await fetch(chatUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
      body: JSON.stringify(body),
    });
    if (r.status === 401 || r.status === 403) throw dead(r.status);
    if (!r.ok) throw new Error('copilot chat ' + r.status + ': ' + clean(await r.text()));
    const d = await r.json().catch(() => ({}));
    const msg = (d.choices && d.choices[0] && d.choices[0].message) || {};
    return o.raw ? msg : (msg.content || '');
  }

  // the true answer: can this credential actually buy a thought right now?
  async function verify() {
    if (!hasToken()) return false;
    try { await ensureToken(); return true; }
    catch (e) { return false; }
  }

  function signOut() { saveSettings({ ghuToken: null, copilotToken: null, copilotExpiresAt: 0 }); pending = null; }

  // WHAT THIS SURFACE DOES AND DOES NOT PROTECT, said plainly, because a comment that overstates
  // it is worse than none. `getToken` is not exported, and the ordinary way to use the seat is to
  // ask for a thought (`chat`) rather than for a credential. But `loadSettings` returns the whole
  // settings object, ghu_ included, and `exchange`/`ensureToken` return the live Copilot token —
  // so this module is not a vault and must not be described as one. It cannot be: every world
  // page on this origin shares this storage, several pull third-party scripts from a CDN, and
  // anything running on kody-w.github.io can read `rapp_settings` directly without asking this
  // file at all. That is inherent to the pattern. What IS held here is the part that is not
  // inherent: the token leaves in an Authorization header to ONE address fixed in this file, it
  // is never put in a URL, never logged, and never scrubbed into an error, and the host the
  // worker forwards to is checked (`copilotApi`) rather than believed because it was in storage.
  root.NexusAuth = { startDeviceLogin, pollDeviceLogin, exchange, ensureToken, chat, chatUrl,
                     signOut, signedIn, hasToken, verify, loadSettings, saveSettings,
                     AUTH_WORKER_URL, COPILOT_CLIENT_ID, COPILOT_DEFAULT_API, STORAGE_KEY, DEFAULT_MODEL };
})(typeof window !== 'undefined' ? window : globalThis);

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
  const signedIn = () => !!getToken();

  let pending = null;

  async function startDeviceLogin() {
    const r = await fetch(AUTH_WORKER_URL + '/api/auth/device', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: COPILOT_CLIENT_ID, scope: 'read:user' }),
    });
    if (!r.ok) throw new Error('device start ' + r.status + ': ' + (await r.text()).slice(0, 200));
    const d = await r.json();
    pending = { device_code: d.device_code, interval: d.interval || 5,
                expires_at: Date.now() + (d.expires_in || 900) * 1000 };
    return { user_code: d.user_code, verification_uri: d.verification_uri, interval: pending.interval };
  }

  // returns the token once the person has authorised, null while still waiting
  async function pollDeviceLogin() {
    if (!pending) return null;
    if (Date.now() > pending.expires_at) { pending = null; throw new Error('that code expired — start again'); }
    const r = await fetch(AUTH_WORKER_URL + '/api/auth/device/poll', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: pending.device_code, client_id: COPILOT_CLIENT_ID }),
    });
    const d = await r.json();
    if (d.access_token) { saveSettings({ ghuToken: d.access_token }); pending = null; return d.access_token; }
    if (d.error === 'authorization_pending' || d.error === 'slow_down') return null;
    if (d.error) { pending = null; throw new Error(d.error_description || d.error); }
    return null;
  }

  async function exchange() {
    const ghu = getToken();
    if (!ghu) throw new Error('not signed in');
    const r = await fetch(AUTH_WORKER_URL + '/api/copilot/token', { headers: { Authorization: 'Bearer ' + ghu } });
    if (!r.ok) throw new Error('copilot exchange ' + r.status + ': ' + (await r.text()).slice(0, 200));
    const d = await r.json();
    if (!d.token) throw new Error('Copilot returned no token');
    saveSettings({ copilotToken: d.token,
      copilotEndpoint: (d.endpoints && d.endpoints.api) || COPILOT_DEFAULT_API,
      copilotExpiresAt: (d.expires_at || (Date.now() / 1000 + 600)) * 1000 });
    return d.token;
  }

  async function ensureToken() {
    const s = loadSettings();
    if (s.copilotToken && Date.now() < (s.copilotExpiresAt || 0) - 60000) return s.copilotToken;
    return exchange();
  }

  const chatUrl = () => AUTH_WORKER_URL + '/api/copilot/chat?endpoint=' +
    encodeURIComponent(loadSettings().copilotEndpoint || COPILOT_DEFAULT_API);

  // one turn of thought: messages in, the assistant's text out
  async function chat(messages, opts) {
    const o = opts || {};
    const tok = await ensureToken();
    const r = await fetch(chatUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
      body: JSON.stringify({ model: o.model || loadSettings().model || DEFAULT_MODEL,
                             messages, temperature: o.temperature === undefined ? 0.7 : o.temperature,
                             max_tokens: o.max_tokens || 600, stream: false }),
    });
    if (!r.ok) throw new Error('copilot chat ' + r.status + ': ' + (await r.text()).slice(0, 200));
    const d = await r.json();
    return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
  }

  function signOut() { saveSettings({ ghuToken: null, copilotToken: null, copilotExpiresAt: 0 }); pending = null; }

  root.NexusAuth = { startDeviceLogin, pollDeviceLogin, exchange, ensureToken, chat, chatUrl,
                     signOut, signedIn, getToken, loadSettings, saveSettings,
                     AUTH_WORKER_URL, COPILOT_CLIENT_ID, COPILOT_DEFAULT_API, STORAGE_KEY, DEFAULT_MODEL };
})(typeof window !== 'undefined' ? window : globalThis);

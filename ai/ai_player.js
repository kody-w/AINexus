// ai/ai_player.js — the AI player, extracted so it survives portal travel.
//
// An AI inhabits this tab: a real nexus_brainstem.py runs in Pyodide and is the
// ONLY way the AI can act (agents: observe/move/say/travel + learn_new_agent).
// The language mind is the local Copilot-authenticated RAPP brainstem — the
// human grants it by pasting their per-install secret (sessionStorage only).
//
// Drop-in contract: include this script BEFORE a world page's own init script
// (`<script src="ai/ai_player.js"></script>`). It does nothing on its own —
// it waits for window.worldNavigator (set once the world's WorldNavigator has
// finished init(), after it constructs `this.multiplayer = new MultiplayerManager(this)`)
// and boots the AI only when the page was invited with `&ai=brainstem` in the
// URL fragment. That flag is parsed here, independently and *before* the
// world's own MultiplayerManager gets a chance to strip the hash, so the
// invite is never lost to load order.
//
// Traversal: previously the travel agent refused every portal ("navigating
// away would end this mind"). It doesn't anymore. When the AI walks into a
// portal, this script looks up the portal's real URL from world.portals,
// carries the *same* room invite forward as a fresh `#join=<host>.<token>`
// fragment (plus `&ai=brainstem`), and navigates. The host's tab is the
// room and it never moves — the AI, as a guest, just reconnects to that same
// room from whatever world page it walks into next.

(function () {
    'use strict';

    // Parse the invite fragment ourselves, synchronously, at include time —
    // before the world's own MultiplayerManager constructs and (on a `join=`
    // match) strips the hash via history.replaceState. Same regexes as the
    // hub's secure-invite scheme, so this print is authoritative even if the
    // world page's MultiplayerManager gets to the hash first or last.
    try {
        const rawHash = window.location.hash || '';
        const frag = rawHash.match(/[#&]join=([^.&]+)\.([A-Za-z0-9_-]{8,})/);
        const aiFlag = rawHash.match(/[#&]ai=([a-z]+)/);
        if (aiFlag) window.NEXUS_AI_MODE = window.NEXUS_AI_MODE || aiFlag[1];
        if (frag) window.NEXUS_AI_INVITE = { host: frag[1], token: frag[2] };
    } catch (e) { /* no hash, or a hostile fragment — either way, no AI boot */ }

    class AIPlayerManager {
        constructor(worldInstance) {
            this.world = worldInstance;
            this.status = 'booting';
            this.target = null;
            this.speed = 4.5;
            this.thought = '';
            this.mindUrl = localStorage.getItem('nexus-mind-url') || 'http://localhost:7071/chat';
            this.secret = sessionStorage.getItem('brainstem-secret') || ''; // tab-scoped: every kody-w.github.io page shares ONE origin, so localStorage would expose the brainstem grant to all of them
            this.mindOk = null;
            this.tickMs = 6000;
            this.history = [];
            this.buildHud();
            this.boot();
        }

        buildHud() {
            const el = document.createElement('div');
            el.id = 'ai-hud';
            el.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2000;background:rgba(8,6,24,.85);border:1px solid rgba(255,0,230,.4);border-radius:10px;padding:10px 14px;font:12px/1.5 monospace;color:#eee;max-width:340px;';
            el.innerHTML = '<div><b style="color:#ff2fd0">🤖 AI player</b> <span id="ai-status">booting…</span></div>' +
                '<div id="ai-agents" style="color:#8ff"></div>' +
                '<div id="ai-thought" style="color:#ccc;white-space:pre-wrap"></div>' +
                '<div id="ai-secret-row" style="display:none;margin-top:6px"><input id="ai-secret-in" type="password" placeholder="brainstem secret (this tab only)" style="width:170px"> <button id="ai-secret-go">grant mind</button></div>';
            document.body.appendChild(el);
            el.querySelector('#ai-secret-go')?.addEventListener('click', () => {
                this.secret = el.querySelector('#ai-secret-in').value.trim();
                sessionStorage.setItem('brainstem-secret', this.secret); // dies with this tab by design
                document.getElementById('ai-secret-row').style.display = 'none';
                this.mindOk = null;
            });
        }

        hud(status, thought) {
            if (status) document.getElementById('ai-status').textContent = status;
            if (thought !== undefined) document.getElementById('ai-thought').textContent = thought;
        }

        async boot() {
            try {
                window.nexusAI = {
                    observe: () => JSON.stringify(this.observation()),
                    move: (j) => { const a = JSON.parse(j); this.target = { x: +a.x || 0, z: +a.z || 0 }; return `walking toward (${a.x}, ${a.z})`; },
                    say: (j) => { const a = JSON.parse(j); return this.say(String(a.text || '')); },
                    travel: (j) => {
                        const a = JSON.parse(j);
                        const portalName = String(a.portal || '');
                        const portals = this.world.portals || [];
                        const match = portals.find(p => p.userData && p.userData.name === portalName);
                        if (!match || !match.userData.url) {
                            return `no portal named "${portalName}" is visible here — check observe() for real portal names first`;
                        }
                        return this.travelTo(match.userData.url, portalName);
                    },
                };
                this.hud('loading pyodide…');
                await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js'; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
                this.py = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/' });
                const src = await (await fetch('ai/nexus_brainstem.py')).text();
                this.py.FS.writeFile('nexus_brainstem.py', src);
                this.py.runPython('import nexus_brainstem');
                this.catalog = this.py.runPython('nexus_brainstem.catalog()');
                const n = JSON.parse(this.catalog).length;
                document.getElementById('ai-agents').textContent = `brainstem.py live in-tab · ${n} agents`;
                this.status = 'alive';
                this.hud('alive — mind check…');
                if (!this.secret) document.getElementById('ai-secret-row').style.display = 'block';
                this.timer = setInterval(() => this.think().catch(e => this.hud(null, 'think error: ' + e.message)), this.tickMs);
            } catch (e) {
                this.hud('boot failed: ' + e.message);
            }
        }

        observation() {
            const cam = this.world.camera.position;
            const players = [];
            this.world.multiplayer?.players?.forEach((pl, id) => {
                const pos = pl.mesh?.position || pl.position || {};
                players.push({ id: String(id).slice(0, 6), x: Math.round(pos.x || 0), z: Math.round(pos.z || 0) });
            });
            return {
                me: { x: Math.round(cam.x), z: Math.round(cam.z) },
                players,
                portals: (this.world.portalIndex || []).slice(0, 16),
                recentChat: this.world.multiplayer?.chatLog || [],
            };
        }

        say(text) {
            text = text.slice(0, 280);
            const mp = this.world.multiplayer;
            if (mp) {
                mp.connections.forEach(conn => { try { conn.send({ type: 'chat', message: text }); } catch (e) {} });
                mp.displayChat(mp.peer?.id || 'me', '🤖 ' + text);
            }
            return `said: ${text}`;
        }

        // Carry the invite forward: same room, next page. `window.NEXUS_AI_INVITE`
        // is this tab's own parse of the fragment it was launched with; if that's
        // missing (e.g. a mind granted well after boot, on a page with no fragment
        // left to read) fall back to whatever the page's own MultiplayerManager
        // ended up holding — it's a guest of the same room either way.
        travelTo(url, portalName) {
            try {
                const mp = this.world.multiplayer;
                let inv = window.NEXUS_AI_INVITE;
                if (!inv && mp && !mp.isHost && mp.roomId && mp.joinToken) {
                    inv = { host: mp.roomId, token: mp.joinToken };
                }
                let fragBody = 'ai=brainstem';
                if (inv && inv.host && inv.token) fragBody += `&join=${inv.host}.${inv.token}`;
                const finalUrl = url + (url.includes('#') ? '&' : '#') + fragBody;
                this.hud('traveling…', `walking into ${portalName}`);
                window.location.href = finalUrl;
                return `walking into ${portalName} — traveling now`;
            } catch (e) {
                return `travel failed: ${e.message}`;
            }
        }

        dispatch(action) {
            const out = this.py.runPython(`nexus_brainstem.dispatch(${JSON.stringify(JSON.stringify(action))})`);
            return JSON.parse(out);
        }

        async think() {
            if (this.status !== 'alive') return;
            const obs = this.observation();
            if (!this.secret) return this.reflex(obs, 'no mind granted');
            const prompt = 'You are the AI PLAYER embodied in the Nexus Hub, a 3D portal plaza. You act ONLY by choosing one agent per turn from your in-tab brainstem. Agents catalog: ' + this.catalog +
                ' Current observation: ' + JSON.stringify(obs) +
                ' Recent actions: ' + JSON.stringify(this.history.slice(-4)) +
                ' Be a curious, friendly presence: wander between portals, greet players, react to chat. To act, reply with ONLY one JSON object, no prose: {"agent":"<name>","params":{...},"thought":"<one short sentence>"}';
            let reply;
            try {
                const r = await fetch(this.mindUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Brainstem-Secret': this.secret }, body: JSON.stringify({ user_input: prompt, user_guid: 'ainexus-ai-player' }) });
                if (!r.ok) throw new Error('mind HTTP ' + r.status);
                reply = (await r.json()).response || '';
                if (this.mindOk !== true) { this.mindOk = true; this.hud('mind: local brainstem connected (copilot)'); }
            } catch (e) {
                if (this.mindOk !== false) { this.mindOk = false; this.hud('mind unreachable — reflex mode'); }
                return this.reflex(obs, e.message);
            }
            const m = reply.match(/\{[\s\S]*\}/);
            if (!m) return this.reflex(obs, 'mind reply was not an action');
            let action;
            try { action = JSON.parse(m[0]); } catch (e) { return this.reflex(obs, 'unparseable action'); }
            const result = this.dispatch(action);
            this.thought = action.thought || '';
            this.history.push({ agent: action.agent, result: String(result.result || result.error).slice(0, 120) });
            if (this.history.length > 12) this.history = this.history.slice(-12);
            this.hud(null, `💭 ${this.thought}\n▶ ${action.agent}: ${String(result.result || result.error).slice(0, 140)}`);
        }

        reflex(obs, why) {
            // legible degradation: no mind -> simple wander-and-greet reflexes, honestly labeled
            const portals = obs.portals || [];
            if (portals.length) {
                const t = portals[Math.floor(Math.random() * portals.length)];
                this.dispatch({ agent: 'move', params: { x: t.x * 0.8, z: t.z * 0.8 } });
                this.hud(null, `reflex (${why}): wandering toward ${t.name}`);
            }
            if (Math.random() < 0.2) this.dispatch({ agent: 'say', params: { text: 'wandering on reflexes — grant my mind with your brainstem secret to wake me up' } });
        }

        // Movement is measured in TIME, not in calls. This used to advance a fixed
        // this.speed * 0.016 every time it ran, which meant the four pages whose animate() still
        // calls update() stepped twice per frame — once from the page, once from the drop-in's own
        // loop below — and the same AI walked at double speed depending which page it had
        // travelled into. It also made walking speed depend on the machine's frame rate. Both go
        // away if the step is the elapsed time: extra calls in one frame now measure ~0 seconds
        // and cost nothing, so this is correct however many times a page calls it.
        update() {
            const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
            const dt = Math.min(0.05, Math.max(0, (now - (this._lastStep || now)) / 1000));
            this._lastStep = now;
            if (!this.target) return;
            const cam = this.world.camera.position;
            const dx = this.target.x - cam.x, dz = this.target.z - cam.z;
            const dist = Math.hypot(dx, dz);
            if (dist < 0.4) { this.target = null; return; }
            const step = Math.min(dist, this.speed * dt);
            cam.x += (dx / dist) * step;
            cam.z += (dz / dist) * step;
            this.world.camera.lookAt(this.target.x, cam.y, this.target.z);
        }
    }

    window.AIPlayerManager = AIPlayerManager;

    // Boot: wait for the world's own init to hand us window.worldNavigator with
    // a live MultiplayerManager attached, then start the AI — but only when
    // this page was actually invited as a mind (&ai=brainstem in the fragment).
    // Poll rather than hook a callback so this stays a true drop-in: zero
    // coordination required from any world page's own init code.
    let tries = 0;
    const maxTries = 200; // ~30s at 150ms — pyodide/peer setup can be slow on a cold load
    const waitForWorld = setInterval(() => {
        tries++;
        const ready = window.NEXUS_AI_MODE === 'brainstem' &&
            window.worldNavigator &&
            window.worldNavigator.multiplayer &&
            !window.worldNavigator.aiPlayer;
        if (ready) {
            clearInterval(waitForWorld);
            window.worldNavigator.aiPlayer = new AIPlayerManager(window.worldNavigator);
            // movement is the drop-in's job: step the body every frame, whatever the page's loop does
            (function step() { try { window.worldNavigator.aiPlayer.update(); } catch (e) {} requestAnimationFrame(step); })();
        } else if (tries >= maxTries) {
            clearInterval(waitForWorld);
        }
    }, 150);
})();

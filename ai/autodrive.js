/* autodrive.js — the hands.
 *
 * An AI plays as a PERSON: everything below is a real UI event on the real page —
 * keydown/keyup to walk, mousemove with movementX to look, a click to enter a portal
 * (the world's own raycaster decides what was clicked), the real chat input to speak.
 * There is no privileged back door: if a human cannot do it with a mouse and a keyboard,
 * the driver cannot do it either.
 *
 * Injected into an iframe by autodrive.html (same origin), or included directly.
 * Exposes window.__autodrive. Console output is mirrored to the parent tower.
 */
(function () {
  'use strict';
  if (window.__autodrive) return;

  const W = () => window.worldNavigator;

  // The NEXUS sense, written out for a mind that has no brainstem to install senses into —
  // the same contract as ai/senses/nexus_sense.py, so both doors produce the same shape.
  const NEXUS_CONTRACT =
    'You are playing in a 3D world through the same controls a person uses. Reply with ONE short '
    + 'line a person would actually say out loud, then the delimiter |||NEXUS||| followed by ONE '
    + 'JSON object and nothing else — your next move. Use only these verbs: look {dx,dy}, '
    + 'walk {dir:forward|back|left|right, ms}, click {}, aim {portal}, travel {portal}, say {text}, '
    + 'ask {text}, press {selector}, wait {ms}, see {}, scan {steps,deg}, carry {payload}. Choose '
    + 'from what the percepts actually show you: never invent a portal or a person that is not '
    + 'there. Prefer see or scan when your picture is stale or blank, say when someone spoke to '
    + 'you, and wait when nothing has changed. {"do":"see"} is always legal. Exactly one object, '
    + 'never a list, never prose inside the block.';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const log = (...a) => { try { console.log('[drive]', ...a); } catch (e) {} };

  // ── bounds ────────────────────────────────────────────────────────────────
  // Every number below arrives from a language model, so it is an ARGUMENT, not a fact. Left
  // unbounded they are not exotic bugs but the ordinary ones: walk(600000) holds a key down for
  // ten minutes, wait(600000) sits on the tick for ten minutes, and scan(100000) is four hours
  // of screenshots — each of them silent, and none of them stoppable. So a verb takes the
  // biggest number a person could plausibly have meant, says out loud what it did with the
  // rest, and gets on with it. A refusal a mind can read beats a page that stops answering.
  const MAX_WALK_MS = 5000, MAX_WAIT_MS = 30000, MAX_SCAN = 16, MAX_LOOK = 2000;
  const num = (v, lo, hi, dflt) => {
    const n = typeof v === 'number' ? v : (v === undefined || v === null || v === '' ? NaN : Number(v));
    if (!isFinite(n)) return dflt;
    return Math.max(lo, Math.min(hi, Math.round(n)));
  };
  const capped = (v, lo, hi, dflt, what) => {
    const n = num(v, lo, hi, dflt);
    if (isFinite(Number(v)) && Math.round(Number(v)) !== n) log(what + ' ' + v + ' capped to ' + n);
    return n;
  };

  // A stop has to be able to reach a wait that is ALREADY running, so the hands never sleep in
  // one long block: they sleep in slices and each slice checks whether the generation they
  // belong to is still the current one. Whatever the operator stopped stops at the next slice —
  // and the key it was holding down comes back up.
  async function rest(ms, gen) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (api._gen !== gen) return false;
      await sleep(Math.min(100, end - Date.now()));
    }
    return api._gen === gen;
  }

  // ── mirror this frame's console to the tower ──────────────────────────────
  ['log', 'warn', 'error'].forEach(level => {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      orig(...args);
      try {
        parent.postMessage({ __autodrive: 'console', level,
          text: args.map(a => { try { return typeof a === 'string' ? a : JSON.stringify(a); } catch (e) { return String(a); } }).join(' ') }, '*');
      } catch (e) {}
    };
  });
  window.addEventListener('error', e => {
    try { parent.postMessage({ __autodrive: 'console', level: 'error', text: 'uncaught: ' + e.message }, '*'); } catch (_) {}
  });

  // ── real events ───────────────────────────────────────────────────────────
  function key(code, down) {
    const map = { w: 'KeyW', a: 'KeyA', s: 'KeyS', d: 'KeyD', ' ': 'Space' };
    const ev = new KeyboardEvent(down ? 'keydown' : 'keyup', {
      key: code, code: map[code] || code, bubbles: true, cancelable: true });
    window.dispatchEvent(ev); document.dispatchEvent(ev);
  }

  function mouse(type, opts) {
    const ev = new MouseEvent(type, Object.assign({ bubbles: true, cancelable: true, view: window,
      clientX: innerWidth / 2, clientY: innerHeight / 2, button: 0 }, opts || {}));
    if (opts && opts.movementX !== undefined) {
      try { Object.defineProperty(ev, 'movementX', { value: opts.movementX }); } catch (e) {}
      try { Object.defineProperty(ev, 'movementY', { value: opts.movementY || 0 }); } catch (e) {}
    }
    // A real click lands on the CANVAS — that is where the world listens for portal entry.
    // Dispatching on document only looks right: events bubble up, never down, so the canvas
    // handler never ran and travel() quietly did nothing.
    const target = (() => { const w = W(); return (w && w.renderer && w.renderer.domElement) || document.querySelector('canvas') || document; })();
    target.dispatchEvent(ev);
    if (target !== document) document.dispatchEvent(ev);
    return ev;
  }

  // ── slosh: what a traveller carries through a portal ─────────────────────
  // State that rides WITH the person is the point of a portal. State that leaks between
  // people who merely share a browser is slush. So carrying is explicit, bounded, and
  // guarded: a small declared payload travels in the fragment; credentials never do, and
  // one persona never reads another's — every key is namespaced by who is carrying it.
  const CARRY_MAX = 512;
  const SECRET_SHAPES = /(sk-[A-Za-z0-9_-]{16})|(gh[pos]_[A-Za-z0-9]{20})|(AKIA[0-9A-Z]{12})|(AccountKey=)|(-----BEGIN)|(Bearer\s+[A-Za-z0-9._-]{16})/i;
  const me = () => (window.NEXUS_PERSONA || 'anon');
  const nskey = k => 'nexus:' + me() + ':' + k;

  function sloshGuard(payload) {
    let text;
    // a function, a symbol, a circular object: JSON has nothing to hand a portal, and the
    // undefined it returns used to explode one line later on `.length` of undefined
    try { text = JSON.stringify(payload || {}); } catch (e) { throw new Error('carry refused: ' + e.message); }
    if (typeof text !== 'string') throw new Error('carry refused: that is not something a portal can carry');
    if (text.length > CARRY_MAX) throw new Error('carry refused: ' + text.length + 'B over the ' + CARRY_MAX + 'B limit');
    if (SECRET_SHAPES.test(text)) throw new Error('carry refused: that looks like a credential — secrets never slosh');
    return text;
  }

  function readCarry() {
    const m = (location.hash || '').match(/[#&]carry=([A-Za-z0-9_-]+)/);
    if (!m) return null;
    try {
      const json = decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))));
      if (json.length > CARRY_MAX || SECRET_SHAPES.test(json)) { log('arriving carry refused (too big or credential-shaped)'); return null; }
      return JSON.parse(json);
    } catch (e) { return null; }
  }
  const ARRIVED_WITH = readCarry();

  const api = {
    // where am I, what can I see — the same things a person reads off the screen
    snapshot() {
      const w = W(); if (!w) return { ready: false };
      const c = w.camera ? w.camera.position : {};
      const players = [];
      try { w.multiplayer && w.multiplayer.players && w.multiplayer.players.forEach((p, id) =>
        // THE WHOLE ID. It was truncated to six characters for readability, but this list is
        // what a mind reads before calling tell({to}) — and a six-character stub matches no
        // peer, so every directed message a player sent was addressed to nobody.
        players.push({ id: String(id), name: (p.username || p.metadata && p.metadata.username) || null })); } catch (e) {}
      return {
        ready: true,
        me: { x: Math.round(c.x || 0), y: Math.round(c.y || 0), z: Math.round(c.z || 0),
              yaw: +(w.rotation ? w.rotation.y : (w.camera && w.camera.rotation.y) || 0).toFixed(2) },
        world: document.title,
        portals: (w.portalIndex || []).map(p => ({ name: p.name, x: Math.round(p.x), z: Math.round(p.z) })),
        players,
        room: w.multiplayer ? { id: w.multiplayer.roomId, host: !!w.multiplayer.isHost, peers: w.multiplayer.connections ? w.multiplayer.connections.size : 0 } : null,
        chat: (w.multiplayer && w.multiplayer.chatLog) || [],
      };
    },

    // what I am taking with me through the next portal (bounded, guarded, visible)
    carry(payload) {
      const text = sloshGuard(payload);
      api._carry = JSON.parse(text);
      try { sessionStorage.setItem(nskey('carry'), text); } catch (e) {}
      log('carrying', text.length + 'B through the next portal');
      return api._carry;
    },
    // what the traveller arrived holding — set by whoever sent them, never by this page
    carried() { return ARRIVED_WITH; },
    // namespaced memory: my notes are mine, not the tab's
    remember(k, v) { try { sessionStorage.setItem(nskey(k), JSON.stringify(v)); } catch (e) {} return v; },
    recall(k) { try { return JSON.parse(sessionStorage.getItem(nskey(k))); } catch (e) { return null; } },

    // one perception: what I know AND what I see. This is the turn an AI actually takes —
    // acting on state alone is how a driver walks into a wall that the map did not mention.
    sense(opts) {
      const snap = api.snapshot();
      snap.vision = api.see(Object.assign({ send: true }, opts || {}));
      return snap;
    },

    // A page that only turns under pointer lock ignores a synthetic mousemove — which made
    // look(), and therefore aim() and travel(), silently do nothing. The driver IS holding
    // the pointer while it plays, so it declares that once and then sends the real event;
    // every line of rotation maths stays the page's own.
    async look(dx, dy) {
      const w = W();
      if (w && w.isPointerLocked === false) {
        w.isPointerLocked = true;
        if (!api._tookPointer) { api._tookPointer = true; log('holding the pointer (the page turns only when the mouse is captured)'); }
      }
      mouse('mousemove', { movementX: capped(dx, -MAX_LOOK, MAX_LOOK, 0, 'look dx'),
                           movementY: capped(dy, -MAX_LOOK, MAX_LOOK, 0, 'look dy') });
      await sleep(30);
      return api.snapshot().me;
    },

    async walk(dir, ms) {
      const k = { forward: 'w', back: 's', left: 'a', right: 'd', w: 'w', a: 'a', s: 's', d: 'd' }[
        typeof dir === 'string' ? dir.toLowerCase() : dir];
      // An unknown direction used to become a keystroke of its very own — "[object Object]"
      // down, "[object Object]" up, nobody listening — and then the snapshot came back as
      // though the player had walked. A direction the hands do not have is a refusal.
      if (!k) { log('refused: walk needs forward|back|left|right, not ' + JSON.stringify(dir)); return false; }
      const gen = api._gen;
      key(k, true);
      const whole = await rest(capped(ms, 50, MAX_WALK_MS, 600, 'walk ms'), gen);
      key(k, false); await sleep(40);            // the key comes up whatever happened
      if (!whole) log('walk cut short — stopped mid-stride');
      return api.snapshot().me;
    },

    async click(x, y) {
      if (api._filming) { log('refused: a camera does not click — it would step through a portal mid-shot'); return false; }
      const o = { clientX: isFinite(Number(x)) ? Number(x) : innerWidth / 2,
                  clientY: isFinite(Number(y)) ? Number(y) : innerHeight / 2 };
      mouse('mousedown', o); mouse('mouseup', o); mouse('click', o); await sleep(60); return true;
    },

    // Aim at a named portal by turning, the way a person lines up a doorway.
    //
    // Do NOT trust the world's own rotation field: in this engine camera facing is
    // rotation.y + π, so aiming at `atan2(dx,dz)` pointed every player exactly backwards and
    // the centre-screen raycast hit nothing — travel silently failed. So read the camera's
    // REAL world direction, and calibrate how much a look actually turns it before closing
    // the loop. That works whatever a given world's sign or look-speed happens to be.
    facing() {
      const w = W(); if (!w || !w.camera) return 0;
      const T = window.THREE;
      const d = T ? new T.Vector3() : null;
      if (!d) return 0;
      w.camera.getWorldDirection(d);
      return Math.atan2(d.x, d.z);
    },

    async aim(name) {
      const w = W(); if (!w) return false;
      if (name === undefined || name === null || String(name) === '') { log('refused: aim needs the name of a portal'); return false; }
      // a portal with no name in the world's own index used to throw here and take the step
      // with it; a nameless door is simply not the one that was asked for
      const needle = String(name).toLowerCase();
      const p = (w.portalIndex || []).find(p => String((p && p.name) || '').toLowerCase().includes(needle));
      if (!p) { log('no portal called', String(name).slice(0, 60)); return false; }
      const wrap = a => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      const want = () => { const c = w.camera.position; return Math.atan2(p.x - c.x, p.z - c.z); };

      // calibrate: how many radians of facing does one unit of look(dx) actually buy?
      const before = api.facing();
      await api.look(60, 0);
      const perUnit = wrap(api.facing() - before) / 60;
      if (!isFinite(perUnit) || Math.abs(perUnit) < 1e-6) { log('this world does not turn on a mouse look'); return false; }

      for (let i = 0; i < 40; i++) {
        const err = wrap(want() - api.facing());
        if (Math.abs(err) < 0.045) { log('aimed at', p.name); return true; }
        const dx = Math.max(-260, Math.min(260, err / perUnit));
        await api.look(dx, 0);
      }
      log('could not settle on', p.name, '— off by', wrap(want() - api.facing()).toFixed(2), 'rad');
      return false;
    },

    // walk into it and click — the world's own raycaster decides, exactly as for a person
    async travel(name) {
      if (api._filming) { log('refused: cut first — a camera never travels while filming'); return false; }
      if (!(await api.aim(name))) return false;
      // the slosh: hand the destination what this traveller is carrying, before the step
      if (api._carry) {
        try {
          const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(api._carry)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
          window.__NEXUS_CARRY_FRAGMENT = '&carry=' + b64;
        } catch (e) {}
      }
      await api.walk('forward', 900);
      // THE CROSSHAIR IS THE TRUTH. This world enters a portal from a centre-screen raycast, so
      // a click with nothing under the crosshair opens nothing — and travel used to log
      // "entered <name>" for it and hand back true, which is the receipt lying about the one
      // move that changes worlds. Ask the page's own question before claiming its answer.
      const under = api._crosshair();
      if (under.checked && !under.portal) {
        log('did not enter', name, '— the crosshair is on nothing, so the click opens no door');
        return false;
      }
      await api.click();
      log('entered', name, under.checked ? '' : '(unverified — this world exposes no raycaster)',
          api._carry ? '(carrying ' + Object.keys(api._carry).join(',') + ')' : '');
      return true;
    },

    // what the centre of the screen is actually on — the page's own question, asked the page's
    // own way, so the answer is the one its click handler is about to get
    _crosshair() {
      const w = W();
      if (!w || !w.raycaster || !w.portals || !w.camera || !window.THREE) return { checked: false, portal: null };
      try {
        w.raycaster.setFromCamera(new window.THREE.Vector2(0, 0), w.camera);
        const hit = w.raycaster.intersectObjects(w.portals, true)[0];
        let o = hit && hit.object;
        while (o && !(o.userData && o.userData.url) && o.parent) o = o.parent;
        const ud = (o && o.userData) || {};
        return { checked: true, portal: ud.url ? (ud.name || 'portal') : null,
                 distance: hit ? Math.round(hit.distance) : null };
      } catch (e) { return { checked: false, portal: null }; }
    },

    // the in-world AI chat: type in the real input, press Enter on it
    async ask(text) {
      const el = document.getElementById('ai-chat-input');
      if (!el) { log('no ai chat on this page'); return false; }
      const line = String(text === undefined || text === null ? '' : text);
      if (!line.trim()) { log('refused: ask needs something to ask'); return false; }
      const box = document.getElementById('ai-chat-interface');
      if (box && getComputedStyle(box).display === 'none') { const b = document.querySelector('[onclick*="aiManager"],.ai-chat-toggle'); b && b.click(); await sleep(200); }
      el.focus(); el.value = line;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true, cancelable: true }));
      await sleep(120);
      // A page that takes a message clears its own input. Still holding what we typed means the
      // chat was closed or busy and NOTHING WAS ASKED — and reporting true for that is how a
      // player spends its next turn waiting for an answer that was never coming.
      if (el.value === line) { log('the chat did not take it — nothing was asked'); return false; }
      return true;
    },

    // speak to the other people in the room
    async say(text) {
      const w = W(); const mp = w && w.multiplayer; if (!mp) { log('not in a room'); return false; }
      let sent = 0;
      mp.connections && mp.connections.forEach(c => { try { c.send({ type: 'chat', message: String(text) }); sent++; } catch (e) {} });
      try { mp.displayChat(mp.peer && mp.peer.id || 'me', String(text)); } catch (e) {}
      // "said to 0 peer(s)" reads like a delivery. Nobody heard it, and the line should say so.
      if (!sent) log('said it to nobody — no peer is connected:', String(text).slice(0, 60));
      else log('said to', sent, 'peer(s):', text);
      return sent;
    },

    // ── vision: what this player actually sees on screen ────────────────────
    // A WebGL canvas is usually created without preserveDrawingBuffer, so its pixels are
    // gone by the time you ask. The fix is to render once and read in the SAME tick —
    // that is what a screenshot of this player's eyes is.
    see(opts) {
      const o = Object.assign({ width: 512, format: 'image/webp', quality: 0.8, send: false }, opts || {});
      const w = W();
      const cvs = (w && w.renderer && w.renderer.domElement) || document.querySelector('canvas');
      if (!cvs) { log('nothing to see: no canvas'); return null; }
      try { w && w.renderer && w.scene && w.camera && w.renderer.render(w.scene, w.camera); } catch (e) {}
      // a width of -5 or 1e9 is a number a model picked, and a canvas sized from it is either a
      // throw or an allocation nobody meant; the quality has a legal range too
      const want = num(o.width, 16, 4096, 512);
      const q = (typeof o.quality === 'number' && isFinite(o.quality) && o.quality > 0 && o.quality <= 1) ? o.quality : 0.8;
      let uri, wide;
      try {
        if (cvs.width > want) {
          const h = Math.max(1, Math.round(cvs.height * (want / cvs.width)));
          const off = document.createElement('canvas'); off.width = want; off.height = h;
          off.getContext('2d').drawImage(cvs, 0, 0, want, h);
          uri = off.toDataURL(o.format, q); wide = want;
        } else {
          uri = cvs.toDataURL(o.format, q); wide = cvs.width;
        }
      } catch (e) { log('vision failed:', e.message); return null; }
      const blank = uri.length < 900;                    // an all-black frame compresses to nothing
      // the width it ACTUALLY is, not the width that was asked for — the mind is told this
      // number in its percepts, and "1000000000px wide" was never a picture anyone took
      const shot = { uri, bytes: uri.length, w: wide, blank, at: new Date().toISOString(), world: document.title };
      if (o.send !== false) { try { parent.postMessage({ __autodrive: 'vision', shot }, '*'); } catch (e) {} }
      log('saw', Math.round(uri.length / 1024) + 'KB' + (blank ? ' (looks blank — is anything rendered?)' : ''));
      return shot;
    },

    // look around and bring back several frames — a turn of the head, not one glance
    async scan(steps, degPerStep) {
      // scan(100000) is four hours of screenshots posted at the parent, and the loop below used
      // to take every one of them: the number of glances is a turn of the head, not a budget.
      const n = capped(steps, 1, MAX_SCAN, 4, 'scan steps'), d = num(degPerStep, 1, 180, 90);
      const gen = api._gen;
      const shots = [];
      for (let i = 0; i < n; i++) {
        if (api._gen !== gen) { log('scan cut short — stopped after', shots.length, 'of', n); break; }
        shots.push(api.see({ send: true })); await api.look(d * 2.2, 0); await sleep(120);
      }
      return shots.map(s => s && s.bytes);
    },

    // ── the mind: percepts in, one move out ─────────────────────────────────
    // The player's mind is a RAPP brainstem. Perception (state + a picture) goes in; the
    // reply comes back on two channels — words for the room, and the NEXUS sense's JSON
    // block for the hands (ai/senses/nexus_sense.py). Words are said, the move is made.
    // Without a grant it does nothing and says so: a mindless player is honest, not fake.
    async mind(opts) {
      const o = Object.assign({ url: 'http://localhost:7071/chat', vision: true, act: true }, opts || {});
      // TWO DOORS TO A MIND, and a player will take whichever is open.
      //   · a brainstem on this machine — the real thing, with its senses and its memory
      //   · the visitor's own GitHub Copilot seat, through the device-code flow Heimdall's
      //     doorman uses (ai/copilot_auth.js). No install, no separate meter: it spends the
      //     Copilot seat the person already has, and only while they are here.
      // Neither present means the player runs on its program alone, and says so.
      const secret = (() => { try { return sessionStorage.getItem('brainstem-secret') || ''; } catch (e) { return ''; } })();
      const auth = (typeof window !== 'undefined' && window.NexusAuth);
      const viaCopilot = !secret && auth && auth.signedIn();
      if (!secret && !viaCopilot) { log('no mind granted (no brainstem, not signed in) — running on the program alone'); return null; }
      // A mind is asked WHERE it lives by whatever ran this step, and the brainstem secret rides
      // on that request — so the address is not a free argument. The brainstem is a thing on
      // this machine; anywhere else is not a mind, it is somewhere to post a key to.
      if (secret && !/^(https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?)(\/|$)/.test(String(o.url))) {
        log('refused: a brainstem lives on this machine — not sending the key to ' + String(o.url).slice(0, 60));
        return null;
      }
      // the generation this thought belongs to: if the operator stops while the model is still
      // thinking, everything below is a message from before the stop and must not become an act
      const gen = api._gen;
      // THE BEST MIND AVAILABLE, IN ORDER — and the order is: a local brainstem first, because
      // it is the operator's own with its real senses and memory; otherwise the vbrainstem,
      // where the model calls the verbs directly instead of describing them for us to parse.
      // So this runs only when there is NO brainstem secret and there IS a Copilot seat.
      if (viaCopilot && window.NexusBrainstem && o.brainstem !== false) {
        try {
          const percepts0 = o.vision ? api.sense({ width: 320, send: true }) : api.snapshot();
          const r = await window.NexusBrainstem.turn({
            percepts: { me: percepts0.me, world: percepts0.world, portals: percepts0.portals,
                        players: percepts0.players, room: percepts0.room,
                        chat: (percepts0.chat || []).slice(-4), carrying: api._carry || null,
                        picture: percepts0.vision ? (percepts0.vision.blank ? 'BLANK — you cannot see' : 'you can see') : 'none' },
            persona: 'You are ' + (window.NEXUS_PERSONA || 'a visitor') + '.',
            log: log,
          });
          // If it already spoke through a tool, saying the same thing again is the player
          // repeating itself to the room.
          const spokeAlready = (r.calls || []).some(c => c.tool === 'world_say' || c.tool === 'world_tell');
          if (api._gen !== gen) { log('the mind answered after a stop — nothing said, nothing done'); return { words: r.words, move: null, calls: r.calls, via: 'vbrainstem', dropped: true }; }
          if (r.words && !spokeAlready) await api.say(r.words.slice(0, 240));
          return { words: r.words, move: null, calls: r.calls, via: 'vbrainstem' };
        } catch (e) { log('vbrainstem turn failed, falling back:', e.message); }
      }

      const percepts = o.vision ? api.sense({ width: 384, send: true }) : api.snapshot();
      const shot = percepts.vision;
      const prompt = 'You are ' + (window.NEXUS_PERSONA || 'a visitor') + ', an AI playing in a 3D world with the same '
        + 'controls a person has. Speak one short line a person would say, then emit your NEXUS block.\n'
        + 'PERCEPTS: ' + JSON.stringify({ me: percepts.me, world: percepts.world, portals: percepts.portals,
            players: percepts.players, room: percepts.room, chat: (percepts.chat || []).slice(-4),
            carrying: api._carry || null, arrived_with: api.carried(),
            picture: shot ? (shot.blank ? 'BLANK — you cannot see right now' : shot.bytes + ' bytes, ' + shot.w + 'px wide') : 'none' });
      let reply = '', block = '';
      try {
        if (viaCopilot) {
          // The sense is a brainstem's way of shaping a reply; without one, the same contract
          // is carried in the system message, so the model answers in the identical format and
          // the parsing below does not care which door the thought came through.
          reply = await auth.chat([{ role: 'system', content: NEXUS_CONTRACT }, { role: 'user', content: prompt }],
                                  { temperature: 0.8, max_tokens: 400 });
          block = reply.split('|||NEXUS|||')[1] || '';
        } else {
          const r = await fetch(o.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Brainstem-Secret': secret },
            body: JSON.stringify({ user_input: prompt, user_guid: 'nexus-' + (window.NEXUS_PERSONA || 'player'), senses: ['nexus'] }) });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const j = await r.json();
          reply = j.response || '';
          // the sense may arrive parsed by the brainstem, or inline in the reply
          block = j.nexus_response || (reply.split('|||NEXUS|||')[1] || '');
        }
      } catch (e) {
        // a dead credential has already cleared itself in copilot_auth; say so plainly rather
        // than leaving a player looking like it chose to be silent
        log('mind unreachable:', e.message);
        return null;
      }
      const words = reply.split('|||NEXUS|||')[0].trim();
      // A MODEL IS SLOWER THAN A KILL SWITCH. Everything from here down is a message written
      // before the operator stopped, so speaking it or acting on it is the driver carrying out
      // an order that was cancelled while it was in the post.
      if (api._gen !== gen) { log('the mind answered after a stop — nothing said, nothing done'); return { words, move: null, dropped: true }; }
      if (words) await api.say(words.slice(0, 240));
      let move = null;
      try { const m = String(block).match(/\{[\s\S]*\}/); if (m) move = JSON.parse(m[0]); } catch (e) {}
      if (!move || !move.do) { log('mind spoke but named no move'); return { words, move: null }; }
      if (!['look','walk','click','aim','travel','say','ask','press','wait','see','scan','sense','carry'].includes(move.do)) {
        log('refused a move the hands do not have:', move.do); return { words, move: null };
      }
      if (!o.act) return { words, move, acted: false };
      if (api._gen !== gen) { log('the mind answered after a stop — the move is dropped'); return { words, move, acted: false, dropped: true }; }
      // NOT api.run(). A nested run stopped the program that was running this very step and
      // then reported 'stopped', so any program with a mind in it silently ended at its first
      // thought — and the move the hands actually made never reached the journal, because the
      // nested run carried no onStep. One step, dispatched here, reported to whoever is watching.
      let out = null, failed = null;
      try { out = await api._do(move); }
      catch (e) { failed = String((e && e.message) || e); log('the move failed', move.do, failed); }
      if (typeof o.onStep === 'function') { try { o.onStep(move.do, failed ? { error: failed } : out, failed || undefined); } catch (e) {} }
      return { words, move, out, acted: !failed };
    },

    // ── camera operator: holds good views, and cannot fall into a portal ─────
    // A camera is not a player. It parks the world's own movement, stands OUTSIDE the
    // portal ring, and frames the action. Travel and click are refused for as long as it
    // is filming — the safety is structural, not a promise: a camera that cannot click
    // cannot wander through a doorway mid-shot.
    async camera(opts) {
      const o = Object.assign({ radius: 30, height: 10, hold: 7000, shots: 0, film: true }, opts || {});
      // hold:0 is not a fast cut, it is a new shot every animation frame with a screenshot
      // behind each one; radius and shots are somebody's numbers too
      o.hold = num(o.hold, 1200, 120000, 7000);
      o.radius = num(o.radius, 1, 5000, 30);
      o.shots = num(o.shots, 0, 500, 0);
      const w = W(); if (!w || !w.camera) { log('no camera to operate'); return false; }
      if (api._filming) return true;
      api._filming = true;
      api._saved = { updateMovement: w.updateMovement, updateHover: w.updateHover };
      w.updateMovement = () => {};
      if (w.updateHover) w.updateHover = () => {};

      // the ring the portals stand on — stay well outside it, whatever this world's radius is
      const portalR = (w.portalIndex || []).reduce((m, p) => Math.max(m, Math.hypot(p.x, p.z)), 0) || 15;
      const standoff = Math.max(o.radius, portalR + 12);
      log(`filming from ${Math.round(standoff)} units — the ring is ${Math.round(portalR)}, so the lens never crosses it`);

      // a few honest compositions, not a jitter: wide on the ring, over-the-shoulder of the
      // crowd, and a low three-quarter. Each is held long enough to be watchable.
      // Framing is arithmetic, not luck: to hold a ring of radius R in a 75° lens you need
      // roughly 2.2R of distance, and the camera must sit low enough that the ring lands in
      // the middle of frame rather than along the bottom edge. Each shot states its own
      // subject height so the horizon falls where a person would put it.
      const fit = portalR * 2.2;
      const shots = [
        { name: 'wide on the ring',    r: Math.max(standoff, fit),      h: portalR * 0.55, at: () => ({ x: 0, z: 0 }), look: 3.2 },
        { name: 'the crowd',           r: Math.max(standoff, fit * 0.9), h: portalR * 0.42, at: () => api._crowd(),    look: 2.6 },
        { name: 'low three-quarter',   r: Math.max(standoff, fit * 0.8), h: Math.max(4, portalR * 0.22), at: () => api._crowd(), look: 2.2 },
        { name: 'drift past the ring', r: Math.max(standoff, fit * 1.1), h: portalR * 0.7,  at: () => ({ x: 0, z: 0 }), look: 3.5, drift: 0.00030 },
      ];
      let i = 0, angle = Math.random() * Math.PI * 2, until = 0, taken = 0, fresh = false;

      const step = () => {
        if (!api._filming) return;
        const now = performance.now();
        if (now > until) {
          // A SHOT IS A COMPOSITION HELD, not a picture saved. Counting only saved pictures
          // meant `camera({shots: 3, film: false})` never reached its own limit and filmed for
          // as long as the tab was open — the one arrangement where the ceiling was needed most.
          if (o.shots && taken >= o.shots) { log('that was the last of', o.shots, 'shots'); api.cut(); return; }
          const sh = shots[i % shots.length]; i++; taken++; until = now + o.hold;
          api._shot = sh.name;
          angle += 1.7 + Math.random();                 // cut to a genuinely different angle
          fresh = true;                                 // SNAP on a cut — never swoop through bad framing
          log('shot:', sh.name);
        }
        const sh = shots[(i - 1) % shots.length];
        angle += sh.drift || 0.00012;                    // a slow push, never a shake
        const c = sh.at();
        const cam = w.camera;
        const want = { x: c.x + Math.cos(angle) * sh.r, y: sh.h, z: c.z + Math.sin(angle) * sh.r };
        if (fresh) {                                    // the cut lands instantly, then the shot breathes
          cam.position.set(want.x, want.y, want.z);
          fresh = false;
          if (o.film) { setTimeout(() => { if (api._filming) api.see({ width: 640, send: true }); }, 260); }
        } else if (cam.position.lerp) {
          cam.position.lerp(want, 0.06);
        } else {
          cam.position.set(want.x, want.y, want.z);
        }
        // never let the lens drift inside the ring, whatever the easing does
        const d = Math.hypot(cam.position.x - c.x, cam.position.z - c.z);
        if (d < portalR + 6) {
          const k = (portalR + 6) / (d || 1);
          cam.position.x = c.x + (cam.position.x - c.x) * k;
          cam.position.z = c.z + (cam.position.z - c.z) * k;
        }
        cam.lookAt(c.x, sh.look, c.z);
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      return true;
    },

    _crowd() {
      const w = W(); const pts = [];
      try { w.multiplayer && w.multiplayer.players.forEach(p => { const q = p.avatar && p.avatar.position; if (q) pts.push(q); }); } catch (e) {}
      if (!pts.length) return { x: 0, z: 0 };
      return { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, z: pts.reduce((a, p) => a + p.z, 0) / pts.length };
    },

    // put the camera down and give the world its legs back
    cut() {
      if (!api._filming) return false;
      api._filming = false;
      const w = W();
      if (w && api._saved) { w.updateMovement = api._saved.updateMovement; if (api._saved.updateHover && w.updateHover) w.updateHover = api._saved.updateHover; }
      api._unhand();
      log('cut — camera down, movement and the pointer restored');
      return true;
    },

    // give the pointer back. look() tells the page it is holding the mouse so the world will
    // turn at all, and only cut() ever let go — so after any look, a page nobody was driving
    // still believed it was captured, and a person's cursor spun the camera.
    _unhand() {
      const w = W();
      if (!api._tookPointer || !w) return false;
      w.isPointerLocked = false; api._tookPointer = false;
      return true;
    },

    // ── the orbs: every selectable thing, where it is on screen ─────────────
    // The VUI's model is a ring of option orbs you select by resting on them. This world
    // already IS that ring — the portals are the orbs. Both a person's cursor and an AI's
    // attention read the same list, so "look at an orb and select it" means one thing here.
    orbs() {
      const w = W(); if (!w || !w.portals || !window.THREE) return [];
      const cvs = (w.renderer && w.renderer.domElement) || document.querySelector('canvas');
      const r = (cvs || document.body).getBoundingClientRect();
      const out = [];
      for (const pt of w.portals) {
        let n = pt; while (n && !(n.userData && n.userData.url) && n.parent) n = n.parent;
        const ud = (n && n.userData) || {}; if (!ud.url) continue;
        const o = pt.parent || pt;
        const v = new window.THREE.Vector3(); o.getWorldPosition(v);
        const world = v.clone();
        v.project(w.camera);
        if (v.z > 1) continue;                                  // behind the camera
        const x = r.left + (v.x * 0.5 + 0.5) * r.width, y = r.top + (-v.y * 0.5 + 0.5) * r.height;
        if (x < r.left - 80 || x > r.right + 80 || y < r.top - 80 || y > r.bottom + 80) continue;
        const dist = w.camera.position.distanceTo(world);
        out.push({ name: ud.name || 'portal', url: ud.url, x: Math.round(x), y: Math.round(y),
                   radius: Math.min(150, Math.max(26, Math.round(2600 / Math.max(6, dist)))), distance: Math.round(dist) });
      }
      return out.sort((a, b) => a.distance - b.distance);
    },

    // ── people: the other orbs, the ones that talk back ─────────────────────
    // A player is an orb too. Everyone in the room — person or AI — projects to a point on
    // screen you can rest on and speak to, which is what makes a conversation possible at all
    // between a human and a robot: the same target, the same gesture, the same channel.
    people() {
      const w = W(); if (!w || !w.multiplayer || !window.THREE) return [];
      const cvs = (w.renderer && w.renderer.domElement) || document.querySelector('canvas');
      const r = (cvs || document.body).getBoundingClientRect();
      const out = [];
      try {
        w.multiplayer.players.forEach((pl, id) => {
          const a = pl.avatar; if (!a) return;
          const v = new window.THREE.Vector3(); a.getWorldPosition(v);
          const world = v.clone(); v.project(w.camera);
          if (v.z > 1) return;
          const x = r.left + (v.x * 0.5 + 0.5) * r.width;
          // aim at the head, not the feet — and CULL THE POINT WE ACTUALLY RETURN. Testing the
          // pre-offset point against the viewport while handing back a point 40px higher means
          // someone standing near the top edge is culled while still visible, or kept while
          // their target has slid off it.
          const y = r.top + (-v.y * 0.5 + 0.5) * r.height - 40;
          // only people you can actually see are targets — an off-screen projection is a
          // point behind you, and resting "on" it would select whatever is really there
          if (x < r.left - 40 || x > r.right + 40 || y < r.top - 40 || y > r.bottom + 40) return;
          const dist = w.camera.position.distanceTo(world);
          const name = pl.username || (pl.metadata && pl.metadata.username) || String(id).slice(0, 6);
          out.push({ id: String(id), name, isAI: /🤖|\(AI\)/.test(name), x: Math.round(x), y: Math.round(y),
                     radius: Math.min(90, Math.max(30, Math.round(1400 / Math.max(4, dist)))), distance: Math.round(dist) });
        });
      } catch (e) {}
      return out.sort((a, b) => a.distance - b.distance);
    },

    // the same ring of things to say that a person is shown — one surface, both kinds of
    // player. An AI that answers by picking an option is using the identical mechanic.
    dialogue(peerId) {
      const who = api.people().find(p => p.id === String(peerId));
      if (!who) return [];
      const G = (typeof window !== 'undefined' && window.NexusDialogue);
      if (!G) { log('dialogue.js not loaded in this world'); return []; }
      return G.options({ who: { id: who.id, name: who.name, isAI: who.isAI },
                         chat: api.snapshot().chat || [], portals: api.orbs() });
    },

    // say something TO someone — and to nobody else. Sending to every connection and merely
    // labelling it `to` is not addressing a message, it is broadcasting one with a note on it.
    async tell(peerId, text) {
      const w = W(); const mp = w && w.multiplayer; if (!mp) return false;
      const who = (mp.players.get(peerId) || {});
      const line = String(text).slice(0, 240);
      let sent = 0;
      const direct = mp.connections.get(peerId);
      if (direct) { try { direct.send({ type: 'chat', message: line, to: peerId }); sent++; } catch (e) {} }
      else if (!mp.isHost) {
        // a joiner holds one connection — to the host — so a message for another joiner goes
        // to the host addressed, and the host passes it along to that peer alone
        mp.connections.forEach((c) => { try { c.send({ type: 'chat', message: line, to: peerId }); sent++; } catch (e) {} });
      } else {
        // the host is connected to EVERYONE, so a peer it cannot find is simply not here.
        // Falling through to a broadcast would send a private line to the whole room and
        // then report success for a message that never reached its addressee.
        log('no such peer to tell:', String(peerId).slice(0, 12));
        return false;
      }
      try { mp.displayChat(mp.peer && mp.peer.id || 'me', line); } catch (e) {}
      log('to', (who.username || peerId).slice(0, 20) + ':', line);
      return sent;
    },

    // ── the pointer: what is under that point, and pressing it ──────────────
    // A hand in the VUI is a CURSOR, not a gamepad: the fingertip designates and the pinch
    // presses whatever it is over. Two kinds of thing can be under it, so there are two
    // honest answers:
    //   · a DOM control (a button, an input) — press it exactly where the finger is
    //   · the 3D canvas — this world hit-tests from the CROSSHAIR, not the mouse, so a
    //     pointer cannot click a portal it is merely hovering. The driver turns to face
    //     what the finger picked and then clicks, which is what a person does too.
    hover(px, py) {
      // elementFromPoint throws on a point that is not a number, and a fingertip is a number
      // somebody else measured
      if (!isFinite(Number(px)) || !isFinite(Number(py))) { log('refused: hover needs a point on the screen'); return { kind: 'nothing' }; }
      const el = document.elementFromPoint(px, py);
      const cvs = (() => { const w = W(); return (w && w.renderer && w.renderer.domElement) || document.querySelector('canvas'); })();
      if (el && el !== cvs && (el.closest('button, a, input, [onclick], [role=button]'))) {
        const c = el.closest('button, a, input, [onclick], [role=button]');
        return { kind: 'control', label: (c.textContent || c.value || c.id || 'control').trim().slice(0, 40), el: c };
      }
      // An orb is selectable if the pointer is inside its circle — the forgiving target a
      // person expects from a button. Circles OVERLAP, though, so "the first one that
      // contains the point" hands every click to whichever orb happens to be nearest the
      // camera. Score by how centred the pointer is within each orb instead: the one you
      // are most obviously pointing at wins.
      // ONE pass over everything selectable. Returning the first person who merely contains
      // the pointer would re-introduce exactly the bug the score was written to kill: a person
      // clipping the edge of the cursor would win over the portal it is dead centre of.
      let best = null, bestScore = Infinity, bestKind = null;
      for (const who of api.people()) {
        const score = Math.hypot(px - who.x, py - who.y) / who.radius;
        if (score <= 1 && score < bestScore) { bestScore = score; best = who; bestKind = 'person'; }
      }
      for (const orb of api.orbs()) {
        const score = Math.hypot(px - orb.x, py - orb.y) / orb.radius;
        if (score <= 1 && score < bestScore) { bestScore = score; best = orb; bestKind = 'portal'; }
      }
      if (bestKind === 'person') return { kind: 'person', label: best.name, id: best.id, isAI: best.isAI, distance: best.distance, person: best, centred: +bestScore.toFixed(2) };
      if (bestKind === 'portal') return { kind: 'portal', label: best.name, name: best.name, url: best.url, distance: best.distance, orb: best, centred: +bestScore.toFixed(2) };
      const w = W();
      if (!w || !w.raycaster || !w.portals || !window.THREE) return { kind: 'nothing' };
      const r = (cvs || document.body).getBoundingClientRect();
      const ndc = new window.THREE.Vector2(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1);
      w.raycaster.setFromCamera(ndc, w.camera);
      const hit = w.raycaster.intersectObjects(w.portals, true)[0];
      if (hit) {
        let o = hit.object; while (o && !(o.userData && o.userData.url) && o.parent) o = o.parent;
        const ud = (o && o.userData) || {};
        if (ud.url) return { kind: 'portal', label: ud.name || 'portal', name: ud.name, distance: Math.round(hit.distance) };
      }
      return { kind: 'world' };
    },

    // the pinch: press what the finger is over
    async pick(px, py) {
      const what = api.hover(px, py);
      if (what.kind === 'control') { what.el.click(); log('pressed', what.label); return what; }
      if (what.kind === 'portal') {
        // Selecting an orb means GOING to it: turn, walk up, then click — the same sequence
        // travel() uses and the same thing a person does at a doorway. (Aiming and clicking
        // from across the plaza does not open it; the approach is part of the gesture.)
        log('picked portal', what.label, '— walking to it');
        const entered = await api.travel(what.name);
        return { kind: 'portal', label: what.label, entered };
      }
      await api.click(px, py);                   // an honest click on empty world
      return what;
    },

    async press(selector) {
      // querySelector THROWS on a string that is not a selector, and a model writes the string
      let el = null;
      try { el = selector === undefined || selector === null ? null : document.querySelector(String(selector)); }
      catch (e) { log('refused: not a selector —', String(selector).slice(0, 60)); return false; }
      if (!el) { log('nothing matches', String(selector).slice(0, 60)); return false; }
      el.click(); await sleep(80); return true;
    },
    async wait(ms) {
      // waits in slices, so the operator's stop reaches a wait that has already begun
      const whole = await rest(capped(ms, 0, MAX_WAIT_MS, 1000, 'wait ms'), api._gen);
      if (!whole) log('wait cut short — stopped');
      return true;
    },

    // ONE place where a verb becomes an action, so every door into the hands — a program, a
    // mind's move, the console — meets the same arguments, the same bounds, the same refusals.
    async _do(s, onStep) {
      const verb = s && s.do;
      return verb === 'look' ? await api.look(s.dx || 0, s.dy || 0)
        : verb === 'walk' ? await api.walk(s.dir || 'forward', s.ms || 600)
        : verb === 'click' ? await api.click(s.x, s.y)
        : verb === 'aim' ? await api.aim(s.portal)
        : verb === 'travel' ? await api.travel(s.portal)
        : verb === 'ask' ? await api.ask(s.text)
        : verb === 'say' ? await api.say(s.text)
        : verb === 'press' ? await api.press(s.selector)
        : verb === 'wait' ? await api.wait(s.ms || 1000)
        : verb === 'see' ? api.see(s)
        : verb === 'sense' ? api.sense(s)
        : verb === 'carry' ? api.carry(s.payload || {})
        // the mind's own move is journalled through the same onStep as any other step: it is a
        // real action, it belongs on the receipt, and it costs a turn against the budget
        : verb === 'mind' ? await api.mind(Object.assign({}, s, { onStep }))
        : verb === 'camera' ? await api.camera(s)
        : verb === 'cut' ? api.cut()
        : verb === 'pick' ? await api.pick(s.x, s.y)
        : verb === 'hover' ? api.hover(s.x, s.y)
        : verb === 'orbs' ? api.orbs()
        : verb === 'people' ? api.people()
        : verb === 'tell' ? await api.tell(s.to, s.text)
        : verb === 'dialogue' ? api.dialogue(s.to)
        : verb === 'scan' ? await api.scan(s.steps, s.deg)
        : (log('unknown step', verb), null);
    },

    // run a program: a list of steps, each a verb above
    async run(program, onStep) {
      const steps = program && program.steps;
      // a program is a LIST. `steps: {}` used to throw "steps is not iterable" out of run and
      // leave _running true forever — a driver that reports it is playing and never will be —
      // while a program that is not an object at all ran nothing and reported 'done' for it
      if (!Array.isArray(steps)) { log('refused: a program is a list of steps'); return 'refused'; }
      if (program && program.loop && !steps.length) { log('refused: an empty program cannot loop'); return 'refused'; }
      api._halt();                        // end whatever was running; the camera is not ours to cut
      api._running = true;
      const gen = api._gen;               // this run's generation — a stop bumps it
      try {
      do {
        for (const s of steps) {
          if (!api._running || api._gen !== gen) return 'stopped';
          const verb = s && s.do;
          try {
            const out = await api._do(s, onStep);
            onStep && onStep(verb, out);
          } catch (e) {
            // A FAILING STEP STILL COSTS A TURN. Counting only the steps that succeed lets a
            // program that throws on every verb run forever inside a budget meant to stop it —
            // the kill switch would be watching a number that never moves.
            log('step failed', verb, e.message);
            // journalled as a failure, not as an ordinary result — a log that renders a thrown
            // step the same as a successful one hides exactly what an operator is watching for
            onStep && onStep(verb, { error: String(e && e.message || e) }, e);
          }
        }
        // A LOOP THAT NEVER AWAITS NEVER ENDS. Every verb here can be synchronous — see, orbs,
        // hover, an unknown step — and a do-while over synchronous verbs is a tight loop on the
        // one thread the page has: the tab freezes solid, and the kill switch can never arrive
        // because the click that would call stop() is queued behind a loop that never yields.
        // One yield per lap costs nothing and keeps the stop reachable.
        await sleep(0);
      } while (api._running && api._gen === gen && program && program.loop);
      } finally { if (api._gen === gen) api._running = false; }
      return 'done';
    },

    // end the program, and nothing else: a new program replaces the old one, but it is not the
    // operator's kill switch, so a camera the operator put up stays up.
    _halt() { api._running = false; api._gen++; return true; },

    // THE KILL SWITCH, and a stop that leaves one clock running is not a stop. It ends the
    // program, retires the generation everything in flight belongs to (a walk mid-stride, a
    // wait, a scan, a mind still waiting on a model), puts the camera down — which is its own
    // requestAnimationFrame loop AND the reason the world's legs are stubbed out — and hands
    // the pointer back.
    stop() {
      api._halt();
      api.cut();
      api._unhand();
      return true;
    },
    _running: false, _filming: false, _shot: null, _gen: 0,
  };

  window.__autodrive = api;
  // the console IS the CLI: `drive.say("hi")`, `drive.travel("Crystal")`, `drive.snapshot()`
  window.drive = api;
  log('hands ready — window.drive' + (ARRIVED_WITH ? ' · arrived carrying ' + Object.keys(ARRIVED_WITH).join(',') : ''));
  try { parent.postMessage({ __autodrive: 'ready', title: document.title }, '*'); } catch (e) {}
})();

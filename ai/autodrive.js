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
    const text = JSON.stringify(payload || {});
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
        players.push({ id: String(id).slice(0, 6), name: (p.username || p.metadata && p.metadata.username) || null })); } catch (e) {}
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
      mouse('mousemove', { movementX: dx | 0, movementY: dy | 0 });
      await sleep(30);
      return api.snapshot().me;
    },

    async walk(dir, ms) {
      const k = { forward: 'w', back: 's', left: 'a', right: 'd' }[dir] || dir;
      key(k, true); await sleep(Math.max(50, ms | 0)); key(k, false); await sleep(40);
      return api.snapshot().me;
    },

    async click(x, y) {
      if (api._filming) { log('refused: a camera does not click — it would step through a portal mid-shot'); return false; }
      const o = { clientX: x === undefined ? innerWidth / 2 : x, clientY: y === undefined ? innerHeight / 2 : y };
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
      const p = (w.portalIndex || []).find(p => p.name.toLowerCase().includes(String(name).toLowerCase()));
      if (!p) { log('no portal called', name); return false; }
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
      await api.click();
      log('entered', name, api._carry ? '(carrying ' + Object.keys(api._carry).join(',') + ')' : '');
      return true;
    },

    // the in-world AI chat: type in the real input, press Enter on it
    async ask(text) {
      const el = document.getElementById('ai-chat-input');
      if (!el) { log('no ai chat on this page'); return false; }
      const box = document.getElementById('ai-chat-interface');
      if (box && getComputedStyle(box).display === 'none') { const b = document.querySelector('[onclick*="aiManager"],.ai-chat-toggle'); b && b.click(); await sleep(200); }
      el.focus(); el.value = String(text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true, cancelable: true }));
      await sleep(120);
      return true;
    },

    // speak to the other people in the room
    async say(text) {
      const w = W(); const mp = w && w.multiplayer; if (!mp) { log('not in a room'); return false; }
      let sent = 0;
      mp.connections && mp.connections.forEach(c => { try { c.send({ type: 'chat', message: String(text) }); sent++; } catch (e) {} });
      try { mp.displayChat(mp.peer && mp.peer.id || 'me', String(text)); } catch (e) {}
      log('said to', sent, 'peer(s):', text);
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
      let uri;
      try {
        if (o.width && cvs.width > o.width) {
          const h = Math.round(cvs.height * (o.width / cvs.width));
          const off = document.createElement('canvas'); off.width = o.width; off.height = h;
          off.getContext('2d').drawImage(cvs, 0, 0, o.width, h);
          uri = off.toDataURL(o.format, o.quality);
        } else {
          uri = cvs.toDataURL(o.format, o.quality);
        }
      } catch (e) { log('vision failed:', e.message); return null; }
      const blank = uri.length < 900;                    // an all-black frame compresses to nothing
      const shot = { uri, bytes: uri.length, w: o.width, blank, at: new Date().toISOString(), world: document.title };
      if (o.send !== false) { try { parent.postMessage({ __autodrive: 'vision', shot }, '*'); } catch (e) {} }
      log('saw', Math.round(uri.length / 1024) + 'KB' + (blank ? ' (looks blank — is anything rendered?)' : ''));
      return shot;
    },

    // look around and bring back several frames — a turn of the head, not one glance
    async scan(steps, degPerStep) {
      const n = Math.max(1, steps | 0 || 4), d = degPerStep || 90;
      const shots = [];
      for (let i = 0; i < n; i++) { shots.push(api.see({ send: true })); await api.look(d * 2.2, 0); await sleep(120); }
      return shots.map(s => s && s.bytes);
    },

    // ── the mind: percepts in, one move out ─────────────────────────────────
    // The player's mind is a RAPP brainstem. Perception (state + a picture) goes in; the
    // reply comes back on two channels — words for the room, and the NEXUS sense's JSON
    // block for the hands (ai/senses/nexus_sense.py). Words are said, the move is made.
    // Without a grant it does nothing and says so: a mindless player is honest, not fake.
    async mind(opts, inheritedGen) {
      const o = Object.assign({ url: 'http://localhost:7071/chat', vision: true, act: true }, opts || {});
      // TWO DOORS TO A MIND, and a player will take whichever is open.
      //   · a brainstem on this machine — the real thing, with its senses and its memory
      //   · the visitor's own GitHub Copilot seat, through the device-code flow Heimdall's
      //     doorman uses (ai/copilot_auth.js). No install, no separate meter: it spends the
      //     Copilot seat the person already has, and only while they are here.
      // Neither present means the player runs on its program alone, and says so.
      // A turn belongs to the generation of whatever INVOKED it. Reading one off the clock
      // instead re-stamped a `mind` step that was executing inside an already-voided frame
      // with the live generation, which made both speech gates below unreachable in the one
      // case they exist for: a resurrected program spoke, and billed, while the tower
      // reported it stopped. As a step, the generation is handed in. Entered directly
      // (drive.mind() at the tab CLI) there is no caller to inherit from, so the turn IS
      // the operator's action and adopts the current generation.
      const myTurn = typeof inheritedGen === 'number' ? inheritedGen : api._epoch;
      if (typeof inheritedGen !== 'number') api._liveTurn = api._epoch;
      if (myTurn !== api._epoch) { log('turn belongs to a stopped generation — not thinking'); return null; }
      const secret = (() => { try { return sessionStorage.getItem('brainstem-secret') || ''; } catch (e) { return ''; } })();
      const auth = (typeof window !== 'undefined' && window.NexusAuth);
      const viaCopilot = !secret && auth && auth.signedIn();
      if (!secret && !viaCopilot) { log('no mind granted (no brainstem, not signed in) — running on the program alone'); return null; }
      // THE BEST MIND AVAILABLE, IN ORDER. A vbrainstem here in the page means the model can
      // call the verbs directly instead of describing them for us to parse — so prefer it
      // whenever it is loaded and there is a Copilot seat to run it on.
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
          // A turn that was killed while parked in auth.chat must not deliver the line
          // it was carrying: the reply arrives long after the operator pulled the kill
          // switch, and the tower already reports this player stopped. Only the MOVE was
          // guarded before, so a stopped player went on talking to the whole room.
          if (myTurn !== api._epoch) { log('turn was stopped while thinking — not speaking'); return { words: '', move: null, via: 'vbrainstem' }; }
          if (r.words) await api.say(r.words.slice(0, 240));
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
      // same gate as the vbrainstem path above: the chat call has no timeout, so this
      // reply can land minutes after a stop
      if (myTurn !== api._epoch) { log('turn was stopped while thinking — not speaking'); return { words: '', move: null }; }
      if (words) await api.say(words.slice(0, 240));
      let move = null;
      try { const m = String(block).match(/\{[\s\S]*\}/); if (m) move = JSON.parse(m[0]); } catch (e) {}
      if (!move || !move.do) { log('mind spoke but named no move'); return { words, move: null }; }
      if (!['look','walk','click','aim','travel','say','ask','press','wait','see','scan','sense','carry'].includes(move.do)) {
        log('refused a move the hands do not have:', move.do); return { words, move: null };
      }
      if (o.act) await api.run({ steps: [move] }, null, { turn: myTurn });
      return { words, move };
    },

    // ── camera operator: holds good views, and cannot fall into a portal ─────
    // A camera is not a player. It parks the world's own movement, stands OUTSIDE the
    // portal ring, and frames the action. Travel and click are refused for as long as it
    // is filming — the safety is structural, not a promise: a camera that cannot click
    // cannot wander through a doorway mid-shot.
    async camera(opts) {
      const o = Object.assign({ radius: 30, height: 10, hold: 7000, shots: 0, film: true }, opts || {});
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
          const sh = shots[i % shots.length]; i++; until = now + o.hold;
          api._shot = sh.name;
          angle += 1.7 + Math.random();                 // cut to a genuinely different angle
          fresh = true;                                 // SNAP on a cut — never swoop through bad framing
          log('shot:', sh.name);
          if (o.shots && taken >= o.shots) { api.cut(); return; }
        }
        const sh = shots[(i - 1) % shots.length];
        angle += sh.drift || 0.00012;                    // a slow push, never a shake
        const c = sh.at();
        const cam = w.camera;
        const want = { x: c.x + Math.cos(angle) * sh.r, y: sh.h, z: c.z + Math.sin(angle) * sh.r };
        if (fresh) {                                    // the cut lands instantly, then the shot breathes
          cam.position.set(want.x, want.y, want.z);
          fresh = false;
          if (o.film) { setTimeout(() => { if (api._filming) { api.see({ width: 640, send: true }); taken++; } }, 260); }
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
      if (api._tookPointer && w) { w.isPointerLocked = false; api._tookPointer = false; }
      log('cut — camera down, movement and the pointer restored');
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

    async press(selector) { const el = document.querySelector(selector); if (!el) return false; el.click(); await sleep(80); return true; },
    async wait(ms) { await sleep(ms | 0); return true; },

    // run a program: a list of steps, each a verb above
    // `opts.turn` marks a call ISSUED BY a turn — mind() executing the move the model
    // chose, or vbrainstem executing a tool call. Anything without it is an operator
    // action: the tower's start button, the per-tab CLI, a view's own program.
    //
    // The caller DECLARES which it is; nothing is inferred from _depth. Inferring is
    // what broke this twice. _depth said "nested" for a turn parked in an
    // un-timeoutable auth.chat fetch, so every later operator run was silently refused;
    // and it said "top level" for a drive.mind() typed at the CLI, so the turn's own
    // first tool call cancelled the turn that issued it. A counter cannot answer
    // "is the turn that issued this still alive" — only the caller knows.
    async run(program, onStep, opts) {
      const steps = (program && program.steps) || [];
      // Ask whether the caller DECLARED a turn, not whether the declaration is truthy.
      // Generation 0 is the generation every freshly loaded page starts in, and `0` is
      // falsy: testing `opts.turn` sent the first turn of every page down the operator
      // branch, where it called stop() and cancelled the turn that issued it — this
      // mechanism's own bug, for the third time, one layer over. The claim is a value;
      // its presence is the question.
      if (opts && Object.prototype.hasOwnProperty.call(opts, 'turn')) {
        // The claim carries the GENERATION it belongs to, not a bare "I am a turn".
        // A boolean would let a zombie through: a turn parked in auth.chat that wakes
        // after the operator has already started a different program would claim the
        // NEW generation and run a step inside someone else's program — two minds
        // driving one avatar. Naming the generation makes a stale caller answerable.
        const claim = typeof opts.turn === 'number' ? opts.turn : api._liveTurn;
        if (claim !== api._epoch) return 'stopped';
      } else {
        // An operator run replaces EVERYTHING, including work parked in an await that
        // may never settle. Bumping the generation is what tells a parked turn it is
        // over; clearing the depth is what stops its abandoned frames from being
        // mistaken for this run's parents.
        api.stop();
        api._depth = 0;
        api._liveTurn = api._epoch;
      }
      // The generation THIS invocation belongs to. A zombie frame that settles later
      // must not decrement the counters of the run that replaced it.
      const gen = api._epoch;
      api._depth = (api._depth || 0) + 1;
      api._running = true;
      try {
      do {
        for (const s of steps) {
          // `_running` is ONE global flag, so it answers "is anything running", not "am I
          // still the thing that should be running". A frame parked in an await when the
          // operator stopped belongs to a voided generation — and the next operator run
          // sets _running back to true, which used to wake that zombie and let it step and
          // loop beside the program that replaced it. The finally below already knows to
          // ask `gen === api._epoch`; the loop has to ask it too.
          if (!api._running || gen !== api._epoch) return 'stopped';
          const verb = s.do;
          try {
            const out = verb === 'look' ? await api.look(s.dx || 0, s.dy || 0)
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
              : verb === 'mind' ? await api.mind(s, gen)
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
      } while (api._running && gen === api._epoch && program && program.loop);
      return 'done';
      } finally {
        // in a finally so a thrown step can never strand the counter. Only the live
        // generation owns the counters: a frame abandoned by a stop settles into a
        // world that has moved on, and touching _depth/_running there would end a run
        // that replaced it.
        if (gen === api._epoch) {
          api._depth = Math.max(0, (api._depth || 1) - 1);
          if (api._depth === 0) api._running = false; // only the outermost run ends the run
        }
      }
    },

    // A stop voids the current generation. It deliberately does NOT zero _depth: doing
    // that made the very next call from inside a running turn look top-level, so it took
    // the branch that re-arms _running and cancelled the stop. The depth drains on its
    // own as the stack unwinds.
    stop() { api._running = false; api._epoch = (api._epoch || 0) + 1; return true; },
    // _epoch    — bumped by stop(); everything issued before it is void
    // _liveTurn — the generation the operator program currently on the stack belongs to
    _running: false, _depth: 0, _epoch: 0, _liveTurn: 0, _filming: false, _shot: null,
  };

  window.__autodrive = api;
  // the console IS the CLI: `drive.say("hi")`, `drive.travel("Crystal")`, `drive.snapshot()`
  window.drive = api;

  // ── the label is not the caller's job ──────────────────────────────────────
  // "Every AI player is labelled as an AI to everyone in the room" is an
  // invariant of this system, and an invariant a caller has to remember is one
  // that eventually gets forgotten — it already was, by the new live views grid,
  // which set NEXUS_IS_AI but never touched the multiplayer username, so its
  // players would have appeared to the room as unlabelled people.
  //
  // So the driver labels itself the moment it has hands. Anything that arms a
  // driver gets this for free and cannot opt out by omission. It is idempotent,
  // so a caller that also labels (the control tower does) changes nothing.
  api.labelAsAI = function (persona) {
    // Only an AI player gets labelled as one. frontier.html arms this same driver
    // for a PERSON at the keyboard; stamping "🤖 (AI)" on their name would be a
    // lie in the opposite direction, and the honesty rule cuts both ways. A
    // persona is set by whatever drives on an AI's behalf (the tower, the views
    // grid); no persona and no declared AI intent means a human is flying.
    const who = persona || window.NEXUS_PERSONA;
    if (!who && !window.NEXUS_IS_AI) return false;
    try {
      const mp = window.worldNavigator && window.worldNavigator.multiplayer;
      if (mp) {
        const tag = '🤖 ' + (who || 'agent') + ' (AI)';
        if (mp.username !== tag) mp.username = tag;
        if (mp.peer) mp.peer.__isAI = true;
      }
      window.NEXUS_IS_AI = true;
      return true;
    } catch (e) { return false; }
  };
  // The world may not have built its multiplayer yet when the driver arms, so
  // try until it exists rather than labelling once into a void.
  (function labelWhenPossible(tries) {
    if (!window.NEXUS_PERSONA && !window.NEXUS_IS_AI) {
      // nobody has claimed this is an AI yet; check again in case a driver is
      // still setting up, but never label a frame that stays human
      if (tries > 40) return;
      setTimeout(() => labelWhenPossible(tries + 1), 500);
      return;
    }
    if (api.labelAsAI() && window.worldNavigator && window.worldNavigator.multiplayer) return;
    if (tries > 40) return;                       // ~20s, then give up quietly
    setTimeout(() => labelWhenPossible(tries + 1), 500);
  })(0);
  log('hands ready — window.drive' + (ARRIVED_WITH ? ' · arrived carrying ' + Object.keys(ARRIVED_WITH).join(',') : ''));
  try { parent.postMessage({ __autodrive: 'ready', title: document.title }, '*'); } catch (e) {}
})();

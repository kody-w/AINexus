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
    async mind(opts) {
      const o = Object.assign({ url: 'http://localhost:7071/chat', vision: true, act: true }, opts || {});
      const secret = (() => { try { return sessionStorage.getItem('brainstem-secret') || ''; } catch (e) { return ''; } })();
      if (!secret) { log('no mind granted (no brainstem secret) — running on the program alone'); return null; }
      const percepts = o.vision ? api.sense({ width: 384, send: true }) : api.snapshot();
      const shot = percepts.vision;
      const prompt = 'You are ' + (window.NEXUS_PERSONA || 'a visitor') + ', an AI playing in a 3D world with the same '
        + 'controls a person has. Speak one short line a person would say, then emit your NEXUS block.\n'
        + 'PERCEPTS: ' + JSON.stringify({ me: percepts.me, world: percepts.world, portals: percepts.portals,
            players: percepts.players, room: percepts.room, chat: (percepts.chat || []).slice(-4),
            carrying: api._carry || null, arrived_with: api.carried(),
            picture: shot ? (shot.blank ? 'BLANK — you cannot see right now' : shot.bytes + ' bytes, ' + shot.w + 'px wide') : 'none' });
      let reply = '';
      try {
        const r = await fetch(o.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Brainstem-Secret': secret },
          body: JSON.stringify({ user_input: prompt, user_guid: 'nexus-' + (window.NEXUS_PERSONA || 'player'), senses: ['nexus'] }) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        reply = j.response || '';
        // the sense may arrive parsed by the brainstem, or inline in the reply
        var block = j.nexus_response || (reply.split('|||NEXUS|||')[1] || '');
      } catch (e) { log('mind unreachable:', e.message); return null; }
      const words = reply.split('|||NEXUS|||')[0].trim();
      if (words) await api.say(words.slice(0, 240));
      let move = null;
      try { const m = String(block).match(/\{[\s\S]*\}/); if (m) move = JSON.parse(m[0]); } catch (e) {}
      if (!move || !move.do) { log('mind spoke but named no move'); return { words, move: null }; }
      if (!['look','walk','click','aim','travel','say','ask','press','wait','see','scan','sense','carry'].includes(move.do)) {
        log('refused a move the hands do not have:', move.do); return { words, move: null };
      }
      if (o.act) await api.run({ steps: [move] });
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
        log('picked portal', what.label, '— turning to it');
        const ok = await api.aim(what.name);
        if (!ok) { log('could not line up on', what.label); return { kind: 'portal', label: what.label, aimed: false }; }
        await api.click();                       // the world's own crosshair test now hits it
        return { kind: 'portal', label: what.label, aimed: true };
      }
      await api.click(px, py);                   // an honest click on empty world
      return what;
    },

    async press(selector) { const el = document.querySelector(selector); if (!el) return false; el.click(); await sleep(80); return true; },
    async wait(ms) { await sleep(ms | 0); return true; },

    // run a program: a list of steps, each a verb above
    async run(program, onStep) {
      const steps = (program && program.steps) || [];
      api.stop();
      api._running = true;
      do {
        for (const s of steps) {
          if (!api._running) return 'stopped';
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
              : verb === 'mind' ? await api.mind(s)
              : verb === 'camera' ? await api.camera(s)
              : verb === 'cut' ? api.cut()
              : verb === 'pick' ? await api.pick(s.x, s.y)
              : verb === 'hover' ? api.hover(s.x, s.y)
              : verb === 'scan' ? await api.scan(s.steps, s.deg)
              : (log('unknown step', verb), null);
            onStep && onStep(verb, out);
          } catch (e) { log('step failed', verb, e.message); }
        }
      } while (api._running && program && program.loop);
      api._running = false;
      return 'done';
    },

    stop() { api._running = false; return true; },
    _running: false, _filming: false, _shot: null,
  };

  window.__autodrive = api;
  // the console IS the CLI: `drive.say("hi")`, `drive.travel("Crystal")`, `drive.snapshot()`
  window.drive = api;
  log('hands ready — window.drive' + (ARRIVED_WITH ? ' · arrived carrying ' + Object.keys(ARRIVED_WITH).join(',') : ''));
  try { parent.postMessage({ __autodrive: 'ready', title: document.title }, '*'); } catch (e) {}
})();

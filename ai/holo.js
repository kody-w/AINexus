/* holo.js — you are where you are projected.
 *
 * Four players in four tabs were four separate worlds that happened to look alike: every view
 * was empty of other people because there were no other people in it. The obvious fix is to make
 * them share one instance and fight the handshake until they do.
 *
 * This is the other fix, and it is the one this estate already believes: a presence is an
 * identity projected through a transform. So a player PUBLISHES its pose — where it stands,
 * which way it faces, whether it is speaking — and every world PAINTS everyone else as a
 * hologram at that pose. They can be in different worlds, on different machines, in different
 * instances of different scenes, and still be visibly there to each other.
 *
 * A holo does not pretend to be a body. It reads as a projection on purpose — translucent, lit
 * from within, standing on a ring of light — because a projection that pretends to be a person
 * is a lie the moment the connection drops.
 *
 * Transport is whatever is available, in order:
 *   · BroadcastChannel — other tabs on this origin, which is what a recording rig is
 *   · the room's own peer connections, when a multiplayer session exists
 * Both carry the same tiny pose frame, so a world does not care which one it heard.
 */
(function (root) {
  'use strict';

  const CH = 'nexus:presence';
  const GONE_MS = 6000;                 // a presence unheard this long has left
  const SEND_MS = 120;
  const HIST = 24;                      // how many matched frames to calibrate against

  const state = { me: null, others: new Map(), group: null, world: null, bus: null,
                  publishing: null, painting: null, seen: 0, sent: 0, frame: 0 };

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function bus() {
    if (state.bus) return state.bus;
    try { state.bus = new BroadcastChannel(CH); state.bus.onmessage = (e) => receive(e && e.data); }
    catch (e) { state.bus = null; }
    return state.bus;
  }

  function receive(d) {
    if (!d || d.kind !== 'pose' || !d.id) return;
    if (state.me && d.id === state.me.id) return;                 // not your own reflection
    const prev = state.others.get(d.id);
    const t = now();
    const p = { id: d.id, name: d.name || d.id, color: d.color || null,
      world: d.world || null, speaking: !!d.speaking, at: t,
      pos: d.pos || (prev && prev.pos) || { x: 0, y: 0, z: 0 },
      yaw: typeof d.yaw === 'number' ? d.yaw : (prev ? prev.yaw : 0),
      f: typeof d.f === 'number' ? d.f : null,
      shown: prev ? prev.shown : null,
      hist: (prev && prev.hist) || [],
      vel: (prev && prev.vel) || { x: 0, y: 0, z: 0 },
      lead: (prev && prev.lead) || 0,          // how far ahead to project, in ms
      err: (prev && prev.err) || null,          // last matched-frame error, in metres
      rms: (prev && prev.rms) || null };

    // ── the double calibration ─────────────────────────────────────────────
    // Both sides are numbering their frames, so a pose is not just "here I am" — it is "here I
    // was at frame N". That means the painter can go back to what it was SHOWING at frame N and
    // compare. The gap between the two is the projection's error, measured against the source's
    // own record rather than guessed, and it is the amount to lead by next time.
    if (prev && prev.at) {
      const dt = Math.max(1, t - prev.at);
      p.vel = { x: (p.pos.x - prev.pos.x) / dt, y: (p.pos.y - prev.pos.y) / dt, z: (p.pos.z - prev.pos.z) / dt };
      // what did we paint while that frame was in flight?
      const painted = prev.paintedAt ? prev.painted : null;
      if (painted) {
        const e = Math.hypot(p.pos.x - painted.x, p.pos.y - painted.y, p.pos.z - painted.z);
        p.err = +e.toFixed(3);
        prev.hist.push(e);
        while (prev.hist.length > HIST) prev.hist.shift();
        const n = prev.hist.length;
        p.rms = +Math.sqrt(prev.hist.reduce((a, v) => a + v * v, 0) / n).toFixed(3);
        // lead by the time the error implies at the speed it is going, damped so it settles
        const speed = Math.hypot(p.vel.x, p.vel.y, p.vel.z);
        const want = speed > 1e-5 ? Math.min(600, e / speed) : 0;
        p.lead = prev.lead + (want - prev.lead) * 0.25;
      }
      p.hist = prev.hist;
    }
    state.others.set(d.id, p);
    state.seen++;
  }

  // ── publishing: this is where I am ───────────────────────────────────────
  function publish(opts) {
    const o = opts || {};
    state.me = { id: o.id || ('holo-' + Math.floor(now())), name: o.name || o.id || 'someone',
                 color: o.color || null };
    if (state.publishing) clearInterval(state.publishing);
    const send = () => {
      const w = root.worldNavigator;
      const c = w && w.camera && w.camera.position;
      const pose = { kind: 'pose', id: state.me.id, name: state.me.name, color: state.me.color,
        f: state.frame++, t: Math.round(now()),      // WHICH FRAME this is, and when it was sent
        world: (typeof document !== 'undefined' && document.title) || null,
        speaking: !!root.__holoSpeaking,
        pos: c ? { x: +c.x.toFixed(2), y: +c.y.toFixed(2), z: +c.z.toFixed(2) } : { x: 0, y: 0, z: 0 },
        yaw: +(((w && w.rotation && w.rotation.y) || (w && w.camera && w.camera.rotation.y) || 0)).toFixed(3) };
      const b = bus(); if (b) { try { b.postMessage(pose); state.sent++; } catch (e) {} }
      // and to the room, if this world is in one — same frame, different pipe
      try {
        const mp = w && w.multiplayer;
        mp && mp.connections && mp.connections.forEach(cn => { try { cn.send({ type: 'holo', pose }); } catch (e) {} });
      } catch (e) {}
    };
    send();
    state.publishing = setInterval(send, o.everyMs || SEND_MS);
    return state.me;
  }

  // ── painting: everyone else, standing in this world ──────────────────────
  // ONE SET OF SHAPES FOR EVERYBODY. A holo per person built from its own fresh geometry cost
  // more to draw than the real avatars it replaces — measured, not assumed: eight of them added
  // 32 geometries and 40 draw calls. The shapes are identical for every person, so they are
  // built once and shared; only the material carries the colour. What is left per holo is four
  // small meshes over four shared buffers, and no light at all — the avatar path adds a
  // PointLight each, which costs per-pixel shading that a triangle count never shows.
  let SHAPES = null;
  function shapes() {
    const T = root.THREE;
    if (!SHAPES) SHAPES = {
      body: new T.CylinderGeometry(0.42, 0.52, 1.7, 14, 1, true),
      core: new T.SphereGeometry(0.3, 12, 8),
      ring: new T.RingGeometry(0.55, 0.78, 24),
      nose: new T.ConeGeometry(0.12, 0.34, 6),
    };
    return SHAPES;
  }

  function makeHolo(p, opts) {
    const T = root.THREE; if (!T) return null;
    const o = opts || {};
    const g = new T.Group();
    const tint = new T.Color(p.color || tintFor(p.id));
    const S = shapes();
    const mat = (opacity) => new T.MeshBasicMaterial({ color: tint, transparent: true, opacity,
      depthWrite: false, blending: T.AdditiveBlending });

    const body = new T.Mesh(S.body, mat(0.28));
    body.material.side = T.DoubleSide; body.position.y = 0.85; g.add(body);
    const core = new T.Mesh(S.core, mat(0.55)); core.position.y = 1.35; g.add(core);
    const ring = new T.Mesh(S.ring, mat(0.5));
    ring.material.side = T.DoubleSide; ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; g.add(ring);
    const nose = new T.Mesh(S.nose, mat(0.7));
    nose.rotation.x = Math.PI / 2; nose.position.set(0, 1.35, -0.42); g.add(nose);

    // the nameplate is the only per-person texture, so it is optional: a recording rig that
    // draws its own labels does not need eight canvases uploaded to the GPU
    let tag = null;
    if (o.labels !== false) { tag = nameplate(p.name, tint); if (tag) { tag.position.y = 2.15; g.add(tag); } }

    g.userData.holo = { body, core, ring, tag, tint, born: now() };
    return g;
  }

  function tintFor(id) {
    let h = 0; const s = String(id);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const hue = (h % 360) / 360;
    const T = root.THREE;
    return new T.Color().setHSL(hue, 0.75, 0.62);
  }

  function nameplate(text, tint) {
    const T = root.THREE; if (!T || typeof document === 'undefined') return null;
    const c = document.createElement('canvas'); c.width = 512; c.height = 96;
    const x = c.getContext('2d');
    x.font = '600 44px ui-monospace, Menlo, monospace';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = 'rgba(0,0,0,.85)'; x.shadowBlur = 14;
    x.fillStyle = '#' + tint.getHexString();
    x.fillText(String(text).slice(0, 22), 256, 52);
    const tex = new T.CanvasTexture(c);
    const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
    sp.scale.set(2.6, 0.49, 1);
    return sp;
  }

  function attach(opts) {
    const o = opts || {};
    state.opts = o;
    if (state.painting) return state.painting;
    const calibrated = o.calibrate !== false;
    const step = () => {
      const w = root.worldNavigator, T = root.THREE;
      if (w && w.scene && T) {
        if (!state.group || state.group.parent !== w.scene) {
          state.group = new T.Group(); state.group.name = 'holos'; w.scene.add(state.group);
        }
        const t = now();
        for (const [id, p] of state.others) {
          if (t - p.at > GONE_MS) {                       // gone quiet: fade it out honestly
            if (p.shown) { state.group.remove(p.shown); p.shown = null; }
            state.others.delete(id); continue;
          }
          if (!p.shown) { p.shown = makeHolo(p, state.opts); if (p.shown) state.group.add(p.shown); }
          if (!p.shown) continue;
          // WHERE IT WILL BE, not where it was. The pose is already old by the time it arrives,
          // and the easing below adds more lag on top. So aim at the position the calibrated
          // lead says it has reached by now — and remember what was aimed at, because the next
          // frame from that player is what says whether the aim was right.
          const g = p.shown, k = 0.18;
          const age = calibrated ? Math.min(500, (t - p.at) + (p.lead || 0)) : 0;
          const want = { x: p.pos.x + p.vel.x * age, y: p.pos.y + p.vel.y * age, z: p.pos.z + p.vel.z * age };
          p.painted = { x: want.x, y: want.y, z: want.z }; p.paintedAt = t;
          g.position.x += (want.x - g.position.x) * k;
          g.position.y += ((want.y - 1.6) - g.position.y) * k;    // camera is at eye height
          g.position.z += (want.z - g.position.z) * k;
          g.rotation.y += (((p.yaw + Math.PI) - g.rotation.y)) * k;
          const h = g.userData.holo;
          if (h) {
            // NEAR FADE. Additive light a metre from the lens is not a person, it is a flare
            // that eats the shot — and a camera bolted to a wall WILL have somebody walk into
            // it. So a projection thins out as it approaches whatever is looking at it, which
            // is also how a hologram ought to behave.
            const cam = (root.worldNavigator && root.worldNavigator.camera);
            let near = 1;
            if (cam) {
              const d = Math.hypot(cam.position.x - g.position.x, cam.position.y - g.position.y,
                                   cam.position.z - g.position.z);
              near = d < 1.2 ? 0 : d < 4 ? (d - 1.2) / 2.8 : 1;
            }
            h.near = near;
            const breathe = 0.5 + 0.5 * Math.sin(t / 900 + g.position.x);
            h.core.material.opacity = near * (p.speaking ? 0.55 + 0.4 * Math.abs(Math.sin(t / 90)) : 0.35 + 0.2 * breathe);
            h.ring.material.opacity = near * (p.speaking ? 0.75 : 0.35 + 0.25 * breathe);
            h.body.material.opacity = near * 0.28;
            if (h.tag) h.tag.material.opacity = near;
            g.visible = near > 0.02;
            const s = p.speaking ? 1.12 + 0.06 * Math.sin(t / 80) : 1;
            h.core.scale.setScalar(s);
          }
        }
      }
      state.painting = requestAnimationFrame(step);
    };
    state.painting = requestAnimationFrame(step);
    bus();
    return state.painting;
  }

  // a world already in a room can hand us poses that arrived over its own connections
  function ingest(pose) { receive(pose); }

  function stop() {
    if (state.publishing) clearInterval(state.publishing);
    if (state.painting) cancelAnimationFrame(state.painting);
    state.publishing = state.painting = null;
    if (state.group && state.group.parent) state.group.parent.remove(state.group);
    // the shared shapes outlive one attach; the per-person materials and textures do not
    for (const p of state.others.values()) {
      if (!p.shown) continue;
      p.shown.traverse(o => { if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
    }
    state.group = null; state.others.clear();
  }

  root.NexusHolo = { publish, attach, ingest, stop,
    speaking: (on) => { root.__holoSpeaking = !!on; },
    present: () => [...state.others.values()].map(p => ({ id: p.id, name: p.name, world: p.world,
      speaking: p.speaking, pos: p.pos, painted: !!p.shown })),
    stats: () => ({ sent: state.sent, seen: state.seen, others: state.others.size, me: state.me && state.me.id }),
    // what the calibration currently believes, per presence — visible rather than magic
    calibration: () => [...state.others.values()].map(p => ({ id: p.id, frame: p.f,
      errorNow: p.err, rmsOverFrames: p.rms, samples: (p.hist || []).length,
      leadMs: p.lead ? +p.lead.toFixed(0) : 0 })) };
})(typeof window !== 'undefined' ? window : globalThis);

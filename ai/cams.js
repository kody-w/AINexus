/* cams.js — fixed cameras watching the house.
 *
 * Not a player's eyes. These are mounted in corners and looking at the room, the way a house
 * full of cameras watches people who are busy being themselves.
 *
 * They render to their OWN offscreen targets and never touch the visible canvas: the world's
 * renderer was made without preserveDrawingBuffer, so anything drawn to the default framebuffer
 * is both gone by the next read and briefly shown to whoever is standing there. A render target
 * has neither problem — the player never sees a flicker, and the pixels are still there when we
 * ask for them.
 *
 * A camera also SCORES what it can see, because a house with eight cameras is only interesting
 * if something cuts to the one where the argument is happening. Engagement is: how many people
 * are in shot, how close together they are, whether one of them is speaking, and whether
 * anything changed since the last look. The director takes the highest.
 */
(function (root) {
  'use strict';

  const cams = new Map();
  let rig = null;

  const V = () => new root.THREE.Vector3();

  function add(spec) {
    const T = root.THREE, w = root.worldNavigator;
    if (!T || !w || !w.renderer) return null;
    const c = {
      id: spec.id, name: spec.name || spec.id, room: spec.room || null,
      pos: spec.pos, look: spec.look || { x: 0, y: 1.4, z: 0 },
      fov: spec.fov || 58, width: spec.width || 480, height: spec.height || 300,
      pan: spec.pan || null,                      // {axis:'y', deg: 12, seconds: 20} for a slow sweep
      cam: new T.PerspectiveCamera(spec.fov || 58, (spec.width || 480) / (spec.height || 300), 0.1, 400),
      target: new T.WebGLRenderTarget(spec.width || 480, spec.height || 300,
        { minFilter: T.LinearFilter, magFilter: T.LinearFilter, format: T.RGBAFormat }),
      buf: new Uint8Array((spec.width || 480) * (spec.height || 300) * 4),
      canvas: null, score: 0, saw: [], last: null,
    };
    c.cam.position.set(spec.pos.x, spec.pos.y, spec.pos.z);
    c.cam.lookAt(c.look.x, c.look.y, c.look.z);
    c.baseYaw = c.cam.rotation.y;
    cams.set(c.id, c);
    return c;
  }

  // one camera's picture, as a data URI — rendered without disturbing anybody
  function shoot(id, opts) {
    const o = opts || {};
    const c = cams.get(id); if (!c) return null;
    const w = root.worldNavigator, R = w && w.renderer;
    if (!R || !w.scene) return null;
    const prev = R.getRenderTarget ? R.getRenderTarget() : null;
    try {
      R.setRenderTarget(c.target);
      R.render(w.scene, c.cam);
      R.readRenderTargetPixels(c.target, 0, 0, c.width, c.height, c.buf);
    } catch (e) { return null; } finally {
      try { R.setRenderTarget(prev || null); } catch (e) {}
    }
    if (!c.canvas) { c.canvas = document.createElement('canvas'); c.canvas.width = c.width; c.canvas.height = c.height; }
    const ctx = c.canvas.getContext('2d');
    const img = ctx.createImageData(c.width, c.height);
    // a render target reads bottom-up; a canvas draws top-down
    const row = c.width * 4;
    for (let y = 0; y < c.height; y++) {
      const src = (c.height - 1 - y) * row;
      img.data.set(c.buf.subarray(src, src + row), y * row);
    }
    ctx.putImageData(img, 0, 0);
    return c.canvas.toDataURL(o.format || 'image/webp', o.quality || 0.7);
  }

  // who can this camera see, and is anything happening
  function look(id) {
    const c = cams.get(id); if (!c) return null;
    const T = root.THREE, w = root.worldNavigator;
    if (!T || !w) return null;
    c.cam.updateMatrixWorld(); c.cam.updateProjectionMatrix();
    const frustum = new T.Frustum().setFromProjectionMatrix(
      new T.Matrix4().multiplyMatrices(c.cam.projectionMatrix, c.cam.matrixWorldInverse));

    const people = [];
    // holographic presences are the population of this house
    const H = root.NexusHolo;
    if (H) for (const p of H.present()) {
      const v = new T.Vector3(p.pos.x, p.pos.y - 1.0, p.pos.z);
      if (!frustum.containsPoint(v)) continue;
      people.push({ id: p.id, name: p.name, speaking: !!p.speaking, pos: p.pos,
                    dist: c.cam.position.distanceTo(v) });
    }
    // and whoever is actually standing here in this instance
    if (w.camera) {
      const me = w.camera.position.clone(); me.y -= 1.0;
      if (frustum.containsPoint(me)) people.push({ id: 'local', name: 'in the room', speaking: !!root.__holoSpeaking,
        pos: { x: me.x, y: me.y, z: me.z }, dist: c.cam.position.distanceTo(me) });
    }

    // ENGAGEMENT, not just occupancy. Two people close together and one of them talking is a
    // scene; four people scattered and silent is a corridor.
    let score = 0;
    score += people.length * 10;
    if (people.some(p => p.speaking)) score += 45;
    for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
      const a = people[i].pos, b = people[j].pos;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < 5) score += 22 - d * 3;                       // closer is more of a conversation
    }
    const near = people.length ? Math.min(...people.map(p => p.dist)) : 999;
    if (near < 12) score += (12 - near) * 1.5;              // a face fills the frame better than a dot
    // something changing is worth watching
    const sig = people.map(p => p.id + ':' + p.pos.x.toFixed(1) + ',' + p.pos.z.toFixed(1)).sort().join('|');
    if (c.last && sig !== c.last) score += 8;
    c.last = sig;
    c.saw = people; c.score = Math.round(score);
    return { id: c.id, name: c.name, room: c.room, score: c.score,
             people: people.map(p => ({ id: p.id, name: p.name, speaking: p.speaking, dist: +p.dist.toFixed(1) })) };
  }

  const survey = () => [...cams.keys()].map(look).filter(Boolean).sort((a, b) => b.score - a.score);

  // the slow drift a mounted camera has, so a still room is not a still image
  function drift(t) {
    for (const c of cams.values()) {
      if (!c.pan) continue;
      const a = (c.pan.deg || 10) * Math.PI / 180;
      c.cam.rotation.y = c.baseYaw + a * Math.sin(t / ((c.pan.seconds || 20) * 1000) * Math.PI * 2);
    }
  }

  function house(spec) {
    for (const s of (spec || [])) add(s);
    return list();
  }
  const list = () => [...cams.values()].map(c => ({ id: c.id, name: c.name, room: c.room,
    pos: c.pos, w: c.width, h: c.height }));
  function clear() {
    for (const c of cams.values()) { try { c.target.dispose(); } catch (e) {} }
    cams.clear();
  }

  root.NexusCams = { add, house, shoot, look, survey, drift, list, clear,
                     count: () => cams.size, get: (id) => cams.get(id) };
})(typeof window !== 'undefined' ? window : globalThis);

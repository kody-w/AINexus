// The room is a STAR: every guest is wired only to the host. These checks pin the two
// things that makes true — the host relaying presence, and a body being named once.
//
// Runs in node against a tiny THREE stub, because the browser cannot be trusted for this:
// a Chrome tab hidden more than ~5 minutes throttles timers to about once a minute, and
// the multiplayer path is driven from the animation loop.
//
//   node tests/presence_relay.test.js
//   node tests/presence_relay.test.js /path/to/other/multiplayer.js
const fs = require('fs'), vm = require('vm');

// ── the smallest THREE that createPlayerAvatar needs ────────────────────────
class Obj3D {
  constructor(type) {
    this.type = type; this.name = ''; this.children = [];
    this.position = { x:0, y:0, z:0, lerp(){}, set(){} };
    this.rotation = { x:0, y:0, z:0 };
    this.scale = { x:1, y:1, z:1, set(){} };
  }
  add(c) { this.children.push(c); return this; }
  remove(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return this; }
  traverse(fn) { fn(this); this.children.forEach(c => c.traverse && c.traverse(fn)); }
  getObjectByName(n) { let hit = null; this.traverse(o => { if (!hit && o.name === n) hit = o; }); return hit; }
}
// GPU-resident things are stubbed as objects that remember they were released, because the
// leak this file guards against is invisible from the scene graph: removing a group from the
// scene is exactly as observable as removing one AND disposing what it held.
const disposals = [];
function releasable(tag) {
  return class {
    constructor(opts) { this.__tag = tag; if (opts && opts.map) this.map = opts.map; }
    dispose() { disposals.push(tag); }
  };
}
const SHARED_SPRITE_GEOMETRY = { __tag: 'SpriteSharedGeometry', dispose() { disposals.push('SpriteSharedGeometry'); } };
const THREE = {
  Group: class extends Obj3D { constructor() { super('Group'); } },
  // the stub has to CARRY geometry/material, or a traversal looking for them finds an
  // avatar that appears to own nothing and a leak passes as a clean teardown
  Mesh: class extends Obj3D { constructor(geometry, material) { super('Mesh'); this.geometry = geometry; this.material = material; } },
  // Every Sprite in three.js r128 shares ONE module-level BufferGeometry. Modelling that
  // is the whole point: a stub where each sprite owned its own geometry would have called
  // disposing it correct, which is how the leak got past this file the first time.
  Sprite: class extends Obj3D {
    constructor(material) { super('Sprite'); this.isSprite = true; this.material = material; this.geometry = SHARED_SPRITE_GEOMETRY; }
  },
  PointLight: class extends Obj3D { constructor() { super('PointLight'); } dispose() { disposals.push('PointLight'); } },
  CylinderGeometry: releasable('CylinderGeometry'), SphereGeometry: releasable('SphereGeometry'),
  MeshStandardMaterial: releasable('MeshStandardMaterial'), SpriteMaterial: releasable('SpriteMaterial'),
  CanvasTexture: releasable('CanvasTexture'),
  Vector3: class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } },
};

function load(file) {
  const noop = () => {};
  const canvas = { width: 0, height: 0, getContext: () => ({ fillStyle: '', font: '', textAlign: '', fillRect: noop, fillText: noop }) };
  // one shared #player-count element, so updatePlayerCount has something to write to
  const countEl = { textContent: null };
  const doc = { createElement: () => canvas, body: { appendChild: noop }, addEventListener: noop,
                getElementById: (id) => (id === 'player-count' ? countEl : null), __countEl: countEl };
  const win = { document: doc, THREE, console, setTimeout, clearTimeout, setInterval, clearInterval,
    location: { search: '', hash: '', pathname: '/' }, localStorage: { getItem: () => null, setItem: noop },
    crypto: { getRandomValues: (a) => a.fill(7) }, btoa: (s) => Buffer.from(s, 'binary').toString('base64') };
  win.window = win; win.self = win;
  const ctx = vm.createContext(win);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  return { MP: win.NexusMultiplayer, countEl: doc.__countEl };
}

// A manager without its constructor, so no broker is ever dialled.
function makePeer(MP, { id, isHost }) {
  const m = Object.create(MP.prototype);
  m.world = { scene: new THREE.Group(), camera: { position: { x:0, y:0, z:0 }, rotation: { x:0, y:0 } } };
  m.peer = { id };
  m.connections = new Map(); m.players = new Map(); m.pending = new Map();
  m.isHost = isHost; m.roomId = isHost ? id : null;
  m.updateInterval = 0; m.lastUpdate = 0;
  m.username = null;
  m.showNotification = () => {};
  m.updateStatus = () => {};
  m.sent = [];
  return m;
}
// A one-way channel that records what was sent and can deliver it.
function wire(from, to) {
  const conn = { peer: to.peer.id, open: true, send: (d) => { from.sent.push({ to: to.peer.id, d }); to.handlePeerData(from.peer.id, d, back); } };
  const back = { peer: from.peer.id, open: true, send: () => {} };
  from.connections.set(to.peer.id, conn);
  return conn;
}

const { MP, countEl } = load(process.argv[2] || 'net/multiplayer.js');
const R = {};

// host + two guests, wired as a star: each guest only to the host, host to both
const host = makePeer(MP, { id: 'HOST0001', isHost: true });
const g1 = makePeer(MP, { id: 'GUEST001', isHost: false });
const g2 = makePeer(MP, { id: 'GUEST002', isHost: false });
wire(host, g1); wire(host, g2); wire(g1, host); wire(g2, host);

// each guest is born knowing only the host, exactly as acceptConnection leaves it
g1.createPlayerAvatar('HOST0001', {});
g2.createPlayerAvatar('HOST0001', {});
host.createPlayerAvatar('GUEST001', { username: 'one (AI)' });
host.createPlayerAvatar('GUEST002', { username: 'two (AI)' });

// One round of the steady state: every peer broadcasts to everyone it is wired to,
// which for a guest is only the host. The host is the one that passes it on.
host.username = 'Nova (AI)'; g1.username = 'one (AI)'; g2.username = 'two (AI)';
host.connections.forEach(c => host.sendPlayerData(c));   // host -> both guests
g1.sendPlayerData(g1.connections.get('HOST0001'));       // g1 -> host -> (relay) -> g2
g2.sendPlayerData(g2.connections.get('HOST0001'));       // g2 -> host -> (relay) -> g1

// ── 1. the host names itself, and must do so ONCE ───────────────────────────
// The body is born "Anonymous" and renamed on the host's first update. Before the
// nametag carried a .name, the rename could not find the old sprite and welded the
// new label on top of it, so the host wore two names in every joining tab.
const hostBodyInG1 = g1.players.get('HOST0001');
let sprites = 0; hostBodyInG1.avatar.traverse(o => { if (o.type === 'Sprite') sprites++; });
R['1_host_label_replaced_not_stacked'] = { username: hostBodyInG1.username, spriteCount: sprites };

// ── 2. each guest must see the OTHER guest, relayed by the host ─────────────
R['2_guest_sees_other_guest'] = {
  g1_knows: [...g1.players.keys()].sort(),
  g2_knows: [...g2.players.keys()].sort(),
  g2_names: [...g2.players.values()].map(p => p.username).sort(),
};

// ── 3. the count is the ROOM, not my own wires ──────────────────────────────
const counts = {};
for (const [n, p] of [['host', host], ['g1', g1], ['g2', g2]]) {
  countEl.textContent = null;
  p.updatePlayerCount();
  counts[n] = countEl.textContent;
}
R['3_counts_the_room'] = counts;

// ── 4. a departure relayed by the host removes the body ─────────────────────
host.relayDeparture('GUEST001');
R['4_departure_relayed'] = { g2_knows_after: [...g2.players.keys()].sort() };

// ── 5. a host cannot mint an unbounded crowd in a guest's tab ───────────────
// `from` is the host's word, and a room is just a link somebody sent you. Every accepted
// name costs the guest a Group with two geometries, a material, a light and a 256x64
// texture, so a loop of 50000 of them is a tab that never comes back.
const flood = makePeer(MP, { id: 'GUEST003', isHost: false });
flood.createPlayerAvatar('HOST0001', {});
const floodConn = { peer: 'HOST0001', open: true, send: () => {} };
const realWarn = console.warn;
let warns = 0;
console.warn = (...a) => { if (String(a[0]).includes('player bodies')) warns++; };
for (let i = 1; i <= 500; i++) {
  flood.handlePeerData('HOST0001', { type: 'playerUpdate', from: 'x' + i, username: 'a',
                                     position: { x:0, y:0, z:0 }, rotation: { y:0 } }, floodConn);
}
console.warn = realWarn;
R['5_mint_is_capped'] = { claimed: 500, bodies: flood.players.size, warnings: warns };

// ── 6. an id that no broker could have minted is not an identity ────────────
// Anything that reaches this code was handed out by the signalling server or copied from a
// room id, so it lives in [A-Za-z0-9_-]. A shape outside that is a map key being invented.
const shapes = makePeer(MP, { id: 'GUEST004', isHost: false });
shapes.createPlayerAvatar('HOST0001', {});
const shapeConn = { peer: 'HOST0001', open: true, send: () => {} };
let threw = null;
for (const bad of ['bad id', '../../etc/passwd', 'x'.repeat(65), '<script>', 123, {}, null, true]) {
  try {
    shapes.handlePeerData('HOST0001', { type: 'playerUpdate', from: bad, username: 'a',
                                        position: { x:0, y:0, z:0 }, rotation: { y:0 } }, shapeConn);
  } catch (e) { threw = String(e && e.message); }
}
// ...and a well-shaped one still gets its body, so the check is a filter and not a wall
shapes.handlePeerData('HOST0001', { type: 'playerUpdate', from: '9a1f4c2e-77b0-4f31-8c6d-0e2b5a9d1f77',
                                    username: 'real', position: { x:0, y:0, z:0 } }, shapeConn);
R['6_implausible_ids_refused'] = { known: [...shapes.players.keys()].sort(), threw };

// ── 7. a prune releases the GPU, not just the scene slot ────────────────────
// First-sight creation turned the 5s prune into a remove/recreate cycle: a peer whose tab is
// backgrounded stops sending (rAF is suspended), is pruned, and is rebuilt when it returns.
// Without disposal every one of those round trips leaks a full avatar's worth of GPU memory.
const pruner = makePeer(MP, { id: 'GUEST005', isHost: false });
pruner.createPlayerAvatar('GUEST006', { username: 'stalled' });
disposals.length = 0;
pruner.players.get('GUEST006').lastUpdate = Date.now() - 6000;
pruner.update();
R['7_prune_disposes'] = { stillKnown: [...pruner.players.keys()], disposed: disposals.slice().sort() };

// ── 8. a prune must not tear down geometry three.js shares page-wide ────────
// The nametag sprite's quad is not ours to release: every other player's nametag and
// every label the world itself placed ride the same object.
R['8_shared_sprite_geometry_survives'] = {
  disposedSharedQuad: disposals.includes('SpriteSharedGeometry'),
  ourSpriteMaterialDisposed: disposals.includes('SpriteMaterial'),
  ourCanvasTextureDisposed: disposals.includes('CanvasTexture'),
};

console.log(JSON.stringify(R, null, 1));
const pass =
  R['1_host_label_replaced_not_stacked'].spriteCount === 1 &&
  R['1_host_label_replaced_not_stacked'].username === 'Nova (AI)' &&
  R['2_guest_sees_other_guest'].g2_knows.join(',') === 'GUEST001,HOST0001' &&
  R['2_guest_sees_other_guest'].g1_knows.join(',') === 'GUEST002,HOST0001' &&
  R['2_guest_sees_other_guest'].g2_names.join(',') === 'Nova (AI),one (AI)' &&
  R['3_counts_the_room'].host === 3 && R['3_counts_the_room'].g1 === 3 && R['3_counts_the_room'].g2 === 3 &&
  R['4_departure_relayed'].g2_knows_after.join(',') === 'HOST0001' &&
  R['5_mint_is_capped'].bodies < R['5_mint_is_capped'].claimed &&
  R['5_mint_is_capped'].bodies <= 64 && R['5_mint_is_capped'].warnings === 1 &&
  R['6_implausible_ids_refused'].threw === null &&
  R['6_implausible_ids_refused'].known.join(',') === '9a1f4c2e-77b0-4f31-8c6d-0e2b5a9d1f77,HOST0001' &&
  R['7_prune_disposes'].stillKnown.length === 0 &&
  R['7_prune_disposes'].disposed.join(',') ===
    'CanvasTexture,CylinderGeometry,MeshStandardMaterial,PointLight,SphereGeometry,SpriteMaterial' &&
  R['8_shared_sprite_geometry_survives'].disposedSharedQuad === false &&
  R['8_shared_sprite_geometry_survives'].ourSpriteMaterialDisposed === true &&
  R['8_shared_sprite_geometry_survives'].ourCanvasTextureDisposed === true;
console.log(pass ? 'ALL PASS' : 'FAIL');
process.exit(pass ? 0 : 1);

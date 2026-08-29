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

// ── 7. the prune must not invent a departure, and must release the GPU when it is real ──
// First-sight creation put RELAYED bodies — ones this peer holds no channel to — into the same
// map as wired ones. They then fell through both guards (`conn` undefined), so five seconds of
// silence deleted a peer the HOST could still see: "Player left" for somebody who never left,
// the avatar rebuilt when their tab came back, and their chat under a raw id in between. A
// backgrounded tab stops the sender's frame loop entirely, so five seconds of relay silence is
// routine. Liveness of a relayed body is the host's to report, and it does report it
// ('playerLeft', case 4). When the prune IS right, it has to release the GPU too: without
// disposal every remove/recreate round trip leaks a full avatar's worth.
const pruner = makePeer(MP, { id: 'GUEST005', isHost: false });
pruner.createPlayerAvatar('GUEST006', { username: 'stalled' });
disposals.length = 0;
pruner.players.get('GUEST006').lastUpdate = Date.now() - 6000;
pruner.update();
const survivedShortSilence = pruner.players.has('GUEST006');

// past the grace, with still nothing relaying it, the body does go — and is disposed
// guarded so a revision that already pruned it reports a FAILED assertion rather than a
// stack trace — an A/B that crashes tells you nothing about which behaviour was wrong
if (pruner.players.has('GUEST006')) pruner.players.get('GUEST006').lastUpdate = Date.now() - 120000;
pruner.update();
R['7_prune_disposes'] = {
  relayedBodySurvivesShortSilence: survivedShortSilence,
  stillKnown: [...pruner.players.keys()],
  disposed: disposals.slice().sort(),
};

// ── 7b. a body whose CHANNEL is gone is a different thing, and the count must follow ──
// updatePlayerCount is the union of connections and players, so refreshing it BEFORE
// removePlayer recounts the body that is about to go and then never counts again.
const closed = makePeer(MP, { id: 'GUEST007', isHost: true });
let seenCounts = [];
closed.updatePlayerCount = function () {
  const seen = new Set([...this.connections.keys(), ...this.players.keys()]);
  seenCounts.push(seen.size + 1);
};
closed.createPlayerAvatar('GUEST008', { username: 'live' });
closed.createPlayerAvatar('GUEST009', { username: 'dead' });
closed.connections.set('GUEST008', { peer: 'GUEST008', open: true, send: () => {} });
closed.connections.set('GUEST009', { peer: 'GUEST009', open: false, send: () => {} });
closed.players.get('GUEST009').lastUpdate = Date.now() - 6000;
seenCounts = [];
closed.update();
R['7b_dead_channel_pruned_and_counted'] = {
  stillKnown: [...closed.players.keys()].sort(),
  countAfter: seenCounts.length ? seenCounts[seenCounts.length - 1] : null,
};

// ── 8. a prune must not tear down geometry three.js shares page-wide ────────
// The nametag sprite's quad is not ours to release: every other player's nametag and
// every label the world itself placed ride the same object.
R['8_shared_sprite_geometry_survives'] = {
  disposedSharedQuad: disposals.includes('SpriteSharedGeometry'),
  ourSpriteMaterialDisposed: disposals.includes('SpriteMaterial'),
  ourCanvasTextureDisposed: disposals.includes('CanvasTexture'),
};

// ── 9. what the host passes on is bounded, whatever arrives ────────────────
// The relay is the amplifier. peerjs opens these channels with serialization 'json' and
// refuses to send any frame at or above its 16300-byte chunk limit — it raises MessageToBig
// on that DataConnection, and conn.on('error') here treats that as the peer being gone. A
// relayed frame that crosses the limit therefore evicts every OTHER member of the room, and
// permanently, since the door check drops the messages of anyone no longer in `connections`.
// So the host must forward a frame it BUILT from the fields the room reads, never the frame
// it received: extra keys ride along unnoticed and a long name is enough on its own.
const relay = makePeer(MP, { id: 'HOST0002', isHost: true });
const sent = [];
for (const id of ['GUEST010', 'GUEST011']) {
  relay.connections.set(id, { peer: id, open: true, send: (m) => sent.push({ to: id, m }) });
  relay.createPlayerAvatar(id, { username: id });
}
const hostile = {
  type: 'playerUpdate',
  username: 'A'.repeat(16186),                       // a frame just under the limit going IN
  position: { x: 1, y: 2, z: 3, pad: 'B'.repeat(4000) },
  rotation: { x: 0, y: 0.5, z: 0 },
  extra: 'C'.repeat(4000),
};
relay.handlePeerData('GUEST010', hostile, relay.connections.get('GUEST010'));
const relayedFrames = sent.filter(x => x.m && x.m.type === 'playerUpdate');
const biggest = relayedFrames.reduce((n, x) => Math.max(n, Buffer.byteLength(JSON.stringify(x.m), 'utf8')), 0);
R['9_relay_is_bounded'] = {
  recipients: relayedFrames.map(x => x.to),
  biggestRelayedFrame: biggest,
  underPeerjsChunkLimit: biggest < 16300,
  keysForwarded: relayedFrames.length ? Object.keys(relayedFrames[0].m).sort() : [],
  padStrippedFromPosition: relayedFrames.length ? !('pad' in (relayedFrames[0].m.position || {})) : false,
  roomIntact: relay.connections.size === 2,
};

// a position that is not three real numbers is not forwarded as one
sent.length = 0;
relay.handlePeerData('GUEST010', { type: 'playerUpdate', username: 'ok',
                                   position: { x: 1, y: NaN, z: 3 } }, relay.connections.get('GUEST010'));
R['9b_nonfinite_position_dropped'] = {
  forwardedPosition: sent.length ? ('position' in sent[0].m) : null,
};

// ── 10. the relay budget sits above the rate this class itself sends at ────
// broadcastPlayerUpdate sends every `updateInterval` ms with no dirty check, so a stationary
// peer sends as fast as a moving one. A budget under that does not throttle smoothly: the
// window is over ALLOWED timestamps, so it passes a burst and then blocks solid until the
// oldest token ages out — seconds at a time with no relayed motion, while the host, wired
// directly, sees nothing wrong.
const budget = makePeer(MP, { id: 'HOST0003', isHost: true });
budget.connections.set('GUEST012', { peer: 'GUEST012', open: true, send: () => {} });
budget.connections.set('GUEST013', { peer: 'GUEST013', open: true, send: (m) => { if (m.type === 'playerUpdate') passed++; } });
budget.createPlayerAvatar('GUEST012', { username: 'mover' });
let passed = 0;
const HZ = Math.round(1000 / (budget.updateInterval || 50));       // what this class sends at
for (let i = 0; i < HZ * 5; i++) {                                  // five seconds of it
  budget.handlePeerData('GUEST012', { type: 'playerUpdate', username: 'mover',
                                      position: { x: i, y: 0, z: 0 } }, budget.connections.get('GUEST012'));
}
R['10_budget_clears_our_own_send_rate'] = {
  sendRateHz: HZ, offeredIn5s: HZ * 5, relayed: passed, everyOneRelayed: passed === HZ * 5,
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
  R['7_prune_disposes'].relayedBodySurvivesShortSilence === true &&
  R['7_prune_disposes'].stillKnown.length === 0 &&
  R['7b_dead_channel_pruned_and_counted'].stillKnown.join(',') === 'GUEST008' &&
  R['7b_dead_channel_pruned_and_counted'].countAfter === 2 &&
  R['7_prune_disposes'].disposed.join(',') ===
    'CanvasTexture,CylinderGeometry,MeshStandardMaterial,PointLight,SphereGeometry,SpriteMaterial' &&
  R['8_shared_sprite_geometry_survives'].disposedSharedQuad === false &&
  R['8_shared_sprite_geometry_survives'].ourSpriteMaterialDisposed === true &&
  R['8_shared_sprite_geometry_survives'].ourCanvasTextureDisposed === true &&
  R['9_relay_is_bounded'].underPeerjsChunkLimit === true &&
  R['9_relay_is_bounded'].recipients.join(',') === 'GUEST011' &&
  R['9_relay_is_bounded'].keysForwarded.join(',') === 'from,position,rotation,type,username' &&
  R['9_relay_is_bounded'].padStrippedFromPosition === true &&
  R['9_relay_is_bounded'].roomIntact === true &&
  R['9b_nonfinite_position_dropped'].forwardedPosition === false &&
  R['10_budget_clears_our_own_send_rate'].everyOneRelayed === true;
console.log(pass ? 'ALL PASS' : 'FAIL');
process.exit(pass ? 0 : 1);

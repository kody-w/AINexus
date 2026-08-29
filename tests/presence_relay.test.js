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
const THREE = {
  Group: class extends Obj3D { constructor() { super('Group'); } },
  Mesh: class extends Obj3D { constructor() { super('Mesh'); } },
  Sprite: class extends Obj3D { constructor() { super('Sprite'); } },
  PointLight: class extends Obj3D { constructor() { super('PointLight'); } },
  CylinderGeometry: class {}, SphereGeometry: class {},
  MeshStandardMaterial: class {}, SpriteMaterial: class {}, CanvasTexture: class {},
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

console.log(JSON.stringify(R, null, 1));
const pass =
  R['1_host_label_replaced_not_stacked'].spriteCount === 1 &&
  R['1_host_label_replaced_not_stacked'].username === 'Nova (AI)' &&
  R['2_guest_sees_other_guest'].g2_knows.join(',') === 'GUEST001,HOST0001' &&
  R['2_guest_sees_other_guest'].g1_knows.join(',') === 'GUEST002,HOST0001' &&
  R['2_guest_sees_other_guest'].g2_names.join(',') === 'Nova (AI),one (AI)' &&
  R['3_counts_the_room'].host === 3 && R['3_counts_the_room'].g1 === 3 && R['3_counts_the_room'].g2 === 3 &&
  R['4_departure_relayed'].g2_knows_after.join(',') === 'HOST0001';
console.log(pass ? 'ALL PASS' : 'FAIL');
process.exit(pass ? 0 : 1);

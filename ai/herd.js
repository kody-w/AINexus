/* herd.js — one brainstem, many players. Quantum hot-loading.
 *
 * Kody's name for it, and it is the right one: the brainstem sits in no particular player's
 * configuration until a call arrives. The call collapses it — this identity, this agent set,
 * these hands — it thinks, and then it is indeterminate again, ready to be somebody else.
 *
 * The naive shape is one brainstem per player: N runtimes, N copies of Python, N ten-megabyte
 * downloads, N of everything, for players that are idle between ticks anyway. This is the other
 * shape. ONE runtime. Every agent stays loaded in it. What changes per call is a pointer to the
 * hands, a set of names the player is allowed to see, and the identity its memory is filed
 * under — none of which is a load, so switching costs about what assigning a variable costs.
 *
 * Three things keep the players genuinely independent rather than merely sequential:
 *   · HANDS — each turn binds that player's own driver for the duration of the call
 *   · SIGHT — each turn is offered its own agents plus the shared core, and nothing else
 *   · MEMORY — the identity is imposed on every agent call, so one player cannot read another's
 *
 * They take turns because there is one runtime, and that is the honest trade: they are served
 * round-robin, quickly, rather than in parallel. A player waiting 200ms for its neighbour to
 * finish thinking is a player nobody notices waiting.
 */
(function (root) {
  'use strict';

  const players = new Map();          // id -> { persona, drive, agents, guid, ticks, chain, prev }
  let herd = null;

  const LS_IDS = 'nexus:player-ids';      // label -> minted identity, so a player keeps its memory
  const LS_LINES = 'nexus:lines';         // every tick line this device has ever seen

  function guidFor(label) {
    let map = {};
    try { map = JSON.parse(localStorage.getItem(LS_IDS) || '{}') || {}; } catch (e) {}
    if (!map[label]) {
      map[label] = 'nexus-' + (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID()
                                                                     : String(Math.random()).slice(2) + Date.now());
      try { localStorage.setItem(LS_IDS, JSON.stringify(map)); } catch (e) {}
    }
    return map[label];
  }

  // ── the lines outlive the tab ────────────────────────────────────────────
  // A chain that dies on refresh cannot be evidence and cannot be searched. Dr Strange did not
  // win by looking at three futures. Every tick is appended to a store on this device, and the
  // search for "a universe where it worked" reads all of them, not just the handful this page
  // happens to be holding.
  function remember(frame, playerId) {
    try {
      const all = JSON.parse(localStorage.getItem(LS_LINES) || '[]');
      all.push({ p: playerId, a: frame.payload.asserts, q: frame.payload.requires, h: frame.frame_hash });
      while (all.length > 4000) all.shift();
      localStorage.setItem(LS_LINES, JSON.stringify(all));
    } catch (e) {}
  }
  function recall() {
    try { return JSON.parse(localStorage.getItem(LS_LINES) || '[]'); } catch (e) { return []; }
  }

  async function join(p) {
    if (!p || !p.id) throw new Error('a player needs an id');
    const B = root.NexusBrainstem;
    if (!B) throw new Error('no brainstem on this page');
    const rec = {
      id: String(p.id),
      persona: p.persona || ('You are ' + p.id + ', an AI player in a shared 3D world.'),
      drive: p.drive || null,
      // AN IDENTITY IS MINTED, NOT SPELLED. Deriving the memory key from the label meant
      // 'greeter/1' and 'greeter-1' sanitised to the same string and shared one memory — two
      // beings with one set of recollections. The label is what you call it; the identity is
      // minted once, kept, and never computed from a name.
      guid: p.guid || guidFor(String(p.id)),
      agents: [],                     // names this player can see, beyond the shared core
      ticks: 0, acts: 0, journal: [], chain: [], prev: null,
      streamId: 'rappid:@kody-w/ainexus/player:' +
        (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : String(Math.random()).slice(2)),
    };
    // this player's own agents, hot-loaded once into the shared runtime and thereafter free
    for (const src of (p.agents || [])) {
      try { const a = await B.hotload(src, {}); rec.agents.push(a.name); }
      catch (e) { (p.log || function () {})('[herd] ' + rec.id + ' could not load ' + src + ': ' + e.message); }
    }
    players.set(rec.id, rec);
    return { id: rec.id, agents: rec.agents, guid: rec.guid, streamId: rec.streamId };
  }

  const leave = (id) => players.delete(String(id));
  const wake = (id) => { const r = players.get(String(id)); if (r) { r.sleeping = false; r.idle = 0; } return !!r; };
  const roster = () => [...players.values()].map(r => ({ id: r.id, guid: r.guid, agents: r.agents,
    ticks: r.ticks, acts: r.acts, frames: r.chain.length, hands: !!r.drive,
    sleeping: !!r.sleeping, idle: r.idle || 0 }));

  // one player's turn on the shared brainstem — the collapse
  async function serve(id, opts) {
    const rec = players.get(String(id));
    if (!rec) throw new Error('no such player: ' + id);
    const B = root.NexusBrainstem, F = root.NexusFrames;
    const o = opts || {};
    const drive = rec.drive || root.__autodrive;
    if (!drive) throw new Error(rec.id + ' has no hands');
    rec.ticks++;
    const started = Date.now();
    let entry;
    try {
      const s0 = (o.vision !== false && drive.sense) ? drive.sense({ width: 320, send: true }) : drive.snapshot();
      const r = await B.turn({
        percepts: { me: s0.me, world: s0.world, portals: s0.portals, players: s0.players,
                    room: s0.room, chat: (s0.chat || []).slice(-4),
                    picture: s0.vision ? (s0.vision.blank ? 'BLANK — you cannot see' : 'you can see') : 'none' },
        persona: rec.persona, drive, guid: rec.guid, agents: rec.agents,
        python: o.python, log: o.log, rounds: o.rounds,
      });
      rec.acts += (r.calls || []).length;
      // A tick that says nothing and does nothing is not thought, it is billing.
      rec.idle = ((r.calls || []).length === 0 && !r.words) ? (rec.idle || 0) + 1 : 0;
      entry = { player: rec.id, tick: rec.ticks, slot: r.slot, ms: Date.now() - started, words: r.words,
                resident: (r.residency && r.residency.resident) || [], missing: (r.residency && r.residency.missing) || [],
                summoned: r.summoned || [],
                calls: (r.calls || []).map(c => ({ tool: c.tool, failed: /failed|no such/.test(c.result) })) };
      if (F) {
        try {
          const f = await F.buildFrame({ kind: 'nexus.tick', streamId: rec.streamId, seq: rec.chain.length,
            payload: { asserts: { tick: rec.ticks, player: rec.id, said: r.words || '',
                                  called: entry.calls.map(c => c.tool + (c.failed ? ' ✗' : '')),
                                  at: (s0 && s0.me) || {},
                                  // the slot this turn held on the shared brainstem: two frames
                                  // claiming one slot, anywhere in the herd, is a race made visible
                                  slot: typeof r.slot === 'number' ? r.slot : -1 },
                       // what had to be true for this tick: whose hands, and which agents were
                       // actually answering in the runtime at the moment the call went out
                       requires: { hands: rec.id,
                                   resident: ((r.residency && r.residency.resident) || []).slice(0, 12),
                                   missing: ((r.residency && r.residency.missing) || []).slice(0, 6) },
                       // a capability that was invented a second ago must never look, to anyone
                       // reading this line later, like one that has worked in six universes
                       summoned: ((r.summoned) || []).map(x => x.got + ':' + x.via).slice(0, 4) },
            prev: rec.prev });
          rec.chain.push(f); rec.prev = f.payload_hash; remember(f, rec.id);
          if (rec.chain.length > 500) rec.chain.shift();
          entry.frame = f.frame_hash;
        } catch (e) {}
      }
    } catch (e) {
      entry = { player: rec.id, tick: rec.ticks, ms: Date.now() - started, error: e.message };
    }
    rec.journal.push(entry);
    if (rec.journal.length > 200) rec.journal.shift();
    return entry;
  }

  // round-robin: everyone gets a turn, nobody waits long
  function live(opts) {
    const o = Object.assign({ everyMs: 4000, maxTicks: 0 }, opts || {});
    if (herd) return herd;
    const state = { running: true, rounds: 0, stopped: null };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    (async () => {
      while (state.running && (!o.maxTicks || state.rounds < o.maxTicks)) {
        const ids = [...players.keys()];
        if (!ids.length) { await sleep(o.everyMs); continue; }
        state.rounds++;
        for (const id of ids) {
          if (!state.running) break;
          const p0 = players.get(id);
          if (p0 && p0.sleeping) continue;         // woken by anything that changes around it
          let e;
          try { e = await serve(id, o); } catch (err) { e = { player: id, error: err.message }; }
          if (o.onTick) { try { o.onTick(e, roster()); } catch (err) {} }
          const rec = players.get(id);
          if (rec && rec.idle >= (o.idleLimit || 4)) {
            rec.drive = rec.drive;                 // keep the player, stop paying for its silence
            players.get(id).sleeping = true;
            if (o.onTick) { try { o.onTick({ player: id, note: 'asleep — ' + rec.idle + ' ticks with nothing to say' }, roster()); } catch (err) {} }
          }
          if (e && e.error && /sign-in expired|not signed in|no mind/i.test(e.error)) {
            state.running = false; state.stopped = e.error; break;
          }
        }
        if (state.running) await sleep(o.everyMs);
      }
      state.running = false;
      if (!state.stopped) state.stopped = 'asked to stop';
      if (o.onStop) { try { o.onStop(state, roster()); } catch (e) {} }
      herd = null;
    })();
    herd = { stop: (why) => { state.running = false; state.stopped = why || 'asked to stop'; },
             state: () => state };
    return herd;
  }

  // Read every player's line together and check the ordering they all claim. One runtime means
  // one sequence of slots; if the same slot appears twice, or a player's ticks are not in slot
  // order, the turns overlapped and the frames say so.
  function auditSlots() {
    const seen = new Map(); const problems = [];
    for (const r of players.values()) {
      let last = -1;
      for (const f of r.chain) {
        const slot = f.payload && f.payload.asserts && f.payload.asserts.slot;
        if (typeof slot !== 'number' || slot < 0) continue;
        if (seen.has(slot)) problems.push('slot ' + slot + ' claimed by both ' + seen.get(slot) + ' and ' + r.id);
        else seen.set(slot, r.id);
        if (slot < last) problems.push(r.id + ' went backwards: slot ' + slot + ' after ' + last);
        last = slot;
      }
    }
    const slots = [...seen.keys()].sort((a, b) => a - b);
    return { turns: slots.length, distinct: seen.size, problems,
             contiguous: slots.every((v, i) => i === 0 || v === slots[i - 1] + 1),
             clean: problems.length === 0 };
  }

  // A LINE WHERE IT ALREADY WORKED. Search every player's frames for a tick that had this
  // capability resident and did NOT record it failing. That is the fixed point: not a guess
  // about what might work, a record of what did.
  function provenSource(need) {
    const B = root.NexusBrainstem;
    if (!B || !B.sourceOf) return null;
    const words = String(need || '').toLowerCase();
    const scored = new Map();
    // every line this device holds — this session's players AND everything remembered before
    const lines = [];
    for (const r of players.values()) for (const f of r.chain)
      lines.push({ p: r.id, a: f.payload.asserts, q: f.payload.requires });
    for (const l of recall()) lines.push(l);
    for (const l of lines) {
      const a = l.a || {}, q = l.q || {};
      for (const name of (q.resident || [])) {
        const failed = (a.called || []).some(c => c.indexOf(name) === 0 && / ✗$/.test(c));
        const worked = (a.called || []).some(c => c.indexOf(name) === 0 && !/ ✗$/.test(c));
        if (failed) continue;
        if (words.indexOf(String(name).toLowerCase()) < 0) continue;   // not what was asked for
        const cur = scored.get(name) || { name, player: l.p, hits: 0, proven: 0 };
        cur.hits++; if (worked) cur.proven++;
        scored.set(name, cur);
      }
    }
    // THE ONE DIMENSION WHERE IT WORKED. Prefer a line that shows the call actually succeeding
    // over one that merely had the thing loaded — a capability that was present and never used
    // is not evidence that it works.
    const ranked = [...scored.values()].sort((x, y) => (y.proven - x.proven) || (y.hits - x.hits));
    scored.sort((x, y) => y.score - x.score);
    for (const s of ranked) {
      const src = B.sourceOf(s.name);
      if (src) return Object.assign({ player: s.player, proven: s.proven, seen: s.hits }, src);
    }
    return null;
  }

  const chainOf = (id) => { const r = players.get(String(id));
    return r ? r.chain.map(f => JSON.stringify(f)).join('\n') + (r.chain.length ? '\n' : '') : ''; };

  root.NexusHerd = { join, leave, wake, serve, live, roster, chainOf, auditSlots, provenSource,
                     lines: recall, forget: () => { try { localStorage.removeItem(LS_LINES); } catch (e) {} },
                     players: () => players, running: () => !!herd };
})(typeof window !== 'undefined' ? window : globalThis);

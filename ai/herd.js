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
      ticks: 0, acts: 0, journal: [], chain: [], prev: null, seq: 0, truncated: 0,
      streamId: 'rappid:@kody-w/ainexus/player:' +
        (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : String(Math.random()).slice(2)),
    };
    // this player's own agents, hot-loaded once into the shared runtime and thereafter free
    // hotload replaces live instances, so it goes through the same lane a turn holds — a player
    // arriving mid-thought must not swap an agent out from under the player who is thinking
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
          const f = await F.buildFrame({ kind: 'nexus.tick', streamId: rec.streamId, seq: rec.seq++,
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
          // DROPPING THE OLDEST FRAME BREAKS THE LINE. The window that was meant to bound memory
          // was quietly destroying the genesis link and freezing seq at 500, so after a long
          // session the exported chain no longer verified at all — a bounded log pretending to
          // be a chain. seq is now its own counter, and a window says out loud that it is one.
          if (rec.chain.length > 500) { rec.chain.shift(); rec.truncated++; }
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

  // ── invoked, not polled ──────────────────────────────────────────────────
  // A player on a timer thinks because a clock said so, which is how a room full of AIs ends up
  // spending a seat to stare at an empty world. A player should run when the world gives it a
  // REASON: someone spoke, someone arrived, it was addressed, it landed somewhere new. The
  // wider frame invokes it; otherwise it is simply not running.
  //
  // A heartbeat still exists, off by default and slow when on, for the one case a reason cannot
  // cover: a player alone in a world deciding to go somewhere else.
  function invoke(id, reason, opts) {
    const rec = players.get(String(id));
    if (!rec) return Promise.resolve(null);
    rec.sleeping = false; rec.idle = 0; rec.lastReason = reason || 'invoked';
    return serve(id, Object.assign({ reason }, opts || {}));
  }

  // ── the ensemble: everyone in one call ───────────────────────────────────
  // A call per player is a call per player. Twelve AIs hanging around a portal is twelve model
  // calls to decide that most of them are, in fact, still hanging around a portal.
  //
  // So the world asks ONCE. It hands the model every player's situation and gets back a stack of
  // directives — one per player — which are sealed into a single world frame. Each player then
  // has a STANDING INTENTION and runs it locally, on its own, with no model call at all: walking,
  // drifting, glancing, saying the line it was given. It keeps that freedom until the next frame
  // arrives and changes what it is doing.
  //
  // That is the shape games have always used for a crowd: a director speaks rarely, actors act
  // continuously. It is also, bluntly, the difference between a demo and something you can leave
  // running — one call for a dozen players instead of a dozen.
  const DIRECT_TOOL = {
    type: 'function',
    function: {
      name: 'direct',
      description: 'Give every player something to be doing until the next direction.',
      parameters: { type: 'object', required: ['directives'], properties: {
        directives: { type: 'array', items: { type: 'object', required: ['player', 'intent'], properties: {
          player: { type: 'string', description: 'the player id, exactly as given' },
          intent: { type: 'string', description: 'one of: wander, hold, follow, approach, go, talk' },
          target: { type: 'string', description: 'a player id for follow/approach/talk, or a portal name for go' },
          say: { type: 'string', description: 'optional: one short line to say out loud now' },
        } } },
      } },
    },
  };

  // ── a dimension is a seed ────────────────────────────────────────────────
  // "Different dimensions are literally new content" is only true if a dimension can be RE-RUN
  // and come back the same. Local movement used Math.random(), so replaying a line gave a
  // different walk every time — the frames matched, the world did not, and a variation you
  // cannot reproduce is not content, it is noise.
  //
  // So the wandering is seeded. A dimension carries a seed; the same seed always walks the same
  // walk. Which means the whole continuation compresses to a short string — where it split,
  // what lens it wears, what seed it runs on — and the content is RE-DERIVED rather than stored.
  // A small seed and a large derivation is how every procedural world has ever worked, and it is
  // the same bargain the DOGG seed chants make.
  let rngState = 1;
  function seedRng(n) { rngState = (n >>> 0) || 1; }
  function rnd() {                                        // xorshift32: small, fast, reproducible
    rngState ^= rngState << 13; rngState >>>= 0;
    rngState ^= rngState >>> 17;
    rngState ^= rngState << 5;  rngState >>>= 0;
    return rngState / 4294967296;
  }
  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < String(str).length; i++) { h ^= String(str).charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }

  // what a player does on its own, between directions — cheap, local, no model
  const INTENTS = {
    hold:     async () => {},
    wander:   async (d) => { await d.look((rnd() * 120 - 60) | 0, 0); await d.walk('forward', 350 + (rnd() * 400 | 0)); },
    follow:   async (d, t) => { const who = (d.people() || []).find(p => p.id === t || p.name === t);
                                if (who) { await d.look(Math.max(-160, Math.min(160, (who.x - innerWidth / 2) / 4 | 0)), 0); await d.walk('forward', 400); } },
    approach: async (d, t) => INTENTS.follow(d, t),
    go:       async (d, t) => { if (t) await d.aim(t); },
    talk:     async (d, t) => { const r = d.dialogue && d.dialogue(t);
                                if (r && r.length) await d.tell(t, r[0].text); },
  };

  async function actLocally(rec) {
    const st = rec.standing;
    if (!st || !rec.drive) return null;
    const fn = INTENTS[st.intent] || INTENTS.hold;
    try {
      if (st.say) { await rec.drive.say(String(st.say).slice(0, 200)); st.say = null; }   // said once
      await fn(rec.drive, st.target);
      rec.localActs = (rec.localActs || 0) + 1;
      // DATA SLOSH. What actually happened while the player was free is the thing the next
      // direction has to be built from — not where it was told to go, where it ended up. It
      // sloshes forward into the next frame.
      let where = null; try { const s0 = rec.drive.snapshot(); where = s0 && s0.me; } catch (e) {}
      const vf = virtualFrame(rec);
      (rec.slosh = rec.slosh || []).push({ did: st.intent, at: where, v: vf.v, epoch: vf.epoch.slice(0, 12) });
      while (rec.slosh.length > 6) rec.slosh.shift();
      return { player: rec.id, local: st.intent, target: st.target || null, virtual: epoch.virtual, epoch: epoch.id };
    } catch (e) { return { player: rec.id, local: st.intent, error: e.message }; }
  }

  // one call, everybody directed, one frame
  async function ensemble(opts) {
    const o = opts || {};
    const B = root.NexusBrainstem, F = root.NexusFrames, auth = root.NexusAuth;
    if (!auth || !auth.signedIn()) throw new Error('no mind: not signed in');
    const who = [...players.values()].filter(r => r.drive);
    if (!who.length) return null;
    // ONE RESIDENCY PASS FOR THE WHOLE HERD. Everything anybody might need is made resident
    // before the single call, rather than each player discovering a gap on its own turn.
    let residency = { resident: [], missing: [] };
    if (B && B.ensureResident && o.python !== false) {
      const union = [...new Set(who.reduce((a, r) => a.concat(r.agents || []), []))];
      try { residency = await B.ensureResident(union, o.log); } catch (e) {}
    }
    const situation = who.map(r => {
      let s0 = {}; try { s0 = r.drive.snapshot() || {}; } catch (e) {}
      return { player: r.id, at: s0.me || {}, world: s0.world,
               others: (s0.players || []).map(x => x.name || x.id).slice(0, 6),
               portals: (s0.portals || []).slice(0, 5).map(x => x.name || x),
               doing: (r.standing && r.standing.intent) || 'nothing',
               // where it got to while it was free, which is what it must re-orient FROM
               since_last: (r.slosh || []).slice(-4),
               carrying: (r.agents || []).slice(0, 6),
               heard: (s0.chat || []).slice(-3).map(c => c.text) };
    });
    const msg = await auth.chat([
      { role: 'system', content: (o.director || 'You direct a group of AI characters sharing a 3D world of portals.')
        + ' Give EACH player something to be doing until you speak again. Most of the time most of them should '
        + 'simply carry on — hold or wander — and only one or two should do something pointed. Do not invent a '
        + 'player, a portal or a person that is not listed. Each player has been moving freely since '
        + 'your last direction — since_last shows where it actually got to, so direct it from THERE, '
        + 'not from where you last put it. Call direct and nothing else.' },
      { role: 'user', content: JSON.stringify(situation) },
    ], { tools: [DIRECT_TOOL], tool_choice: { type: 'function', function: { name: 'direct' } },
         raw: true, temperature: 0.8, max_tokens: 700 });
    const tc = msg && msg.tool_calls && msg.tool_calls[0];
    if (!tc) return null;
    let got; try { got = JSON.parse(tc.function.arguments || '{}'); } catch (e) { return null; }

    // EVERYTHING AT ONCE. Build the whole next state first, then commit it in one pass, so no
    // player is ever observed running the new direction while its neighbour still runs the old.
    const staged = [];
    for (const d of (got.directives || [])) {
      const rec = players.get(String(d.player));
      if (!rec) continue;                                   // a player who is not here gets nothing
      const intent = INTENTS[d.intent] ? d.intent : 'hold';  // and an intent nobody has is holding still
      staged.push([rec, { intent, target: d.target || null, say: d.say || null }]);
    }
    const spentVirtual = epoch.virtual;
    ledger.liveFrames++; ledger.calls++;         // this one was decided, and decisions are the cost
    const applied = [];
    // the commit: one synchronous pass, one instant, every object
    const at = Date.now();
    for (const [rec, st] of staged) {
      rec.standing = Object.assign({ since: at }, st);
      rec.slosh = [];                                       // consumed: it fed this direction
      applied.push({ player: rec.id, intent: st.intent, target: st.target, said: !!st.say });
    }
    let frame = null;
    if (F && applied.length) {
      try {
        frame = await F.buildFrame({ kind: 'nexus.ensemble', streamId: ensembleStream,
          seq: ensembleChain.length,
          payload: { asserts: { directed: applied.length, directives: applied.slice(0, 12), calls: 1,
                                // how much world happened between the last keyframe and this one
                                virtual_frames_elapsed: spentVirtual },
                     requires: { players: who.map(r => r.id).slice(0, 12),
                                 resident: (residency.resident || []).slice(0, 16),
                                 missing: (residency.missing || []).slice(0, 6) } },
          prev: ensemblePrev });
        ensembleChain.push(frame); ensemblePrev = frame.payload_hash;
        if (ensembleChain.length > 300) ensembleChain.shift();
        // the new epoch begins here, and every object is in it from this instant
        epoch = { id: frame.frame_hash, seq: frame.seq, at, virtual: 0 };
        for (const [rec] of staged) rec.epoch = epoch.id;
      } catch (e) {}
    }
    return { directives: applied, calls: 1, players: who.length, frame: frame && frame.frame_hash,
             epoch: epoch.id, virtual_elapsed: spentVirtual };
  }

  // ── epochs and virtual frames ────────────────────────────────────────────
  // A published frame is a KEYFRAME: it names one instant, and everything it directs takes
  // effect at that same instant for every object. Not applied one player at a time — a
  // half-applied direction is a world where two objects disagree about what moment it is.
  //
  // Between keyframes the world still moves, and those in-between states are VIRTUAL FRAMES:
  // derived, not published, cheap, and each stamped with the epoch it descends from. That is
  // what lets everything stay in sync without anything being sent: two objects carrying the
  // same epoch are provably in the same moment, and a virtual frame always knows which real
  // frame it is a continuation of.
  // ── the ledger ───────────────────────────────────────────────────────────
  // This is the whole cost model of the system in four numbers, and it is worth saying plainly:
  // a frame generated LIVE costs a model call, and every frame after it — replayed, rewound,
  // or derived as a virtual frame between keyframes — costs nothing at all. The expensive thing
  // is deciding. Everything downstream of a decision is arithmetic.
  //
  // So the meter is not decoration. It tells an operator what they are paying for (novelty) and
  // what they are getting free (everything that has already been decided once), which is the
  // number that decides whether a world with a dozen AIs in it can be left running.
  const ledger = { liveFrames: 0, calls: 0, replayedFrames: 0, rewinds: 0, virtualFrames: 0 };
  let epoch = { id: 'genesis', seq: -1, at: Date.now(), virtual: 0 };
  let dimension = { forkedFrom: null, lens: null, seed: 'genesis' };
  const virtualFrame = (rec) => { ledger.virtualFrames++;
    return { epoch: epoch.id, seq: epoch.seq, v: ++epoch.virtual, player: rec.id }; };

  let ensembleChain = [], ensemblePrev = null;
  const ensembleStream = 'rappid:@kody-w/ainexus/ensemble:' +
    (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : String(Math.random()).slice(2));

  // ── time travel through the exhaust ──────────────────────────────────────
  // The keyframes are already written down. That means a past session is not a log of something
  // that happened — it is a WORLD you can start again, and it costs nothing to run because
  // nobody has to decide anything: every decision was made once and recorded.
  //
  // Two things fall out. A live AI can be dropped into an ancient frame and wake up standing in
  // that moment, directed as that moment directed it. And because the frames after it are also
  // known, the replay can be timed exactly — the gaps between keyframes are in the chain, so the
  // world unfolds at the speed it originally did, or faster, with no model in the loop at all.
  //
  // What that gives back is the thing a live session cannot: run it twice and compare. Two runs
  // that agree tick for tick are evidence; one that diverges names the frame where it happened.
  // ── forking: a rewind is a new dimension, not an edit ────────────────────
  // Kody's correction, and it is the right one: rolling back in a game re-simulates the SAME
  // timeline from a corrected state — one history, quietly rewritten. Rewinding here is not
  // that. The past frame still stands; going back to it starts ANOTHER line from that moment,
  // and both lines are real from then on.
  //
  // rapp/1 has no parent pointer on a frame, and inventing one would break the spec. So a fork
  // is a genuinely new stream whose genesis SAYS where it split — the fork is recorded in the
  // data rather than implied by a link, which is also what makes it findable later.
  // A LENS IS WHAT THE NEW DIMENSION IS SEEN THROUGH. The estate already holds that an identity
  // is projected through a transform and that migration ships the FRAME, letting the destination
  // re-derive. So a fork does not have to continue in the same shape as the line it left: it can
  // carry a lens — another camera rig, another cast, another world, another director — and the
  // same moment re-derives into something that is genuinely different and genuinely descended.
  // The lens is named in the genesis, so what changed is on the record and not in somebody's head.
  const LENSES = {};
  const lens = (name, fn) => { LENSES[name] = fn; return Object.keys(LENSES); };

  async function fork(frame, opts) {
    const o = opts || {};
    const f = typeof frame === 'string' ? JSON.parse(frame) : frame;
    const F = root.NexusFrames;
    const stream = 'rappid:@kody-w/ainexus/dimension:' +
      (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : String(Math.random()).slice(2));
    const woke = rewind(f, o);
    // wear the lens before the genesis is sealed, so the frame records the world it produced
    let worn = null;
    if (o.lens) {
      const fn = typeof o.lens === 'function' ? o.lens : LENSES[o.lens];
      if (fn) { try { worn = (await fn({ players, frame: f, woke })) || String(o.lens); }
                catch (e) { worn = 'lens failed: ' + e.message; } }
      else worn = 'no such lens: ' + o.lens;
    }
    let genesis = null;
    if (F) {
      try {
        genesis = await F.buildFrame({ kind: 'nexus.fork', streamId: stream, seq: 0,
          payload: { asserts: { forked_from: f.frame_hash, at_seq: f.seq, at_utc: f.utc || null,
                                woke: woke.woke, reason: o.reason || 'someone went back',
                                lens: o.lens ? String(typeof o.lens === 'function' ? (o.lens.name || 'anonymous') : o.lens) : null,
                                lens_said: worn },
                     requires: { of_stream: f.stream_id } },
          prev: null });
      } catch (e) {}
    }
    // the new line starts here; the old one is untouched and still true
    ensembleChain = genesis ? [genesis] : [];
    ensemblePrev = genesis ? genesis.payload_hash : null;
    if (genesis) epoch = { id: genesis.frame_hash, seq: 0, at: epoch.at, virtual: 0 };
    ledger.forks = (ledger.forks || 0) + 1;
    // the whole continuation, as something you could write on a card
    dimension = { forkedFrom: f.frame_hash, lens: o.lens ? String(o.lens) : null,
                  seed: o.seed !== undefined ? String(o.seed) : (f.frame_hash.slice(0, 12) + ':' + (o.lens || '-')) };
    seedRng(hashSeed(dimension.seed));
    return { dimension: stream, seed: seedOf(), genesis: genesis && genesis.frame_hash,
             forkedFrom: f.frame_hash, at: f.seq, woke: woke.woke, lens: o.lens || null, lensSaid: worn };
  }

  function rewind(frame, opts) {
    const o = opts || {};
    const f = typeof frame === 'string' ? JSON.parse(frame) : frame;
    const a = (f && f.payload && f.payload.asserts) || {};
    const applied = [];
    const at = Date.now();
    for (const d of (a.directives || [])) {
      const rec = players.get(String(d.player));
      if (!rec) continue;
      rec.standing = { intent: INTENTS[d.intent] ? d.intent : 'hold', target: d.target || null,
                       say: o.speak ? d.say || null : null, since: at };
      rec.slosh = [];
      rec.epoch = f.frame_hash;
      applied.push({ player: rec.id, intent: rec.standing.intent });
    }
    epoch = { id: f.frame_hash, seq: f.seq, at, virtual: 0 };
    ledger.rewinds++; ledger.replayedFrames++;   // a decision already made costs nothing to make again
    return { woke: applied, epoch: epoch.id, seq: f.seq,
             from: (f.utc || 'an unrecorded moment'), directed: a.directed || applied.length };
  }

  // walk a recorded chain, honouring the gaps it recorded — no model call anywhere
  function replay(chainText, opts) {
    const o = Object.assign({ speed: 1, act: true, onFrame: null }, opts || {});
    const frames = (typeof chainText === 'string'
      ? chainText.split('\n').filter(l => l.trim()).map(l => JSON.parse(l))
      : chainText).filter(f => f && f.payload);
    let i = 0, running = true, timer = null;
    const stamp = (f) => Date.parse(f.utc || 0) || 0;
    function step() {
      if (!running || i >= frames.length) { running = false; if (o.onDone) try { o.onDone({ played: i }); } catch (e) {} return; }
      const f = frames[i++];
      const r = rewind(f, { speak: true });
      if (o.onFrame) { try { o.onFrame(Object.assign({ index: i - 1 }, r)); } catch (e) {} }
      if (o.act) { for (const rec of players.values()) actLocally(rec); }
      if (i >= frames.length) { running = false; if (o.onDone) try { o.onDone({ played: i }); } catch (e) {} return; }
      // the gap is not guessed — it is the distance the chain itself recorded
      const gap = Math.max(0, (stamp(frames[i]) - stamp(f))) / (o.speed || 1);
      timer = setTimeout(step, Math.min(gap || o.minGapMs || 60, o.maxGapMs || 5000));
    }
    step();
    return { stop: () => { running = false; if (timer) clearTimeout(timer); },
             state: () => ({ played: i, of: frames.length, running }) };
  }

  // the loop that makes a crowd affordable: direct rarely, act continuously
  function hangOut(opts) {
    const o = Object.assign({ directEveryMs: 30000, actEveryMs: 2500 }, opts || {});
    let running = true, directions = 0, acts = 0;
    (async function actLoop() {
      while (running) {
        for (const rec of players.values()) {
          const e = await actLocally(rec);
          if (e) { acts++; if (o.onAct) { try { o.onAct(e); } catch (x) {} } }
        }
        await new Promise(r => setTimeout(r, o.actEveryMs));
      }
    })();
    (async function directLoop() {
      while (running) {
        try { const r = await ensemble(o); if (r) { directions++; if (o.onDirect) { try { o.onDirect(r); } catch (x) {} } } }
        catch (e) { if (o.onDirect) { try { o.onDirect({ error: e.message }); } catch (x) {} }
                    if (/sign-in|budget|no mind/i.test(e.message)) { running = false; break; } }
        await new Promise(r => setTimeout(r, o.directEveryMs));
      }
    })();
    return { stop: () => { running = false; },
             state: () => ({ directions, acts, running, frames: ensembleChain.length }),
             chain: () => ensembleChain.map(f => JSON.stringify(f)).join('\n') + (ensembleChain.length ? '\n' : '') };
  }

  // ── the world frame ──────────────────────────────────────────────────────
  // Not every player watching for its own reasons — that is N pollers and no shared clock. ONE
  // frame sits over the whole world, looks once, and picks the single player with the strongest
  // reason to act. That player wakes for a second, does one thing, and the world moves. The
  // others were not asleep because a timer said so; they were not chosen.
  //
  // Each world tick is itself a frame recording who was picked and why, and what the alternatives
  // were — so the question "why did that one act?" has an answer on a chain rather than in a
  // guess. And when nobody has a reason, nobody wakes and nothing is spent. A still world is
  // allowed to be still.
  // A REASON IS SOMETHING NEW, AND IT IS SPENT ONCE. Two ways this goes wrong and both cost
  // real money: the FIRST look at a world has nothing to compare against, so everything reads as
  // a change and a still world wakes somebody; and a sentence sitting in the chat log stays true
  // forever, so one "hey alice" wakes alice on every tick until the tab is closed. So the
  // baseline is seeded on first sight, and a reason only counts for what arrived since this
  // player last acted on it.
  const REASONS = [
    [40, 'was spoken to',         (s, me, was) => (s.chat || []).slice(was.chat).some(c => new RegExp(me, 'i').test(c.text || ''))],
    [30, 'someone spoke',         (s, _m, was) => (s.chat || []).length > was.chat],
    [20, 'who is here changed',   (s, _m, was) => ((s.players || []).map(x => x.id).sort().join(',')) !== was.here],
    [15, 'arrived somewhere new', (s, _m, was) => !!was.world && s.world !== was.world],
    [5,  'has never acted',       (s, _m, was, rec) => rec.ticks === 0],
  ];

  function conduct(opts) {
    const o = Object.assign({ everyMs: 1500, secondsEach: 20 }, opts || {});
    const seen = new Map();
    const world = { tick: 0, chain: [], prev: null, running: true, busy: false,
      streamId: 'rappid:@kody-w/ainexus/world:' +
        (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : String(Math.random()).slice(2)) };

    // A frame published anywhere on this device triggers the next run here, and this world's
    // frames are announced the same way — so two tabs watching one world take turns rather than
    // both deciding, and a frame maker that is not this loop can drive it just as well.
    let bus = null;
    try {
      bus = new BroadcastChannel('nexus:world');
      bus.onmessage = (ev) => {
        const d = ev && ev.data;
        if (!d || d.streamId === world.streamId) return;
        if (d.kind === 'nexus.world' && d.chose && players.has(d.chose) && !world.busy) {
          world.busy = true;
          invoke(d.chose, d.because || 'a frame named it', o)
            .then(() => { world.busy = false; }).catch(() => { world.busy = false; });
        }
      };
    } catch (e) {}

    const timer = setInterval(async () => {
      if (!world.running || world.busy) return;
      const candidates = [];
      for (const rec of players.values()) {
        if (!rec.drive) continue;
        let s0 = null;
        try { s0 = rec.drive.snapshot(); } catch (e) { continue; }
        const first = !seen.has(rec.id);
        const was = seen.get(rec.id) || { chat: (s0.chat || []).length,
                                          here: (s0.players || []).map(x => x.id).sort().join(','), world: s0.world };
        let score = 0; const why = [];
        if (!first) {
          for (const [w, label, test] of REASONS) {
            let hit = false;
            try { hit = !!test(s0, rec.id, was, rec); } catch (e) {}
            if (hit) { score += w; why.push(label); }
          }
        }
        // the baseline only advances when this player ACTS on what it saw; merely being looked
        // at does not consume a reason, and acting consumes all of them
        if (first) seen.set(rec.id, was);
        if (score > 0) candidates.push({ id: rec.id, score, why: why.join(' · '),
                                         mark: { chat: (s0.chat || []).length,
                                                 here: (s0.players || []).map(x => x.id).sort().join(','), world: s0.world } });
      }
      candidates.sort((a, b) => b.score - a.score);
      const chosen = candidates[0];

      world.tick++;
      const F = root.NexusFrames;
      const payload = {
        asserts: { tick: world.tick, chose: chosen ? chosen.id : null,
                   because: chosen ? chosen.why : 'nobody had a reason — the world is still' },
        requires: { considered: candidates.slice(0, 6).map(c => c.id + ':' + c.score) },
      };
      if (F) {
        try {
          const f = await F.buildFrame({ kind: 'nexus.world', streamId: world.streamId,
                                         seq: world.chain.length, payload, prev: world.prev });
          world.chain.push(f); world.prev = f.payload_hash;
          if (world.chain.length > 500) world.chain.shift();
          try { bus && bus.postMessage({ kind: 'nexus.world', streamId: world.streamId,
                  chose: payload.asserts.chose, because: payload.asserts.because, hash: f.frame_hash }); } catch (e) {}
        } catch (e) {}
      }
      if (!chosen) { if (o.onTick) { try { o.onTick(payload.asserts, roster()); } catch (e) {} } return; }

      // wake it for a second — one turn, and not for longer than the world will wait
      world.busy = true;
      seen.set(chosen.id, chosen.mark);          // this player has now acted on what it saw
      const guard = setTimeout(() => { world.busy = false; }, (o.secondsEach || 20) * 1000);
      invoke(chosen.id, chosen.why, o)
        .then(e => { clearTimeout(guard); world.busy = false;
                     if (o.onTick) { try { o.onTick(Object.assign({}, payload.asserts, { entry: e }), roster()); } catch (x) {} } })
        .catch(() => { clearTimeout(guard); world.busy = false; });
    }, o.everyMs);

    return {
      stop: () => { world.running = false; clearInterval(timer); try { bus && bus.close(); } catch (e) {} },
      state: () => ({ tick: world.tick, frames: world.chain.length, busy: world.busy, streamId: world.streamId }),
      chain: () => world.chain.map(f => JSON.stringify(f)).join('\n') + (world.chain.length ? '\n' : ''),
      // THE LAST FRAME STANDS. Between publications nothing runs and nothing is spent: this frame
      // is simply what is true about the world right now, ongoing, until the next one is
      // published. Reading it is how anything — another tab, another tool, a person — finds out
      // where the world got to without asking a player to think about it.
      head: () => world.chain[world.chain.length - 1] || null,
    };
  }

  // watch the world and invoke whoever has a reason to think
  function watch(opts) {
    const o = opts || {};
    const seen = new Map();                 // player id -> what it had last time we looked
    const timer = setInterval(() => {
      for (const rec of players.values()) {
        const drive = rec.drive; if (!drive) continue;
        let s0 = null;
        try { s0 = drive.snapshot(); } catch (e) { continue; }
        const chat = (s0.chat || []), here = (s0.players || []).map(x => x.id).sort().join(',');
        const was = seen.get(rec.id) || { chat: 0, here: '', world: '' };
        const reasons = [];
        if (chat.length > was.chat) reasons.push('someone spoke');
        if (here !== was.here) reasons.push('who is here changed');
        if (s0.world !== was.world && was.world) reasons.push('a new world');
        seen.set(rec.id, { chat: chat.length, here, world: s0.world });
        if (!reasons.length || rec.thinking) continue;
        rec.thinking = true;
        invoke(rec.id, reasons.join(' and '), o)
          .then(e => { rec.thinking = false; if (o.onTick) { try { o.onTick(e, roster()); } catch (x) {} } })
          .catch(() => { rec.thinking = false; });
      }
    }, o.checkMs || 1200);
    return { stop: () => clearInterval(timer) };
  }

  // round-robin, for when you deliberately want everyone thinking on a clock
  function live(opts) {
    const o = Object.assign({ everyMs: 4000, maxTicks: 0 }, opts || {});
    // A herd that has been asked to stop is not a herd you can join. Handing the dying one back
    // meant stop() followed by live() silently returned the corpse and nothing ran again.
    if (herd && herd.state && herd.state().running) return herd;
    herd = null;
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
          if (!p0) continue;                       // it left between the snapshot and its turn
          if (p0.sleeping) {
            // asleep, not exiled: anything changing around it is a reason to look again
            let changed = false;
            try { const s0 = p0.drive && p0.drive.snapshot();
                  const sig = s0 ? ((s0.chat || []).length + '|' + (s0.players || []).length + '|' + s0.world) : '';
                  if (sig && sig !== p0.lastSig) { changed = true; p0.lastSig = sig; } } catch (e) {}
            if (!changed) continue;
            p0.sleeping = false; p0.idle = 0;
          }
          let e;
          if (!players.has(id)) continue;          // left between the snapshot and its turn
          try { e = await serve(id, o); }
          catch (err) { e = players.has(id) ? { player: id, error: err.message }
                                            : { player: id, note: 'left the world mid-round' }; }
          if (o.onTick) { try { o.onTick(e, roster()); } catch (err) {} }
          const rec = players.get(id);
          if (rec && rec.idle >= (o.idleLimit || 4)) {
            rec.sleeping = true;                   // keep the player, stop paying for its silence
            try { const s0 = rec.drive && rec.drive.snapshot();
                  rec.lastSig = s0 ? ((s0.chat || []).length + '|' + (s0.players || []).length + '|' + s0.world) : ''; } catch (e) {}
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

  // The full line if we still hold all of it; otherwise an explicitly-labelled WINDOW, which
  // verifies internally but is not a chain from genesis and must not be offered as one.
  function chainOf(id) {
    const r = players.get(String(id));
    if (!r) return '';
    return r.chain.map(f => JSON.stringify(f)).join('\n') + (r.chain.length ? '\n' : '');
  }
  const chainKind = (id) => { const r = players.get(String(id));
    return !r ? 'none' : r.truncated ? 'window' : 'chain'; };

  // A DIMENSION IN ONE LINE: where it split, what lens it wears, what seed it runs on. Everything
  // after the split re-derives from those three, so a variation is something you can write on a
  // card and hand to somebody rather than a recording you have to ship.
  function seedOf() {
    return (dimension.forkedFrom || 'genesis').slice(0, 12) + '/' +
           (dimension.lens || '-') + '/' + dimension.seed;
  }

  // re-derive a dimension from its seed alone: same split, same lens, same walk
  async function fromSeed(seed, findFrame, opts) {
    const bits = String(seed).split('/');
    const from = bits[0], lensName = bits[1];
    const s2 = bits.slice(2).join('/') || from;
    const f = typeof findFrame === 'function' ? await findFrame(from) : findFrame;
    if (!f) throw new Error('cannot re-derive: no frame matching ' + from);
    return fork(f, Object.assign({}, opts, { lens: lensName === '-' ? null : lensName, seed: s2 }));
  }

  root.NexusHerd = { join, leave, wake, serve, invoke, conduct, ensemble, hangOut, actLocally, watch, live, chainKind,
                     epoch: () => Object.assign({}, epoch), rewind, replay, fork, lens,
                     // a dimension in one line: where it split, what it wears, what it runs on
                     seedOf, fromSeed, reseed: (s2) => { dimension.seed = String(s2); seedRng(hashSeed(dimension.seed)); return seedOf(); },
                     lenses: () => Object.keys(LENSES),
                     cost: () => {
                       const free = ledger.replayedFrames + ledger.virtualFrames;
                       const total = ledger.liveFrames + free;
                       return Object.assign({}, ledger, { freeFrames: free, totalFrames: total,
                         callsPerFrame: total ? +(ledger.calls / total).toFixed(3) : 0,
                         // what it would have cost to decide every frame afresh, including one
                         // call per player per frame the naive way
                         savedCalls: free, paidFor: 'deciding', freeBecause: 'already decided' }); },
                     history: () => ensembleChain.map(f => JSON.stringify(f)).join('\n') + (ensembleChain.length ? '\n' : ''),
                     inSync: () => { const e = [...players.values()].map(r => r.epoch || null);
                                     return { epoch: epoch.id, all: e.every(x => x === epoch.id), of: e.length }; },
                     roster, chainOf, auditSlots, provenSource,
                     lines: recall, forget: () => { try { localStorage.removeItem(LS_LINES); } catch (e) {} },
                     players: () => players, running: () => !!herd };
})(typeof window !== 'undefined' ? window : globalThis);

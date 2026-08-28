/* vbrainstem.js — a real brainstem in the page.
 *
 * Until now an AI player thought by being handed a paragraph of instructions and asked to end
 * its reply with a JSON blob, which someone then had to fish out of the prose. That works until
 * it doesn't: the model wraps the block in a code fence, or names a verb the hands do not have,
 * or forgets it, and the player just stands there looking thoughtful.
 *
 * This is the other way, and it is how the rest of the estate already works: the brainstem's own
 * agents running as PYTHON in the browser through Pyodide — the pattern kody-w/heimdall's doorman
 * calls "the real vbrainstem" — with the world's verbs offered as TOOLS. The model does not
 * describe an action for us to parse. It CALLS one. Walking is a function call, so "the mind
 * spoke but named no move" stops being a category of failure rather than being handled better.
 *
 *   · the agents are the same .py files a local brainstem loads, fetched from the grail
 *   · storage is a shim (ai/vb/local_storage.py) — agents write to localStorage and cannot tell
 *   · the verbs come from ai/autodrive.js: the identical surface a person's hands drive
 *   · the model is the visitor's own Copilot seat (ai/copilot_auth.js)
 *
 * Nothing downloads until a player actually needs to think: Pyodide is large and loads lazily,
 * once. If it never loads, `turn()` still works — it just has the verbs and no Python agents,
 * which is a smaller brainstem, not a broken one.
 */
(function (root) {
  'use strict';

  const SELF = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';
  const here = (rel) => { try { return new URL(rel, SELF).href; } catch (e) { return rel; } };

  const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
  const BASIC_AGENT_URL = 'https://raw.githubusercontent.com/kody-w/rapp-installer/main/rapp_brainstem/agents/basic_agent.py';
  const AGENT_BASE = 'https://raw.githubusercontent.com/kody-w/RAPP/main/rapp_brainstem/agents/';
  const AGENTS = [
    { file: 'manage_memory_agent.py', className: 'ManageMemoryAgent' },
    { file: 'context_memory_agent.py', className: 'ContextMemoryAgent' },
  ];
  const MAX_ROUNDS = 5;                        // a turn is a few calls, not an afternoon

  // ── the world's verbs, described so a model can call them ────────────────
  // One entry per thing the hands can actually do. The schemas are deliberately tight: a verb
  // that does not exist cannot be named, and an argument that is not offered cannot be invented.
  const VERBS = [
    ['look',   'Turn your head. Positive dx looks right.', { dx: ['number', 'pixels to turn horizontally, about 220 for a quarter turn'], dy: ['number', 'pixels to look up or down'] }, []],
    ['walk',   'Walk in a direction for a while.', { dir: ['string', 'forward, back, left or right'], ms: ['number', 'how long in milliseconds, 300-1500'] }, ['dir']],
    ['aim',    'Turn to face a portal by name, without entering it.', { portal: ['string', 'the portal name exactly as the percepts give it'] }, ['portal']],
    ['travel', 'Walk into a portal and go to that world.', { portal: ['string', 'the portal name exactly as the percepts give it'] }, ['portal']],
    ['say',    'Say something out loud to everyone in the room.', { text: ['string', 'what you say, one short natural line'] }, ['text']],
    ['tell',   'Say something to one person, privately.', { to: ['string', 'their id from the percepts'], text: ['string', 'what you say'] }, ['to', 'text']],
    ['see',    'Look at what is in front of you right now and get a fresh picture.', {}, []],
    ['scan',   'Turn all the way around, sampling what is there.', { steps: ['number', 'how many samples, 4-8'], deg: ['number', 'degrees between samples'] }, []],
    ['people', 'List who else is here, with their ids.', {}, []],
    ['orbs',   'List the portals in view, with names and distances.', {}, []],
    ['dialogue', 'The ring of things you could say to one person right now.', { to: ['string', 'their id from the percepts'] }, ['to']],
    ['wait',   'Do nothing for a moment.', { ms: ['number', 'milliseconds'] }, []],
  ];

  // Call the verb ITSELF and keep what it returns. Going through run() threw the answer away:
  // run() reports 'done' whether a step worked or not, so tell()-ing a peer who left, or aiming
  // at a portal that does not exist, both came back as success. A mind told 'ok' about something
  // that did not happen will spend the rest of the turn reasoning from it.
  const CALL = {
    look:     (d, a) => d.look(a.dx | 0, a.dy | 0),
    walk:     (d, a) => d.walk(String(a.dir || 'forward'), Math.max(80, Math.min(3000, a.ms || 600))),
    aim:      (d, a) => d.aim(a.portal),
    travel:   (d, a) => d.travel(a.portal),
    say:      (d, a) => d.say(a.text),
    tell:     (d, a) => d.tell(a.to, a.text),
    see:      (d) => d.see({}),
    scan:     (d, a) => d.scan(a.steps, a.deg),
    people:   (d) => d.people(),
    orbs:     (d) => d.orbs().map(o => ({ name: o.name, distance: o.distance })),
    dialogue: (d, a) => d.dialogue(a.to),
    wait:     (d, a) => d.wait(Math.max(50, Math.min(4000, a.ms || 800))),
  };

  // what the model is told came back — an honest sentence, never a cheerful constant
  function describe(verb, value) {
    if (value === false || value === null || value === undefined) return 'failed: ' + verb + ' did not happen';
    if (value === true) return 'ok';
    if (typeof value === 'object') { try { return JSON.stringify(value).slice(0, 1200); } catch (e) { return 'ok'; } }
    return String(value).slice(0, 400);
  }

  function verbToolDefs() {
    return VERBS.map(([name, description, props, required]) => {
      const properties = {};
      for (const k of Object.keys(props)) properties[k] = { type: props[k][0], description: props[k][1] };
      return { type: 'function', function: { name: 'world_' + name, description,
               parameters: { type: 'object', properties, required } } };
    });
  }

  // ── Pyodide: the agents, as Python ───────────────────────────────────────
  let pyodide = null, pyAgents = {}, loading = null, loadNote = 'not started';

  async function initPyodide(log) {
    if (pyodide && Object.keys(pyAgents).length) return pyodide;
    if (loading) return loading;
    loading = (async () => {
      const say = (m) => { loadNote = m; if (log) log('[vbrainstem]', m); };
      try {
        if (typeof root.loadPyodide === 'undefined') {
          say('fetching pyodide…');
          await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = PYODIDE_URL + 'pyodide.js';
            s.onload = res; s.onerror = () => rej(new Error('pyodide script would not load'));
            document.head.appendChild(s);
          });
        }
        say('starting python…');
        pyodide = await root.loadPyodide({ indexURL: PYODIDE_URL });

        const grab = async (u, fallback) => {
          try { const r = await fetch(u, { cache: 'force-cache' }); if (r.ok) return await r.text(); } catch (e) {}
          return fallback;
        };
        const basic = await grab(BASIC_AGENT_URL,
          'class BasicAgent:\n    def __init__(self, name=None, metadata=None):\n' +
          '        if name is not None: self.name = name\n        if metadata is not None: self.metadata = metadata\n' +
          '    def system_context(self):\n        return None\n');

        pyodide.FS.mkdirTree('/agents'); pyodide.FS.mkdirTree('/utils');
        pyodide.FS.writeFile('/agents/__init__.py', ''); pyodide.FS.writeFile('/utils/__init__.py', '');
        pyodide.FS.writeFile('/agents/basic_agent.py', basic);
        for (const f of ['local_storage', 'azure_file_storage', 'dynamics_storage', 'storage_factory']) {
          pyodide.FS.writeFile('/utils/' + f + '.py', await grab(here('vb/' + f + '.py'), ''));
        }
        await pyodide.runPythonAsync("import sys; sys.path.insert(0, '/')");

        say('loading agents…');
        for (const cfg of AGENTS) {
          try {
            const src = await grab(AGENT_BASE + cfg.file, null);
            if (!src) continue;
            pyodide.FS.writeFile('/agents/' + cfg.file, src);
            const mod = cfg.file.replace(/\.py$/, ''), slot = '_vb_' + cfg.className;
            await pyodide.runPythonAsync(`from agents.${mod} import ${cfg.className} as _C\n${slot} = _C()\n`);
            const inst = pyodide.globals.get(slot);
            if (!inst) continue;
            const md = inst.metadata;
            const metadata = md && md.toJs ? md.toJs({ dict_converter: Object.fromEntries }) : md;
            const name = (inst.name && String(inst.name)) || cfg.className.replace(/Agent$/, '');
            pyAgents[name] = { instance: inst, metadata };
          } catch (e) { if (log) log('[vbrainstem] agent', cfg.file, 'failed:', e.message); }
        }
        const names = Object.keys(pyAgents);
        say(names.length ? 'ready with ' + names.join(', ') : 'ready (verbs only — no python agents loaded)');
        return pyodide;
      } catch (e) {
        say('python unavailable: ' + e.message + ' — running on verbs alone');
        pyodide = null;
        loading = null;              // a bad moment is not a life sentence: let it be retried
        return null;
      }
    })();
    return loading;
  }

  function agentToolDefs() {
    return Object.entries(pyAgents).filter(([, i]) => i && i.metadata).map(([name, info]) => ({
      type: 'function',
      function: { name, description: info.metadata.description || ('Run ' + name),
                  parameters: info.metadata.parameters || { type: 'object', properties: {}, required: [] } },
    }));
  }

  async function callAgent(name, args) {
    const info = pyAgents[name];
    if (!info) return null;
    // Every toPy() hands back a proxy that owns memory on the Python side; dropping the
    // reference does not free it. Over a long session of tool calls that is a slow leak.
    const proxy = pyodide.toPy(args || {});
    try {
      pyodide.globals.set('_vb_args', proxy);
      pyodide.globals.set('_vb_target', info.instance);
      const out = await pyodide.runPythonAsync('str(_vb_target.perform(**dict(_vb_args)))');
      return String(out);
    } finally {
      try { proxy.destroy(); } catch (e) {}
      try { pyodide.globals.delete('_vb_args'); pyodide.globals.delete('_vb_target'); } catch (e) {}
    }
  }

  // ── one turn of thought ──────────────────────────────────────────────────
  // Percepts in; the model may call verbs, and does, until it has said something. Every call and
  // every result is returned, so an operator can read exactly what the player did and why.
  async function turn(opts) {
    const o = opts || {};
    const auth = root.NexusAuth, drive = root.__autodrive;
    if (!auth || !auth.signedIn()) throw new Error('no mind: not signed in');
    if (!drive) throw new Error('no hands: the driver is not loaded here');
    const log = o.log || function () {};

    if (o.python !== false) { try { await initPyodide(log); } catch (e) {} }
    const tools = verbToolDefs().concat(agentToolDefs());

    const system = (o.persona || 'You are a visitor in a shared 3D world.') + '\n'
      + 'You are PLAYING, through exactly the controls a person has. Act by CALLING the world_* '
      + 'tools — never describe an action in words instead of calling it, and never name a portal '
      + 'or a person that is not in the percepts. Look before you move if your picture is stale. '
      + 'When someone has spoken to you, answer them. Take one or two actions, then reply with a '
      + 'single short line of what you say out loud — or an empty reply if you say nothing.';

    const messages = [{ role: 'system', content: system },
                      { role: 'user', content: 'PERCEPTS: ' + JSON.stringify(o.percepts || {}) }];
    const calls = [];
    // A MODEL USUALLY NARRATES AND ACTS IN THE SAME BREATH. Reading the spoken line only from a
    // round with no tool calls throws away everything said on every acting round — and a player
    // that acts on every round then never speaks at all.
    let lastWords = '';

    for (let round = 0; round < (o.rounds || MAX_ROUNDS); round++) {
      const msg = await auth.chat(messages, { tools, raw: true, temperature: o.temperature, max_tokens: 500 });
      messages.push(msg);
      const said = String((msg && msg.content) || '').trim();
      if (said) lastWords = said;
      const tcs = msg && msg.tool_calls;
      if (!tcs || !tcs.length) return { words: lastWords, calls, rounds: round + 1 };
      for (const tc of tcs) {
        const fname = tc.function && tc.function.name;
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) {}
        let result;
        try {
          if (fname && fname.indexOf('world_') === 0) {
            const verb = fname.slice(6);
            // A NAME THE HANDS DO NOT HAVE IS NOT AN ACTION. Dispatching an unrecognised verb
            // used to reach a silent no-op and still be reported as success, so a model could
            // invent world_jump and be told it jumped.
            if (!CALL[verb]) result = 'no such verb: ' + verb + ' — the hands cannot do that';
            else result = describe(verb, await CALL[verb](drive, args));
          } else {
            const r = await callAgent(fname, args);
            result = r === null ? ('no such tool: ' + fname) : r;
          }
        } catch (e) { result = 'failed: ' + e.message; }
        calls.push({ tool: fname, args, result: String(result).slice(0, 400) });
        log('[vbrainstem]', fname, JSON.stringify(args).slice(0, 90), '->', String(result).slice(0, 90));
        messages.push({ role: 'tool', tool_call_id: tc.id, content: String(result).slice(0, 2000) });
      }
    }
    return { words: lastWords, calls, rounds: o.rounds || MAX_ROUNDS, note: 'ran out of rounds still acting' };
  }

  // ── things to say, in character ──────────────────────────────────────────
  // ai/dialogue.js builds a ring from what is TRUE — who spoke, which portal is nearest. That
  // ring is the floor: it needs no network, no seat and no model, and it is what everybody gets.
  // This is the ceiling: the same situation handed to a mind, which answers with lines this
  // particular character would actually say.
  //
  // It asks through a TOOL with a fixed schema rather than asking for JSON in prose, for the
  // same reason the verbs are tools: a shape you are handed cannot be a shape you had to guess.
  const LINES_TOOL = {
    type: 'function',
    function: {
      name: 'propose_lines',
      description: 'Offer the player 3 to 4 things they could say right now.',
      parameters: {
        type: 'object',
        properties: {
          lines: {
            type: 'array', minItems: 3, maxItems: 4,
            items: { type: 'object', required: ['short', 'text'], properties: {
              short: { type: 'string', description: 'one lowercase word for the orb label, at most 8 letters' },
              text: { type: 'string', description: 'the line itself, one natural sentence under 90 characters' } } },
          },
        },
        required: ['lines'],
      },
    },
  };

  async function lines(opts) {
    const o = opts || {}, auth = root.NexusAuth;
    if (!auth || !auth.signedIn()) return null;
    const who = o.who || {};
    const recent = (o.chat || []).slice(-4).map(c => (c.from === String(who.id).slice(0, 6) ? 'them: ' : 'you: ') + c.text);
    const near = (o.portals || []).slice().sort((a, b) => (a.distance || 0) - (b.distance || 0))[0];
    const msg = await auth.chat([
      { role: 'system', content: (o.persona || 'You are a visitor in a shared 3D world of portals.')
        + ' Offer things to say that fit THIS moment — not greetings if you are already talking, not '
        + 'questions already answered. Speak plainly, the way a person actually talks. Call propose_lines and nothing else.' },
      { role: 'user', content: 'You are talking to ' + (who.name || 'someone')
        + (who.isAI ? ' (an AI player)' : ' (a person)') + '.'
        + (near ? ' The nearest portal is ' + near.name + '.' : '')
        + (recent.length ? '\nRecently said:\n' + recent.join('\n') : '\nNothing has been said yet.') },
    ], { tools: [LINES_TOOL], tool_choice: { type: 'function', function: { name: 'propose_lines' } },
         raw: true, temperature: 0.9, max_tokens: 300 });
    const tc = msg && msg.tool_calls && msg.tool_calls[0];
    if (!tc) return null;
    let got;
    try { got = JSON.parse(tc.function.arguments || '{}'); } catch (e) { return null; }
    const out = [];
    for (const l of (got.lines || [])) {
      const short = String(l && l.short || '').trim().toLowerCase().slice(0, 8);
      const text = String(l && l.text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (short && text && !out.some(x => x.text === text)) out.push({ short, text });
      if (out.length >= 4) break;
    }
    if (out.length < 2) return null;                 // too thin to be worth replacing the floor
    out.push({ short: 'leave', text: 'catch you later' });
    return out;
  }

  // ── the tick ─────────────────────────────────────────────────────────────
  // A turn is one thought. THIS is the thing that makes a player a player: perceive, think,
  // act, wait, again — the rapplication loop, running in the world rather than beside it.
  //
  // Nobody drives it from outside. Earlier an AI player only moved because a test harness
  // stepped it, which meant the player was a puppet and the harness was the intelligence. With
  // a mind in the page that inverts: the loop lives here, ticks on its own clock, and the only
  // thing anyone outside does is start it, watch it, and stop it.
  //
  // Every tick is journalled — what it said, what it called, what came back — because a player
  // you cannot audit is a player you cannot trust, and because the journal IS the evidence that
  // it played rather than idled.
  function live(opts) {
    const o = Object.assign({ everyMs: 6000, maxTicks: 0, vision: true }, opts || {});
    // A SESSION IS A LINE, NOT A LOG. Every tick is a rapp/1 frame carrying what the player
    // asserts it did and what that tick required to be true — the openrappter qqdrill shape.
    // That buys three things a log cannot: the line can be verified by anyone with the spec, two
    // runs of the same player can be matched tick for tick (one match is coincidence, six are
    // evidence), and a later frame that contradicts something an earlier tick REQUIRED can be
    // refused rather than quietly absorbed.
    //
    // The identity is minted once, from randomness. Never from the persona's name — a name-hash
    // would make two players called "greeter" the same being, which is the one mistake this
    // estate does not make twice.
    const streamId = o.streamId || ('rappid:@kody-w/ainexus/player:' +
      (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : String(Math.random()).slice(2)));
    const state = { ticks: 0, acts: 0, words: 0, running: true, done: false, journal: [],
                    stopped: null, streamId, chain: [], prev: null };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // what this tick claims, and what it leaned on
    async function seal(entry, percepts) {
      const F = root.NexusFrames;
      if (!F) return null;
      const named = (entry.calls || []).map(c => c.name).filter(Boolean);
      const asserts = {
        tick: entry.tick,
        at: (percepts && percepts.me) || {},
        said: entry.words || '',
        called: (entry.calls || []).map(c => c.tool + (c.failed ? ' ✗' : '')),
        saw_people: ((percepts && percepts.players) || []).map(p => p.name || p.id).slice(0, 8),
      };
      if (entry.error) asserts.error = String(entry.error).slice(0, 200);
      // the facts this tick acted on: naming a portal or a peer is depending on it being there
      const requires = {};
      const portals = ((percepts && percepts.portals) || []).map(x => x.name || x).filter(Boolean);
      if (named.length) requires.named = named.slice(0, 8);
      if (portals.length) requires.portals_in_view = portals.slice(0, 12);
      try {
        const f = await F.buildFrame({ kind: 'nexus.tick', streamId, seq: state.chain.length,
                                       payload: { asserts, requires }, prev: state.prev });
        state.chain.push(f); state.prev = f.payload_hash;
        if (state.chain.length > 500) state.chain.shift();     // a long session is still bounded
        return f;
      } catch (e) { return null; }
    }

    (async () => {
      while (state.running && (!o.maxTicks || state.ticks < o.maxTicks)) {
        const drive = root.__autodrive;
        if (!drive) { state.stopped = 'the hands went away'; break; }
        state.ticks++;
        const started = Date.now();
        let entry, s0 = null;
        try {
          s0 = o.vision && drive.sense ? drive.sense({ width: 320, send: true }) : drive.snapshot();
          const r = await turn({
            percepts: { me: s0.me, world: s0.world, portals: s0.portals, players: s0.players,
                        room: s0.room, chat: (s0.chat || []).slice(-4),
                        picture: s0.vision ? (s0.vision.blank ? 'BLANK — you cannot see' : 'you can see') : 'none' },
            persona: o.persona, python: o.python, log: o.log, rounds: o.rounds,
          });
          state.acts += (r.calls || []).length;
          if (r.words) state.words++;
          entry = { tick: state.ticks, ms: Date.now() - started, words: r.words,
                    calls: (r.calls || []).map(c => ({ tool: c.tool, name: c.args && (c.args.portal || c.args.to),
                                                       failed: /failed|no such/.test(c.result) })) };
          entry.frame = await seal(entry, s0);
        } catch (e) {
          entry = { tick: state.ticks, ms: Date.now() - started, error: e.message };
          entry.frame = await seal(entry, null);
          // A dead credential will not heal by being asked again in six seconds. Stop, and say why.
          if (/sign-in expired|not signed in|no mind/i.test(e.message)) {
            state.stopped = e.message; state.running = false;
          }
        }
        state.journal.push(entry);
        if (state.journal.length > 200) state.journal.shift();
        if (o.onTick) { try { o.onTick(entry, state); } catch (e) {} }
        if (!state.running) break;
        await sleep(o.everyMs);
      }
      state.running = false; state.done = true;
      if (!state.stopped) state.stopped = 'asked to stop';
      if (o.onStop) { try { o.onStop(state); } catch (e) {} }
    })();

    return {
      stop: (why) => { state.running = false; state.stopped = why || 'asked to stop'; },
      state: () => state,
      // the line itself, as a file anybody can check against the spec
      chain: () => state.chain.map(f => JSON.stringify(f)).join('\n') + (state.chain.length ? '\n' : ''),
      verify: () => (root.NexusFrames ? root.NexusFrames.verifyChain(state.chain) : Promise.reject(new Error('no frames module'))),
    };
  }

  root.NexusBrainstem = { turn, lines, live, initPyodide, verbToolDefs, agentToolDefs, callAgent,
                          status: () => ({ python: !!pyodide, agents: Object.keys(pyAgents), note: loadNote }),
                          VERBS, MAX_ROUNDS };
})(typeof window !== 'undefined' ? window : globalThis);

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
    // A failed load must not be memoised. The catch below deliberately nulls `pyodide` so a
    // later call can retry, but this guard handed back the already-settled failure forever,
    // so one flaky fetch disabled Python for the life of the tab.
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
        loading = null;                      // let the next turn try again
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
    pyodide.globals.set('_vb_args', pyodide.toPy(args || {}));
    pyodide.globals.set('_vb_target', info.instance);
    const out = await pyodide.runPythonAsync('str(_vb_target.perform(**dict(_vb_args)))');
    return String(out);
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

    // The session is CARRIED IN, never read off the driver. Reading it here was the same
    // mistake mind() had, one boundary further out: the line above awaits initPyodide(),
    // which on a cold tab downloads a wasm runtime and can take tens of seconds, so a turn
    // stopped during that load used to wake and adopt whatever was live — its stop-check
    // could then never fire, and every tool call it issued was accepted and executed.
    const session = o.session || null;
    const stopped = () => !!session && !session.alive;
    // ...and the first thing to ask is whether that load outlived us.
    if (stopped()) return { words: '', calls: [], rounds: 0, note: 'stopped' };

    for (let round = 0; round < (o.rounds || MAX_ROUNDS); round++) {
      if (stopped()) return { words: '', calls, rounds: round, note: 'stopped' };
      const msg = await auth.chat(messages, { tools, raw: true, temperature: o.temperature, max_tokens: 500 });
      messages.push(msg);
      const tcs = msg && msg.tool_calls;
      if (!tcs || !tcs.length) {
        const words = String((msg && msg.content) || '').trim();
        return { words, calls, rounds: round + 1 };
      }
      for (const tc of tcs) {
        if (stopped()) return { words: '', calls, rounds: round + 1, note: 'stopped' };
        const fname = tc.function && tc.function.name;
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) {}
        let result;
        try {
          if (fname && fname.indexOf('world_') === 0) {
            const verb = fname.slice(6);
            result = await drive.run({ steps: [Object.assign({ do: verb }, args)] }, null, { session });
            // the step's own return is more useful to a mind than "done"
            if (verb === 'people') result = JSON.stringify(drive.people());
            else if (verb === 'orbs') result = JSON.stringify(drive.orbs().map(x => ({ name: x.name, distance: x.distance })));
            else if (verb === 'dialogue') result = JSON.stringify(drive.dialogue(args.to));
            else if (verb === 'see' || verb === 'scan') { const s = drive.snapshot(); result = JSON.stringify({ me: s.me, portals: s.portals, players: s.players }); }
            // never launder a refusal into a success: a step run() declined because the
            // operator stopped must reach the model and the receipt as 'stopped', or the
            // journal records work that never happened
            else if (result !== 'stopped') result = 'ok';
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
    return { words: '', calls, rounds: o.rounds || MAX_ROUNDS, note: 'ran out of rounds still acting' };
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

  root.NexusBrainstem = { turn, lines, initPyodide, verbToolDefs, agentToolDefs, callAgent,
                          status: () => ({ python: !!pyodide, agents: Object.keys(pyAgents), note: loadNote }),
                          VERBS, MAX_ROUNDS };
})(typeof window !== 'undefined' ? window : globalThis);

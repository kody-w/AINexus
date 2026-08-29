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
  // The world itself, as an agent — same contract, loaded from here rather than from the grail.
  const LOCAL_AGENTS = [
    { url: 'vb/nexus_world_agent.py', className: 'NexusWorldAgent' },
    // lenses: a tile in, a tile out, pure — so they compose
    { url: 'vb/lens_gravity_agent.py', className: 'LensGravityAgent' },
    { url: 'vb/lens_daynight_agent.py', className: 'LensDayNightAgent' },
    { url: 'vb/lens_cataclysm_agent.py', className: 'LensCataclysmAgent' },
    // the inverse: a world wearing an organism rather than a lens wearing a world
    { url: 'vb/adapt_agent.py', className: 'AdaptAgent' },
  ];
  const CORE_AGENTS = ['ManageMemory', 'ContextMemory', 'NexusWorld',
                       'LensGravity', 'LensDayNight', 'LensCataclysm', 'Adapt'];

  // ── the ceiling ──────────────────────────────────────────────────────────
  // A herd of players thinking every few seconds, several model round trips each, on somebody
  // else's Copilot seat, with no upper bound — that is a tab left open overnight quietly
  // spending a stranger's money. A default of "unlimited" is not a default, it is an accident
  // waiting for the first person who walks away from the keyboard.
  //
  // So the session has a hard ceiling on model calls and on wall-clock, both raisable on
  // purpose and neither raisable by a player. When it is reached, thinking stops and says so.
  const budget = { calls: 0, limit: 400, since: Date.now(), minutes: 90, stopped: null };
  function spend() {
    if (budget.stopped) throw new Error(budget.stopped);
    if (budget.calls >= budget.limit)
      throw new Error(budget.stopped = 'session budget reached (' + budget.limit + ' model calls) — nothing more will be spent');
    if ((Date.now() - budget.since) / 60000 >= budget.minutes)
      throw new Error(budget.stopped = 'session time limit reached (' + budget.minutes + ' minutes) — nothing more will be spent');
    budget.calls++;
  }

  // ── the single lane ──────────────────────────────────────────────────────
  // There is ONE runtime and ONE `__autodrive` binding, and a turn holds that binding across
  // several awaits while it talks to a model. Two turns overlapping is not a slow path, it is a
  // wrong one: the second swap replaces the first player's hands mid-thought, and player A
  // finishes its turn by moving player B's body.
  //
  // So turns queue. Every turn takes the next SLOT on the way in, and the slot number goes into
  // the tick frame — which means the interleaving is not merely correct, it is written down: a
  // chain with a repeated or missing slot is a chain that raced, and anyone can see it.
  let lane = Promise.resolve(), nextSlot = 0, depth = 0;
  function inLane(fn) {
    // ALREADY INSIDE IT. A tool call that reaches back into turn() would queue behind the turn
    // that is running it — and wait for itself, forever, taking every other player down with it.
    // Re-entering runs directly: it is already the one holding the lane.
    if (depth > 0) return Promise.resolve(fn(nextSlot++));
    const slot = nextSlot++;
    const enter = async () => { depth++; try { return await fn(slot); } finally { depth--; } };
    // depth must fall only when the async body finishes, not when it first awaits
    const run = lane.then(enter, enter).then(
      (v) => v, (e) => { throw e; });
    lane = run.then(() => {}, () => {});
    return run;
  }
  // work that must not interleave with a turn — hot-loading, which replaces live instances
  function queued(fn) { return inLane(() => fn()); }
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
  const agentSource = {};             // name -> where it came from, so it can be made resident again
  const summonedNames = new Set();    // written by a model rather than fetched — never confused for the rest

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
        for (const cfg of LOCAL_AGENTS) {
          try { await hotload(here(cfg.url), { className: cfg.className, file: cfg.url.split('/').pop() }); }
          catch (e) { if (log) log('[vbrainstem] world agent failed:', e.message); }
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

  // ── hot-loading ──────────────────────────────────────────────────────────
  // Drop an agent.py in and the player can use it on its very next thought. This is the whole
  // reason the agents run as Python rather than being reimplemented here: an agent written for
  // a brainstem on a laptop is the same file, unchanged, and a player picks it up without a
  // reload, a build, or a deploy.
  async function hotload(what, opts) { return queued(() => hotloadNow(what, opts)); }
  async function hotloadNow(what, opts) {
    const o = opts || {};
    await initPyodide(o.log);
    if (!pyodide) throw new Error('no python: cannot hot-load agents');
    let source = what, file = o.file;
    if (/^https?:|^\.|^\//.test(String(what)) && !/\n/.test(String(what))) {
      const r = await fetch(what, { cache: 'no-cache' });
      if (!r.ok) throw new Error('could not fetch ' + what + ' (' + r.status + ')');
      source = await r.text();
      file = file || String(what).split('/').pop();
    }
    file = file || ('hot_' + Date.now() + '_agent.py');
    if (!/\.py$/.test(file)) file += '.py';
    // find the class the file defines, so the caller does not have to name it
    const cls = o.className || (String(source).match(/^class\s+([A-Za-z_]\w*)\s*\(/m) || [])[1];
    if (!cls) throw new Error('no agent class found in ' + file);
    pyodide.FS.writeFile('/agents/' + file, source);
    const mod = file.replace(/\.py$/, ''), slot = '_vb_hot_' + cls;
    await pyodide.runPythonAsync(`import importlib, sys\nsys.modules.pop('agents.${mod}', None)\n` +
                                 `from agents.${mod} import ${cls} as _C\n${slot} = _C()\n`);
    const inst = pyodide.globals.get(slot);
    if (!inst) throw new Error('could not instantiate ' + cls);
    const md = inst.metadata;
    const metadata = md && md.toJs ? md.toJs({ dict_converter: Object.fromEntries }) : md;
    let name = (inst.name && String(inst.name)) || cls.replace(/Agent$/, '');
    // TWO PLAYERS, ONE NAME, DIFFERENT CODE. Overwriting the live instance would hand a player
    // somebody else's agent under a name it trusts. A genuine duplicate (same source) is
    // shared; a different one gets its own name and the caller is told what it actually got.
    const prior = agentSource[name];
    if (pyAgents[name] && prior && prior.file !== file) {
      let n = 2; while (pyAgents[name + '~' + n]) n++;
      name = name + '~' + n;
    }
    pyAgents[name] = { instance: inst, metadata };
    agentSource[name] = { what, file, className: cls };
    if (o.log) o.log('[vbrainstem] hot-loaded', name, 'from', file);
    return { name, metadata, file };
  }

  // `only` limits the set to this player's own agents plus the shared core. Everything stays
  // loaded in the one runtime; what changes per call is which of it this player can see.
  // ── residency ────────────────────────────────────────────────────────────
  // Loading an agent at join time is not the same as it being THERE when the call goes out. A
  // runtime shared by a herd can lose one — a load that failed quietly, a name replaced by a
  // later player, a page that woke up with a half-built world. So the set is checked at the
  // instant of the call, from inside the lane, where nothing else can interleave: anything
  // missing is written to the virtual filesystem and imported right then, and the turn only
  // proceeds once every name it needs is answering. What the model is offered is exactly what
  // is in memory, not what was in memory earlier.
  async function ensureResident(names, log) {
    const want = (names || []).filter(Boolean);
    const resident = [], missing = [];
    for (const n of want) {
      // the same test the tool filter uses, or a player is offered a tool that is not there
      if (pyAgents[n] && pyAgents[n].metadata) { resident.push(n); continue; }
      const src = agentSource[n];
      if (!src) { missing.push(n); continue; }
      try { await hotload(src.what, { file: src.file, className: src.className, log });
            if (pyAgents[n] && pyAgents[n].metadata) resident.push(n); else missing.push(n); }
      catch (e) { missing.push(n); if (log) log('[vbrainstem] could not make ' + n + ' resident: ' + e.message); }
    }
    return { resident, missing };
  }

  // ── summoning ────────────────────────────────────────────────────────────
  // A player reaches for something it does not have. The ordinary answer is "no such tool",
  // which ends the thought. There are two better ones, and they are the qqdrill idea applied to
  // capability rather than to history.
  //
  //   FROM A UNIVERSE WHERE IT MATCHED. Every tick in this herd is a frame that records which
  //   agents were resident and whether the call worked. So before inventing anything, look for a
  //   line where this capability already existed AND the call did not fail — a fixed point. If
  //   another player has stood in that universe, the agent is fetched from where that line says
  //   it came from, and it is not a guess: it is a thing that has demonstrably worked here.
  //
  //   OTHERWISE, MADE. No line has it, so it is written now, hot-loaded into the running
  //   runtime, and used in the same turn that needed it. Generated capability is marked as such
  //   in the frame — a tool that was invented a second ago and a tool that has worked in six
  //   universes should never look alike to anyone auditing the line.
  const AGENT_SHAPE = {
    type: 'function',
    function: {
      name: 'write_agent',
      description: 'Write one RAPP agent.py that provides the missing capability.',
      parameters: { type: 'object', required: ['class_name', 'source'], properties: {
        class_name: { type: 'string', description: 'the class name, ending in Agent' },
        source: { type: 'string', description:
          'the complete python file: `from agents.basic_agent import BasicAgent`, one class extending it, ' +
          '__init__ setting self.name and self.metadata (name, description, parameters as a JSON schema) ' +
          'then calling super().__init__(name=self.name, metadata=self.metadata), and perform(self, **kwargs) ' +
          'returning a string. Standard library only — no network, no file system, no imports that need installing.' },
      } },
    },
  };

  async function summon(need, opts) {
    const o = opts || {}, log = o.log || function () {};
    // 1 — a universe where it already matched
    const herd = root.NexusHerd;
    if (herd && herd.provenSource) {
      const found = herd.provenSource(need);
      if (found && found.what) {
        try { const a = await hotload(found.what, { file: found.file, className: found.className, log });
              log('[summon] ' + a.name + ' came from a line where it already worked (' + found.player + ')');
              return { name: a.name, via: 'universe', from: found.player }; }
        catch (e) { log('[summon] that universe would not load here: ' + e.message); }
      }
    }
    // 2 — no universe has it, so make one
    const auth = root.NexusAuth;
    if (!auth || !auth.signedIn()) return null;
    spend();
    const msg = await auth.chat([
      { role: 'system', content: 'You write small, correct RAPP agents. Call write_agent and nothing else.' },
      { role: 'user', content: 'A player in a 3D world needs a capability it does not have: ' + String(need).slice(0, 400)
        + '\nWrite the smallest agent that provides it.' },
    ], { tools: [AGENT_SHAPE], tool_choice: { type: 'function', function: { name: 'write_agent' } },
         raw: true, temperature: 0.3, max_tokens: 900 });
    const tc = msg && msg.tool_calls && msg.tool_calls[0];
    if (!tc) return null;
    let got; try { got = JSON.parse(tc.function.arguments || '{}'); } catch (e) { return null; }
    if (!got.source || !/class\s+\w+\s*\(/.test(got.source)) return null;
    // WRITTEN A SECOND AGO BY A MODEL, AND ABOUT TO BE IMPORTED. Pyodide keeps it away from the
    // operating system, but not from this PAGE: `from js import window` would hand fresh, unread
    // code the credential in localStorage and the player's hands. A summoned agent is allowed to
    // compute and to answer; it is not allowed to reach out of the interpreter.
    const forbidden = [
      [/^\s*(?:import\s+js\b|from\s+js\s+import)/m, 'reaching into the page (js)'],
      [/\bpyodide\b|\bpyfetch\b|\bjs\.\w+/, 'reaching into the page'],
      [/\b(?:eval|exec|compile|__import__|globals|locals|breakpoint)\s*\(/, 'evaluating code at runtime'],
      [/\bopen\s*\(|\bos\.|\bsubprocess\b|\bsocket\b|\bshutil\b/, 'touching files, processes or the network'],
      [/__(?:subclasses|bases|mro|class)__/, 'walking the object graph to escape'],
    ];
    for (const [re, why] of forbidden) {
      if (re.test(got.source)) { log('[summon] refused a written agent: ' + why); return null; }
    }
    try {
      const a = await hotload(got.source, { className: got.class_name, file: 'summoned_' + Date.now() + '_agent.py', log });
      summonedNames.add(a.name);
      log('[summon] wrote ' + a.name + ' from nothing and loaded it');
      return { name: a.name, via: 'generated' };
    } catch (e) { log('[summon] the written agent would not load: ' + e.message); return null; }
  }

  // Does this agent actually declare an identity parameter? Grepping the whole manifest for the
  // string "user_guid" says yes for an agent that merely mentions it in a description, and says
  // no for one that names its identity parameter something else — a contract has to be read
  // where it is written.
  function takesGuid(info) {
    const props = info && info.metadata && info.metadata.parameters && info.metadata.parameters.properties;
    return !!(props && Object.prototype.hasOwnProperty.call(props, 'user_guid'));
  }

  function agentToolDefs(only) {
    // `undefined` means "everything"; `[]` means "this player brought none of its own", and
    // those are not the same sentence. Treating them alike showed every player's agents to
    // every player who happened to arrive empty-handed — which is most of them.
    const allow = only == null ? null : new Set(only.concat(CORE_AGENTS));
    return Object.entries(pyAgents).filter(([n, i]) => i && i.metadata && (!allow || allow.has(n))).map(([name, info]) => ({
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
      // NOT str() around the call. An agent that drives the world hands back the promise for
      // the thing it started, and stringifying a promise reports that we asked rather than
      // what happened — the exact lie the verb dispatch was just fixed for.
      let out = await pyodide.runPythonAsync('_vb_target.perform(**dict(_vb_args))');
      if (out && typeof out.then === 'function') out = await out;
      if (out && typeof out.toJs === 'function') { const j = out.toJs({ dict_converter: Object.fromEntries }); try { out.destroy(); } catch (e) {} out = j; }
      if (out === false || out === null || out === undefined) return 'failed: the world did not do that';
      if (out === true) return 'ok';
      return typeof out === 'object' ? JSON.stringify(out).slice(0, 1200) : String(out).slice(0, 1200);
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
    const auth = root.NexusAuth;
    if (!auth || !auth.signedIn()) throw new Error('no mind: not signed in');
    // ONE BRAINSTEM CAN SERVE MANY PLAYERS, but only one at a time, and the Python side reads
    // the page's driver by name. Binding it for the duration of the call — and restoring it
    // after — is what lets a shared runtime move a different player's hands each turn without
    // any of them noticing. The swap is a pointer, not a load.
    return inLane(async (slot) => {
      // RESOLVED IN HERE, NOT OUT THERE. Reading the driver before entering the lane meant a
      // caller that named no driver picked up whatever binding happened to be installed at that
      // instant — which, mid-herd, is somebody else's body.
      const held = root.__autodrive, heldAgents = root.__nexus_agents;
      const drive = o.drive || held;
      if (!drive) throw new Error('no hands: the driver is not loaded here');
      root.__autodrive = drive;
      root.__nexus_agents = (o.agents || []).concat(CORE_AGENTS);
      try { const r = await think(drive); r.slot = slot; return r; }
      finally { root.__autodrive = held; root.__nexus_agents = heldAgents; }
    });

    async function think(drive) {
    const log = o.log || function () {};

    if (o.python !== false) { try { await initPyodide(log); } catch (e) {} }
    // checked here, inside the lane, immediately before the model is asked anything
    const residency = o.python === false ? { resident: [], missing: [] }
                                         : await ensureResident((o.agents || []).concat(CORE_AGENTS), log);
    const tools = verbToolDefs().concat(agentToolDefs(o.agents));

    const system = (o.persona || 'You are a visitor in a shared 3D world.') + '\n'
      + 'You are PLAYING, through exactly the controls a person has. Act by CALLING the world_* '
      + 'tools — never describe an action in words instead of calling it, and never name a portal '
      + 'or a person that is not in the percepts. Look before you move if your picture is stale. '
      + 'When someone has spoken to you, answer them. Take one or two actions, then reply with a '
      + 'single short line of what you say out loud — or an empty reply if you say nothing.';

    const messages = [{ role: 'system', content: system },
                      { role: 'user', content: 'PERCEPTS: ' + JSON.stringify(o.percepts || {}) }];
    const calls = [];
    const summoned = [];
    // A MODEL USUALLY NARRATES AND ACTS IN THE SAME BREATH. Reading the spoken line only from a
    // round with no tool calls throws away everything said on every acting round — and a player
    // that acts on every round then never speaks at all.
    let lastWords = '';

    for (let round = 0; round < (o.rounds || MAX_ROUNDS); round++) {
      spend();
      const msg = await auth.chat(messages, { tools, raw: true, temperature: o.temperature, max_tokens: 500 });
      messages.push(msg);
      const said = String((msg && msg.content) || '').trim();
      if (said) lastWords = said;
      const tcs = msg && msg.tool_calls;
      if (!tcs || !tcs.length) return { words: lastWords, calls, rounds: round + 1, residency, summoned };
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
          } else if (!pyAgents[fname] && o.summon !== false) {
            // reached for something nobody has: find a universe where it worked, or write it
            const got = await summon('a tool called "' + fname + '" called with ' + JSON.stringify(args).slice(0, 200), { log });
            if (got && pyAgents[got.name]) {
              summoned.push({ asked: fname, got: got.name, via: got.via });
              if (o.guid && takesGuid(pyAgents[got.name])) args.user_guid = o.guid;
              const r2 = await callAgent(got.name, args);
              result = (r2 === null ? 'no such tool: ' + fname : r2);
            } else result = 'no such tool: ' + fname + ' — and none could be summoned';
          } else {
            // The identity is IMPOSED, never requested. An agent that stores or recalls memory
            // is given this player's guid whether the model thought to pass one or not —
            // otherwise one player's recollection is another player's, which in a shared
            // runtime is the only way this can go badly wrong.
            if (o.guid && takesGuid(pyAgents[fname])) args.user_guid = o.guid;
            const r = await callAgent(fname, args);
            result = r === null ? ('no such tool: ' + fname) : r;
          }
        } catch (e) { result = 'failed: ' + e.message; }
        calls.push({ tool: fname, args, result: String(result).slice(0, 400) });
        log('[vbrainstem]', fname, JSON.stringify(args).slice(0, 90), '->', String(result).slice(0, 90));
        messages.push({ role: 'tool', tool_call_id: tc.id, content: String(result).slice(0, 2000) });
      }
    }
    return { words: lastWords, calls, rounds: o.rounds || MAX_ROUNDS, residency, summoned, note: 'ran out of rounds still acting' };
    }
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
    spend();
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
        const drive = o.drive || root.__autodrive;
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
            drive: o.drive, guid: o.guid,
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

  root.NexusBrainstem = { turn, lines, live, hotload, summon, ensureResident, initPyodide, slots: () => nextSlot,
                          budget: (patch) => { if (patch) Object.assign(budget, patch); return Object.assign({}, budget); },
                          halt: (why) => { budget.stopped = why || 'stopped by the operator'; },
                          wasSummoned: (n) => summonedNames.has(n), takesGuid, queued,
                          resident: () => Object.keys(pyAgents),
                          sourceOf: (name) => agentSource[name] || null, verbToolDefs, agentToolDefs, callAgent,
                          status: () => ({ python: !!pyodide, agents: Object.keys(pyAgents), note: loadNote }),
                          VERBS, MAX_ROUNDS };
})(typeof window !== 'undefined' ? window : globalThis);

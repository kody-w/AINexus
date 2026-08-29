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
    { url: 'vb/world_forge_agent.py', className: 'WorldForgeAgent' },
    // a conversation is the smallest frame there is, and the cheapest thing to slosh
    { url: 'vb/chat_tile_agent.py', className: 'ChatTileAgent' },
    { url: 'vb/organism_forge_agent.py', className: 'OrganismForgeAgent' },
  ];
  const CORE_AGENTS = ['ManageMemory', 'ContextMemory', 'NexusWorld',
                       'LensGravity', 'LensDayNight', 'LensCataclysm', 'Adapt', 'WorldForge', 'ChatTile', 'OrganismForge'];

  // ── the ceiling ──────────────────────────────────────────────────────────
  // A herd of players thinking every few seconds, several model round trips each, on somebody
  // else's Copilot seat, with no upper bound — that is a tab left open overnight quietly
  // spending a stranger's money. A default of "unlimited" is not a default, it is an accident
  // waiting for the first person who walks away from the keyboard.
  //
  // So the session has a hard ceiling on model calls and on wall-clock, both raisable on
  // purpose and neither raisable by a player. When it is reached, thinking stops and says so.
  //
  // SCOPE: this is one counter per JS realm — per page, and per iframe. A herd sharing one page
  // shares one ceiling, which is the case it was written for. Players in SEPARATE frames
  // (autodrive.html gives each one its own world in its own iframe) each get their own 400, so
  // six tabs is a ceiling of 2400. That is the truth about it; the word "session" above meant
  // the page, not the visitor, and pretending otherwise would be the more expensive mistake.
  //
  // `since` is a DEADLINE, not a rolling window: it is stamped when this file loads and never
  // moves on its own, so the wall-clock ceiling is 90 minutes from the page opening. Nothing
  // resets it except an operator explicitly patching it, which is the point — a window that
  // rolled would be a budget that refills itself while nobody is watching.
  const budget = { calls: 0, limit: 400, since: Date.now(), minutes: 90,
                   stopped: null, reason: null, free: 0 };
  function refuse(reason, msg) {
    budget.reason = reason; budget.stopped = msg;
    const e = new Error(msg); e.code = 'budget'; e.reason = reason; return e;
  }
  // A MIND THAT COSTS NOTHING MUST NOT EAT A CEILING THAT EXISTS TO BOUND COST. Since a mind is
  // a contract rather than a service, some of them are free: a scripted NPC buys no thought and
  // reaches no seat. Counting its turns against the paid limit did two bad things at once —
  // a few hundred NPC turns permanently locked the visitor's own player out of thinking, and the
  // refusal it got said "400 model calls" when the true number of model calls was zero.
  // Free turns are still COUNTED, in their own column, because a run nobody paid for is still a
  // run somebody should be able to see.
  // `free: false` on a mind overrides the exemption, which is how the paid ceiling stays testable:
  // a scripted mind marked paid drives the real accounting thousands of times without buying one.
  function spend(mind) {
    const paid = !(mind && mind.free !== false && (mind.isScripted === true || mind.free === true));
    // an operator's halt binds everything; a ceiling only binds what spends
    if (budget.stopped && (paid || budget.reason === 'operator')) {
      const e = new Error(budget.stopped); e.code = 'budget'; e.reason = budget.reason || 'calls'; throw e;
    }
    if (!paid) { budget.free++; return; }
    if (budget.calls >= budget.limit)
      throw refuse('calls', 'session budget reached (' + budget.limit + ' model calls) — nothing more will be spent');
    if ((Date.now() - budget.since) / 60000 >= budget.minutes)
      throw refuse('time', 'session time limit reached (' + budget.minutes + ' minutes) — nothing more will be spent');
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
  // A NUMBER FROM A MIND IS A REQUEST, NOT A FACT. Round it, bound it, and never let a bit-op
  // silently change its sign or its size. MAX_TURN is generous — several full turns — while still
  // refusing an int32 wrap or an Infinity.
  const MAX_TURN = 20000;
  const swing = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(-MAX_TURN, Math.min(MAX_TURN, Math.round(n)));
  };
  const count = (v, cap) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return undefined;   // let the hands use their own default
    return Math.max(1, Math.min(cap, Math.round(n)));
  };

  // A NAME IS NOT A CAPABILITY JUST BECAUSE JAVASCRIPT ANSWERS TO IT. CALL, pyAgents and
  // agentSource are plain objects, so every name on Object.prototype answered yes to a bare
  // lookup. `world_toString` reached Object.prototype.toString, came back "[object Object]" and
  // was reported to the mind as a successful action — the exact failure the "no such verb" guard
  // below exists to end, walking straight past it. On the agent side `constructor` and its
  // siblings looked like a tool that already existed, which SKIPPED THE SUMMON PATH entirely and
  // handed the mind an internal TypeError instead of an honest sentence. A mind is untrusted
  // input; the name it asks for has to be a key somebody actually put there.
  const has = (map, name) =>
    typeof name === 'string' && !!name && Object.prototype.hasOwnProperty.call(map, name);

  const CALL = {
    // `a.dx | 0` truncated to int32, which did two things quietly. A fractional turn became NO
    // turn — 0.2 | 0 is 0 — so a small adjustment did nothing while still being reported as done.
    // And it wrapped: 2147483648 | 0 is -2147483648, so a hard right became a hard left. Its
    // siblings walk and wait already clamp; look did not. Same `| 0` that was truncating a frame's
    // seq elsewhere in this estate.
    look:     (d, a) => d.look(swing(a.dx), swing(a.dy)),
    walk:     (d, a) => d.walk(String(a.dir || 'forward'), Math.max(80, Math.min(3000, a.ms || 600))),
    aim:      (d, a) => d.aim(a.portal),
    travel:   (d, a) => d.travel(a.portal),
    say:      (d, a) => d.say(a.text),
    tell:     (d, a) => d.tell(a.to, a.text),
    see:      (d) => d.see({}),
    scan:     (d, a) => d.scan(count(a.steps, 16), count(a.deg, 180)),
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

        // THE BOOTSTRAP FETCHES ARE THE ONES THAT MATTER MOST, and they were the ones with no
        // check at all. hotloadNow verifies the eight same-origin agents under ai/vb/ — the files
        // that shipped with this page — while basic_agent.py, manage_memory_agent.py and
        // context_memory_agent.py came from OTHER repositories, off a mutable `main`, straight into
        // runPythonAsync. basic_agent.py is the base class all eight verified agents inherit from,
        // so the hash-checked leaves were hanging off an unchecked root, and ManageMemory is a core
        // agent offered to every player on every turn. state/bootstrap_agents.json pins each to a
        // commit and publishes its sha256; a fingerprint against a moving branch is a promise that
        // breaks itself.
        let bootstrap = null;
        try {
          const br = await fetch(here('../state/bootstrap_agents.json'), { cache: 'no-cache' });
          if (br.ok) {
            bootstrap = {};
            for (const a of ((await br.json()).agents || [])) bootstrap[a.file] = a;
          }
        } catch (e) { if (log) log('[vbrainstem] no bootstrap manifest: ' + e.message); }

        const digest = async (text) => [...new Uint8Array(await crypto.subtle.digest(
          'SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');

        // grab(url, fallback, pinName): with a pinName, the pinned commit is fetched instead of
        // whatever `main` says today, and bytes that do not match are REFUSED — the fallback is
        // used, never the unverified bytes. Refusing here means losing a capability; running
        // unread code from a branch anyone can move means losing the tab.
        const grab = async (u, fallback, pinName) => {
          const pin = pinName && bootstrap && bootstrap[pinName];
          const url = pin ? 'https://raw.githubusercontent.com/' + pin.repo + '/' + pin.commit + '/' + pin.path : u;
          try {
            const r = await fetch(url, { cache: pin ? 'no-cache' : 'force-cache' });
            if (r.ok) {
              const text = await r.text();
              if (pin) {
                const got = await digest(text);
                if (got !== pin.sha256) {
                  if (log) log('[vbrainstem] REFUSED ' + pinName + ': published ' + pin.sha256.slice(0, 12)
                               + '… but fetched ' + got.slice(0, 12) + '… — not run');
                  return fallback;
                }
                if (log) log('[vbrainstem] verified ' + pinName + ' against its pinned sha256');
              } else if (pinName && !pin) {
                if (log) log('[vbrainstem] ' + pinName + ' has no published fingerprint — not run');
                return fallback;
              }
              return text;
            }
          } catch (e) {}
          return fallback;
        };
        const basic = await grab(BASIC_AGENT_URL, undefined, 'basic_agent.py') || (
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
            const src = await grab(AGENT_BASE + cfg.file, null, cfg.file);
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
  // THE PUBLISHED FINGERPRINTS. Loaded once and consulted by every hot-load, so verification is
  // what happens by default rather than what a careful caller remembers to ask for. state/
  // agent_templates.json is built by tools/build_agent_registry.py from the files themselves.
  // fingerprintsUnavailable is the difference between "no fingerprint published for this file"
  // and "I could not read the list at all". The first is a judgement; the second is ignorance, and
  // ignorance must not silently become permission — a failed fetch of this registry used to turn
  // every later refusal into a load, which is a security check that disappears exactly when the
  // network is being interfered with.
  let fingerprints = null, fingerprintsTried = false, fingerprintsUnavailable = false;
  async function publishedFingerprints(log) {
    if (fingerprintsTried) return fingerprints;
    fingerprintsTried = true;
    fingerprintsUnavailable = true;      // cleared below only if the list actually parses
    try {
      const r = await fetch(here('../state/agent_templates.json'), { cache: 'no-cache' });
      if (r.ok) {
        const reg = await r.json();
        fingerprints = {};
        for (const t of (reg.templates || [])) {
          if (t.file && /^[0-9a-f]{64}$/.test(String(t.sha256 || ''))) {
            fingerprints[String(t.file).split('/').pop()] = t.sha256;
          }
        }
        fingerprintsUnavailable = false;
        if (log) log('[vbrainstem] ' + Object.keys(fingerprints).length + ' published fingerprints loaded');
      } else {
        // a 503 does not throw — it is a fetch that worked and a server that did not, and it is
        // just as retryable as a network error
        fingerprintsTried = false;
        if (log) log('[vbrainstem] fingerprint list came back ' + r.status
                     + ' — refusing for now, will try again on the next load');
      }
    } catch (e) {
      // A BAD MOMENT IS NOT A LIFE SENTENCE. Failing closed is right; latching that failure for
      // the rest of the page's life is not. One flaky fetch of the list — and it is the first
      // thing the local-agent loop touches — would refuse all eight agents and every later
      // hot-load with no way back but a reload. initPyodide one function up resets itself for
      // exactly this reason. A FETCH failure is retryable; a list that parsed is not re-fetched.
      fingerprintsTried = false;
      if (log) log('[vbrainstem] could not read the fingerprint list (' + e.message
                   + ') — refusing for now, will try again on the next load');
    }
    return fingerprints;
  }

  async function hotload(what, opts) { return queued(() => hotloadNow(what, opts)); }
  async function hotloadNow(what, opts) {
    const o = opts || {};
    await initPyodide(o.log);
    if (!pyodide) throw new Error('no python: cannot hot-load agents');
    let source = what, file = o.file;
    // Is this a place to fetch, or the code itself? A one-line string ending in .py is a path,
    // and treating it as source finds no class and reports a confusing error — which is exactly
    // what it did to a caller passing 'ai/vb/lens_gravity_agent.py'.
    const looksLikePath = !/\n/.test(String(what)) && String(what).length < 512
      && (/^https?:/.test(String(what)) || /^[.\/]/.test(String(what)) || /\.py$/i.test(String(what)));
    if (looksLikePath) {
      const r = await fetch(what, { cache: 'no-cache' });
      if (!r.ok) throw new Error('could not fetch ' + what + ' (' + r.status + ')');
      source = await r.text();
      file = file || String(what).split('/').pop();
      // VERIFY OR REFUSE — and this is the general path, not a special case. The teaching page
      // told strangers that agents fetched from a registry are checked against a published
      // fingerprint and refused on mismatch. That was true of the two forges and NOT true here,
      // which meant the one document a newcomer reads was promising a protection the code did
      // not provide. Refusing is cheap; a page that overclaims safety is not.
      const reg = await publishedFingerprints(o.log);
      const expect = o.sha256
        || (o.registry && o.registry[file] && o.registry[file].sha256)
        || (reg && reg[file]);
      if (expect) {
        const F = root.NexusFrames;
        const bytes = new TextEncoder().encode(source);
        const got = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
          .map(b => b.toString(16).padStart(2, '0')).join('');
        if (got !== expect) {
          throw new Error('REFUSED: ' + file + ' does not match its published sha256 ('
            + expect.slice(0, 12) + '… expected, ' + got.slice(0, 12) + '… fetched). '
            + 'Not repaired, not loaded.');
        }
        if (o.log) o.log('[vbrainstem] verified ' + file + ' against its published sha256');
      } else if (fingerprintsUnavailable) {
        // FAIL CLOSED. Not knowing what the bytes should be is not a reason to run them.
        throw new Error('REFUSED: the published fingerprint list could not be read, so ' + file
          + ' cannot be checked. Refusing rather than running it unverified.');
      } else if (o.requireVerified) {
        throw new Error('REFUSED: no published sha256 for ' + file + ' and verification was required');
      }
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
    // 1 — a universe where it already matched.
    // WHY THIS HALF DOES NOT RUN THE SCAN THE OTHER HALF RUNS, since the asymmetry looks like an
    // oversight and is not. It reloads source out of `agentSource`, and only three things ever
    // put anything there: the agents this page shipped with (sha256-verified at load), agents an
    // operator handed to join(), and agents the second half already scanned. None of those is
    // unread model output. Running the scan here would refuse the page's OWN world — ai/vb/
    // nexus_world_agent.py says `from js import window`, and has to: reaching into the page IS
    // what the world agent is for. The denylist is for code nobody has vouched for; this half
    // only reaches code somebody already did.
    // THE ONE CHANGE THAT WOULD BREAK THAT: persisting `agentSource` to storage so this half
    // survives a reload. Storage on this origin is writable by everything else on it, so a
    // remembered source is no longer vouched for by anyone, and it would have to be scanned —
    // or, better, re-fetched and re-verified — before it were loaded again.
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
    // THE MIND IS A CONTRACT HERE TOO, AND THIS WAS THE ONE PLACE THAT FORGOT IT. summon()
    // reached past its caller to root.NexusAuth, so a turn driven by a mind the caller handed in
    // — a scripted NPC, which buys no thought and asks nobody — went to the visitor's Copilot
    // seat the instant it named a tool that did not exist. Two consequences, both bad and
    // opposite: on a page with no seat this half was unreachable, so "write one from nothing"
    // could never be exercised without buying a thought; on a page WITH one, a character that
    // was supposed to be free quietly spent somebody's money.
    const auth = o.mind || root.NexusAuth;
    if (!auth || !auth.signedIn()) return null;
    spend(auth);
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
      if (re.test(got.source)) { log('[summon] refused a written agent: ' + why); return { refused: why }; }
    }
    // A BLOCKLIST OF SPELLINGS IS NOT A BOUNDARY. The five patterns above name the shapes we
    // already know; they cannot name the ones we do not, and a module reached under another name
    // is the same module — `import js` is refused and an alias of a module nobody thought to list
    // was not. So what a written agent may import is stated POSITIVELY: arithmetic, text, and its
    // own base class. Everything else is refused by module name, whatever it is bound to.
    // This is not a sandbox — Pyodide is the sandbox. This is the door in front of it, and a door
    // that only recognises the burglars it has already met is not a door.
    const IMPORT_OK = new Set(['agents', 'utils', 'math', 'json', 'random', 're', 'time', 'datetime',
      'string', 'textwrap', 'itertools', 'functools', 'collections', 'statistics', 'decimal',
      'fractions', 'uuid', 'typing', 'dataclasses', 'enum', 'abc', 'copy', 'heapq', 'bisect', 'unicodedata']);
    const IMPORT_RE = /^[ \t]*(?:from[ \t]+([A-Za-z_][\w.]*)|import[ \t]+([^\n#]+))/gm;
    for (let m; (m = IMPORT_RE.exec(String(got.source))) !== null;) {
      // `from X import a, b` names one module; `import a, b as c` names several
      const named = m[1] ? [m[1]] : String(m[2]).split(',').map(s => s.trim().split(/[ \t]+/)[0]);
      for (const n of named) {
        const mod = String(n || '').split('.')[0];
        if (!mod || IMPORT_OK.has(mod)) continue;
        log('[summon] refused a written agent: importing ' + mod);
        return { refused: 'it imports ' + mod };
      }
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

  // callAgent's own word for "the agent ran and answered with nothing". It is a constant rather
  // than a literal because the dispatch has to be able to tell it apart from an agent that
  // merely SAID something similar — see the failure verdict in turn().
  const DID_NOT = 'failed: the world did not do that';

  async function callAgent(name, args) {
    // hasOwnProperty, not truthiness: pyAgents['constructor'] is a function, and calling this
    // with an inherited name got as far as pyodide.toPy before failing with a TypeError.
    if (!has(pyAgents, name)) return null;
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
      if (out === false || out === null || out === undefined) return DID_NOT;
      if (out === true) return 'ok';
      // NO TRUNCATION HERE. Cutting an agent's answer to a readable length is a courtesy owed to
      // a MODEL's context window, and it belongs at that boundary — where turn() already does it.
      // Doing it at the source silently mangles agent-to-agent piping: a lens that hands its
      // world to the next lens had its JSON cut mid-object and arrived as "did not return a tile".
      return typeof out === 'object' ? JSON.stringify(out) : String(out);
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
    // A MIND IS A CONTRACT, NOT A SERVICE: signedIn(), and chat(messages) answering with words and
    // tool calls. Usually that is a model on the visitor's Copilot seat, found at root.NexusAuth.
    // A caller may hand one over instead — a scripted mind for an NPC who says the same lines every
    // time, or for exercising everything downstream of the answer without buying a thought. Nothing
    // below can tell the difference, which is the point: the machinery under test stays the real one.
    const auth = o.mind || root.NexusAuth;
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
      // STOP MEANS STOP, INCLUDING MID-THOUGHT. A turn holds the lane across several model round
      // trips, so a kill switch pressed during one used to buy every remaining round and move the
      // body for each — the operator watched a stopped player go on walking. `until` is asked
      // BETWEEN rounds (never before the first: a turn that does nothing is not a turn) and the
      // turn ends where it stands, keeping what it already said and did.
      if (round && typeof o.until === 'function' && !o.until())
        return { words: lastWords, calls, rounds: round, residency, summoned, note: 'stopped mid-turn' };
      spend(auth);        // whose seat this round is on — a free mind spends none of it
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
        // WHETHER A CALL FAILED IS THE DISPATCH'S VERDICT, NEVER THE CALLEE'S PROSE. Readers of
        // a turn decided this by testing the RESULT STRING for /failed|no such/ — and for an
        // agent, that string is whatever the agent returned. A summoned agent — written by a
        // mind, a second ago — answering "no such tool: pay no attention" therefore wrote a ✗
        // against its own name into a sealed rapp/1 frame, and provenSource() reads exactly
        // those marks to decide what has been proven to work. Untrusted output must not be able
        // to forge a verdict about itself. Default true: unless the dispatch saw the thing run,
        // it did not run.
        let failed = true;
        try {
          // A NAME FROM A MIND IS A REQUEST, NOT A FACT, and it does not have to be a string:
          // a number went into fname.indexOf and came back to the mind as
          // 'failed: fname.indexOf is not a function', which is this module's stack trace
          // wearing the costume of a world event.
          if (typeof fname !== 'string' || !fname) {
            result = 'no such tool: that call arrived without a usable name';
          } else if (fname.indexOf('world_') === 0) {
            const verb = fname.slice(6);
            // A NAME THE HANDS DO NOT HAVE IS NOT AN ACTION. Dispatching an unrecognised verb
            // used to reach a silent no-op and still be reported as success, so a model could
            // invent world_jump and be told it jumped. `has`, not truthiness: world_toString
            // found Object.prototype.toString and was answered "[object Object]" — a success.
            if (!has(CALL, verb)) result = 'no such verb: ' + verb + ' — the hands cannot do that';
            else { const v = await CALL[verb](drive, args);
                   result = describe(verb, v);
                   failed = (v === false || v === null || v === undefined); }
          } else if (!has(pyAgents, fname) && o.summon !== false) {
            // reached for something nobody has: find a universe where it worked, or write it
            const got = await summon('a tool called "' + fname + '" called with ' + JSON.stringify(args).slice(0, 200),
                                     { log, mind: o.mind });
            if (got && has(pyAgents, got.name)) {
              summoned.push({ asked: fname, got: got.name, via: got.via });
              if (o.guid && takesGuid(pyAgents[got.name])) args.user_guid = o.guid;
              const r2 = await callAgent(got.name, args);
              if (r2 === null) result = 'no such tool: ' + fname;
              else { result = r2; failed = (r2 === DID_NOT); }
            } else if (got && got.refused) {
              // A REFUSAL IS A RESULT, AND IT BELONGS IN THE LINE. Refusing a written agent was a
              // log() call and nothing else — and o.log defaults to a no-op — so "nobody had it
              // and nothing was written" and "something was written that tried to reach out of
              // the interpreter, and we refused it" arrived at the mind, the journal and the
              // frame as the same six words. A security control nobody can see working is a
              // security control nobody can tell has stopped working.
              summoned.push({ asked: fname, got: 'none', via: 'refused: ' + got.refused });
              result = 'no such tool: ' + fname + ' — one was written for it and refused: ' + got.refused;
            } else result = 'no such tool: ' + fname + ' — and none could be summoned';
          } else {
            // The identity is IMPOSED, never requested. An agent that stores or recalls memory
            // is given this player's guid whether the model thought to pass one or not —
            // otherwise one player's recollection is another player's, which in a shared
            // runtime is the only way this can go badly wrong.
            if (o.guid && takesGuid(pyAgents[fname])) args.user_guid = o.guid;
            const r = await callAgent(fname, args);
            if (r === null) result = 'no such tool: ' + fname;
            else { result = r; failed = (r === DID_NOT); }
          }
        } catch (e) { result = 'failed: ' + e.message; }
        calls.push({ tool: fname, args, failed, result: String(result).slice(0, 400) });
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
    // THE FOURTH PLACE THAT REACHED PAST ITS CALLER FOR A SEAT. turn() and join() took a handed
    // mind, live() dropped it, summon() reached around it, and this one — which offers a person
    // the things they might say — could not be given one at all. So an NPC could act and speak but
    // never propose its own lines, and every ring cost the visitor's seat even when the mind
    // behind it was free.
    const o = opts || {}, auth = o.mind || root.NexusAuth;
    if (!auth || !auth.signedIn()) return null;
    const who = o.who || {};
    const recent = (o.chat || []).slice(-4).map(c => (c.from === String(who.id).slice(0, 6) ? 'them: ' : 'you: ') + c.text);
    const near = (o.portals || []).slice().sort((a, b) => (a.distance || 0) - (b.distance || 0))[0];
    spend(auth);          // a free mind spends none of the seat, here as anywhere else
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
    // minted on first use through the spec's grammar, never spelled from a name (§6.2)
    let streamId = o.streamId || null;
    // `stopped` is the sentence a person reads; `reason` is the word a caller branches on —
    // budget | no-mind | no-hands | maxTicks | failing | asked. Three different deaths that all
    // arrived as English prose used to be told apart by regex, which is how herd.js and this
    // file came to disagree about what counts as fatal.
    const state = { ticks: 0, acts: 0, words: 0, running: true, done: false, journal: [],
                    stopped: null, reason: null, fails: 0,
                    get streamId() { return streamId; }, chain: [], prev: null };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // what this tick claims, and what it leaned on
    async function seal(entry, percepts) {
      const F = root.NexusFrames;
      if (!F) return null;
      // WHERE, IN UNITS A FRAME CAN CARRY. rapp/1 is I-JSON: no floats. herd.js was given this
      // guard and this copy was not — the third time tonight one defect lived in two files and
      // only one got fixed. A drive with real coordinates makes buildFrame throw, and a tick that
      // cannot be sealed is a moment with no record.
      const place = (me) => {
        if (!me || typeof me !== 'object') return {};
        const out = {};
        for (const k of ['x', 'y', 'z']) {
          const v = me[k];
          if (typeof v === 'number' && Number.isFinite(v)) out[k + '_milli'] = Math.round(v * 1000);
        }
        return out;
      };
      const named = (entry.calls || []).map(c => c.name).filter(Boolean);
      const asserts = {
        tick: entry.tick,
        at: place(percepts && percepts.me),
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
        // a player's ticks are its biography: body.pulse on a body-stream, which is a bare
        // MINTED rappid (§6.1, §7.2). Minted here on first use rather than spelled from a name.
        if (!streamId) streamId = await F.mintRappid('kody-w', 'nexus-player');
        // seq COUNTS THE LIFE, NOT THE ARRAY. Using state.chain.length meant that once the
        // window below dropped the oldest frame, seq stopped advancing and started repeating —
        // the chain read as a life that kept restarting at 500. herd.js was fixed for this; this
        // copy was not. A biography whose numbering resets is a log with extra steps.
        const f = await F.buildFrame({ kind: 'body.pulse', streamId, seq: state.seq = (state.seq || 0),
                                       payload: { asserts, requires }, prev: state.prev });
        state.chain.push(f); state.prev = f.payload_hash;
        state.seq++;
        if (state.chain.length > 500) {
          state.chain.shift();                                 // a long session is still bounded
          state.windowed = true;   // and says so, rather than pretending the start was never there
        }
        return f;
      } catch (e) {
        // SAY SO. herd.js records entry.sealFailed when a seal throws; this copy returned null,
        // which is indistinguishable from a tick that had nothing to seal — so a moment lost to a
        // rejected buildFrame looked exactly like an ordinary quiet one. The journal is the only
        // evidence a player played; a gap in it that announces nothing is the worst kind.
        state.lastSealError = String((e && e.message) || e).slice(0, 200);
        state.sealFailures = (state.sealFailures || 0) + 1;
        return null;
      }
    }

    (async () => {
      while (state.running && (!o.maxTicks || state.ticks < o.maxTicks)) {
        const drive = o.drive || root.__autodrive;
        if (!drive) { state.stopped = 'the hands went away'; state.reason = 'no-hands'; break; }
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
            // THE MIND WAS BEING DROPPED ON THE FLOOR. turn() takes one — a scripted NPC, or
            // anything else satisfying the contract — and live() accepted `mind` and then never
            // passed it on, so every tick of an NPC loop fell through to root.NexusAuth and threw
            // 'no mind: not signed in' on tick 1. The loop then stopped, correctly, for a reason
            // that was entirely its own doing: a scripted player could not live at all.
            drive: o.drive, guid: o.guid, mind: o.mind,
            // and the loop's own aliveness, so stop() reaches INSIDE the thought it interrupted
            until: () => state.running,
          });
          state.acts += (r.calls || []).length;
          if (r.words) state.words++;
          entry = { tick: state.ticks, ms: Date.now() - started, words: r.words,
                    // the dispatch's verdict when it has one — see turn(); the text test is the
                    // fallback, and herd.js's copy of this line was fixed alongside it, because
                    // one defect living in two files and only one of them getting fixed is how
                    // this pair drifted apart before
                    calls: (r.calls || []).map(c => ({ tool: c.tool, name: c.args && (c.args.portal || c.args.to),
                      failed: c.failed != null ? !!c.failed : /failed|no such/.test(c.result) })) };
          entry.frame = await seal(entry, s0);
          if (!entry.frame && state.lastSealError) entry.sealFailed = state.lastSealError;
          state.fails = 0;                          // a tick that worked clears the streak
        } catch (e) {
          entry = { tick: state.ticks, ms: Date.now() - started, error: e.message };
          if (e.code) entry.code = e.code;
          // s0, not null: if the percepts were taken before the mind threw, the position IS
          // known, and herd's error path records it. Passing null threw away a fact we had.
          entry.frame = await seal(entry, s0);
          if (!entry.frame && state.lastSealError) entry.sealFailed = state.lastSealError;
          // A dead credential will not heal by being asked again in six seconds. Stop, and say why.
          if (/sign-in expired|not signed in|no mind/i.test(e.message)) {
            state.stopped = e.message; state.reason = 'no-mind'; state.running = false;
          }
          // NEITHER WILL AN EXHAUSTED CEILING. herd.js already stopped its direct loop on
          // /budget/; this loop did not, so a player that ran out of budget went on ticking
          // every six seconds forever — refused every time, journalling the refusal every time,
          // its button still reading "● Looping" — which is the exact shape of a thing that
          // looks alive and is not. The ceiling is permanent by design; a loop that keeps
          // knocking on it is a clock left running.
          else if (e.code === 'budget') {
            state.stopped = e.message; state.reason = 'budget'; state.running = false;
          }
          // A FAILED TICK IS WEATHER; A HUNDRED IN A ROW IS A CLIMATE. Anything else is treated
          // as transient and retried, because most things are — but a world that has thrown on
          // every tick for a solid streak is not coming back on its own, and a loop that never
          // admits that is another clock nobody stopped.
          else if ((state.fails = (state.fails || 0) + 1) >= 20) {
            state.stopped = '20 ticks in a row failed — last: ' + String(e.message).slice(0, 120);
            state.reason = 'failing'; state.running = false;
          }
        }
        state.journal.push(entry);
        if (state.journal.length > 200) state.journal.shift();
        if (o.onTick) { try { o.onTick(entry, state); } catch (e) {} }
        if (!state.running) break;
        await sleep(o.everyMs);
      }
      state.running = false; state.done = true;
      if (!state.stopped) {
        state.stopped = (o.maxTicks && state.ticks >= o.maxTicks)
          ? ('ran its ' + o.maxTicks + ' ticks') : 'asked to stop';
        state.reason = (o.maxTicks && state.ticks >= o.maxTicks) ? 'maxTicks' : 'asked';
      }
      if (o.onStop) { try { o.onStop(state); } catch (e) {} }
    })();

    return {
      // WHY IT STOPPED IS THE ONLY THING WORTH KNOWING ABOUT A STOPPED LOOP, so an operator
      // pressing the button must not overwrite a reason the loop already has. `stop('operator')`
      // arriving one tick after the budget died used to relabel it as an operator decision.
      stop: (why) => { state.running = false;
                       if (!state.stopped) { state.stopped = why || 'asked to stop'; state.reason = 'asked'; } },
      state: () => state,
      // the line itself, as a file anybody can check against the spec
      chain: () => state.chain.map(f => JSON.stringify(f)).join('\n') + (state.chain.length ? '\n' : ''),
      verify: () => (root.NexusFrames ? root.NexusFrames.verifyChain(state.chain) : Promise.reject(new Error('no frames module'))),
    };
  }

  root.NexusBrainstem = { turn, lines, live, hotload, summon, ensureResident, initPyodide, slots: () => nextSlot,
                          // ONE CEILING PER PAGE, AND EVERYTHING THAT BUYS A THOUGHT GOES THROUGH IT.
                          // herd's ensemble() calls a model directly — one call to direct the whole
                          // cast — and had no way to declare it, so those calls were off the books
                          // entirely: the ceiling that exists to bound a visitor's spend never saw
                          // the one call that scales with how many players are in the room.
                          spend,
                          // RAISING A CEILING THAT HAS ALREADY BITTEN MUST ACTUALLY RAISE IT.
                          // `stopped` is sticky on purpose — a session that ran out stays out, and
                          // no player can talk its way past it — but the operator moving the
                          // ceiling is not a player. Patching limit from 400 to 800 left the old
                          // refusal standing, so the raise did nothing at all while the error went
                          // on naming 400: a control that reports success and changes nothing.
                          // An operator HALT is not lifted this way; only the operator lifts that,
                          // by passing `stopped` explicitly.
                          budget: (patch) => {
                            if (patch) {
                              Object.assign(budget, patch);
                              const named = Object.prototype.hasOwnProperty.call(patch, 'stopped');
                              if (!named && budget.stopped && budget.reason && budget.reason !== 'operator'
                                  && budget.calls < budget.limit
                                  && (Date.now() - budget.since) / 60000 < budget.minutes) {
                                budget.stopped = null; budget.reason = null;
                              }
                              if (named && patch.stopped == null) budget.reason = null;
                            }
                            return Object.assign({}, budget);
                          },
                          halt: (why) => { budget.reason = 'operator';
                                           budget.stopped = why || 'stopped by the operator'; },
                          wasSummoned: (n) => summonedNames.has(n), takesGuid, queued,
                          resident: () => Object.keys(pyAgents),
                          // provenSource() asks this about every name it finds in a line; an
                          // inherited one answered with Object's own constructor
                          sourceOf: (name) => (has(agentSource, name) ? agentSource[name] : null),
                          verbToolDefs, agentToolDefs, callAgent,
                          status: () => ({ python: !!pyodide, agents: Object.keys(pyAgents), note: loadNote }),
                          VERBS, MAX_ROUNDS };
})(typeof window !== 'undefined' ? window : globalThis);

/* scripted_mind.js — a mind that answers from a script instead of from a model.
 *
 * A player needs a mind: something that is handed the percepts and answers with words and moves.
 * Usually that is a model on somebody's Copilot seat. It does not have to be. A mind is a contract,
 * not a service — signedIn() and chat(messages) returning words and tool calls — and anything that
 * satisfies it can drive a body.
 *
 * So this is two things at once, and they are the same thing:
 *
 *   AN NPC. A character who says the same lines and walks the same path every time, because that
 *   is what you wanted them to do. No token, no spend, no network, no model deciding to improvise
 *   in the middle of your scene. Deterministic by construction: same script, same tick, same
 *   frames, forever.
 *
 *   A WAY TO EXERCISE EVERYTHING DOWNSTREAM OF THE MIND. Every verb dispatch, every refusal, the
 *   summon path, the budget, the receipts, and the rapp/1 frames are the real ones — the only
 *   substituted part is the answer. This estate ran for a long time with provenSource() throwing
 *   on every call because nothing ever asked for a tool that did not exist; a scripted mind can
 *   ask for one on purpose.
 *
 * What it is NOT: a model. A run driven by a scripted mind proves the machinery, not the
 * intelligence, and anything that reports on such a run should say which it was.
 *
 *   const npc = NexusMind.scripted([
 *     { say: 'evening.', do: [{ verb: 'look', args: { dx: 0.2 } }] },
 *     { say: 'this way.', do: [{ verb: 'travel', args: { portal: 'Ebike World' } }] },
 *   ]);
 *   await NexusBrainstem.turn({ drive, mind: npc, python: false });
 */
(function (root) {
  'use strict';

  // What the model would have said, in the shape the caller already parses. Nothing here is a
  // special case downstream: think() cannot tell this from a reply that cost a token.
  function reply(content, calls) {
    const msg = { role: 'assistant', content: content == null ? '' : String(content) };
    if (calls && calls.length) {
      msg.tool_calls = calls.map((c, i) => ({
        id: 'scripted_' + i + '_' + String(c.verb || c.tool || 'call'),
        type: 'function',
        function: {
          // world_<verb> is how the hands are named; a bare tool name is an agent
          name: c.tool || ('world_' + String(c.verb)),
          arguments: JSON.stringify(c.args || {}),
        },
      }));
    }
    return msg;
  }

  // A tick can take several rounds: the mind speaks, the hands answer, the mind speaks again.
  // Which round we are in is readable from the conversation itself — the number of turns this
  // mind has already taken in it — so nothing has to be remembered between calls and two players
  // sharing one script cannot get tangled.
  function roundOf(messages) {
    let n = 0;
    for (const m of (messages || [])) if (m && m.role === 'assistant') n++;
    return n;
  }

  // WHAT A CHARACTER IS HANDED IS THE ROOM, NOT THE TRANSCRIPT. The conversation carries the
  // percepts in a user message as 'PERCEPTS: {...}', and the first version of this passed the raw
  // message array to the script — so an author reading `percepts.players` got undefined and every
  // NPC quietly fell through to its dullest branch. My own worked example failed its own test on
  // exactly that, which is the only reason it was caught before anyone copied it.
  function perceptsIn(messages) {
    for (const m of (messages || [])) {
      if (!m || m.role !== 'user' || typeof m.content !== 'string') continue;
      const at = m.content.indexOf('PERCEPTS: ');
      if (at < 0) continue;
      try { return JSON.parse(m.content.slice(at + 10)); } catch (e) { /* keep looking */ }
    }
    return {};
  }

  function beatFor(script, tick, messages) {
    const percepts = perceptsIn(messages);
    // the transcript stays available as a third argument for anyone who wants it
    if (typeof script === 'function') return script(percepts, tick, messages) || {};
    const list = Array.isArray(script) ? script : [script];
    if (!list.length) return {};
    // A script shorter than the session repeats rather than falling silent, because an NPC that
    // stops existing halfway through a scene is worse than one that loops.
    return list[tick % list.length] || {};
  }

  function scripted(script, opts) {
    const o = opts || {};
    let ticks = 0;

    return {
      // the contract a mind has to satisfy, and the whole of it
      signedIn: () => true,
      hasToken: () => true,
      // said out loud so nothing downstream can mistake this for a bought thought
      isScripted: true,
      describe: () => o.name ? ('scripted mind: ' + o.name) : 'scripted mind',

      async chat(messages, chatOpts) {
        const raw = !!(chatOpts && chatOpts.raw);
        const round = roundOf(messages);

        if (round > 0) {
          // The hands have answered. A second round of tool calls would loop until the round cap,
          // so the beat is over: say the closing line, or nothing, and let the tick end.
          const beat = beatFor(script, ticks - 1, messages);
          const done = beat && beat.then != null ? String(beat.then) : '';
          return raw ? reply(done, null) : done;
        }

        const beat = beatFor(script, ticks, messages) || {};
        ticks++;
        const calls = [];
        for (const c of (beat.do || [])) calls.push(c);
        const msg = reply(beat.say, calls);
        if (!raw) return msg.content;
        return msg;
      },

      // present so a caller that checks the credential path finds an honest answer rather than
      // a missing function: there is no credential here, and saying so is the truth
      signOut() { ticks = 0; },
      verify: async () => true,
      ticksTaken: () => ticks,
    };
  }

  root.NexusMind = { scripted, reply };
})(typeof window !== 'undefined' ? window : globalThis);

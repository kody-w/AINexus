/* doorman.js — a worked NPC, written rather than bought.
 *
 * A mind is a contract: signedIn(), and chat(percepts) answering with words and moves. A model
 * satisfies it. So does a script. This is the second kind — a character who behaves the same way
 * every run, costs nothing, asks nobody, and keeps working when the network does not.
 *
 * Copy this file to make your own. The only rule is that a beat answers the room it was given:
 * a choreography does the same thing in an empty room, and a character does not. That difference
 * is the whole reason to write one of these instead of a list of verbs.
 *
 *   <script src="ai/scripted_mind.js"></script>
 *   <script src="ai/npcs/doorman.js"></script>
 *   NexusHerd.join({ id: 'doorman', drive, mind: NexusNPC.doorman() });
 *
 * A beat is { say, do: [{ verb, args }], then }. `say` is the opening line, `do` are the moves,
 * and `then` is what it says once the hands have answered. Every verb the hands actually have is
 * available; a verb they do not have is refused and reported, never silently swallowed.
 */
(function (root) {
  'use strict';

  const M = root.NexusMind;
  if (!M) return;   // scripted_mind.js has to load first; saying nothing is better than half-loading

  // WHAT IT CAN SEE. A character is handed the room: portals, players, chat. Keep this cheap and
  // defensive — it runs every tick, and what it is reading came from somewhere else.
  function room(p) {
    p = p || {};
    const portals = Array.isArray(p.portals) ? p.portals : [];
    const players = Array.isArray(p.players) ? p.players : [];
    const chat = Array.isArray(p.chat) ? p.chat : [];
    return {
      doors: portals.map(d => (d && (d.name || d)) || '').filter(Boolean),
      someoneHere: players.length > 0,
      spokenTo: chat.length > 0,
    };
  }

  // The doorman: stands at the entrance, greets what arrives, names a door when there is one, and
  // has the sense to say nothing interesting when nothing is happening.
  function doorman(opts) {
    const o = opts || {};
    const greeting = o.greeting || 'evening.';
    return M.scripted((percepts, tick) => {
      const r = room(percepts);

      if (r.someoneHere && tick === 0) {
        return { say: greeting, do: [{ verb: 'look', args: { dx: 90 } }], then: 'welcome in.' };
      }
      if (r.spokenTo) {
        return { say: 'I heard that.', then: 'go on.' };
      }
      if (r.doors.length) {
        const door = r.doors[tick % r.doors.length];
        return { say: door + ' is open tonight.',
                 do: [{ verb: 'look', args: { dx: 60 } }],
                 then: 'that way, if you like.' };
      }
      // An empty room is a real answer, and pretending otherwise is what makes an NPC feel canned.
      return { say: 'quiet out here.', then: 'still quiet.' };
    }, { name: o.name || 'the doorman' });
  }

  root.NexusNPC = Object.assign({}, root.NexusNPC, { doorman });
})(typeof window !== 'undefined' ? window : globalThis);

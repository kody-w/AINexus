/* dialogue.js — the things you could say, built from what is actually true right now.
 *
 * A fixed list of openers is a menu; a conversation is a menu that KNOWS something. This
 * builds the ring of options from the room itself: whether they just spoke, whether what they
 * said was a question, whether you are both standing next to a portal, whether they are a
 * person or an AI, and whether either of you has said anything yet.
 *
 * It is a PURE FUNCTION — no network, no model, no clock. That matters for three reasons:
 * it is testable without a room; it works with the power out; and a human and an AI player
 * generate the identical option list from the identical state, which is the whole point of
 * the orb mechanic — one surface, four directions (person↔person, person↔AI, AI↔AI).
 *
 * A brainstem can do better than this when one is available (ai/senses/dialogue_sense.py lets
 * a mind propose its own lines). This is the floor, and the floor is always there.
 */
(function (root) {
  'use strict';

  const MAX = 5;
  const tidy = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const short = (s, n) => { const w = tidy(s).split(' '); return w.length <= n ? tidy(s) : w.slice(0, n).join(' ') + '…'; };

  // chat entries carry a TRUNCATED peer id (multiplayer.js keeps from = peerId.slice(0,6)),
  // so a person is matched by that prefix rather than by their full id
  const key = id => String(id == null ? '' : id).slice(0, 6);

  // and an unidentified person matches NOBODY: key(undefined) is the empty string, which used to
  // equal the `from` of any chat line that carried no author, so a nameless orb read someone
  // else's line as its own and answered it
  function lastLineFrom(chat, id) {
    const k = key(id); if (!k) return null;
    for (let i = chat.length - 1; i >= 0; i--) {
      const c = chat[i];
      if (!c || !c.text) continue;
      return String(c.from) === k ? tidy(c.text) : null;         // only if THEY spoke last
    }
    return null;
  }
  const everSpoke = (chat, id) => !!key(id) && chat.some(c => c && c.text && String(c.from) === key(id));
  const isQuestion = t => /\?\s*$/.test(t) || /^(are|is|do|does|did|can|could|will|would|should|who|what|where|when|why|how)\b/i.test(t);

  function options(ctx) {
    const o = ctx || {};
    const who = o.who || {};
    const chat = Array.isArray(o.chat) ? o.chat : [];
    // a portal you cannot name is not something you can both see: "want to go through  together?"
    // offers nothing, and it used to win the slot from a real one
    const portals = (Array.isArray(o.portals) ? o.portals : []).filter(p => p && tidy(p.name));
    const theirs = lastLineFrom(chat, who.id);
    const known = everSpoke(chat, who.id);

    const out = [];
    const add = (s, text) => {
      if (out.length >= MAX - 1) return;                 // the last slot always belongs to "leave"
      const t = tidy(text);
      if (t && !out.some(x => x.text === t)) out.push({ short: s, text: t });
    };

    if (theirs) {
      // THEY JUST SPOKE, so the first thing you could say is an answer to it. A question gets
      // an answer; a statement gets acknowledgement or a pull for more.
      if (isQuestion(theirs)) { add('yes', 'yes'); add('no', 'no'); }
      else add('agree', 'that makes sense');
      add('more', 'say more about that');
    } else if (!known) {
      add('greet', who.isAI ? 'hey — are you running on your own?' : 'hey — good to see someone else here');
    } else {
      add('back', 'still there?');
    }

    // something you can both see: the nearest way out of here. A portal that did not say how far
    // away it is sorted as though it were at your feet — `a.distance || 0` — so an unmeasured
    // portal beat the one two metres away and the option named the wrong door. Not knowing is the
    // furthest thing from being nearest.
    const far = (p) => (typeof p.distance === 'number' && isFinite(p.distance)) ? p.distance : Infinity;
    const near = portals.slice().sort((a, b) => far(a) - far(b))[0];
    if (near) add('go', `want to go through ${short(near.name, 4)} together?`);

    // who am I talking to? Worth asking a human; worth asking an AI something better.
    if (who.isAI) add('what', 'what are you here to do?');
    else add('who', 'are you a person or an AI?');

    add('here', 'what are you doing over here?');

    out.push({ short: 'leave', text: 'catch you later' });
    return out;
  }

  root.NexusDialogue = { options, isQuestion, lastLineFrom, MAX };
})(typeof window !== 'undefined' ? window : globalThis);

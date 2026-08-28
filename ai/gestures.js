/* gestures.js — hands into verbs.
 *
 * The mapping from a hand to an action is a PURE FUNCTION of landmarks, so it can be tested
 * without a camera and reasoned about without a webcam pointed at your face. The VUI
 * (kody-w/rapp-vui) supplies the same vocabulary: a fingertip is a cursor, a pinch is a
 * click, speech is a sentence. Here those become the driver's verbs.
 *
 * Landmarks: MediaPipe hand_landmarker, 21 points, normalised 0..1, mirrored for a selfie view.
 *   4 = thumb tip · 8 = index tip · 12 = middle tip · 0 = wrist · 5 = index MCP
 */
(function (root) {
  'use strict';

  const PINCH_ON = 0.055, PINCH_OFF = 0.075;      // hysteresis: a pinch should not flicker
  const DEAD = 0.08;                               // centre dead-zone, so a still hand does not drift
  const LOOK_GAIN = 260;

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  // read a hand into a stable, named posture
  function posture(lm, prev) {
    if (!lm || lm.length < 21) return { kind: 'none' };
    const pinch = dist(lm[4], lm[8]);
    const wasPinched = prev && prev.pinched;
    const pinched = wasPinched ? pinch < PINCH_OFF : pinch < PINCH_ON;
    // Point vs palm is about EXTENSION, not spread: pointing extends the index and curls the
    // middle, so index reaches much further from the wrist than middle. An open palm extends
    // both, and adjacent fingertips sit close together. (Getting this backwards makes every
    // pointing hand read as a palm and walk you into a wall.)
    const idxReach = dist(lm[0], lm[8]), midReach = dist(lm[0], lm[12]);
    const extensionRatio = midReach > 0 ? idxReach / midReach : 1;
    const openPalm = extensionRatio < 1.15 && midReach > 0.28;
    return {
      kind: pinched ? 'pinch' : openPalm ? 'palm' : 'point',
      pinched,
      x: lm[8].x, y: lm[8].y,
      reach: dist(lm[0], lm[8]),                   // hand pushed toward the camera reads as "forward"
    };
  }

  // posture + where it is on screen -> one driver verb (or nothing)
  function toAction(p, prev) {
    if (!p || p.kind === 'none') return null;
    const dx = p.x - 0.5, dy = p.y - 0.5;

    // a pinch that just closed is a click — the same gesture the VUI uses to press a key
    if (p.pinched && !(prev && prev.pinched)) return { do: 'click' };

    // an open palm held forward walks; the further from centre, the more you turn as you go
    if (p.kind === 'palm') {
      if (Math.abs(dx) > DEAD) return { do: 'look', dx: Math.round(-dx * LOOK_GAIN), dy: 0 };
      return { do: 'walk', dir: 'forward', ms: 260 };
    }

    // pointing steers: only outside the dead-zone, so a resting hand does nothing
    if (Math.abs(dx) > DEAD || Math.abs(dy) > DEAD) {
      return { do: 'look', dx: Math.round(-dx * LOOK_GAIN), dy: Math.round(dy * LOOK_GAIN * 0.4) };
    }
    return null;
  }

  // speech -> a verb. "go to crystal" travels; anything else is said aloud to the room.
  function speechToAction(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    const travel = t.match(/^(?:go(?: to)?|enter|walk into|take me to)\s+(.{2,40})$/i);
    if (travel) return { do: 'travel', portal: travel[1].replace(/[.!?]$/, '').trim() };
    if (/^(stop|halt|freeze)\b/i.test(t)) return { do: 'wait', ms: 1200 };
    if (/^(look|turn)\s+left/i.test(t)) return { do: 'look', dx: 220 };
    if (/^(look|turn)\s+right/i.test(t)) return { do: 'look', dx: -220 };
    if (/^(ask|hey world|world)[,: ]+(.+)$/i.test(t)) return { do: 'ask', text: t.replace(/^(ask|hey world|world)[,: ]+/i, '') };
    return { do: 'say', text: t };
  }

  root.NexusGestures = { posture, toAction, speechToAction, PINCH_ON, PINCH_OFF, DEAD };
})(typeof window !== 'undefined' ? window : globalThis);

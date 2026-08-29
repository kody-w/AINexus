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

  // A LANDMARK THAT IS NOT A NUMBER IS NOT A HAND. The detector can hand back a point whose
  // coordinates are NaN, and every comparison against NaN is false — so a pinch stopped being a
  // pinch, the posture came back as a confident 'point' with x and y of NaN, and the caller
  // multiplied that into a screen position for a cursor that then sat wherever it last was, still
  // lit, still reporting a hand. There is no hand. Say so, which is a thing the caller can act on.
  const fin = (v) => typeof v === 'number' && isFinite(v);
  const pt = (p) => !!(p && fin(p.x) && fin(p.y));

  // read a hand into a stable, named posture
  function posture(lm, prev) {
    if (!lm || lm.length < 21) return { kind: 'none' };
    if (!pt(lm[0]) || !pt(lm[4]) || !pt(lm[8]) || !pt(lm[12])) return { kind: 'none' };
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
  //
  // `px`/`py` are the caller's own mapping of the fingertip onto its viewport (frontier.html
  // mirrors x for the selfie view and multiplies by innerWidth/innerHeight); this module only
  // owns the normalised 0..1 point the detector gave it.
  function toAction(p, prev) {
    if (!p || p.kind === 'none') return null;
    if (!fin(p.x) || !fin(p.y)) return null;
    const dx = p.x - 0.5, dy = p.y - 0.5;

    // THE HAND IS A CURSOR. The fingertip designates a point on screen and the pinch presses
    // whatever is under it — a button, an input, a portal. This is a mouse made of a hand,
    // not a gamepad, so pointing does NOT steer: the pointer goes where the finger goes.
    //
    // A PICK ALWAYS CARRIES A POINT. Fed the posture this file itself produces, this used to hand
    // back {do:'pick', x: undefined, y: undefined} — a press with nowhere to press, saved only by
    // the one caller that happened to ignore the coordinates and use its own. The screen point is
    // reported when the caller supplied one, and the normalised fingertip always is, so anybody
    // driving through this vocabulary knows where the press landed.
    if (p.pinched && !(prev && prev.pinched)) {
      return { do: 'pick', x: fin(p.px) ? p.px : null, y: fin(p.py) ? p.py : null,
               nx: p.x, ny: p.y };
    }

    // An open palm is the one posture that moves the body: push forward to walk, and lean
    // the palm off-centre to turn as you go. Nothing else drives the camera.
    if (p.kind === 'palm') {
      if (Math.abs(dx) > DEAD) return { do: 'look', dx: Math.round(-dx * LOOK_GAIN), dy: 0 };
      return { do: 'walk', dir: 'forward', ms: 260 };
    }
    return null;                                  // a pointing hand only moves the cursor
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

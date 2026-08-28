/* face.js — a face into attention: where you are looking, and one deliberate muscle to click with.
 *
 * Same contract as gestures.js: the mapping from landmarks to intent is a PURE FUNCTION, so it
 * is testable without a camera pointed at anybody. Nothing here touches the DOM, the network,
 * or a video element — it takes a MediaPipe FaceLandmarker result and returns numbers.
 *
 * Why gaze at all: in a world full of orbs, looking at something is already how a person
 * says "that one". Gating the conversation ring on gaze means the ring appears because you
 * turned your attention to a person, not because your cursor drifted across them.
 *
 * THE EYE POINTS, THE BROW CLICKS. A blink is involuntary and a stare is ambiguous, but
 * raising your brows is a thing you only do on purpose — so it is the button. Forehead and
 * brow give a second, hands-free press that never fights the pinch.
 *
 * Landmarks: face_landmarker.task, 478 points, image space (NOT mirrored), normalised 0..1.
 *   iris centres 468 (one eye) / 473 (the other) — present because this model outputs 478.
 * Corner/lid indices are used only in PAIRS and ordered by coordinate, never by which eye
 * MediaPipe calls "left" — that naming flips between references and is not worth trusting.
 */
(function (root) {
  'use strict';

  const EYES = [
    { corners: [33, 133], lids: [159, 145], iris: 468 },
    { corners: [263, 362], lids: [386, 374], iris: 473 },
  ];
  const NOSE = 1, CHIN = 152, BROW_HI = [105, 334];

  // gains turn a small eye movement into a screen-sized one; head pose carries the coarse aim
  // The eye's vertical range inside its socket is far smaller than its horizontal range, so the
  // same gain on both axes saturates the screen the moment you glance down.
  const EYE_GAIN_X = 2.6, EYE_GAIN_Y = 1.3, HEAD_GAIN_X = 3.2, HEAD_GAIN_Y = 2.0;
  const SMOOTH = 0.35;                       // EMA on the final point: steady dot, still responsive
  // Two ways to read a brow, in two different units — and mixing them up means the button
  // silently never fires. Blendshapes are a 0..1 activation; the landmark fallback measures how
  // far the brow lifted from the eye in EYE-WIDTHS (a real raise is roughly 0.10-0.20 of one).
  const BROW_ON = 0.42, BROW_OFF = 0.22;             // blendshape units
  const BROW_ON_LM = 0.085, BROW_OFF_LM = 0.045;     // eye-width units
  const BROW_REFRACTORY_MS = 700;
  const BLINK_CLOSED = 0.17;                 // eye aspect ratio below this reads as shut
  const SETTLE_FRAMES = 20;                  // don't trust the first glimpse of a face
  const PINNED_MS = 1800;                    // a pointer stuck on an edge this long is wrong
  const NEUTRAL_ADAPT = 0.004;               // the baseline drifts slowly toward where you sit
  const NEUTRAL_DEADZONE = 0.06;             // ...and ONLY while you are looking straight ahead
  const BROW_FLOOR_RECOVER = 0.0015;         // the brow's resting level can rise again, slowly

  function cat(shapes, name) {
    if (!shapes) return 0;
    for (let i = 0; i < shapes.length; i++) if (shapes[i].categoryName === name) return shapes[i].score;
    return 0;
  }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  // where the iris sits between its own eye's corners, 0..1, with no assumption about which
  // eye this is or which way the image runs
  function between(p, a, b) {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    return hi - lo < 1e-6 ? 0.5 : clamp01((p - lo) / (hi - lo));
  }

  function readFace(res, prev, opts) {
    const o = opts || {};
    const lm = res && res.faceLandmarks && res.faceLandmarks[0];
    if (!lm || lm.length < 478) return { ok: false, kind: 'none' };
    const shapes = res.faceBlendshapes && res.faceBlendshapes[0] && res.faceBlendshapes[0].categories;

    // ── where the eyes point, relative to their own sockets ──────────────
    let tx = 0, ty = 0, open = 0, n = 0;
    for (const e of EYES) {
      const c0 = lm[e.corners[0]], c1 = lm[e.corners[1]], ir = lm[e.iris];
      const u = lm[e.lids[0]], d = lm[e.lids[1]];
      if (!c0 || !c1 || !ir || !u || !d) continue;
      tx += between(ir.x, c0.x, c1.x);
      ty += between(ir.y, u.y, d.y);
      const w = Math.hypot(c0.x - c1.x, c0.y - c1.y);
      open += w > 1e-6 ? Math.hypot(u.x - d.x, u.y - d.y) / w : 0;
      n++;
    }
    if (!n) return { ok: false, kind: 'none' };
    tx /= n; ty /= n; open /= n;
    const eyesClosed = open < BLINK_CLOSED;

    // ── which way the head is turned ─────────────────────────────────────
    // The nose leads the rotation: it slides toward whichever way the face turns, measured
    // against the eye corners and scaled by face width so distance from the camera cancels.
    const cs = EYES.flatMap(e => [lm[e.corners[0]], lm[e.corners[1]]]).filter(Boolean);
    const xs = cs.map(p => p.x), ys = cs.map(p => p.y);
    const faceW = Math.max(...xs) - Math.min(...xs);
    const eyeMidX = xs.reduce((a, b) => a + b, 0) / xs.length;
    const eyeMidY = ys.reduce((a, b) => a + b, 0) / ys.length;
    const nose = lm[NOSE], chin = lm[CHIN];
    const faceH = chin && nose ? Math.abs(chin.y - eyeMidY) : faceW;
    const yaw = faceW > 1e-6 && nose ? (nose.x - eyeMidX) / faceW : 0;
    const pitch = faceH > 1e-6 && nose ? (nose.y - eyeMidY) / faceH : 0;

    // ── the brow: the one muscle we treat as a button ────────────────────
    // Blendshapes say it best when they are on; otherwise measure the brow lifting away from
    // the eye, in units of eye width, against your own resting face.
    let brow, browFromShapes = false;
    if (shapes && shapes.length) {
      browFromShapes = true;
      brow = Math.max(cat(shapes, 'browInnerUp'),
                     (cat(shapes, 'browOuterUpLeft') + cat(shapes, 'browOuterUpRight')) / 2);
    } else {
      let lift = 0, m = 0;
      BROW_HI.forEach((bi, i) => {
        const b = lm[bi], e = EYES[i] && lm[EYES[i].lids[0]];
        const c0 = EYES[i] && lm[EYES[i].corners[0]], c1 = EYES[i] && lm[EYES[i].corners[1]];
        if (!b || !e || !c0 || !c1) return;
        const w = Math.hypot(c0.x - c1.x, c0.y - c1.y);
        if (w > 1e-6) { lift += Math.abs(b.y - e.y) / w; m++; }
      });
      brow = m ? lift / m : 0;
    }

    // ── neutral: wherever your face rests is the centre of the screen ────
    // Nobody sits square to a webcam. Instead of asking for a calibration ritual, the resting
    // pose IS the origin, and it creeps toward you as you settle. Recentring is one flag.
    // SETTLING. The neutral pose used to be whatever the very first frame happened to hold —
    // and the first frame is the least trustworthy one there is: a face half in shot, a bad
    // exposure, a stray detection in the background. Lock the origin only after the face has
    // been present for a moment.
    const frames = ((prev && prev.frames) || 0) + 1;
    const settling = frames < SETTLE_FRAMES;
    const base = (prev && prev.base && !o.recenter && !settling)
      ? prev.base
      : { tx, ty, yaw, pitch, brow };
    const adapt = (a, b) => a + (b - a) * NEUTRAL_ADAPT;
    // A DELIBERATE LOOK MUST NOT BECOME "CENTRE". If the baseline chased your gaze, holding
    // your eyes on a person would quietly recentre and drop them — so the neutral only learns
    // while you are looking roughly straight ahead. That is drift correction; chasing a held
    // stare is amnesia.
    const off = Math.hypot(tx - base.tx, ty - base.ty) + Math.hypot(yaw - base.yaw, pitch - base.pitch);
    const calm = off < NEUTRAL_DEADZONE;
    // Recentring means "where I am looking now is the middle" — it says nothing about my
    // eyebrows. Folding the brow floor into it means pressing 'c' while your brows happen to be
    // up poisons the floor with a raised value, and that press (and the rest of that raise) is
    // silently swallowed with no feedback until you relax all the way down and start again.
    const browFloor = (prev && prev.base)
      ? (brow < prev.base.brow ? brow : prev.base.brow + BROW_FLOOR_RECOVER)
      : brow;
    const nextBase = (o.recenter || !prev || !prev.base) ? { tx, ty, yaw, pitch, brow: browFloor } : {
      tx: calm ? adapt(base.tx, tx) : base.tx, ty: calm ? adapt(base.ty, ty) : base.ty,
      yaw: calm ? adapt(base.yaw, yaw) : base.yaw, pitch: calm ? adapt(base.pitch, pitch) : base.pitch,
      // the brow's resting level tracks the floor down at once but recovers slowly, so one bad
      // frame cannot permanently convince us your eyebrows live higher than they do
      brow: brow < base.brow ? brow : base.brow + BROW_FLOOR_RECOVER,
    };

    const now0 = (o.now === undefined ? (typeof performance !== 'undefined' ? performance.now() : Date.now()) : o.now);

    // ── the point on screen, in IMAGE space (caller mirrors, exactly like hands) ──
    const rawX = 0.5 + (tx - base.tx) * EYE_GAIN_X + (yaw - base.yaw) * HEAD_GAIN_X;
    const rawY = 0.5 + (ty - base.ty) * EYE_GAIN_Y + (pitch - base.pitch) * HEAD_GAIN_Y;
    // A POINTER PINNED TO AN EDGE IS BROKEN, NOT AIMED. If the origin was learned from a bad
    // pose, every reading saturates and the deadzone below guarantees it can never drift back —
    // the gaze would be stuck against a wall until the person happens to know about the 'c'
    // key. So being pinned for a moment IS the signal to re-learn the origin.
    const saturated = rawX <= 0.001 || rawX >= 0.999 || rawY <= 0.001 || rawY >= 0.999;
    const pinnedSince = saturated ? ((prev && prev.pinnedSince) || now0) : 0;
    const unstick = saturated && pinnedSince && (now0 - pinnedSince) > PINNED_MS;
    const px = clamp01(unstick ? 0.5 : rawX), py = clamp01(unstick ? 0.5 : rawY);
    const sm = prev && prev.ok && !eyesClosed
      ? { x: prev.x + (px - prev.x) * SMOOTH, y: prev.y + (py - prev.y) * SMOOTH }
      : { x: px, y: py };

    // brow press, edge-triggered and refractory so one raise is one click
    const browN = Math.max(0, brow - nextBase.brow);
    const wasRaised = !!(prev && prev.browRaised);
    const onT = browFromShapes ? BROW_ON : BROW_ON_LM, offT = browFromShapes ? BROW_OFF : BROW_OFF_LM;
    const browRaised = wasRaised ? browN > offT : browN > onT;
    const now = now0;
    const lastPress = (prev && prev.lastPress) || -1e9;
    const pressed = browRaised && !wasRaised && (now - lastPress) > BROW_REFRACTORY_MS;

    return {
      ok: true, kind: 'face',
      x: eyesClosed && prev && prev.ok ? prev.x : sm.x,   // a blink must not fling the gaze
      y: eyesClosed && prev && prev.ok ? prev.y : sm.y,
      tx, ty, yaw, pitch, open, eyesClosed,
      brow: browN, browRaised, pressed, browSource: browFromShapes ? 'blendshape' : 'landmark',
      lastPress: pressed ? now : lastPress,
      base: (unstick || settling) ? { tx, ty, yaw, pitch, brow: browFloor } : nextBase,
      frames, settling, recentred: !!unstick, pinnedSince: unstick ? 0 : pinnedSince,
      conf: eyesClosed ? 0.2 : Math.min(1, open / 0.28),
    };
  }

  // readFace returns a point in IMAGE space (0..1), because it has never been told how big
  // your window is or whether the picture is mirrored — the caller owns that. So both helpers
  // below take the SCREEN point explicitly rather than reading fields readFace does not set.
  // (They used to read g.px/g.py, which exists only if a caller happened to attach it.)
  function screenPoint(g, at) {
    if (at && isFinite(at.x) && isFinite(at.y)) return at;
    if (g && isFinite(g.px) && isFinite(g.py)) return { x: g.px, y: g.py };   // a caller attached it
    return null;
  }

  // gaze + brow -> a driver verb. The eye never moves the body; it only says "that one".
  function faceToAction(g, at) {
    if (!g || !g.ok || !g.pressed) return null;
    const pt = screenPoint(g, at);
    return pt ? { do: 'pick', x: pt.x, y: pt.y } : null;
  }

  // is the gaze resting on this screen target? Used to GATE what is even offered: a person's
  // conversation ring exists because you looked at them.
  function looksAt(g, target, radius, at) {
    if (!g || !g.ok || g.eyesClosed || !target) return false;
    const pt = screenPoint(g, at);
    if (!pt) return false;
    const r = radius === undefined ? 160 : radius;
    return Math.hypot(pt.x - target.x, pt.y - target.y) <= Math.max(r, (target.radius || 0) + 90);
  }

  root.NexusFace = { readFace, faceToAction, looksAt, EYE_GAIN_X, EYE_GAIN_Y,
    HEAD_GAIN_X, HEAD_GAIN_Y, BROW_ON, BROW_OFF, BROW_ON_LM, BROW_OFF_LM,
    BROW_REFRACTORY_MS, BLINK_CLOSED };
})(typeof window !== 'undefined' ? window : globalThis);

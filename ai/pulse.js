/* pulse.js — a heartbeat out of ordinary light.
 *
 * Every time your heart beats it pushes blood into the skin of your face and the skin gets
 * very slightly redder. A webcam can see that. This is remote photoplethysmography (rPPG):
 * average the colour of your forehead over time, and hidden in that wobble is your pulse.
 *
 * The signal is TINY — far below what an eye can notice and well under the noise from you
 * breathing, shifting, or a cloud passing the window. So this does what the literature does:
 *   1. normalise each colour channel by its own mean (cancels overall brightness changes)
 *   2. CHROM (de Haan & Jeanne 2013): combine channels so that MOTION, which moves all three
 *      together, cancels, while BLOOD, which does not, survives
 *   3. resample to an even clock — a browser's frame timer is not a metronome
 *   4. detrend, window, FFT, and take the strongest beat between 42 and 240 bpm
 *   5. refuse to answer unless that peak actually stands out of the band (SNR and share)
 *   6. refuse again if the loudest thing in the recording is slower than any heart — a lean or
 *      an exposure ramp leaks a skirt into the band that looks, to 1-5, exactly like a pulse
 *
 * Steps 5 and 6 are the important ones. A number is easy; an honest number is the product. When
 * the light is bad, or you are moving, or the only rhythm in shot is you breathing, this reports
 * ok:false rather than a plausible-looking lie.
 *
 * NOTHING HERE LEAVES THE MACHINE. This module takes numbers and returns numbers; it holds no
 * pixels, no video, no network. A pulse is a body measurement, so the page treats it as
 * private by default and never puts it on the wire unless a person turns that on.
 *
 * The DSP is pure and exported, so it is tested against a synthetic heartbeat rather than
 * against somebody's chest.
 */
(function (root) {
  'use strict';

  const LO_HZ = 0.7, HI_HZ = 4.0;            // 42–240 bpm: the range a human heart lives in
  const FS = 30;                             // the even clock we resample onto
  const MIN_SECONDS = 6, WINDOW_SECONDS = 12;
  // A peak taller than the average is NOT evidence: over hundreds of bins, pure noise throws
  // up a peak 3-6x the mean every single time. What separates a heartbeat from noise is that a
  // heartbeat puts nearly ALL of its band energy into one frequency and its harmonic, while
  // noise smears across the band. Measured over synthetic signals: a real pulse scores
  // share 0.59-1.00 and snr 13-25; pure noise scores share 0.16-0.40 and snr 3.5-6.3.
  // Both gates must pass, so neither statistic alone can be fooled.
  const MIN_SNR = 8, MIN_SHARE = 0.50;
  // ...and how much slower-than-a-heart energy may sit under a reading before the peak inside
  // the band is just that slower thing's skirt. Honest worst case measured 0.74; the lies
  // measured 6e3 upward, so 4 is generous in both directions.
  const MAX_SLOW = 4;
  const RECENT_MS = 15000;                   // how far back the reported median is allowed to reach

  // ── FFT (iterative radix-2) ───────────────────────────────────────────
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const ur = re[i + k], ui = im[i + k];
          const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
          const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
          const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }

  const mean = a => a.reduce((s, v) => s + v, 0) / (a.length || 1);
  function std(a) { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) * (v - m)))) || 1e-9; }

  // linear resample of irregularly-timed samples onto a fixed rate
  function resample(ts, vs, fs) {
    if (ts.length < 4) return [];
    const t0 = ts[0], t1 = ts[ts.length - 1], n = Math.floor((t1 - t0) / 1000 * fs);
    if (n < 8) return [];
    const out = new Array(n); let j = 0;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * 1000 / fs;
      while (j < ts.length - 2 && ts[j + 1] < t) j++;
      const span = ts[j + 1] - ts[j];
      const f = span > 1e-9 ? (t - ts[j]) / span : 0;
      out[i] = vs[j] + (vs[j + 1] - vs[j]) * Math.max(0, Math.min(1, f));
    }
    return out;
  }

  function detrend(x) {                       // remove the slow drift a face makes by existing
    const n = x.length; if (!n) return x;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sx += i; sy += x[i]; sxy += i * x[i]; sxx += i * i; }
    const d = n * sxx - sx * sx;
    const b = d ? (n * sxy - sx * sy) / d : 0, a = (sy - b * sx) / n;
    return x.map((v, i) => v - (a + b * i));
  }

  // CHROM: the combination that keeps blood and drops motion
  function chrom(r, g, b) {
    const mr = mean(r) || 1e-9, mg = mean(g) || 1e-9, mb = mean(b) || 1e-9;
    const Rn = r.map(v => v / mr), Gn = g.map(v => v / mg), Bn = b.map(v => v / mb);
    const X = Rn.map((v, i) => 3 * v - 2 * Gn[i]);
    const Y = Rn.map((v, i) => 1.5 * v + Gn[i] - 1.5 * Bn[i]);
    const alpha = std(X) / std(Y);
    return X.map((v, i) => v - alpha * Y[i]);
  }

  // signal -> {bpm, snr}. Pure: give it an evenly-sampled series and a rate.
  function spectrum(sig, fs) {
    const x = detrend(sig), n = x.length;
    if (n < 32) return null;
    let N = 1; while (N < n * 4) N <<= 1;      // zero-pad for finer frequency resolution
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < n; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));  // Hann
    fft(re, im);
    const bin = fs / N;
    const lo = Math.max(1, Math.ceil(LO_HZ / bin)), hi = Math.min(N / 2 - 1, Math.floor(HI_HZ / bin));
    if (hi <= lo) return null;
    let peak = lo, total = 0;
    const p = i => re[i] * re[i] + im[i] * im[i];
    for (let i = lo; i <= hi; i++) { const v = p(i); total += v; if (v > p(peak)) peak = i; }
    // parabolic interpolation: the true peak sits between bins
    const y0 = p(peak - 1), y1 = p(peak), y2 = p(peak + 1);
    const denom = (y0 - 2 * y1 + y2);
    const shift = denom ? 0.5 * (y0 - y2) / denom : 0;
    const hz = (peak + Math.max(-0.5, Math.min(0.5, shift))) * bin;
    // how much the peak (and its first harmonic) stands out of everything else in the band
    const near = 0.15 / bin;
    let sig2 = 0;
    for (let i = lo; i <= hi; i++) {
      const d1 = Math.abs(i - peak), d2 = Math.abs(i - peak * 2);
      if (d1 <= near || d2 <= near) sig2 += p(i);
    }
    const bandAvg = total / (hi - lo + 1);
    // A THIRD GATE, BECAUSE THE FIRST TWO ONLY LOOK INSIDE THE BAND. Both statistics above ask
    // how CONCENTRATED the band's energy is — and energy arriving from BELOW the band (a slow
    // lean, breathing, a camera settling its exposure) is maximally concentrated at the band's
    // very first bin, so it scores like a textbook pulse. Measured: a plain exponential exposure
    // ramp with no periodicity in it at all scored snr 40 / share 0.68, and a 0.5 Hz sway scored
    // snr 104 / share 0.97 — both reported, confidently, as 42 bpm. 42 is not a coincidence: it
    // is LO_HZ, the bottom of the band, and it is what this says every time it is lying.
    // So ask the question those statistics cannot: is the loudest thing in this recording even
    // inside the human range? Sub-band energy against the whole band separates the two cases by
    // four orders of magnitude — every lie above scored 6e3 to 2e6, while the hardest honest
    // case there is (a 42 bpm heart, half of whose main lobe falls below the band) scored 0.74.
    let slow = 0;
    for (let i = 1; i < lo; i++) slow += p(i);
    return { bpm: hz * 60, hz, slow: total > 0 ? slow / total : Infinity,
             snr: bandAvg > 0 ? p(peak) / bandAvg : 0, share: total > 0 ? sig2 / total : 0 };
  }

  function median(a) {
    const s = a.slice().sort((x, y) => x - y), n = s.length;
    if (!n) return 0;
    return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;   // an even count has two middles
  }

  function create(opts) {
    const o = Object.assign({ fs: FS, window: WINDOW_SECONDS, minSnr: MIN_SNR, minShare: MIN_SHARE }, opts || {});
    const ts = [], R = [], G = [], B = [];
    let recent = [], last = { ok: false, bpm: 0, snr: 0, seconds: 0 };
    return {
      // one ROI colour average per video frame
      push(rgb, t) {
        // all three channels, not just green: CHROM divides by each channel's own mean, so one
        // undefined red is enough to make the whole window NaN — and a NaN window looks exactly
        // like a dark room, so twelve good seconds are thrown away with a lighting excuse
        if (!rgb || !isFinite(rgb.r) || !isFinite(rgb.g) || !isFinite(rgb.b) || !isFinite(t)) return;
        ts.push(t); R.push(rgb.r); G.push(rgb.g); B.push(rgb.b);
        const cut = t - o.window * 1000;
        while (ts.length && ts[0] < cut) { ts.shift(); R.shift(); G.shift(); B.shift(); }
      },
      read() {
        const seconds = ts.length > 1 ? (ts[ts.length - 1] - ts[0]) / 1000 : 0;
        if (seconds < MIN_SECONDS) return (last = { ok: false, bpm: 0, snr: 0, seconds, why: 'warming up' });
        const rr = resample(ts, R, o.fs), gg = resample(ts, G, o.fs), bb = resample(ts, B, o.fs);
        if (gg.length < 32) return (last = { ok: false, bpm: 0, snr: 0, seconds, why: 'not enough frames' });
        const s = spectrum(chrom(rr, gg, bb), o.fs);
        if (!s) return (last = { ok: false, bpm: 0, snr: 0, seconds, why: 'no spectrum' });
        if (s.snr < o.minSnr || s.share < o.minShare)
          return (last = { ok: false, bpm: 0, snr: s.snr, share: s.share, seconds,
                           why: 'signal too weak — hold still, more light on your face' });
        if (s.slow > MAX_SLOW)
          return (last = { ok: false, bpm: 0, snr: s.snr, share: s.share, slow: s.slow, seconds,
                           why: 'that is drift, not a beat — the strongest wobble is slower than any heart' });
        // THE MEDIAN MUST NOT REMEMBER A DIFFERENT MINUTE. This ring only advanced on readings
        // that PASSED, so a run of refusals froze it: twelve fresh seconds of a 55 bpm heart
        // came back as 140 — ok:true, the number confident, the data two minutes old — because
        // six survivors of the last good session still outvoted the one live sample. Smooth
        // over the last few seconds, never across a gap.
        const at = ts[ts.length - 1];
        recent.push({ bpm: s.bpm, t: at });
        while (recent.length && (recent.length > 7 || at - recent[0].t > RECENT_MS)) recent.shift();
        return (last = { ok: true, bpm: Math.round(median(recent.map(r => r.bpm))),
                         instant: Math.round(s.bpm), snr: s.snr, share: s.share, slow: s.slow, seconds, why: '' });
      },
      last() { return last; },
      reset() { ts.length = R.length = G.length = B.length = 0; recent = []; },
      size() { return ts.length; },
    };
  }

  // the patch of skin to read: forehead, between the brows and up toward the hairline.
  // Landmarks are face_landmarker's 478, image space 0..1.
  function foreheadROI(lm, w, h) {
    if (!lm || lm.length < 400) return null;
    const glabella = lm[168] || lm[9], top = lm[10], l = lm[105], r = lm[334];
    if (!glabella || !top || !l || !r) return null;
    const cx = (l.x + r.x) / 2, wid = Math.abs(r.x - l.x) * 0.72;
    const y0 = Math.min(glabella.y, top.y), y1 = Math.max(glabella.y, top.y);
    const cy = y0 + (y1 - y0) * 0.42, hgt = Math.max(0.02, (y1 - y0) * 0.5);
    return {
      x: Math.max(0, Math.round((cx - wid / 2) * w)), y: Math.max(0, Math.round((cy - hgt / 2) * h)),
      w: Math.max(4, Math.round(wid * w)), h: Math.max(4, Math.round(hgt * h)),
    };
  }

  root.NexusPulse = { create, spectrum, chrom, resample, detrend, fft, foreheadROI, LO_HZ, HI_HZ, MIN_SNR, MIN_SHARE };
})(typeof window !== 'undefined' ? window : globalThis);

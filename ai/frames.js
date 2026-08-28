/* frames.js — rapp/1 frames, built and checked in the browser.
 *
 * One implementation, used by everything on this page. The tower had its own copy for verifying
 * sealed programs; a player's tick loop needs the same arithmetic to WRITE frames, and two
 * copies of a hash function is one copy too many.
 *
 * JCS per RFC 8785 over the I-JSON domain; H(space, v) = sha256(space + 0x0a + JCS(v)).
 * A frame is eleven keys. payload_hash covers the payload; frame_hash covers everything except
 * itself and the signature; prev is the PREVIOUS frame's payload_hash, which is what makes a
 * line of ticks a line rather than a pile.
 */
(function (root) {
  'use strict';

  const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

  function canonical(v) {
    if (v === null || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new Error('non-finite number in frame');
      if (!Number.isInteger(v)) throw new Error('float in frame');
      return JSON.stringify(v);
    }
    if (typeof v === 'string') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    if (typeof v === 'object') {
      const keys = Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
    }
    throw new Error('non-I-JSON value in frame');
  }

  async function H(space, v) {
    const body = new TextEncoder().encode(canonical(v));
    const head = new TextEncoder().encode(space);
    const bytes = new Uint8Array(head.length + 1 + body.length);
    bytes.set(head, 0); bytes[head.length] = 0x0a; bytes.set(body, head.length + 1);
    return hex(await crypto.subtle.digest('SHA-256', bytes));
  }

  // rapp/1 insists on exactly this stamp; a Date.toISOString has microseconds nowhere and
  // milliseconds always, which is the same thing the python builder writes.
  function utcNow(d) {
    const t = d || new Date();
    const p = (n, w) => String(n).padStart(w || 2, '0');
    return t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate()) + 'T' +
           p(t.getUTCHours()) + ':' + p(t.getUTCMinutes()) + ':' + p(t.getUTCSeconds()) + '.' +
           p(t.getUTCMilliseconds(), 3) + 'Z';
  }

  async function buildFrame(o) {
    const f = {
      spec: 'rapp/1',
      kind: o.kind,
      stream_id: o.streamId,
      seq: o.seq | 0,
      utc: o.utc || utcNow(),
      payload: o.payload,
      payload_hash: null,
      prev: o.prev === undefined ? null : o.prev,
      prev_wave: o.prevWave === undefined ? null : o.prevWave,
      sig: null,
      frame_hash: null,
    };
    f.payload_hash = await H('rapp/1:particle', f.payload);
    const pre = {};
    for (const k of Object.keys(f)) if (k !== 'frame_hash' && k !== 'sig') pre[k] = f[k];
    f.frame_hash = await H('rapp/1:wave', pre);
    return f;
  }

  // walk a chain: every hash recomputed, every link checked, nothing taken on trust
  async function verifyChain(text) {
    const frames = (typeof text === 'string' ? text.split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) : text);
    let prev = null; const latest = {};
    for (const f of frames) {
      if (await H('rapp/1:particle', f.payload) !== f.payload_hash) throw new Error('frame ' + f.seq + ': payload_hash mismatch');
      const pre = {}; for (const k of Object.keys(f)) if (k !== 'frame_hash' && k !== 'sig') pre[k] = f[k];
      if (await H('rapp/1:wave', pre) !== f.frame_hash) throw new Error('frame ' + f.seq + ': frame_hash mismatch');
      if (prev === null) { if (f.prev !== null) throw new Error('genesis prev must be null'); }
      else {
        if (f.prev !== prev.payload_hash) throw new Error('frame ' + f.seq + ': broken link');
        if (f.seq !== prev.seq + 1) throw new Error('frame ' + f.seq + ': seq is not contiguous');
      }
      prev = f;
      if (f.payload && f.payload.program) latest[f.payload.program] = f.payload;
    }
    return { frames: frames.length, latest, head: prev && prev.frame_hash, headPayload: prev && prev.payload_hash };
  }

  root.NexusFrames = { canonical, H, buildFrame, verifyChain, utcNow };
})(typeof window !== 'undefined' ? window : globalThis);

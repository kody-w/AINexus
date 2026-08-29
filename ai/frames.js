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

  // "float in frame" without saying WHICH field is a message that makes you go and look, and the
  // whole reason the rule exists is that floats do not canonicalise the same way twice. So the
  // path comes with the complaint.
  function canonical(v, at) {
    const where = at || '$';
    if (v === null || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new Error('non-finite number at ' + where);
      if (!Number.isInteger(v)) throw new Error('float in frame at ' + where + ' (= ' + v + ') — rapp/1 is I-JSON: carry it as an integer in fixed units');
      return JSON.stringify(v);
    }
    if (typeof v === 'string') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map((x, i) => canonical(x, where + '[' + i + ']')).join(',') + ']';
    if (typeof v === 'object') {
      const keys = Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(v[k], where + '.' + k)).join(',') + '}';
    }
    throw new Error('non-I-JSON value at ' + where + ' (' + typeof v + ')');
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
    // A frame that is wrong is easier to refuse than to migrate: §12.1 re-genesis is an
    // owner-signed operation, so a non-compliant frame minted today is somebody's signature
    // tomorrow. Refuse at the door unless the caller says it knows better.
    if (o.lax !== true) {
      const why = compliant(o.kind, o.streamId);
      if (why) throw new Error('refusing a non-rapp/1 frame — ' + why);
    }
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

  // ── identity, the way the spec actually spells it ────────────────────────
  // rappid = "rappid:@" owner "/" slug ":" 64-hex, and the tail is MINTED from a uuid4 — never
  // derived from a name (§6.2 forbids sha256("owner/slug") outright). A stream_id is then either
  // that bare rappid (a body-stream: one organism's biography) or the rappid plus one lowercase
  // label (a memory-stream: one instance's memory). Anything else — two labels, an uppercase
  // letter, a dot — is not a conformant form, however readable it looks.
  //
  // And the kind must be REGISTERED. The registry is exact-match: inventing `nexus.tick` because
  // it reads well does not make it a kind, and a family must match its stream's form (§7.2).
  const LCLABEL = /^[a-z0-9]+(?:-?[a-z0-9]+)*$/;

  async function mintRappid(owner, slug) {
    if (!LCLABEL.test(owner) || owner.length > 39) throw new Error('owner must be a lowercase label, 1-39');
    if (!LCLABEL.test(slug) || slug.length > 100) throw new Error('slug must be a lowercase label, 1-100');
    // uuid4's sixteen octets, hashed in the rappid space — minted once, never spelled
    const u = (root.crypto && root.crypto.randomUUID) ? root.crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); });
    const hex = u.replace(/-/g, '');
    const octets = new Uint8Array(16);
    for (let i = 0; i < 16; i++) octets[i] = parseInt(hex.substr(i * 2, 2), 16);
    const space = new TextEncoder().encode('rapp/1:rappid');
    const bytes = new Uint8Array(space.length + 1 + octets.length);
    bytes.set(space, 0); bytes[space.length] = 0x0a; bytes.set(octets, space.length + 1);
    const tail = hex2(await crypto.subtle.digest('SHA-256', bytes));
    return 'rappid:@' + owner + '/' + slug + ':' + tail;
  }
  const hex2 = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

  // one instance's memory, hanging off an organism — the label must be a clean lowercase word
  function memoryStream(rappid, instance) {
    const label = String(instance).toLowerCase().replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-').slice(0, 64);
    if (!LCLABEL.test(label)) throw new Error('instance does not reduce to a label: ' + instance);
    return rappid + ':' + label;
  }

  const RAPPID = /^rappid:@[a-z0-9]+(?:-?[a-z0-9]+)*\/[a-z0-9]+(?:-?[a-z0-9]+)*:[0-9a-f]{64}$/;
  const MEMORY = /^rappid:@[a-z0-9]+(?:-?[a-z0-9]+)*\/[a-z0-9]+(?:-?[a-z0-9]+)*:[0-9a-f]{64}:[a-z0-9]+(?:-?[a-z0-9]+)*$/;
  // exactly the kinds the anchor registers, and the form each family demands
  const KINDS = {
    'body.pulse': 'body', 'body.twin-pulse': 'body', 'body.reconstructed': 'body', 'body.re-genesis': 'body',
    'memory.chat-turn': 'memory', 'memory.tool-call': 'memory', 'memory.save': 'memory',
    'memory.reconstructed': 'memory', 'memory.re-genesis': 'memory',
    'swarm.guidance': 'swarm', 'swarm.echo': 'swarm', 'swarm.telemetry': 'swarm',
    'swarm.reconstructed': 'swarm', 'swarm.re-genesis': 'swarm',
  };
  function formOf(sid) { return RAPPID.test(sid) ? 'body-stream' : MEMORY.test(sid) ? 'memory-stream'
                              : /^net:[a-z0-9]+(?:-?[a-z0-9]+)*$/.test(sid) ? 'swarm-stream' : null; }
  function compliant(kind, streamId) {
    const fam = KINDS[kind];
    if (!fam) return 'kind is not registered: ' + kind;
    const form = formOf(streamId);
    if (!form) return 'stream_id matches no conformant form';
    const want = { body: 'body-stream', memory: 'memory-stream', swarm: 'swarm-stream' }[fam];
    if (form !== want) return "family '" + fam + "' needs a " + want + ', got a ' + form;
    return null;
  }

  root.NexusFrames = { canonical, H, buildFrame, verifyChain, utcNow,
                       mintRappid, memoryStream, compliant, formOf, REGISTERED_KINDS: KINDS };
})(typeof window !== 'undefined' ? window : globalThis);

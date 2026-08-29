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

  // §4's input-domain profile: a string carrying an UNPAIRED surrogate is refused, never repaired.
  // It matters because the three implementations part company here and nowhere else in strings —
  // JSON.stringify happily writes "\ud800", and python's .encode("utf-8") raises on the same
  // value, so a frame minted here with a half-emoji in it can NEVER be re-hashed by the reference
  // implementation. A hash nobody else can reproduce is not an address.
  const wellFormed = (s) => {
    if (typeof s.isWellFormed === 'function') return s.isWellFormed();
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) {
        const n = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
        if (!(n >= 0xDC00 && n <= 0xDFFF)) return false;
        i++;
      } else if (c >= 0xDC00 && c <= 0xDFFF) return false;
    }
    return true;
  };
  const MAX_INT = 9007199254740991;                                    // 2^53-1, §7.4 uint53 / §4

  // TRUNCATION IS WHERE A WELL-FORMED STRING BECOMES AN ILL-FORMED ONE. `s.slice(0, 200)` counts
  // UTF-16 code UNITS, so a cut that lands between the halves of an emoji leaves a lone surrogate
  // behind — and the refusal above then fires far away from the line that caused it, at seal time,
  // on the one frame nobody can afford to lose (the tick that already went wrong). Every place in
  // this estate that shortens text destined for a frame goes through here instead.
  //
  // It only promises not to CREATE a lone surrogate. A string that arrived broken stays broken,
  // and §4 still refuses it — repairing somebody else's bytes is not this module's business.
  function clip(s, max) {
    const t = String(s == null ? '' : s);
    if (!(max > 0)) return '';
    if (t.length <= max) return t;
    const c = t.charCodeAt(max - 1);
    return t.slice(0, (c >= 0xD800 && c <= 0xDBFF) ? max - 1 : max);   // never end on a high half
  }

  // "float in frame" without saying WHICH field is a message that makes you go and look, and the
  // whole reason the rule exists is that floats do not canonicalise the same way twice. So the
  // path comes with the complaint.
  function canonical(v, at) {
    const where = at || '$';
    if (v === null || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new Error('non-finite number at ' + where);
      if (!Number.isInteger(v)) throw new Error('float in frame at ' + where + ' (= ' + v + ') — rapp/1 is I-JSON: carry it as an integer in fixed units');
      // Past 2^53 a double stops counting one at a time: JSON.parse turns 9007199254740993 into
      // ...992 and hashes THAT, while python holds the true integer and hashes something else.
      // Two implementations silently addressing different numbers is the exact failure §4 exists
      // to prevent, so the whole interoperable range is the range — carry bigger counts as strings.
      if (Math.abs(v) > MAX_INT) throw new Error('integer outside the interoperable range at ' + where + ' (|n| > 2^53-1) — carry it as a string');
      return JSON.stringify(v);
    }
    if (typeof v === 'string') {
      if (!wellFormed(v)) throw new Error('unpaired surrogate in the string at ' + where + ' — §4 refuses it rather than repairing it');
      return JSON.stringify(v);
    }
    if (Array.isArray(v)) {
      // v.map skips holes and join() writes them as nothing, so a sparse array used to canonicalise
      // to `[1,,3]` — which is not JSON at all, and got hashed anyway.
      const out = [];
      for (let i = 0; i < v.length; i++) {
        if (!(i in v)) throw new Error('hole in the array at ' + where + '[' + i + '] — I-JSON has no absent element');
        out.push(canonical(v[i], where + '[' + i + ']'));
      }
      return '[' + out.join(',') + ']';
    }
    if (typeof v === 'object') {
      // A Date, Map, Set, RegExp or boxed primitive has no own enumerable keys, so `typeof
      // v === 'object'` alone canonicalised every one of them to `{}` and hashed the empty
      // object — a wrong hash with no complaint. The brand check is realm-agnostic on purpose:
      // an object handed over from an iframe is still a plain object.
      if (Object.prototype.toString.call(v) !== '[object Object]')
        throw new Error('non-I-JSON object at ' + where + ' (' + Object.prototype.toString.call(v) + ') — only plain objects and arrays');
      // RFC 8785 orders member names by UTF-16 code unit, which is exactly what `<` does on a JS
      // string — and is NOT code-point order: "😀" sorts before "Ｚ".
      const keys = Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      for (const k of keys) if (!wellFormed(k)) throw new Error('unpaired surrogate in the member name at ' + where + '.' + k);
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

  // §7.4 wants the fixed 24-byte stamp AND a real date behind it, so 2026-13-45T25:61:61.999Z
  // is refused for being a calendar that does not exist rather than accepted for being 24 bytes.
  const UTC_FORM = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{3}Z$/;
  function utcValid(s) {
    if (typeof s !== 'string') return false;
    const m = UTC_FORM.exec(s);
    if (!m) return false;
    const [, Y, M, D, h, mi, sec] = m.map(Number);
    if (M < 1 || M > 12 || h > 23 || mi > 59 || sec > 59) return false;   // §7.4: seconds never 60
    const leap = (Y % 4 === 0 && Y % 100 !== 0) || Y % 400 === 0;
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][M - 1];
    return D >= 1 && D <= days;
  }
  const HEX64 = /^[0-9a-f]{64}$/;
  const isHex64 = (s) => typeof s === 'string' && HEX64.test(s);
  const isUint53 = (n) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_INT;
  const isPlainObject = (v) => v !== null && typeof v === 'object' && Object.prototype.toString.call(v) === '[object Object]';
  const FRAME_KEYS = ['spec', 'kind', 'stream_id', 'seq', 'utc', 'payload',
                      'payload_hash', 'frame_hash', 'prev', 'prev_wave', 'sig'];

  // §7.5 step 1 — shape and types, exactly the eleven keys. Everything here is about the frame
  // ALONE; the chain-shaped rules live in verifyChain where there is a predecessor to compare to.
  function shapeOf(f) {
    if (!isPlainObject(f)) return 'not a JSON object';
    const keys = Object.keys(f);
    const missing = FRAME_KEYS.filter(k => !Object.prototype.hasOwnProperty.call(f, k));
    const extra = keys.filter(k => FRAME_KEYS.indexOf(k) < 0);
    if (missing.length) return 'missing key(s): ' + missing.join(', ');
    if (extra.length) return 'extra key(s): ' + extra.join(', ');   // §7.1 is eleven, not "at least eleven"
    if (f.spec !== 'rapp/1') return 'spec is not "rapp/1" (' + JSON.stringify(f.spec) + ')';
    if (typeof f.kind !== 'string' || !KIND.test(f.kind)) return 'kind is not a §6.1.1 klabel.klabel';
    if (typeof f.stream_id !== 'string') return 'stream_id is not a string';
    if (!isUint53(f.seq)) return 'seq is not a uint53';
    if (!utcValid(f.utc)) return 'utc is not the §7.4 form, or names a date that does not exist';
    if (!isPlainObject(f.payload)) return 'payload is not a JSON object';
    if (!isHex64(f.payload_hash)) return 'payload_hash is not 64 lowercase hex';
    if (!isHex64(f.frame_hash)) return 'frame_hash is not 64 lowercase hex';
    if (!(f.prev === null || isHex64(f.prev))) return 'prev is neither null nor 64 lowercase hex';
    if (!(f.prev_wave === null || isHex64(f.prev_wave))) return 'prev_wave is neither null nor 64 lowercase hex';
    if (!(f.sig === null || typeof f.sig === 'string')) return 'sig is neither null nor a JWS string';
    return null;
  }

  async function buildFrame(o) {
    // A frame that is wrong is easier to refuse than to migrate: §12.1 re-genesis is an
    // owner-signed operation, so a non-compliant frame minted today is somebody's signature
    // tomorrow. Refuse at the door unless the caller says it knows better.
    if (o.lax !== true) {
      const why = compliant(o.kind, o.streamId);
      if (why) throw new Error('refusing a non-rapp/1 frame — ' + why);
    }
    // `o.seq | 0` used to stand here, and `|` is a 32-bit operator: seq 2147483648 became
    // -2147483648, the legal ceiling 2^53-1 became -1, and 1.5 quietly became 1. The frame then
    // hashed the wrong number and looked perfect doing it. seq is a uint53 (§7.4) or it is nothing.
    if (!isUint53(o.seq)) throw new Error('seq must be an integer 0 … 2^53-1 (§7.4), got ' + JSON.stringify(o.seq));
    const utc = o.utc || utcNow();
    if (!utcValid(utc)) throw new Error('utc must be the §7.4 form YYYY-MM-DDTHH:MM:SS.mmmZ and a real date, got ' + JSON.stringify(utc));
    if (!isPlainObject(o.payload)) throw new Error('payload must be a JSON object (§7.1), possibly {}');
    for (const [k, v] of [['prev', o.prev], ['prevWave', o.prevWave]])
      if (!(v === undefined || v === null || isHex64(v))) throw new Error(k + ' must be null or 64 lowercase hex, got ' + JSON.stringify(v));
    const f = {
      spec: 'rapp/1',
      kind: o.kind,
      stream_id: o.streamId,
      seq: o.seq,
      utc: utc,
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

  // Walk a chain: every hash recomputed, every link checked, nothing taken on trust.
  //
  // This used to run §7.5 steps 2 and 3 and half of step 4, which meant a chain could be waved
  // through while carrying a twelfth key nobody looked at, a `spec` of "rapp-frame/2.0", a payload
  // that was a string, a genesis at seq 7, a `utc` of 2026-13-45T25:61:61.999Z, or — worst —
  // a second frame belonging to a DIFFERENT stream spliced in behind a correct hash link. A false
  // refusal is an argument; a false accept is a broken line that looks sound, so the whole of
  // steps 1, 1a, 4 and 5 is here now.
  //
  // opts.kinds:true additionally demands the §13 registered kind and the §7.2 family/stream match.
  // It is OFF by default and deliberately so: this repo's own older lines (frames/chain.jsonl,
  // frames/worlds/*.jsonl, ai/programs/PROGRAMS.chain.jsonl) carry `body.pulse` on a memory-stream,
  // which frames/line.jsonl's genesis names out loud as the drift it opened a clean line to leave
  // behind. Turning that check on by default would refuse published history, and retiring history
  // is the owner's call (§12.1), not a verifier's.
  async function verifyChain(text, opts) {
    const strictKinds = !!(opts && opts.kinds);
    const frames = (typeof text === 'string' ? text.split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) : text);
    let prev = null; const latest = {}; let streamId = null;
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const at = 'frame ' + i + (f && typeof f === 'object' ? ' (seq ' + JSON.stringify(f.seq) + ')' : '');
      const bad = shapeOf(f);                                             // §7.5 step 1
      if (bad) throw new Error(at + ': ' + bad);
      if (strictKinds) {
        const why = compliant(f.kind, f.stream_id);
        if (why) throw new Error(at + ': ' + why);
      }
      // §7.5 step 1a — one chain is one stream. Without this a segment lifted from another
      // stream links up perfectly, because `prev` only ever spoke about hashes.
      if (streamId === null) streamId = f.stream_id;
      else if (f.stream_id !== streamId) throw new Error(at + ': stream_id changes mid-chain (' + f.stream_id + ' after ' + streamId + ')');

      if (await H('rapp/1:particle', f.payload) !== f.payload_hash) throw new Error(at + ': payload_hash mismatch');   // step 2
      const pre = {}; for (const k of Object.keys(f)) if (k !== 'frame_hash' && k !== 'sig') pre[k] = f[k];
      if (await H('rapp/1:wave', pre) !== f.frame_hash) throw new Error(at + ': frame_hash mismatch');                 // step 3

      if (prev === null) {                                                                                            // step 4
        if (f.prev !== null) throw new Error('genesis prev must be null');
        if (f.seq !== 0) throw new Error(at + ': genesis must be seq 0, not ' + f.seq);
      } else {
        if (f.prev !== prev.payload_hash) throw new Error(at + ': broken link');
        if (f.seq !== prev.seq + 1) throw new Error(at + ': seq is not contiguous');
        if (f.utc < prev.utc) throw new Error(at + ': utc runs backwards (' + f.utc + ' after ' + prev.utc + ')');
      }
      // §7.5 step 5 — prev_wave is non-null exactly on a swarm-stream past genesis, nowhere else.
      const swarm = formOf(f.stream_id) === 'swarm-stream';
      if (swarm && f.seq > 0) {
        if (f.prev_wave !== prev.frame_hash) throw new Error(at + ': prev_wave is not the predecessor frame_hash');
      } else if (f.prev_wave !== null) {
        throw new Error(at + ': prev_wave must be null off a swarm-stream (and at genesis)');
      }
      prev = f;
      if (f.payload && f.payload.program) latest[f.payload.program] = f.payload;
    }
    return { frames: frames.length, latest, stream_id: streamId,
             head: prev && prev.frame_hash, headPayload: prev && prev.payload_hash };
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

  // §6.1's lengths are normative — "an implementation MUST refuse longer" — so they are part of
  // the grammar, not advice. The bare regexes matched a 40-char owner and a 101-char slug happily,
  // which meant compliant() let buildFrame mint onto a stream_id no other implementation will read.
  // (`-` rather than `-?` inside the group: same language, one unambiguous way to match it.)
  const L = '[a-z0-9]+(?:-[a-z0-9]+)*';
  const RAPPID = new RegExp('^rappid:@(' + L + ')/(' + L + '):[0-9a-f]{64}$');
  const MEMORY = new RegExp('^rappid:@(' + L + ')/(' + L + '):[0-9a-f]{64}:(' + L + ')$');
  const SWARM  = new RegExp('^net:' + L + '$');
  const KIND   = new RegExp('^(' + L + ')\\.(' + L + ')$');
  // exactly the kinds the anchor registers, and the form each family demands
  const KINDS = {
    'body.pulse': 'body', 'body.twin-pulse': 'body', 'body.reconstructed': 'body', 'body.re-genesis': 'body',
    'memory.chat-turn': 'memory', 'memory.tool-call': 'memory', 'memory.save': 'memory',
    'memory.reconstructed': 'memory', 'memory.re-genesis': 'memory',
    'swarm.guidance': 'swarm', 'swarm.echo': 'swarm', 'swarm.telemetry': 'swarm',
    'swarm.reconstructed': 'swarm', 'swarm.re-genesis': 'swarm',
  };
  // owner 1-39, slug 1-100, instance 1-64 (§6.1, §6.1.1) — a form that is over length is not
  // a different form, it is no form at all.
  function formOf(sid) {
    if (typeof sid !== 'string') return null;
    let m = RAPPID.exec(sid);
    if (m) return (m[1].length <= 39 && m[2].length <= 100) ? 'body-stream' : null;
    m = MEMORY.exec(sid);
    if (m) return (m[1].length <= 39 && m[2].length <= 100 && m[3].length <= 64) ? 'memory-stream' : null;
    return SWARM.test(sid) ? 'swarm-stream' : null;
  }
  function compliant(kind, streamId) {
    const fam = KINDS[kind];
    if (!fam) return 'kind is not registered: ' + kind;
    const form = formOf(streamId);
    if (!form) return 'stream_id matches no conformant form';
    const want = { body: 'body-stream', memory: 'memory-stream', swarm: 'swarm-stream' }[fam];
    if (form !== want) return "family '" + fam + "' needs a " + want + ', got a ' + form;
    return null;
  }

  root.NexusFrames = { canonical, H, buildFrame, verifyChain, utcNow, shapeOf, utcValid, clip,
                       mintRappid, memoryStream, compliant, formOf, REGISTERED_KINDS: KINDS };
})(typeof window !== 'undefined' ? window : globalThis);

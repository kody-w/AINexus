// ── program_chain.js — the one place a program is verified ──────────────────
//
// A program is DATA, published on a chain this repo owns
// (ai/programs/PROGRAMS.chain.jsonl). Every payload_hash and frame_hash is
// recomputed here and every prev is checked, then a program whose bytes do not
// match the newest frame for its name is REFUSED. Trust the chain, not the file.
//
// This lives in its own file because the control tower and the views grid must
// verify a program identically. Two copies of a security check are one copy and
// one liability.
//
// JCS per RFC 8785 over the I-JSON domain; H = sha256(space + 0x0a + JCS).
(function (root) {
  'use strict';
  const RAW = 'https://raw.githubusercontent.com/kody-w/AINexus/main/';

async function sha256(text) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── rapp/1 frame verification, in the browser ──────────────────────────────
// The bytecode is published on a chain we own (ai/programs/PROGRAMS.chain.jsonl). The tower
// walks that chain here — every payload_hash and frame_hash recomputed, every prev checked —
// and then refuses any program whose bytes do not match the newest frame for its name.
// Trust the chain, not the file. (JCS per RFC 8785 over the I-JSON domain; H = sha256(space + 0x0a + JCS).)
function canonical(v) {
  if (v === null || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'number') { if (!Number.isInteger(v)) throw new Error('float in frame'); return JSON.stringify(v); }
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (typeof v === 'object') {
    const keys = Object.keys(v).sort((a, b) => {
      const A = new TextEncoder().encode(a), B = new TextEncoder().encode(b);   // UTF-16 order ≈ code-unit order for BMP keys
      return a < b ? -1 : a > b ? 1 : 0;
    });
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  throw new Error('non-I-JSON value');
}
async function H(space, v) {
  const bytes = new Uint8Array([...new TextEncoder().encode(space), 0x0a, ...new TextEncoder().encode(canonical(v))]);
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function verifyChain(text) {
  const frames = text.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  let prev = null; const latest = {};
  for (const f of frames) {
    if (await H('rapp/1:particle', f.payload) !== f.payload_hash) throw new Error(`frame ${f.seq}: payload_hash mismatch`);
    const pre = {}; for (const k of Object.keys(f)) if (k !== 'frame_hash' && k !== 'sig') pre[k] = f[k];
    if (await H('rapp/1:wave', pre) !== f.frame_hash) throw new Error(`frame ${f.seq}: frame_hash mismatch`);
    if (prev === null) { if (f.prev !== null) throw new Error('genesis prev must be null'); }
    else if (f.prev !== prev.payload_hash) throw new Error(`frame ${f.seq}: broken link`);
    prev = f;
    if (f.payload && f.payload.program) latest[f.payload.program] = f.payload;
  }
  return { frames: frames.length, latest, head: prev && prev.frame_hash };
}

// Programs are DATA fetched from committed static files (Article XXIV) — never code.
// Any verb the driver does not know is refused, so a tampered file cannot execute anything.
const VERBS = new Set(['look','walk','click','aim','travel','ask','say','press','wait','see','scan','sense','carry','mind','camera','cut']);
async function fetchEither(rel) {
  try { const r = await fetch(RAW + rel, { cache: 'no-store' }); if (!r.ok) throw new Error(r.status); return { text: await r.text(), via: 'raw' }; }
  catch (e) { const r = await fetch(rel); return { text: await r.text(), via: 'local' }; }
}
async function loadProgram(name) {
  const chainSrc = await fetchEither('ai/programs/PROGRAMS.chain.jsonl');
  const chain = await verifyChain(chainSrc.text);            // throws if the chain itself is broken
  const src = await fetchEither('ai/programs/' + name + '.json');
  const digest = await sha256(src.text);
  const sealed = chain.latest[name];
  if (!sealed) throw new Error(`"${name}" is not published on the chain — refusing to run unsealed bytecode`);
  if (sealed.sha256 !== digest) throw new Error(`"${name}" does not match its sealed hash (chain ${sealed.sha256.slice(0, 12)}… vs file ${digest.slice(0, 12)}…) — refused`);
  const prog = JSON.parse(src.text);
  const bad = (prog.steps || []).map(s => s.do).filter(v => !VERBS.has(v));
  if (bad.length) throw new Error('refused: unknown verbs ' + [...new Set(bad)].join(','));
  return { prog, digest, via: src.via, bytes: src.text.length, chain: { frames: chain.frames, head: chain.head } };
}

  root.ProgramChain = { sha256, canonical, verifyChain, loadProgram, fetchEither, VERBS, RAW };
})(typeof window !== 'undefined' ? window : globalThis);

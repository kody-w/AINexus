/* minds.cjs - real minds for the recorded players, and the evidence of every thought.
 *
 * With --minds, a player may think on a tick. Its eyes' picture and its percepts go to ONE model
 * through the estate's own agent loop, NexusBrainstem.turn, so the mind gets the same verbs,
 * bounds and refusals a visitor's player gets. The model acts by calling world_* verbs, and every
 * action carries the reason the model gave for it. Everything that crossed the wire is kept: the
 * exact picture, the exact request and reply, what the hands did with it, and what it cost.
 *
 * THE CHAIN IS THE MEMORY AND THE LEDGER. Where a body was standing, what a player did and said on
 * its last few thoughts, what the others said last tick, when it last thought, and what the last
 * day of thinking cost: all of it is read back from views/, the sealed line. The record and the
 * mind therefore cannot disagree about the past, and anyone can audit the spending from the line.
 *
 * A BODY MOVES ONLY WHEN ITS MIND MOVES IT. A player that is not thinking this tick rests where
 * its last thought left it, and the frame says why: not due yet, the day's budget is spent, or no
 * seat to think on. A still body with an honest reason beats a scripted wander dressed as intent.
 *
 * Thinking happens on a GitHub Copilot seat. The session token arrives in NEXUS_MIND_TOKEN and
 * stays in this process: the page is handed a function to call, never the credential.
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Playout = require('../ai/playout.js');

const PROVIDER = 'github-copilot';
const HEADERS = { 'Copilot-Integration-Id': 'vscode-chat', 'Editor-Version': 'vscode/1.95.0' };
const TIMEOUT_MS = 60000;
const MEMORY = 3;            // this player's own recent thoughts, handed back to it
const LOOKBACK = 200;        // frames read back at least: more than a day at a ten-minute beat
const MAX_EVERY = 4320;      // thirty days of ten-minute ticks
const DAY_MS = 86400000;
const TAU = Math.PI * 2;
// A recorded tick is one world: a mind is not given `travel`, which would take its body, and the
// page its eyes are captured from, somewhere else in the middle of the tick.
const RECORDED_VERBS = ['look', 'walk', 'aim', 'say', 'tell', 'see', 'scan', 'people', 'orbs', 'dialogue', 'wait'];

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

// Cut by code point, never through the middle of a surrogate pair: the sealer reads these in
// Python, and a lone surrogate is a string Python refuses to encode. U+0085, U+2028 and U+2029
// become spaces, as the sealer makes them: JSON leaves them raw, and the spine's own reader splits
// an epoch bundle's lines on them.
function clip(value, max) {
  const chars = Array.from(String(value == null ? '' : value).replace(/[\u0085\u2028\u2029]/g, ' '));
  return chars.length <= max ? chars.join('') : chars.slice(0, max - 1).join('') + '…';
}

// Whitespace as Python's str.split() finds it, so a rest reads the same in the feed and the frame.
const SPACES = /[\s\x1c-\x1f\x85\ufeff]+/g;
const words = (value) => String(value == null ? '' : value).replace(SPACES, ' ').trim();

// ── reading the line back ────────────────────────────────────────────────────
function readLine(dir, last = LOOKBACK) {
  let head;
  try { head = JSON.parse(fs.readFileSync(path.join(dir, 'HEAD.json'), 'utf8')); } catch (error) { return []; }
  const E = head.epoch_size || 288, K = head.sealed_epochs || 0, count = head.count || 0;
  const bundles = new Map();
  const frames = [];
  for (let seq = Math.max(0, count - last); seq < count; seq++) {
    if (seq >= K * E) {
      frames.push(JSON.parse(fs.readFileSync(path.join(dir, seq + '.json'), 'utf8')));
      continue;
    }
    const k = Math.floor(seq / E);
    if (!bundles.has(k)) {
      bundles.set(k, fs.readFileSync(path.join(dir, 'epochs', k + '.jsonl'), 'utf8')
        .split('\n').filter(line => line.trim()).map(line => JSON.parse(line)));
    }
    frames.push(bundles.get(k)[seq - k * E]);
  }
  return frames;
}

// How far back the line must be read for this config: a day of spending, and each player's last
// few thoughts at its cadence.
function lookback(config) {
  const most = Math.max(1, ...Object.values((config && config.players) || {})
    .map(want => Math.min(MAX_EVERY, Number.isInteger(want.every) ? want.every : 1)));
  return Math.max(LOOKBACK, MEMORY * most + 1);
}

// THE LINE IS THE LEDGER, AND THIS IS ITS CARBON COPY. A thought is paid for when the model
// answers, which can be before the tick it belongs to is sealed, or a tick that never is: the
// publish failed, the seal refused, the machine went down. A capture that is run again for the
// same tick would then buy the same thoughts again, outside the cap. So every answer is also
// written here the moment it arrives, and the day's spending is the larger of the two.
function readJournal(file, now = Date.now()) {
  if (!file) return [];
  let lines;
  try { lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); } catch (error) { return []; }
  const kept = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (Date.parse(entry.utc) >= now - 2 * DAY_MS) kept.push(entry);
    } catch (error) {}
  }
  if (kept.length !== lines.length) {
    const temporary = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(temporary, kept.map(entry => JSON.stringify(entry) + '\n').join(''));
    fs.renameSync(temporary, file);
  }
  return kept;
}

const playersOf = (frame) => (frame && frame.payload && frame.payload.views && frame.payload.views.players) || [];
const thought = (entry) => !!(entry && entry.mind && entry.mind.kind === 'model');
const CLOCK = /^[A-Za-z][A-Za-z0-9_+-]{0,31}(\/[A-Za-z0-9_+-]{1,32}){0,2}$/;
const frameMs = (frame) => Date.parse(frame && frame.payload && frame.payload.views && frame.payload.views.captured_utc);
// The clock of the place, from the config, or the hub's own. Players carry none of their own.
const placeClock = (config) => Playout.validClock(config && typeof config.clock === 'string' && CLOCK.test(config.clock)
  ? config.clock : null);
// The clock a sealed frame kept for a body: its place's, or on a line sealed before places had one,
// the body's own.
function sealedClock(frame, entry) {
  const views = frame && frame.payload && frame.payload.views;
  if (views && typeof views.clock === 'string' && views.clock) return views.clock;
  return entry && typeof entry.clock === 'string' && entry.clock ? entry.clock : null;
}

// Where a body is at `now` and what it will run from there: its last sealed pose, played forward
// through the night and its standing routine exactly as every viewer plays it (ai/playout.js), under
// the clock its frame kept. Then the place's clock says whether it is night now: a body the line
// left asleep under another clock wakes where it slept when the place says day, and a body the place
// says is asleep is in its bed.
function bodyAt(id, frames, clock, now) {
  let routine = null, last = null, when = now, kept = null;
  for (let i = frames.length - 1; i >= 0 && !(routine && last); i--) {
    const entry = playersOf(frames[i]).find(e => e.id === id);
    if (!entry) continue;
    if (!routine && entry.routine) routine = entry.routine;
    if (!last && entry.at) { last = entry.at; when = frameMs(frames[i]); kept = sealedClock(frames[i], entry); }
  }
  if (!routine) routine = { steps: Playout.defaultRoutine(id), set_at: null, by: 'default' };
  const state = Playout.stateAt({ id, at: last, routine, clock: kept || clock }, Number.isFinite(when) ? when : now, now);
  const asleep = Playout.asleepAt(clock, now);
  const start = asleep ? Playout.bed(id)
    : state.asleep ? Object.assign(Playout.bed(id), { pitch_mrad: 0 }) : state.pose;
  return { routine, start, asleep };
}

// ── who thinks this tick, and what they remember ─────────────────────────────
// config: { cap_x100, clock?, players: { id: { model, every, multiplier_x100, vision, persona? } } }
function plan(config, frames, options = {}) {
  const now = options.now || Date.now();
  const seat = !!options.seat;
  const newest = frames[frames.length - 1];
  const clock = placeClock(config);
  const local = Playout.clockText(clock, now);
  let onLine = 0, journaled = 0;
  for (const frame of frames) {
    if (!(Date.parse(frame.utc) >= now - DAY_MS)) continue;
    for (const entry of playersOf(frame)) if (thought(entry)) onLine += entry.mind.multiplier_x100 || 0;
  }
  for (const entry of options.journal || []) {
    if (Date.parse(entry.utc) >= now - DAY_MS && Number.isInteger(entry.multiplier_x100)) journaled += entry.multiplier_x100;
  }
  let spent = Math.max(onLine, journaled);
  const cap = Number.isInteger(config.cap_x100) ? config.cap_x100 : 0;
  const out = {};
  for (const [id, want] of Object.entries(config.players || {})) {
    // frames since this player last thought; a player that never has is due at once
    let since = Infinity;
    for (let i = frames.length - 1, n = 0; i >= 0; i--, n++) {
      if (thought(playersOf(frames[i]).find(entry => entry.id === id))) { since = n; break; }
    }
    const every = Math.min(MAX_EVERY, Math.max(1, Number.isInteger(want.every) ? want.every : 1));
    const cost = Number.isInteger(want.multiplier_x100) ? want.multiplier_x100 : 100;
    const body = bodyAt(id, frames, clock, now);
    let why = '';
    if (body.asleep) why = clip('asleep: night in ' + local, 150);
    else if (!seat) why = clip(options.seatWhy || 'no Copilot seat to think on', 150);
    else if (!want.model) why = 'no model chosen for this player';
    else if (want.unavailable) why = clip(String(want.unavailable), 150);
    else if (since + 1 < every) why = `resting between thoughts (thinks every ${every} ticks)`;
    else if (cost > 0 && spent + cost > cap) why = "the day's thinking budget is spent";
    const memory = [];
    for (let i = frames.length - 1; i >= 0 && memory.length < MEMORY; i--) {
      const entry = playersOf(frames[i]).find(e => e.id === id);
      if (thought(entry)) {
        memory.unshift({ tick: frames[i].payload.tick, said: entry.mind.said,
                         did: (entry.mind.did || []).map(d => d.verb + (d.why ? ': ' + d.why : '')) });
      }
    }
    const heard = playersOf(newest).filter(entry => entry.id !== id && thought(entry) && entry.mind.said)
      .map(entry => ({ who: entry.id, said: entry.mind.said }));
    // where the body last stood on the record, however long ago that was
    let restore = null;
    for (let i = frames.length - 1; i >= 0 && !restore; i--) {
      const entry = playersOf(frames[i]).find(e => e.id === id);
      if (entry && entry.at) restore = entry.at;
    }
    if (!why) spent += cost;
    out[id] = { think: !why, why, model: want.model || null, multiplier_x100: cost,
                vision: want.vision !== false, persona: want.persona || null,
                memory, heard, restore, since: Number.isFinite(since) ? since : null,
                sleep: body.asleep, routine: body.routine, start: body.start, local };
  }
  return { players: out, clock, local, spent_x100: spent, on_line_x100: onLine, journaled_x100: journaled, cap_x100: cap };
}

// Everything a capture needs before it opens a page: the line read back as far as this config
// needs, this machine's journal, who thinks, and the tick the line is waiting for.
function prepare(config, lineDir, options = {}) {
  const line = readLine(lineDir, lookback(config));
  const planned = plan(config, line, { now: options.now, seat: options.seat, seatWhy: options.seatWhy,
                                       journal: readJournal(options.journal, options.now) });
  planned.tick = line.length ? line[line.length - 1].payload.tick + 1 : null;
  return planned;
}

// ── the body: where it stands, in integers a frame can carry ─────────────────
async function readPose(page) {
  return page.evaluate((tau) => {
    const w = window.worldNavigator;
    if (!w || !w.camera) return null;
    const p = w.camera.position, r = w.rotation || w.camera.rotation;
    const yaw = ((((r.y % tau) + tau) % tau) + tau / 2) % tau - tau / 2;      // (-π, π]
    return { x_cm: Math.round(p.x * 100), y_cm: Math.round(p.y * 100), z_cm: Math.round(p.z * 100),
             yaw_mrad: Math.round(yaw * 1000), pitch_mrad: Math.round(r.x * 1000) };
  }, TAU).catch(() => null);
}

// Setup, not play: putting the body back where the last sealed frame left it is loading a save.
// Every move after this goes through the hands.
async function restorePose(page, at) {
  if (!at) return false;
  // window.worldNavigator is published at the very end of the world's init, after its camera is
  // built at the spawn point; a pose set before then was silently refused and the body began the
  // tick at the spawn instead of where the line says it is.
  await page.waitForFunction(() => !!(window.worldNavigator && window.worldNavigator.camera),
    null, { timeout: 60000 }).catch(() => {});
  return page.evaluate((a) => {
    const w = window.worldNavigator;
    if (!w || !w.camera) return false;
    w.camera.position.set(a.x_cm / 100, a.y_cm / 100, a.z_cm / 100);
    if (w.rotation) { w.rotation.y = a.yaw_mrad / 1000; w.rotation.x = a.pitch_mrad / 1000; }
    return true;
  }, at).catch(() => false);
}

// A minded page stays the page its eyes are captured from. Anything that tries to navigate it (a
// portal walked into, a link) is answered with 204 No Content, which leaves the document where it is.
async function holdInWorld(page) {
  await page.route('**/*', route => {
    const request = route.request();
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fallback();
  });
}

// ── the wire: one player's page may ask one model, and every round is written down ──
async function installBridge(page, options) {
  const record = { rounds: [] };
  const api = String(options.api || '').replace(/\/+$/, '');
  const fetcher = options.fetch || fetch;
  await page.exposeFunction('__nexusMindChat', async (messagesJson, optsJson) => {
    const messages = JSON.parse(messagesJson);
    const asked = JSON.parse(optsJson);
    const body = { model: options.model, messages, tools: asked.tools, max_tokens: asked.max_tokens || 600,
                   stream: false };
    if (typeof asked.temperature === 'number') body.temperature = asked.temperature;
    const vision = messages.some(m => Array.isArray(m.content) && m.content.some(part => part.type === 'image_url'));
    const headers = Object.assign({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + options.token },
                                  HEADERS, vision ? { 'Copilot-Vision-Request': 'true' } : {});
    const started = Date.now();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), options.timeoutMs || TIMEOUT_MS);
    let status = 0, reply = null;
    try {
      const response = await fetcher(api + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(body),
                                                                  signal: abort.signal });
      status = response.status;
      const text = await response.text();
      try { reply = JSON.parse(text); } catch (error) { reply = { error: { message: clip(text, 200) } }; }
    } catch (error) {
      reply = { error: { message: error.name === 'AbortError' ? 'timed out' : clip(error.message, 200) } };
    } finally {
      clearTimeout(timer);
    }
    const choice = reply && Array.isArray(reply.choices) ? reply.choices[0] : null;
    if (status === 200 && choice && options.journal) {
      fs.appendFileSync(options.journal, JSON.stringify({ utc: new Date().toISOString(), player: options.player || null,
        model: options.model, multiplier_x100: Number.isInteger(options.cost) ? options.cost : 100 }) + '\n');
    }
    record.rounds.push({ request: body, status, ms: Date.now() - started,
                         response: { model: reply && reply.model || null, message: choice ? choice.message : null,
                                     finish_reason: choice ? choice.finish_reason : null,
                                     usage: reply && reply.usage || null,
                                     error: reply && reply.error ? clip(reply.error.message || reply.error, 300) : null } });
    if (status !== 200 || !choice || !choice.message) {
      throw new Error('the model did not answer: HTTP ' + status + (reply && reply.error ? ' ' + clip(reply.error.message || '', 120) : ''));
    }
    return JSON.stringify(choice.message);
  });
  // A routine a mind sets is made canonical here, in the capture, and kept: it is what the body
  // will run until the mind next thinks, and what the sealer will find in the evidence.
  await page.exposeFunction('__nexusMindRoutine', async (stepsJson) => {
    let steps = null;
    try { steps = Playout.canonical(JSON.parse(stepsJson)); } catch (error) {}
    if (!steps) return false;
    record.routine = steps;
    return 'routine set: ' + Playout.summary(steps) + ' (' + steps.length + ' steps, looped until you next think)';
  });
  await page.evaluate(() => {
    window.__nexusMind = {
      signedIn: () => true,
      free: false,
      chat: async (messages, opts) => JSON.parse(await window.__nexusMindChat(JSON.stringify(messages),
        JSON.stringify({ tools: opts && opts.tools, temperature: opts && opts.temperature,
                         max_tokens: opts && opts.max_tokens }))),
    };
  });
  return record;
}

// ── one thought ──────────────────────────────────────────────────────────────
async function think(page, player, options = {}) {
  return page.evaluate(async (a) => {
    const drive = window.__autodrive;
    if (!drive || !window.NexusBrainstem || !window.__nexusMind) throw new Error('no hands or no brainstem in this page');
    const saw = a.vision ? drive.see({ width: a.width, format: 'image/webp', quality: 0.72, send: false }) : null;
    const snap = drive.snapshot();
    const others = window.NexusHolo ? window.NexusHolo.present().map(p => ({
      id: p.id, name: p.name, painted: !!p.painted, speaking: !!p.speaking,
      at: p.pos ? { x: Math.round(p.pos.x), z: Math.round(p.pos.z) } : null })) : [];
    const percepts = { tick: a.tick, me: snap.me, world: snap.world, portals: snap.portals, others,
                       chat: (snap.chat || []).slice(-4),
                       picture: saw ? (saw.blank ? 'BLANK: you cannot see' : 'attached') : 'none',
                       you_recently: a.memory, you_heard: a.heard,
                       your_routine: a.routine,
                       your_clock: a.local + ", the hub's clock: everyone here sleeps from 23:00 to 07:00" };
    // the same hands, plus one: a routine it may leave running until it thinks again
    const hands = Object.create(drive);
    hands.routine = async (steps) => window.__nexusMindRoutine(JSON.stringify(steps === undefined ? null : steps));
    const result = await window.NexusBrainstem.turn({
      percepts, persona: a.persona, mind: window.__nexusMind, python: false, summon: false, drive: hands,
      rounds: 1, explain: true, max_tokens: a.maxTokens, verbs: a.verbs,
      image: saw && !saw.blank ? saw.uri : undefined,
    });
    // A mind that answered in words without calling say still meant them to be heard, so they are
    // said for it, and the evidence records whether that happened.
    const attempted = (result.calls || []).some(c => c.tool === 'world_say' || c.tool === 'world_tell');
    let voiced = null;
    if (result.words && !attempted) {
      const line = Array.from(result.words).slice(0, 240).join('');
      voiced = (await drive.say(line)) === false ? null : line;
    }
    return { saw: saw && !saw.blank ? saw.uri : null, words: result.words || '', calls: result.calls || [],
             voiced, note: result.note || '' };
  }, { vision: player.vision, width: options.width || 448, tick: options.tick == null ? null : options.tick,
       memory: player.memory, heard: player.heard, persona: options.persona, maxTokens: options.maxTokens || 600,
       verbs: RECORDED_VERBS.concat('routine'), local: player.local || '',
       routine: player.routine ? { steps: player.routine.steps, set_by: player.routine.by,
                                   set_at: player.routine.set_at } : null });
}

// ── the evidence ─────────────────────────────────────────────────────────────
// The picture is stored once, as the file the model was shown; the request refers to it by hash
// instead of carrying the base64 a second time.
function evidence(player, planned, record, outcome, sawName) {
  // the picture the model was shown, found in the request itself when the thought did not return it
  let shown = outcome.saw;
  for (const round of shown ? [] : record.rounds) {
    for (const message of round.request.messages) {
      for (const part of Array.isArray(message.content) ? message.content : []) {
        if (!shown && part.type === 'image_url' && /^data:image\//.test(part.image_url && part.image_url.url || '')) {
          shown = part.image_url.url;
        }
      }
    }
  }
  let sawBytes = null, sawHash = null;
  if (shown) {
    sawBytes = Buffer.from(shown.split(',')[1], 'base64');
    sawHash = sha256(sawBytes);
  }
  const rounds = record.rounds.map(round => ({
    status: round.status, ms: round.ms,
    request: Object.assign({}, round.request, {
      messages: round.request.messages.map(message => Array.isArray(message.content)
        ? Object.assign({}, message, { content: message.content.map(part => part.type === 'image_url'
            ? { type: 'image_url', image_url: { url: sawName, sha256: sawHash } } : part) })
        : message),
    }),
    response: round.response,
  }));
  const exchange = {
    schema: 'ainexus/mind-exchange/1', player, provider: PROVIDER, asked: planned.model,
    multiplier_x100: planned.multiplier_x100, rounds,
    calls: outcome.calls.map(call => ({ tool: call.tool, args: call.args, failed: !!call.failed,
                                        result: clip(call.result, 400) })),
    words: clip(outcome.words, 600), voiced: outcome.voiced || null, note: outcome.note || '',
  };
  return { exchange, sawBytes };
}

// What the manifest's `doing` line says about a tick before anything is sealed: exactly the line
// the sealer derives (views_seal.doing_of), so a tick reads the same before and after its seal.
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;
const VERB_ID = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
function routineLine(routine) {
  const who = routine.by === 'default' ? 'default routine' : routine.by + "'s routine";
  return clip('↻ ' + who + ': ' + Playout.summary(routine.steps), 64);
}
function summary(planned, outcome, record, routine) {
  if (!outcome) {
    const why = clip(words(planned.why), 160) || (planned.sleep ? 'sleep' : 'rest');
    return planned.sleep || !routine ? clip('💤 ' + why, 64) : routineLine(routine);
  }
  const rounds = record && record.rounds || [];
  const answered = rounds.length && rounds[rounds.length - 1].response ? rounds[rounds.length - 1].response.model : null;
  const model = typeof answered === 'string' && MODEL_ID.test(answered) ? answered : planned.model;
  const verbs = outcome.calls.slice(0, 6).map(c => typeof c.tool === 'string' && VERB_ID.test(c.tool)
    ? c.tool.replace(/^world_/, '') : '?');
  return clip('🧠 ' + model + (verbs.length ? ': ' + verbs.join(', ') : ''), 64);
}

module.exports = { plan, prepare, readLine, lookback, readJournal, readPose, restorePose, holdInWorld, installBridge, think,
                   evidence, summary, routineLine, clip, sha256, placeClock, sealedClock, bodyAt, RECORDED_VERBS, Playout };

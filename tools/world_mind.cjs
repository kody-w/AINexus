/* world_mind.cjs - the one mind that moves every body.
 *
 * On every tick the heartbeat wakes the assistant headless (copilot -p, no tools, a free model) as
 * the world's one mind. It is given the charter it answers to (intent/), the state of the world
 * played forward to this moment, and what was said lately, and it answers with one directive for
 * every awake body: fine manual control at this tick (act), a line to say, and the routine to run
 * until the next tick. The answer is read exactly as tools/views_seal.py reads it (ai/playout.js
 * `directive`), the capture carries it out, and the exchange itself, prompt and answer, is kept
 * beside the views as evidence. The sealer derives the mind frame on mind:@kody-w/ainexus, and
 * every directed body in the views frame, from that evidence alone.
 *
 * Nothing waits for it. At night everyone is asleep: nobody is directed and nobody is asked. When
 * the model does not answer, or answers nothing a body can do, rules write the directive: every
 * body carries on with the routine it has.
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Playout = require('../ai/playout.js');

const SCHEMA = 'ainexus/world-mind/1';
const MODEL = 'gpt-5-mini';
const TIMEOUT_MS = 150000;
const HEARD = 12;               // lines said lately, newest last
const PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';

const cut = (text, max) => {
  const chars = Array.from(String(text == null ? '' : text));
  return chars.length <= max ? chars.join('') : chars.slice(0, max - 1).join('') + '…';
};

// ── what the one mind is shown ───────────────────────────────────────────────
function readChain(dir) {
  let head;
  try { head = JSON.parse(fs.readFileSync(path.join(dir, 'HEAD.json'), 'utf8')); } catch (error) { return null; }
  const seq = head.count - 1, E = head.epoch_size || 288, K = head.sealed_epochs || 0;
  if (seq < K * E) {
    const lines = fs.readFileSync(path.join(dir, 'epochs', Math.floor(seq / E) + '.jsonl'), 'utf8').split('\n').filter(Boolean);
    return JSON.parse(lines[seq - Math.floor(seq / E) * E]);
  }
  return JSON.parse(fs.readFileSync(path.join(dir, seq + '.json'), 'utf8'));
}

// the newest charter, as the one mind reads it: what the world is meant to be, and what never to do
function charterText(p) {
  const lines = ["What AINexus is meant to be, in Kody's own words. Hold every directive to it."];
  for (const c of p.canon || []) lines.push(`- ${c.rule}${c.status === 'held' ? '' : ' (' + c.status + ')'}`);
  lines.push('Never:');
  for (const n of p.never || []) lines.push(`- ${n.rule}`);
  return lines.join('\n');
}

const metres = cm => Math.round(Math.abs(cm) / 10) / 10;
function where(pose) {
  // the engine looks down -z: north is -z, east is +x, and yaw turns to the left
  const east = pose.x_cm, north = -pose.z_cm;
  const bearing = ((Math.round(-pose.yaw_mrad * 180 / Math.PI / 1000) % 360) + 360) % 360;
  const facing = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(bearing / 45) % 8];
  return `${metres(east)} m ${east < 0 ? 'west' : 'east'} and ${metres(north)} m ${north < 0 ? 'south' : 'north'} of the centre, facing ${facing}`;
}
const stepText = s => s.do === 'walk' ? `walk ${s.dir} ${s.ms} ms` : s.do === 'look' ? `look ${s.dx},${s.dy} px` : `wait ${s.ms} ms`;

// what the bodies said lately, from the line itself: a thought's words or the one mind's lines
function heardOn(frames) {
  const out = [];
  for (const frame of frames) {
    const players = frame && frame.payload && frame.payload.views && frame.payload.views.players || [];
    for (const q of players) {
      const said = q && q.mind && typeof q.mind.said === 'string' ? q.mind.said : '';
      if (said) out.push(`tick ${frame.payload.tick}, ${q.id}: "${said}"`);
    }
  }
  return out.slice(-HEARD);
}

function prompt(input) {
  const ids = Object.keys(input.planned.players);
  const bodies = ids.map(id => {
    const p = input.planned.players[id];
    if (p.sleep) return `- ${id}: asleep in its bed (leave it be)`;
    const r = p.routine;
    return `- ${id}: ${where(p.start)}; its routine (${r.by === 'default' ? "the world's default" : 'set by ' + r.by}): `
      + r.steps.map(stepText).join(' → ');
  });
  const heard = heardOn(input.frames);
  return [
    `You are the one mind of AINexus, a small 3D world of portals where ${ids.length} bodies live: ${ids.join(', ')}. `
      + 'Nothing else moves them. Once a tick, every ten minutes of the global DOGG spine, you write one directive for all of '
      + 'them at once, and between ticks each body runs the routine you left it.',
    '',
    'The charter you answer to:',
    charterText(input.charter.payload),
    '',
    `Now: ${input.local} on the hub's clock. It is day in the hub; everyone in it sleeps from 23:00 to 07:00.`,
    'The plaza is a disc 45 m out from its centre. The portals stand in a ring 15 m out, and each body has a bed beyond them. '
      + 'Walking covers 9 m a second.',
    'Where the bodies are now:',
    ...bodies,
    '',
    'Said lately, newest last:',
    ...(heard.length ? heard : ['(nothing yet)']),
    ...(input.memory ? ['', 'What you remember:', input.memory] : []),
    '',
    'Answer with ONLY one JSON object, no prose and no code fence:',
    '{"bodies": {"<name>": {"say": "...", "act": [...], "routine": [...]}}}',
    'Leave a body or a field out to let it carry on.',
    '- say: one line it says aloud now, up to 140 characters, in its own voice.',
    '- act: done once, right now: up to 4 steps and 6 seconds in all.',
    '- routine: the loop it runs until your next directive: 1 to 8 steps, 0.3 seconds or more in all.',
    'A step is {"do":"walk","dir":"forward|back|left|right","ms":100-3000}, {"do":"look","dx":-2000..2000,"dy":-600..600} '
      + '(pixels: one turns 2 mrad; dx>0 turns right, dy>0 looks down) or {"do":"wait","ms":100-10000}.',
    'Make it a world: let them notice each other, meet, talk and go places.',
  ].join('\n');
}

// ── asking it ────────────────────────────────────────────────────────────────
// The assistant, headless: no tools, no custom instructions from wherever it runs, no questions
// back, in a directory of its own. It answers on stdout.
function ask(text, options = {}) {
  const copilot = options.copilot || process.env.NEXUS_COPILOT || path.join(os.homedir(), '.local', 'bin', 'copilot');
  const args = ['-p', text, '--model', options.model || MODEL, '-s', '--no-custom-instructions', '--no-ask-user',
    '--no-auto-update', '--no-color', '--disable-builtin-mcps', '--available-tools='];
  return new Promise(resolve => {
    const started = Date.now();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'world-mind-'));
    let out = '', err = '', done = false, timer = null, child = null;
    // copilot is a launcher that starts the real process beneath it: it runs in a process group of
    // its own, and the whole group goes when the answer is late or this capture is stopped
    const killTree = () => {
      if (!child || !child.pid) return;
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { try { child.kill('SIGKILL'); } catch (e) {} }
    };
    const onStop = () => { killTree(); process.exit(143); };
    const finish = (answer, error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      process.removeListener('SIGTERM', onStop);
      killTree();
      if (child) { child.stdout.destroy(); child.stderr.destroy(); }
      fs.rmSync(cwd, { recursive: true, force: true });
      resolve({ answer, error, ms: Date.now() - started });
    };
    try {
      child = spawn(copilot, args, { cwd, env: Object.assign({}, process.env, { PATH }), stdio: ['ignore', 'pipe', 'pipe'],
                                     detached: true });
    } catch (error) {
      return finish(null, cut('the model could not be asked: ' + error.message, 150));
    }
    process.once('SIGTERM', onStop);
    timer = setTimeout(() => {
      finish(null, `the model did not answer within ${Math.round((options.timeoutMs || TIMEOUT_MS) / 1000)} s`);
    }, options.timeoutMs || TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', error => finish(null, cut('the model could not be asked: ' + error.message, 150)));
    child.on('close', code => code === 0 && out.trim() ? finish(out.trim(), null)
      : finish(null, cut('the model did not answer' + (code ? ` (exit ${code})` : '') + (err.trim() ? ': ' + err.trim() : ''), 150)));
  });
}

// ── one tick of the one mind ─────────────────────────────────────────────────
// planned: what tools/minds.cjs prepare() found (each body's state at `now`, the place's clock);
// frames: the newest part of the views line; mind: { model?, copilot?, multiplier_x100?, timeout_ms? }.
// null when every body is asleep: there is nobody to direct.
async function think(options) {
  const { planned, frames, root, now, mind = {}, journal } = options;
  const awake = Object.keys(planned.players).filter(id => !planned.players[id].sleep).sort();
  if (!awake.length) return null;
  const charter = readChain(path.join(root, 'intent'));
  const head = frames.length ? frames[frames.length - 1] : null;
  const cost = Number.isInteger(mind.multiplier_x100) && mind.multiplier_x100 > 0 ? mind.multiplier_x100 : 0;
  const evidence = {
    schema: SCHEMA, at_utc: new Date(now).toISOString(), clock: planned.clock,
    charter: charter ? { seq: charter.seq, frame_hash: charter.frame_hash } : null,
    state: head ? { views_seq: head.seq, views_frame: head.frame_hash } : null,
    awake, asked: null, prompt: null, answer: null, ms: 0, error: null,
  };
  if (!charter) evidence.error = 'there is no charter to answer to';
  else if (cost && planned.spent_x100 + cost > planned.cap_x100) evidence.error = "the day's thinking budget is spent";
  else {
    evidence.asked = typeof mind.model === 'string' && mind.model ? mind.model : MODEL;
    evidence.prompt = prompt({ planned, frames, charter, local: planned.local, memory: options.memory || '' });
    const got = await ask(evidence.prompt, { model: evidence.asked, copilot: mind.copilot, timeoutMs: mind.timeout_ms });
    Object.assign(evidence, { answer: got.answer, ms: got.ms, error: got.error });
    if (got.answer && cost && journal) {
      fs.appendFileSync(journal, JSON.stringify({ utc: new Date().toISOString(), player: 'world', model: evidence.asked,
                                                  multiplier_x100: cost }) + '\n');
    }
  }
  const told = typeof evidence.answer === 'string' ? Playout.directive(evidence.answer, awake) : null;
  return { evidence, directive: told || {}, by: told ? evidence.asked : 'rules',
           why: told ? '' : evidence.error || 'the model answered nothing a body can do' };
}

// What the capture does with one body's directive, by the same hands a visitor's player has.
async function carryOut(page, told) {
  if (!told || (!told.act && !told.say)) return true;
  return page.evaluate(async (t) => {
    const drive = window.__autodrive;
    if (!drive) return false;
    for (const s of t.act || []) {
      if (s.do === 'walk') await drive.walk(s.dir, s.ms);
      else if (s.do === 'look') await drive.look(s.dx, s.dy);
      else await new Promise(resolve => setTimeout(resolve, s.ms));
    }
    if (t.say) await drive.say(t.say);
    return true;
  }, told).catch(() => false);
}

module.exports = { think, ask, prompt, carryOut, heardOn, charterText, where, SCHEMA, MODEL };

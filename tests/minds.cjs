// Real minds, end to end. First the planner on its own: who thinks on a tick, and what the sealed
// line hands back to each mind (its budget, its cadence, its memory, what it heard, where it stood).
// Then three real captures, each through tools/record_views.cjs --minds exactly as the heartbeat
// runs it, against a stand-in for the Copilot chat endpoint, each sealed by tools/views_seal.py and
// verified from its evidence:
//   tick 1  three players think: the picture reaches a vision model and no other, every verb carries
//           a why, the seat's token never leaves the capture process, and the frame says exactly
//           what the exchange says.
//   tick 2  captured once and never sealed (a publish that failed), then again: the thought the
//           first attempt bought still counts, so the premium mind is over the day's budget and
//           rests where its last frame left it; a mind between thoughts rests and says why; and the
//           free mind remembers what it did and hears what the others said a tick ago.
//   tick 3  with no seat nobody is asked anything, but the world does not stop: each body runs the
//           routine it was left, to the centimetre where anyone playing the line forward puts it.
//   tick 4  night by the place's clock: every body in the hub sleeps in its bed, all of them at once,
//           each with its routine kept for the morning.
//   tick 5  day again: every body wakes where it slept, eyes level, into its routine.
//   tick 6  the one mind: a stand-in for headless copilot is asked once, with no tools and no custom
//           instructions, for one directive for every body; the capture carries it out and the
//           mind frame and every directed body are sealed from its words.
//   tick 7  the one mind does not answer: rules write the tick, and every body carries on.
//   tick 8  night: nobody is directed and nobody is asked, and the one mind folds the day into one
//           dream (tools/dream.py).
//   tick 9  the morning after it: every body wakes saying its line from the dream, word for word,
//           and the mind frame names the dream it remembers instead of the day.
//
//   node tests/minds.cjs     (PLAYWRIGHT_DIR as for the suites; BROWSER_CHANNEL=chrome to use an installed Chrome)
const { createRequire } = require('module');
const { execFileSync, spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const ROOT = path.resolve(__dirname, '..');
const minds = require(path.join(ROOT, 'tools', 'minds.cjs'));
const PYTHON = process.env.PYTHON || 'python3';
const TOKEN = 'test-seat-token-' + Math.random().toString(36).slice(2);

const checks = [];
function check(name, passed, detail) {
  checks.push(!!passed);
  console.log((passed ? '  ok ' : '  not ok ') + name + (!passed && detail ? '\n      ' + detail : ''));
}

// ── the planner, from a line it did not write ────────────────────────────────
const NOW = Date.parse('2026-09-25T12:00:00.000Z');
const frame = (tick, minutesAgo, players) => ({
  utc: new Date(NOW - minutesAgo * 60000).toISOString(), payload: { tick, views: { players } } });
const thought = (id, cost, said, extra) => Object.assign({ id, mind: { kind: 'model', multiplier_x100: cost, said,
  did: [{ verb: 'world_walk', why: 'toward the portals', failed: false }] } }, extra || {});
const line = [
  frame(1, 26 * 60, [thought('ada', 100, 'yesterday')]),                 // outside the day: not counted
  frame(2, 30, [thought('ada', 100, 'first'), thought('bo', 0, 'hi ada')]),
  frame(3, 20, [thought('ada', 100, 'second', { at: { x_cm: 5, y_cm: 160, z_cm: -7, yaw_mrad: 3, pitch_mrad: 0 } }),
                { id: 'cy', mind: { kind: 'rest', why: 'resting' } }]),
  frame(4, 10, [{ id: 'ada', mind: { kind: 'rest', why: 'resting' } }, thought('bo', 0, 'still here')]),
];
const config = { cap_x100: 250, players: {
  ada: { model: 'premium', every: 1, multiplier_x100: 100 },
  bo: { model: 'free', every: 1, multiplier_x100: 0, vision: false },
  cy: { model: 'premium', every: 3, multiplier_x100: 100 },
  dee: { every: 1 } } };
let plan = minds.plan(config, line, { now: NOW, seat: true });
check('the day\'s spending is read from the line, and only the last day of it',
  plan.spent_x100 === 200 && plan.cap_x100 === 250, JSON.stringify(plan));
check('a premium mind over the day\'s budget rests and says so; a free mind thinks regardless',
  !plan.players.ada.think && /budget is spent/.test(plan.players.ada.why) && plan.players.bo.think &&
  !plan.players.bo.vision, JSON.stringify(plan.players));
check('a mind never thought before is due at once; one with no model chosen rests and says why',
  plan.players.cy.since === null && /budget/.test(plan.players.cy.why) && !plan.players.dee.think &&
  /no model chosen/.test(plan.players.dee.why), JSON.stringify(plan.players));
check('a mind remembers its own last thoughts, hears what the others said last tick, and stands where it last stood',
  plan.players.ada.memory.map(m => m.said).join('|') === 'yesterday|first|second' &&
  plan.players.ada.memory[2].did[0] === 'world_walk: toward the portals' &&
  plan.players.ada.heard.length === 1 && plan.players.ada.heard[0].who === 'bo' && plan.players.ada.heard[0].said === 'still here' &&
  plan.players.ada.restore && plan.players.ada.restore.x_cm === 5 && plan.players.bo.restore === null,
  JSON.stringify(plan.players.ada));
plan = minds.plan(Object.assign({}, config, { cap_x100: 10000 }), line, { now: NOW, seat: true });
const every = n => minds.plan({ cap_x100: 10000, players: { ada: { model: 'm', every: n } } }, line,
  { now: NOW, seat: true }).players.ada;
check('a cadence is kept from the line: two ticks after a thought, every 3 still rests and every 2 thinks',
  plan.players.ada.think && plan.players.ada.since === 1 && every(2).think && !every(3).think &&
  every(3).why === 'resting between thoughts (thinks every 3 ticks)', JSON.stringify([plan.players.ada, every(3)]));
plan = minds.plan(config, line, { now: NOW, seat: false });
check('with no seat, nobody thinks, and every mind says why',
  Object.values(plan.players).every(p => !p.think && p.why === 'no Copilot seat to think on') &&
  Object.values(minds.plan(config, line, { now: NOW, seat: false,
    seatWhy: 'no thinking this tick: Copilot refused this seat (HTTP 401)' }).players)
    .every(p => !p.think && p.why === 'no thinking this tick: Copilot refused this seat (HTTP 401)'),
  JSON.stringify(plan.players));
check('a cut never splits a character in two, so the sealer can always encode it',
  minds.clip('ab😀😀c', 4) === 'ab😀…' && minds.clip('ab😀😀', 4) === 'ab😀😀');
const P0 = minds.Playout;
const hour = h => new Date(NOW - h * 3600000).toISOString();
const premium = { cap_x100: 300, players: { ada: { model: 'premium', every: 1, multiplier_x100: 100 } } };
check('what this machine paid for and never sealed counts against the day, and the larger ledger wins',
  !minds.plan(premium, line, { now: NOW, seat: true, journal: [{ utc: hour(1), multiplier_x100: 300 }] }).players.ada.think &&
  minds.plan(premium, line, { now: NOW, seat: true, journal: [{ utc: hour(1), multiplier_x100: 100 },
    { utc: hour(30), multiplier_x100: 900 }] }).players.ada.think);
const journalFile = path.join(os.tmpdir(), 'minds-journal-' + process.pid + '.jsonl');
fs.writeFileSync(journalFile, [{ utc: hour(1), multiplier_x100: 100 }, { utc: hour(72), multiplier_x100: 100 }]
  .map(entry => JSON.stringify(entry)).join('\n') + '\nnot json\n');
const kept = minds.readJournal(journalFile, NOW);
check('the journal keeps two days and forgets the rest',
  kept.length === 1 && fs.readFileSync(journalFile, 'utf8').trim().split('\n').length === 1);
fs.rmSync(journalFile, { force: true });

// A cadence longer than the default read-back: the line is read as far back as the config needs.
const deep = fs.mkdtempSync(path.join(os.tmpdir(), 'minds-line-'));
const E = 288, N = 900, thoughtAt = new Set([100, 649]);
const deepFrame = seq => ({ utc: new Date(NOW - (N - seq) * 600000).toISOString(), payload: { tick: seq, views: {
  players: [thoughtAt.has(seq) ? thought('ada', 100, 'at ' + seq) : { id: 'ada', mind: { kind: 'rest', why: 'resting' } }] } } });
fs.mkdirSync(path.join(deep, 'epochs'));
fs.writeFileSync(path.join(deep, 'epochs', '0.jsonl'), Array.from({ length: E }, (_, i) => JSON.stringify(deepFrame(i))).join('\n') + '\n');
for (let seq = E; seq < N; seq++) fs.writeFileSync(path.join(deep, seq + '.json'), JSON.stringify(deepFrame(seq)));
fs.writeFileSync(path.join(deep, 'HEAD.json'), JSON.stringify({ count: N, epoch_size: E, sealed_epochs: 1 }));
const slow = { cap_x100: 100000, players: { ada: { model: 'premium', every: 288, multiplier_x100: 100 } } };
const deepLine = minds.readLine(deep, minds.lookback(slow));
const deepPlan = minds.prepare(slow, deep, { now: NOW, seat: true });
check('a mind that thinks every 288 ticks is read back far enough to know it thought 250 ticks ago, and what it said',
  deepLine.length === 3 * 288 + 1 && !deepPlan.players.ada.think && deepPlan.players.ada.since === 250 && deepPlan.tick === N &&
  deepPlan.players.ada.memory.map(m => m.tick).join() === '100,649' &&
  minds.plan(slow, minds.readLine(deep, 200), { now: NOW, seat: true }).players.ada.think,
  JSON.stringify({ length: deepLine.length, ada: deepPlan.players.ada }));
fs.rmSync(deep, { recursive: true, force: true });

// A routine is made canonical twice, by the capture in JavaScript and by the sealer in Python, and
// the two must agree on every input a model might write, or a routine would run as one thing and be
// sealed as another.
const ROUTINES = [
  [{ do: 'walk', dir: 'forward', ms: 1800.9 }, { do: 'look', dx: -0.5 }, { do: 'wait', ms: 1e30 }],
  [{ do: 'look', dx: 99999, dy: -99999 }, { do: 'wait', ms: 50 }],
  [{ do: 'walk', dir: 'up', ms: 500 }],
  [{ do: 'walk', dir: 'left', ms: '500' }],
  [{ do: 'walk', dir: 'left', ms: true }],
  [{ do: 'look', dx: null }],
  [{ do: 'look' }, { do: 'look' }],
  [{ do: 'wait', ms: 299 }],
  [{ do: 'fly', ms: 500 }],
  [[{ do: 'wait', ms: 500 }]],
  [],
  Array.from({ length: 9 }, () => ({ do: 'wait', ms: 500 })),
  [{ do: 'wait', ms: -0.9 }, { do: 'walk', dir: 'back', ms: 3000, extra: 'ignored' }],
  'not a list',
];
let parity = 'unchecked';
try {
  const python = JSON.parse(execFileSync(PYTHON, ['-c', `import sys, json; sys.path.insert(0, "tools"); import views_seal as V
print(json.dumps([V.canonical_routine(r) for r in json.loads(sys.stdin.read())]))`], { cwd: ROOT, encoding: 'utf8',
    input: JSON.stringify(ROUTINES) }));
  const js = ROUTINES.map(r => minds.Playout.canonical(r));
  parity = ROUTINES.map((r, i) => JSON.stringify(js[i]) === JSON.stringify(python[i]) ? '' : `#${i}: js ${JSON.stringify(js[i])} python ${JSON.stringify(python[i])}`)
    .filter(Boolean).join('; ');
} catch (error) { parity = String(error.message || error); }
check('the capture and the sealer make every routine a model might write canonical in exactly the same way', parity === '', parity);
let equal = 'unchecked';
try {
  const py = JSON.parse(execFileSync(PYTHON, ['-c', `import sys, json; sys.path.insert(0, "tools"); import views_seal as V
text = '[{"do":"wait","ms":1' + '0' * 309 + '}]'
print(json.dumps({"defaults": V.DEFAULT_ROUTINES, "huge": V.canonical_routine(json.loads(text)),
                  "beds": {k: V.bed(k) for k in ["wanderer", "greeter", "pilgrim", "watcher", "nobody"]}}))`],
    { cwd: ROOT, encoding: 'utf8' }));
  const ids = ['wanderer', 'greeter', 'pilgrim', 'watcher'];
  const huge = minds.Playout.canonical(JSON.parse('[{"do":"wait","ms":1' + '0'.repeat(309) + '}]'));
  equal = ids.filter(id => JSON.stringify(py.defaults[id]) !== JSON.stringify(minds.Playout.defaultRoutine(id))).join(', ')
    + ids.concat('nobody').filter(id => JSON.stringify(py.beds[id]) !== JSON.stringify(minds.Playout.bed(id)))
      .map(id => ' bed of ' + id).join('')
    + (JSON.stringify(py.huge) !== JSON.stringify(huge) ? ' huge: js ' + JSON.stringify(huge) + ' python ' + JSON.stringify(py.huge) : '');
} catch (error) { equal = String(error.message || error); }
check('the world\'s default routines and its beds are the same in the playout and the sealer, and a number too big for JavaScript is too big for both',
  equal === '', equal);
// What the one mind told every body is derived twice, by the capture that carries it out and by the
// sealer, and the two must agree on every answer a model might write.
const ANSWERS = [
  'Sure. {"bodies": {"wanderer": {"say": "hi", "act": [{"do": "walk", "dir": "forward", "ms": 900.7}], ' +
    '"routine": [{"do": "wait", "ms": 500}]}, "ghost": {"say": "boo"}}} Hope that helps!',
  '{"bodies": {"wanderer": {"say": "  lots   of\\t space\\u2028here  ", "act": [{"do": "walk", "dir": "back", "ms": 3000}, ' +
    '{"do": "walk", "dir": "back", "ms": 3000}, {"do": "wait", "ms": 100}]}}}',
  '{"bodies": {"wanderer": {"say": "' + 'x'.repeat(200) + '"}}}',
  '{"bodies": {"wanderer": {"say": 42, "routine": [{"do": "wait", "ms": 200}]}}}',
  '{"bodies": []}', '[]', 'no json at all', '{"bodies": {"wanderer": {"say": "a"}}',
  '{"bodies": {"wanderer": {"say": "\\ud800 lone"}}}', '{"bodies": {"wanderer": {"say": "😀😀"}}}',
  '{"bodies": {"wanderer": {"say": NaN}}}', '{"bodies": {"wanderer": {"act": [{"do": "look", "dx": 1e400}]}}}',
  '{"bodies": {"wanderer": {"act": [{"do": "look", "dx": -0.9, "dy": 599.9}]}}}',
  '{"bodies": {"wanderer": {"say": "x"}}, "deep": ' + '['.repeat(130) + ']'.repeat(130) + '}',
  '{"bodies": {"wanderer": {"say": "x"}}}\u2028', '{"bodies": {"wanderer": {"say": "x"}}}\ud800',
  'x'.repeat(4001), '{"bodies": {"wanderer": {}, "greeter": {"say": " "}}}',
  '{"bodies": {"wanderer": {"say": "one"}, "wanderer": {"say": "two"}}}',
  '{"bodies": {"greeter": {"act": [{"do": "wait", "ms": 10000}]}, "pilgrim": {"routine": "walk"}}}',
];
let directed = 'unchecked';
try {
  const awake = ['greeter', 'pilgrim', 'wanderer'];
  const python = JSON.parse(execFileSync(PYTHON, ['-c', `import sys, json; sys.path.insert(0, "tools"); import views_seal as V
answers, awake = json.loads(sys.stdin.read())
print(json.dumps([V.directive(a, awake) for a in answers]))`], { cwd: ROOT, encoding: 'utf8', input: JSON.stringify([ANSWERS, awake]) }));
  const js = ANSWERS.map(a => minds.Playout.directive(a, awake));
  directed = ANSWERS.map((a, i) => JSON.stringify(js[i]) === JSON.stringify(python[i]) ? ''
    : `#${i}: js ${JSON.stringify(js[i])} python ${JSON.stringify(python[i])}`).filter(Boolean).join('; ');
  if (!directed && JSON.stringify(js[0]) !== JSON.stringify({ wanderer: { say: 'hi', act: [{ do: 'walk', dir: 'forward', ms: 900 }],
    routine: [{ do: 'wait', ms: 500 }] } })) directed = 'the first answer was not heard as it was meant: ' + JSON.stringify(js[0]);
} catch (error) { directed = String(error.message || error); }
check('the capture and the sealer hear exactly the same directive in every answer the one mind might give', directed === '', directed);

{
  const e = { id: 'wanderer', at: P0.bed('wanderer'), routine: { steps: P0.defaultRoutine('wanderer') }, clock: 'America/New_York' };
  const asleep = Date.parse('2026-09-24T10:50:30Z');           // 06:50:30 in New York
  const past = P0.stateAt(e, asleep, asleep + 599000);          // 07:00:29: a tick not quite ten minutes on
  // in a child with a deadline: a playout that looped forever would otherwise hang this suite instead of failing it
  let odd = null;
  try {
    odd = JSON.parse(execFileSync(process.execPath, ['-e', `const P = require(${JSON.stringify(path.join(ROOT, 'ai', 'playout.js'))});
      const e = { id: 'wanderer', clock: 'Mars/Olympus_Mons', routine: { steps: P.defaultRoutine('wanderer') }, at: P.bed('wanderer') };
      console.log(JSON.stringify({ nan: P.tracker(e, NaN)(Date.now()), later: P.cursor(P.bed('wanderer'), e.routine.steps)(NaN),
                                   clock: P.validClock('Mars/Olympus_Mons') }));`], { encoding: 'utf8', timeout: 5000 }));
  } catch (error) { odd = { error: String(error.message || error).slice(0, 200) }; }
  check('a tick a second past 07:00 finds the body awake, and a line with a clock or a time no engine can read cannot stop the playout',
    !past.asleep && past.since === Date.parse('2026-09-24T11:00:00Z') && past.pose.pitch_mrad === 0 &&
    odd && odd.nan && odd.nan.pose && odd.later && odd.clock === 'America/New_York', JSON.stringify({ past, odd }));
}

// A model that answered was paid for: if the hands fail after that, the thought is still sealed,
// with the picture it was shown found in the request itself.
const pixel = 'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAQAcJaQAA3AA/v3AgAA=';
const bought = { rounds: [{ status: 200, ms: 9, request: { model: 'premium', messages: [{ role: 'system', content: 'You are ada.' },
  { role: 'user', content: [{ type: 'text', text: 'PERCEPTS: {}' }, { type: 'image_url', image_url: { url: pixel } }] }] },
  response: { model: 'premium', message: { role: 'assistant', content: '' }, finish_reason: 'stop', usage: null, error: null } }] };
const failed = minds.evidence('ada', { model: 'premium', multiplier_x100: 100 }, bought,
  { saw: null, words: '', calls: [], voiced: null, note: 'the thought failed after the model answered: gone' }, 'saw.webp');
const failedFile = path.join(os.tmpdir(), 'minds-failed-' + process.pid + '.json');
fs.writeFileSync(failedFile, JSON.stringify(failed.exchange));
let sealedFailed = [{}, null];
try {
  sealedFailed = JSON.parse(execFileSync(PYTHON, ['-c', `import sys, json; sys.path.insert(0, "tools"); import views_seal as V
mind, picture = V.read_exchange(open(sys.argv[1], "rb").read(), "ada"); print(json.dumps([mind, picture]))`, failedFile],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
} catch (error) {
  sealedFailed = [{ refused: String(error.stderr || error.message).trim().split('\n').pop() }, null];
}
fs.rmSync(failedFile, { force: true });
check('a thought whose hands failed after the model answered is sealed as bought, with the picture it was shown',
  !!failed.sawBytes && sealedFailed[1] === minds.sha256(failed.sawBytes) && Array.isArray(sealedFailed[0].did) &&
  sealedFailed[0].did.length === 0 &&
  sealedFailed[0].multiplier_x100 === 100 && /failed after the model answered/.test(failed.exchange && failed.exchange.note),
  JSON.stringify(sealedFailed));

// ── a stand-in for the Copilot chat endpoint ─────────────────────────────────
const heardByStub = [];
const SCRIPT = {
  wanderer: { tool_calls: [['world_look', { dx: 80, why: 'turning toward the portals' }],
                           ['world_walk', { dir: 'forward', ms: 600, why: 'closer, to see them' }],
                           ['world_say', { text: 'Hello from wanderer 👋', why: 'the others should know I am here' }],
                           ['world_routine', { steps: [{ do: 'walk', dir: 'forward', ms: 1200.7 }, { do: 'look', dx: 400 },
                             { do: 'wait', ms: 500 }], why: 'patrol the portals until I think again' }]] },
  pilgrim: { tool_calls: [['world_travel', { portal: 'Crystal', why: 'somewhere new' }],
                          ['world_aim', { portal: 'Nowhere At All', why: 'a portal I made up' }],
                          ['world_say', { text: 'Is anyone near the portals?', why: 'looking for company' }],
                          ['world_routine', { steps: [{ do: 'fly', ms: 500 }], why: 'try to fly' }]] },
  greeter: { content: 'Welcome, everyone.',
             tool_calls: [['world_walk', { dir: 'forward', ms: 1500, why: 'meeting the newcomers' }]] },
};
const stub = http.createServer((request, response) => {
  let body = '';
  request.on('data', chunk => { body += chunk; });
  request.on('end', () => {
    const parsed = JSON.parse(body || '{}');
    const system = String(parsed.messages && parsed.messages[0] && parsed.messages[0].content || '');
    const who = (system.match(/^You are (\w+)/) || [])[1] || '?';
    heardByStub.push({ path: request.url, headers: request.headers, body: parsed, who });
    if (request.url !== '/chat/completions' || request.headers.authorization !== 'Bearer ' + TOKEN) {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      return response.end(JSON.stringify({ error: { message: 'unauthorized' } }));
    }
    const plan = SCRIPT[who] || { content: '' };
    const tool_calls = (plan.tool_calls || []).map(([name, args], i) =>
      ({ id: 'call_' + i, type: 'function', function: { name, arguments: JSON.stringify(args) } }));
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ model: parsed.model + '-2026-09', choices: [{ index: 0, finish_reason: 'tool_calls',
      message: { role: 'assistant', content: plan.content || '', tool_calls } }],
      usage: { prompt_tokens: Math.round(body.length / 4), completion_tokens: 20 + tool_calls.length } }));
  });
});

// ── the line the captures are sealed on ──────────────────────────────────────
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'minds-e2e-'));
const spine = path.join(out, 'spine'), chain = path.join(out, 'chain'), feedRoot = path.join(out, 'feed');
const feed = path.join(feedRoot, 'recordings', 'live');
for (const dir of [spine, chain, feedRoot]) fs.mkdirSync(dir, { recursive: true });
const configFile = path.join(out, 'minds.json');
// a stand-in for headless copilot: it writes down how it was asked and answers from a file
const fakeDir = path.join(out, 'fake-copilot');
fs.mkdirSync(fakeDir);
const fakeCopilot = path.join(fakeDir, 'copilot');
fs.writeFileSync(fakeCopilot, `#!${process.execPath}
const fs = require('fs'), path = require('path'), dir = ${JSON.stringify(fakeDir)};
fs.appendFileSync(path.join(dir, 'asked.jsonl'), JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }) + '\\n');
if (fs.existsSync(path.join(dir, 'fail'))) { process.stderr.write('stand-in: refusing on purpose'); process.exit(1); }
process.stdout.write(fs.readFileSync(path.join(dir, 'answer'), 'utf8'));
`);
fs.chmodSync(fakeCopilot, 0o755);
const askedOf = () => fs.existsSync(path.join(fakeDir, 'asked.jsonl'))
  ? fs.readFileSync(path.join(fakeDir, 'asked.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
const journal = path.join(out, 'journal.jsonl');
// A clock where it is day for hours yet, and one where it is night for hours yet, found now: the
// place keeps one or the other, and every body in it keeps the place's.
const ZONES = ['Pacific/Honolulu', 'America/Los_Angeles', 'America/New_York', 'America/Sao_Paulo', 'Europe/London',
  'Europe/Berlin', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland'];
const hourIn = tz => Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' })
  .format(new Date())) % 24;
const DAY = ZONES.find(tz => hourIn(tz) >= 9 && hourIn(tz) <= 19);
const NIGHT = ZONES.find(tz => hourIn(tz) >= 0 && hourIn(tz) <= 4);
const writeConfig = (clock, mind) => fs.writeFileSync(configFile, JSON.stringify({ cap_x100: 300, clock, mind, players: {
  wanderer: { model: 'stub-premium', every: 1, multiplier_x100: 100, vision: true },
  greeter: { model: 'stub-free', every: 1, multiplier_x100: 0, vision: false },
  pilgrim: { model: 'stub-premium', every: 3, multiplier_x100: 100, vision: true } } }));
writeConfig(DAY);
const P = minds.Playout;
const frameAt = f => Date.parse(f.payload.views.captured_utc);
// where anyone playing a frame forward, under the clock its place kept, puts a body at the next frame's moment
const played = (prev, id, prevFrame, nextFrame) => P.stateAt(Object.assign({}, prev, { id,
  clock: prevFrame.payload.views.clock }), frameAt(prevFrame), frameAt(nextFrame)).pose;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const py = (code, ...args) => execFileSync(PYTHON, ['-c', code, ...args], { cwd: ROOT, encoding: 'utf8' });
const mintTick = () => py(`import sys, datetime; sys.path.insert(0, "tests"); import views_fixture as FX
FX.add_tick(sys.argv[1], datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=2))`, spine);
const seal = (tick) => {
  const anchor = path.join(out, `anchor-${tick}.json`), receipt = path.join(out, `receipt-${tick}.json`);
  execFileSync(PYTHON, ['tools/views_seal.py', 'anchor', '--spine', spine, '--chain', chain, '--out', anchor], { cwd: ROOT });
  execFileSync(PYTHON, ['tools/views_seal.py', 'seal', '--anchor', anchor, '--receipt', receipt, '--feed-dir', feed,
    '--chain', chain, '--feed-url', 'https://example.test/live/'], { cwd: ROOT });
  const head = JSON.parse(fs.readFileSync(path.join(chain, 'HEAD.json'), 'utf8'));
  return JSON.parse(fs.readFileSync(path.join(chain, (head.count - 1) + '.json'), 'utf8'));
};
const verify = () => {
  try {
    return { code: 0, out: execFileSync(PYTHON, ['tools/views_seal.py', 'verify', '--chain', chain, '--spine', spine,
      '--feed', feed], { cwd: ROOT, encoding: 'utf8' }) };
  } catch (error) {
    return { code: error.status, out: String(error.stdout || '') + String(error.stderr || '') };
  }
};
function capture(tick, withSeat, port) {
  const env = Object.assign({}, process.env);
  delete env.NEXUS_MIND_TOKEN;
  delete env.NEXUS_MIND_API;
  if (withSeat) Object.assign(env, { NEXUS_MIND_API: `http://127.0.0.1:${port}`, NEXUS_MIND_TOKEN: TOKEN });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'tools', 'record_views.cjs'), '--players', '4', '--seconds', '1',
      '--fps', '1', '--width', '360', '--quality', '0.62', '--output-root', feedRoot, '--stream', 'recordings/live',
      '--max-frames', '2016', '--tick-seconds', '600', '--receipt', path.join(out, `receipt-${tick}.json`),
      '--minds', configFile, '--line', chain, '--journal', journal,
      // CI captures in the runner's own Chrome, exactly as the Actions fallback publisher does
      ...(process.env.BROWSER_CHANNEL ? ['--browser-channel', process.env.BROWSER_CHANNEL] : [])], { cwd: ROOT, env });
    let log = '';
    child.stdout.on('data', chunk => { log += chunk; });
    child.stderr.on('data', chunk => { log += chunk; });
    child.on('exit', code => code === 0 ? resolve(log) : reject(new Error(`capture ${tick} exited ${code}:\n${log}`)));
  });
}
const byId = f => Object.fromEntries(f.payload.views.players.map(p => [p.id, p]));
const lastDoingOf = id => {
  const live = JSON.parse(fs.readFileSync(path.join(feed, 'manifest.json'), 'utf8')).players.find(x => x.id === id);
  return live.doing[live.doing.length - 1];
};
const percepts = request => {
  const content = request.body.messages[1].content;
  const text = Array.isArray(content) ? content[0].text : content;
  return JSON.parse(text.replace(/^PERCEPTS: /, ''));
};
const everyFile = dir => fs.readdirSync(dir, { recursive: true }).map(f => path.join(dir, f))
  .filter(f => fs.statSync(f).isFile());

(async () => {
// a minded page stays in its world, whatever tries to take it elsewhere
{
  const load = () => {
    for (const base of [process.env.PLAYWRIGHT_DIR].filter(Boolean)) {
      const candidate = createRequire(path.join(base, 'package.json'));
      for (const name of ['playwright', 'playwright-core']) { try { return candidate(name); } catch (error) {} }
    }
    return require('playwright');
  };
  const { chromium } = load();
  const browser = await chromium.launch(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {});
  const page = await browser.newPage();
  await page.route('https://held.test/**', route => route.fulfill({ status: 200, contentType: 'text/html',
    body: '<p>the world</p><script>window.here = "the world"</script>' }));
  await page.goto('https://held.test/world.html');
  await minds.holdInWorld(page);
  await page.evaluate(() => { location.href = 'https://held.test/elsewhere.html'; });
  await page.waitForTimeout(800);
  const still = await page.evaluate(() => window.here + ' ' + location.pathname).catch(error => 'gone: ' + error.message);
  check('a minded page cannot be taken out of its world: the document its eyes are captured from stays',
    still === 'the world /world.html' && page.url() === 'https://held.test/world.html', still + ' ' + page.url());
  await browser.close();
}

await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve));
const port = stub.address().port;

// tick 1: three minds think
mintTick();
// the charter beside the line, as it is beside views/ on main, anchored to this spine: the one mind
// answers to it, and a dream answers to the charter that stood at its tick
py(`import sys; sys.path.insert(0, "tools"); import intent as I
I.amend({k: v for k, v in I.newest()["payload"].items() if k not in ("tick", "tick_frame", "amended_because")},
        where=sys.argv[1], spine=sys.argv[2])`, path.join(out, 'intent'), spine);
let log = await capture(1, true, port);
let f1 = seal(1);
let p = byId(f1);
const asked1 = heardByStub.splice(0);
const askedBy = who => asked1.find(r => r.who === who);
check('each configured mind was asked once, on its own model, and the scripted player was not asked at all',
  asked1.length === 3 && askedBy('wanderer').body.model === 'stub-premium' && askedBy('greeter').body.model === 'stub-free' &&
  askedBy('pilgrim') && !askedBy('watcher'), JSON.stringify(asked1.map(r => [r.who, r.body.model])) + '\n' + log);
const eyes = askedBy('wanderer').body.messages[1].content;
check('a vision mind is shown what its eyes see, as a picture beside its percepts; a mind without vision is not',
  Array.isArray(eyes) && eyes[1].type === 'image_url' && /^data:image\/webp;base64,/.test(eyes[1].image_url.url) &&
  askedBy('wanderer').headers['copilot-vision-request'] === 'true' &&
  typeof askedBy('greeter').body.messages[1].content === 'string' && !askedBy('greeter').headers['copilot-vision-request'],
  JSON.stringify(askedBy('greeter').headers));
check('every verb a mind may call asks it why; it may leave a routine running, and is never offered travel out of its world',
  asked1.every(r => r.body.tools.length >= 10 && r.body.tools.every(t => t.function.parameters.properties.why) &&
    !r.body.tools.some(t => t.function.name === 'world_travel') &&
    r.body.tools.some(t => t.function.name === 'world_routine')),
  JSON.stringify(asked1[0].body.tools.map(t => t.function.name)));
const leaked = [...everyFile(feedRoot), ...everyFile(chain), ...fs.readdirSync(out).filter(f => f.endsWith('.json'))
  .map(f => path.join(out, f))].filter(f => fs.readFileSync(f).includes(TOKEN));
check('the seat\'s token reaches the model endpoint and nothing else: not the feed, the receipt, the evidence or the line',
  leaked.length === 0 && !log.includes(TOKEN) && asked1.every(r => !JSON.stringify(r.body).includes(TOKEN)), leaked.join(' '));
check('the call is made by the capture process, never by the page: no request carries a browser\'s origin',
  asked1.every(r => !r.headers.origin && !r.headers.referer && !/Mozilla|Chrome/.test(r.headers['user-agent'] || '')),
  JSON.stringify(asked1.map(r => [r.headers['user-agent'], r.headers.origin, r.headers.referer])));
const w = p.wanderer.mind, g = p.greeter.mind, pi = p.pilgrim.mind;
check('the frame says who answered and what it did, why, and what it said, exactly as the exchange has it',
  w.asked === 'stub-premium' && w.model === 'stub-premium-2026-09' && w.said === 'Hello from wanderer 👋' &&
  w.did.map(d => d.verb + ':' + d.why + ':' + d.failed).join('|') ===
    'world_look:turning toward the portals:false|world_walk:closer, to see them:false|world_say:the others should know I am here:false' +
    '|world_routine:patrol the portals until I think again:false' &&
  w.saw && w.exchange && w.tokens_out === 24, JSON.stringify(w));
check('a verb it was not given and a verb the hands could not do are sealed as failed, and words said without a say are said for it',
  pi.did[0].verb === 'world_travel' && pi.did[0].failed === true && pi.did[1].verb === 'world_aim' && pi.did[1].failed === true &&
  pi.said === 'Is anyone near the portals?' && p.pilgrim.doing === '🧠 stub-premium-2026-09: travel, aim, say, routine' &&
  g.said === 'Welcome, everyone.' && !g.saw && p.greeter.doing === '🧠 stub-free-2026-09: walk', JSON.stringify({ pi, g }));
check('the scripted player keeps its script, and the ledger counts the thoughts and what they cost',
  !p.watcher.mind && !p.watcher.at && f1.payload.views.thoughts === 3 && f1.payload.views.premium_x100 === 200,
  JSON.stringify(f1.payload.views));
const patrol = [{ do: 'walk', dir: 'forward', ms: 1200 }, { do: 'look', dx: 400, dy: 0 }, { do: 'wait', ms: 500 }];
check('a routine a mind sets is sealed as it runs, from its tick, in the name of the model that answered',
  same(w.routine_set, patrol) && same(p.wanderer.routine, { steps: patrol, set_at: f1.payload.tick, by: 'stub-premium-2026-09' }),
  JSON.stringify({ set: w.routine_set, routine: p.wanderer.routine }));
check('a routine the hands refuse changes nothing: the body keeps the world\'s default until a mind sets one it can run',
  pi.did[3].verb === 'world_routine' && pi.did[3].failed === true && !('routine_set' in pi) &&
  same(p.pilgrim.routine, { steps: P.defaultRoutine('pilgrim'), set_at: null, by: 'default' }) &&
  same(p.greeter.routine, { steps: P.defaultRoutine('greeter'), set_at: null, by: 'default' }),
  JSON.stringify({ pilgrim: p.pilgrim.routine, greeter: p.greeter.routine }));
const woke = percepts(askedBy('wanderer'));
check('a body the line has never seen wakes in its own bed, and its mind is told its routine and the clock of its place',
  Math.abs(woke.me.x - 17) <= 1 && Math.abs(woke.me.z - 17) <= 1 && woke.your_routine.set_by === 'default' &&
  same(woke.your_routine.steps, P.defaultRoutine('wanderer')) &&
  /, the hub's clock: everyone here sleeps from 23:00 to 07:00$/.test(woke.your_clock) &&
  f1.payload.views.clock === DAY && !Object.values(p).some(x => 'clock' in x),
  JSON.stringify({ me: woke.me, at: [p.wanderer.at, p.greeter.at, p.pilgrim.at], routine: woke.your_routine,
    clock: woke.your_clock, sealed: f1.payload.views.clock }) + '\n' + log);
const manifest = JSON.parse(fs.readFileSync(path.join(feed, 'manifest.json'), 'utf8'));
const lastDoing = id => { const q = manifest.players.find(x => x.id === id); return q.doing[q.doing.length - 1]; };
check('the feed says what the frame says, before its seal and after it',
  ['wanderer', 'greeter', 'pilgrim'].every(id => lastDoing(id) === p[id].doing), JSON.stringify(manifest.players.map(q => q.doing)));
let verified = verify();
check('the line verifies, every thought derived again from its evidence',
  verified.code === 0 && /minds: 3 thought\(s\) say exactly what their evidence says/.test(verified.out), verified.out);

// tick 2: one capture that is never sealed, as when its publish fails, then the one that is
mintTick();
await capture(2, true, port);
const unsealed = heardByStub.splice(0);
log = await capture(2, true, port);
const f2 = seal(2);
const q = byId(f2);
const asked2 = heardByStub.splice(0);
const paid = fs.readFileSync(journal, 'utf8').trim().split('\n').map(line => JSON.parse(line));
check('a thought bought by a capture that was never sealed still counts: the next capture does not buy it again',
  unsealed.map(r => r.who).sort().join() === 'greeter,wanderer' && paid.length === 6 &&
  paid.reduce((sum, entry) => sum + entry.multiplier_x100, 0) === 300 && q.wanderer.mind.kind === 'rest' &&
  // and from the line alone, as it stood before this tick, it would have been bought twice
  minds.plan(JSON.parse(fs.readFileSync(configFile, 'utf8')), minds.readLine(chain).slice(0, -1), { seat: true }).players.wanderer.think,
  JSON.stringify({ unsealed: unsealed.map(r => r.who), paid }) + '\n' + log);
check('over the day\'s budget a premium mind rests, between thoughts a mind rests, and each says why',
  q.wanderer.mind.kind === 'rest' && /budget is spent/.test(q.wanderer.mind.why) &&
  q.pilgrim.mind.kind === 'rest' && q.pilgrim.mind.why === 'resting between thoughts (thinks every 3 ticks)' &&
  asked2.length === 1 && asked2[0].who === 'greeter' && f2.payload.views.thoughts === 1 && f2.payload.views.premium_x100 === 0,
  JSON.stringify({ asked: asked2.map(r => r.who), wanderer: q.wanderer.mind, pilgrim: q.pilgrim.mind }) + '\n' + log);
const near = (a, b, cm, mrad) => a && b && Math.abs(a.x_cm - b.x_cm) <= cm && Math.abs(a.z_cm - b.z_cm) <= cm &&
  Math.abs(a.yaw_mrad - b.yaw_mrad) <= mrad;
const aheadW = played(p.wanderer, 'wanderer', f1, f2), aheadP = played(p.pilgrim, 'pilgrim', f1, f2);
check('between thoughts a body runs its routine, and the next frame finds it exactly where anyone playing the last one forward puts it',
  same(q.wanderer.at, aheadW) && same(q.pilgrim.at, aheadP) && !same(q.pilgrim.at, p.pilgrim.at) &&
  same(q.wanderer.routine, p.wanderer.routine) && same(q.pilgrim.routine, p.pilgrim.routine) &&
  q.wanderer.doing === "↻ stub-premium-2026-09's routine: walk, look, wait" &&
  q.pilgrim.doing === '↻ default routine: walk, wait, look',
  JSON.stringify({ sealed: [q.wanderer.at, q.pilgrim.at], played: [aheadW, aheadP], doing: [q.wanderer.doing, q.pilgrim.doing] }));
const seen = percepts(asked2[0]);
// how far a walk goes depends on the frame rate (a slow CI renderer walks a few centimetres a
// second), so moving is judged against the same 5 cm a resting body is held to, not a distance
const aheadG = played(p.greeter, 'greeter', f1, f2);
check('a thinking body wakes into the day where its routine took it, and its mind moves it on from there',
  Math.abs(seen.me.x * 100 - aheadG.x_cm) <= 100 && Math.abs(seen.me.z * 100 - aheadG.z_cm) <= 100 &&
  q.greeter.mind.did[0].verb === 'world_walk' && q.greeter.mind.did[0].failed === false &&
  !near(q.greeter.at, aheadG, 5, 5), JSON.stringify({ seen: seen.me, played: aheadG, after: q.greeter.at }));
check('a mind remembers what it did and why, and hears what the others said a tick ago',
  seen.you_recently.length === 1 && seen.you_recently[0].said === 'Welcome, everyone.' &&
  seen.you_recently[0].did[0] === 'world_walk: meeting the newcomers' &&
  seen.you_heard.map(h => h.who + ': ' + h.said).sort().join(' / ') ===
    'pilgrim: Is anyone near the portals? / wanderer: Hello from wanderer 👋', JSON.stringify(seen));

// tick 3: no seat, in the day
mintTick();
log = await capture(3, false, port);
const f3 = seal(3);
const r3 = byId(f3);
const MINDED = ['wanderer', 'greeter', 'pilgrim'];
check('with no seat nobody is asked anything, and the bodies still run their routines exactly as anyone plays them',
  heardByStub.length === 0 && f3.payload.views.thoughts === 0 &&
  MINDED.every(id => r3[id].mind.kind === 'rest' && r3[id].mind.why === 'no Copilot seat to think on' &&
    same(r3[id].at, played(q[id], id, f2, f3)) && same(r3[id].routine, q[id].routine)),
  JSON.stringify(r3) + '\n' + log);

// tick 4: night, by the one clock of the place
writeConfig(NIGHT);
mintTick();
log = await capture(4, false, port);
const f4 = seal(4);
const r4 = byId(f4);
check('at night by the clock of their place, every body in it sleeps in its bed at once, eyes on the sky, its routine kept for the morning',
  f4.payload.views.clock === NIGHT && !Object.values(r4).some(x => 'clock' in x) &&
  MINDED.every(id => r4[id].mind.kind === 'sleep' && /^asleep: night in /.test(r4[id].mind.why) &&
    same(r4[id].at, P.bed(id)) && same(r4[id].routine, r3[id].routine) &&
    r4[id].doing === '💤 ' + r4[id].mind.why && lastDoingOf(id) === r4[id].doing) &&
  new Set(MINDED.map(id => r4[id].mind.why)).size === 1,
  JSON.stringify(r4) + '\n' + log);

// tick 5: day again
writeConfig(DAY);
mintTick();
log = await capture(5, false, port);
const f5 = seal(5);
const r5 = byId(f5);
check('when the clock of their place says day, every body wakes where it slept, eyes level, into the routine it was left',
  f5.payload.views.clock === DAY &&
  MINDED.every(id => r5[id].mind.kind === 'rest' && same(r5[id].at, Object.assign(P.bed(id), { pitch_mrad: 0 })) &&
    same(r5[id].routine, r4[id].routine) && r5[id].doing === minds.routineLine(r5[id].routine)),
  JSON.stringify(r5) + '\n' + log);
verified = verify();
check('and the whole line of five ticks verifies from its evidence',
  verified.code === 0 && /line: 5 frame\(s\) verify/.test(verified.out), verified.out);

// tick 6: the one mind directs every body
const ONE = { model: 'stub-mind', copilot: fakeCopilot };
fs.writeFileSync(path.join(fakeDir, 'answer'), 'Here you go: {"bodies": {"wanderer": {"say": "Greeter! Race you to the portals.", ' +
  '"act": [{"do": "walk", "dir": "forward", "ms": 1500}], "routine": [{"do": "walk", "dir": "forward", "ms": 1000}, ' +
  '{"do": "look", "dx": 500}]}, "greeter": {"say": "You are on."}, "ghost": {"say": "boo"}}}');
writeConfig(DAY, ONE);
mintTick();
log = await capture(6, false, port);
const f6 = seal(6);
const r6 = byId(f6);
const asked6 = askedOf();
const argv = asked6.length ? asked6[0].argv : [];
const told6 = argv[argv.indexOf('-p') + 1] || '';
check('the one mind is woken headless once, on its own model, with no tools and no custom instructions, away from the repo',
  asked6.length === 1 && argv.includes('--available-tools=') && argv.includes('--no-custom-instructions') &&
  argv.includes('--no-ask-user') && argv[argv.indexOf('--model') + 1] === 'stub-mind' &&
  !asked6[0].cwd.startsWith(ROOT) && heardByStub.length === 0, JSON.stringify(asked6) + '\n' + log);
check('it is shown the charter it answers to, where every body is, and what they said lately',
  told6.includes('everyone in one place shares one clock') && told6.includes('Where the bodies are now:') &&
  told6.includes('- wanderer: ') && told6.includes("the hub's clock") && told6.includes('Said lately'),
  told6.slice(0, 600));
const mindChain = path.join(out, 'mind');
const readMind = seq => JSON.parse(fs.readFileSync(path.join(mindChain, seq + '.json'), 'utf8'));
const m6 = fs.existsSync(path.join(mindChain, '0.json')) ? readMind(0) : { payload: {} };
const race = [{ do: 'walk', dir: 'forward', ms: 1000 }, { do: 'look', dx: 500, dy: 0 }];
check('the mind frame is sealed from its words, and every body it directed says exactly what it was told',
  f6.payload.views.mind && f6.payload.views.mind.seq === 0 && f6.payload.views.mind.frame_hash === m6.frame_hash &&
  m6.payload.by && m6.payload.by.kind === 'model' && m6.payload.by.asked === 'stub-mind' &&
  same(m6.payload.bodies, { greeter: { say: 'You are on.' }, wanderer: { say: 'Greeter! Race you to the portals.',
    act: [{ do: 'walk', dir: 'forward', ms: 1500 }], routine: race } }) &&
  same(r6.wanderer.mind, { kind: 'directed', by: 'stub-mind', said: 'Greeter! Race you to the portals.',
    act: [{ do: 'walk', dir: 'forward', ms: 1500 }], routine_set: race }) &&
  same(r6.wanderer.routine, { steps: race, set_at: f6.payload.tick, by: 'stub-mind' }) &&
  r6.greeter.mind.said === 'You are on.' && r6.pilgrim.mind.said === '' && r6.pilgrim.doing === minds.routineLine(r6.pilgrim.routine) &&
  r6.wanderer.doing === '🧠 stub-mind: say, walk, routine' && lastDoingOf('wanderer') === r6.wanderer.doing,
  JSON.stringify({ mind: m6.payload, r6 }) + '\n' + log);
const startW = played(r5.wanderer, 'wanderer', f5, f6);
check('the capture carries the directive out by the same hands a visitor has: the wanderer walked where it was told',
  !near(r6.wanderer.at, startW, 5, 5) && near(r6.greeter.at, played(r5.greeter, 'greeter', f5, f6), 5, 5),
  JSON.stringify({ start: startW, after: r6.wanderer.at }));
verified = verify();
check('the line and the one mind\'s line verify, each mind frame derived again from the evidence in the feed',
  verified.code === 0 && /the one mind: 1 frame\(s\) verify/.test(verified.out) &&
  /minds: \d+ thought\(s\) say exactly what their evidence says/.test(verified.out), verified.out);

// tick 7: the one mind does not answer
fs.writeFileSync(path.join(fakeDir, 'fail'), '1');
mintTick();
log = await capture(7, false, port);
const f7 = seal(7);
const r7 = byId(f7);
const m7 = fs.existsSync(path.join(mindChain, '1.json')) ? readMind(1) : { payload: {} };
check('when the one mind does not answer, rules write the tick: every body carries on with the routine it was left',
  askedOf().length === 2 && m7.payload.by && m7.payload.by.kind === 'rules' && /did not answer \(exit 1\)/.test(m7.payload.by.why) &&
  same(m7.payload.bodies, {}) && f7.payload.views.mind.seq === 1 &&
  MINDED.every(id => r7[id].mind.kind === 'directed' && r7[id].mind.by === 'rules' && r7[id].mind.said === '' &&
    same(r7[id].routine, r6[id].routine) && same(r7[id].at, played(r6[id], id, f6, f7))),
  JSON.stringify({ mind: m7.payload, r7 }) + '\n' + log);

// tick 8: night
fs.rmSync(path.join(fakeDir, 'fail'));
writeConfig(NIGHT, ONE);
mintTick();
log = await capture(8, false, port);
const f8 = seal(8);
const r8 = byId(f8);
check('at night nobody is directed and nobody is asked: every body sleeps, and the one mind writes no frame',
  askedOf().length === 2 && !f8.payload.views.mind && !fs.existsSync(path.join(mindChain, '2.json')) &&
  MINDED.every(id => r8[id].mind.kind === 'sleep' && same(r8[id].at, P.bed(id))), JSON.stringify(r8) + '\n' + log);

// ... and while they sleep, the one mind folds the day into one dream
// in the order the dream seals them (by name)
const LINES = { greeter: 'I dreamed the wanderer let me win.', pilgrim: 'I dreamed of a portal nobody has walked through yet.',
  wanderer: 'I dreamed I raced the greeter to the portals and won.', watcher: 'I dreamed I watched them all run.' };
fs.writeFileSync(path.join(fakeDir, 'answer'), JSON.stringify({ text: 'The wanderer raced the greeter to the portals while the pilgrim '
  + 'watched the ring, and then the hub went dark and everyone slept.', lines: LINES,
  memory: 'The wanderer and the greeter race. The pilgrim wonders about the portals.' }));
const dreamChain = path.join(out, 'dream');
const dreamArgs = ['--chain', dreamChain, '--views', chain, '--intent', path.join(out, 'intent')];
let dreamt = '';
try {
  dreamt = execFileSync(PYTHON, ['tools/dream.py', 'dream', '--anchor', path.join(out, 'anchor-8.json'), '--model', 'stub-mind',
    '--copilot', fakeCopilot, '--clock', NIGHT, '--cache', path.join(out, 'dream-cache.json'), ...dreamArgs],
    { cwd: ROOT, encoding: 'utf8' });
} catch (error) { dreamt = 'refused: ' + String(error.stderr || error.message); }
const dream0 = fs.existsSync(path.join(dreamChain, '0.json')) ? JSON.parse(fs.readFileSync(path.join(dreamChain, '0.json'), 'utf8')) : null;
check('while they sleep, the one mind folds the whole day into one dream frame, every view folded once',
  /^sealed dream 0 · night /.test(dreamt) && dream0 && dream0.payload.by.kind === 'model' && dream0.payload.folded.from === 0 &&
  dream0.payload.folded.to === f8.seq && same(dream0.payload.dream.lines, LINES) && askedOf().length === 3,
  dreamt + JSON.stringify(dream0 && dream0.payload.by));

// tick 9: the morning after the dream
fs.writeFileSync(path.join(fakeDir, 'answer'), '{"bodies": {"wanderer": {"say": "this is not what it says", '
  + '"act": [{"do": "look", "dx": 400}]}, "pilgrim": {"routine": [{"do": "wait", "ms": 900}]}}}');
writeConfig(DAY, ONE);
mintTick();
log = await capture(9, false, port);
const f9 = seal(9);
const r9 = byId(f9);
const m9 = fs.existsSync(path.join(mindChain, '2.json')) ? readMind(2) : { payload: {} };
const told9 = (askedOf()[3] || { argv: [] }).argv;
check('the morning after, every body wakes saying its line from the dream, word for word, and the mind frame names the dream',
  m9.payload.morning === true && same(m9.payload.memory, dream0 && { seq: 0, frame_hash: dream0.frame_hash }) &&
  MINDED.every(id => r9[id].mind.kind === 'directed' && r9[id].mind.said === LINES[id]) &&
  same(r9.wanderer.mind.act, [{ do: 'look', dx: 400, dy: 0 }]) && r9.pilgrim.mind.routine_set &&
  (told9[told9.indexOf('-p') + 1] || '').includes('The wanderer and the greeter race.'),
  JSON.stringify({ mind: m9.payload, r9 }) + '\n' + log);
verified = verify();
let dreamVerified = '';
try {
  dreamVerified = execFileSync(PYTHON, ['tools/dream.py', 'verify', ...dreamArgs, '--spine', spine], { cwd: ROOT, encoding: 'utf8' });
} catch (error) { dreamVerified = 'refused: ' + String(error.stdout || '') + String(error.stderr || error.message); }
check('and the whole line of nine ticks, the one mind\'s three frames and the dream all verify',
  verified.code === 0 && /line: 9 frame\(s\) verify/.test(verified.out) && /the one mind: 3 frame\(s\) verify/.test(verified.out) &&
  /the dream line verifies/.test(dreamVerified), verified.out + dreamVerified);

stub.close();
fs.rmSync(out, { recursive: true, force: true });
if (checks.some(passed => !passed)) process.exit(1);
})().catch(error => {
  console.log('  not ok the suite could not run: ' + (error && error.stack || error));
  stub.close();
  process.exit(1);
});

/* build_show.cjs — turn a written scene into a timed show with real voices.
 *
 * The frame contract Kody set: a beat says "say these words", and the next beat cannot start
 * until that character has finished the thought. Which means a beat's length is not a guess —
 * it is exactly as long as the line takes to say. So the line is rendered to audio first and
 * MEASURED, and that measurement becomes the beat's duration. Everything downstream — the cut,
 * the subtitle, the walk to the kettle — is timed off the voice rather than off a timer that
 * hopes.
 *
 * macOS `say` gives every character a different voice; ffprobe gives the exact seconds.
 *
 *   node tools/build_show.cjs shows/house/script.json
 */
const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');

const scriptPath = process.argv[2] || 'shows/house/script.json';
const src = JSON.parse(fs.readFileSync(path.join(ROOT, scriptPath), 'utf8'));
const outDir = path.join(ROOT, path.dirname(scriptPath));
const audioDir = path.join(outDir, 'audio');
fs.mkdirSync(audioDir, { recursive: true });

const voiceOf = {};
for (const c of src.cast) voiceOf[c.id] = c.voice || 'Alex';

const dur = (f) => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
  '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim();

console.log(`${src.beats.length} beats, ${src.cast.length} in the house`);
let t = 0;
const beats = [];
for (let i = 0; i < src.beats.length; i++) {
  const b = src.beats[i];
  const name = String(i).padStart(3, '0') + '.aiff';
  const file = path.join(audioDir, name);
  let seconds = b.seconds || 0;
  if (b.text) {
    // the rate is per character so a fast talker stays a fast talker
    const c = src.cast.find(x => x.id === b.speaker) || {};
    const args = ['-v', voiceOf[b.speaker] || 'Alex'];
    if (c.rate) args.push('-r', String(c.rate));
    args.push('-o', file, b.text);
    execFileSync('say', args);
    seconds = dur(file);
  }
  const beat = { n: i, at: +t.toFixed(3), speaker: b.speaker || null, text: b.text || '',
                 seconds: +(+seconds).toFixed(3), audio: b.text ? 'audio/' + name : null,
                 camera: b.camera || null, room: b.room || null, intent: b.intent || null,
                 with: b.with || [], note: b.note || null };
  beats.push(beat);
  t += beat.seconds + (b.pause || 0.35);          // a breath between thoughts
  process.stdout.write(`  ${String(i + 1).padStart(3)}/${src.beats.length}  ${(b.speaker || '—').padEnd(9)} ${beat.seconds.toFixed(2)}s\r`);
}
console.log('\ntotal ' + t.toFixed(1) + 's');

// one soundtrack, each line laid at its exact offset
const listFile = path.join(audioDir, '_mix.txt');
const parts = beats.filter(b => b.audio);
const filter = parts.map((b, k) => `[${k}:a]adelay=${Math.round(b.at * 1000)}|${Math.round(b.at * 1000)}[a${k}]`).join(';')
  + ';' + parts.map((_, k) => `[a${k}]`).join('') + `amix=inputs=${parts.length}:normalize=0[out]`;
const inputs = parts.flatMap(b => ['-i', path.join(outDir, b.audio)]);
const track = path.join(outDir, 'soundtrack.wav');
execFileSync('ffmpeg', ['-y', ...inputs, '-filter_complex', filter, '-map', '[out]',
  '-t', String(t.toFixed(2)), track], { stdio: ['ignore', 'ignore', 'pipe'] });
try { fs.unlinkSync(listFile); } catch (e) {}

const show = { title: src.title, house: src.house || 'the house', cast: src.cast,
               rooms: src.rooms || [], cameras: src.cameras || [], seconds: +t.toFixed(2), beats };
fs.writeFileSync(path.join(outDir, 'show.json'), JSON.stringify(show, null, 1));
console.log(`  ${path.relative(ROOT, path.join(outDir, 'show.json'))}`);
console.log(`  ${path.relative(ROOT, track)}  (${(fs.statSync(track).size / 1048576).toFixed(2)}MB)`);

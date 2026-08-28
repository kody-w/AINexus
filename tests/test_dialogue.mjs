import { readFileSync } from 'node:fs';
(0, eval)(readFileSync(new URL('../ai/dialogue.js', import.meta.url), 'utf8'));
const D = globalThis.NexusDialogue;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };
const shorts = r => r.map(o => o.short).join(',');
const ADA = { id: 'abcdef1234', name: 'Ada', isAI: false };
const BOT = { id: 'bbbbbb9999', name: 'greeter-1', isAI: true };

console.log('dialogue — options built from what is true');
{
  const r = D.options({ who: ADA, chat: [], portals: [] });
  ok('a cold open greets and always offers a way out (' + shorts(r) + ')', r[0].short === 'greet' && r[r.length - 1].short === 'leave');
  ok('never more than five orbs', r.length <= 5);
}
{
  const r = D.options({ who: BOT, chat: [], portals: [] });
  ok('an AI gets a different opener and a different question (' + shorts(r) + ')',
     /running on your own/.test(r[0].text) && r.some(o => o.short === 'what'));
}
{
  const r = D.options({ who: ADA, chat: [{ from: 'abcdef', text: 'are you new here?' }], portals: [] });
  ok('their QUESTION gets yes / no / say-more (' + shorts(r) + ')',
     r[0].short === 'yes' && r[1].short === 'no' && r.some(o => o.short === 'more'));
}
{
  const r = D.options({ who: ADA, chat: [{ from: 'abcdef', text: 'this place is enormous' }], portals: [] });
  ok('their STATEMENT gets acknowledgement, not yes/no (' + shorts(r) + ')',
     r[0].short === 'agree' && !r.some(o => o.short === 'yes'));
}
{
  const r = D.options({ who: ADA, chat: [{ from: 'abcdef', text: 'hi' }, { from: 'zzzzzz', text: 'hello all' }], portals: [] });
  ok('someone else speaking last means their line is no longer the open question (' + shorts(r) + ')',
     r[0].short === 'back');
}
{
  const r = D.options({ who: ADA, chat: [], portals: [
    { name: 'Crystal Caverns World', distance: 40 }, { name: 'Ebike World', distance: 9 }] });
  ok('the invite names the NEAREST portal (' + (r.find(o => o.short === 'go') || {}).text + ')',
     /Ebike World/.test((r.find(o => o.short === 'go') || {}).text || ''));
}
{
  const r = D.options({ who: ADA, chat: [], portals: [{ name: 'A Very Long Portal Name That Runs On And On', distance: 1 }] });
  const go = r.find(o => o.short === 'go');
  ok('a long portal name is trimmed so the orb label fits (' + go.text + ')', go.text.length < 60 && /…/.test(go.text));
}
{
  const r = D.options({});
  ok('no context at all still yields a usable ring (' + shorts(r) + ')', r.length >= 2 && r[r.length - 1].short === 'leave');
}
{
  const a = D.options({ who: ADA, chat: [{ from: 'abcdef', text: 'why are you here?' }], portals: [{ name: 'Ebike World', distance: 3 }] });
  const b = D.options({ who: ADA, chat: [{ from: 'abcdef', text: 'why are you here?' }], portals: [{ name: 'Ebike World', distance: 3 }] });
  ok('deterministic: the same room gives the same ring', JSON.stringify(a) === JSON.stringify(b));
}
{
  ok('a question is recognised with or without a mark',
     D.isQuestion('are you real') && D.isQuestion('really?') && !D.isQuestion('this is a wall'));
}
{
  const r = D.options({ who: ADA, chat: [{ from: 'abcdef', text: 'hi' }], portals: [{ name: 'X', distance: 1 }] });
  ok('no duplicate text in the ring', new Set(r.map(o => o.text)).size === r.length);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

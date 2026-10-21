// Listens to every radio clip and voiceover line (OpenAI speech-to-text) and flags the ones that
// do not say what they should: dropped or garbled words, stalls, wrong numbers.
// Cost: a few cents for the whole video.
//
//   node qa.mjs
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('../.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const KEY = env.OPENAI_API_KEY ?? env.OPENAI_API;
if (!KEY) throw new Error('No OpenAI key in .env.local');

const manifest = JSON.parse(readFileSync('public/audio/manifest.json', 'utf8'));

/** Words, with numbers and phonetic letters folded so "3000" and "three thousand" compare equal. */
const PHON = { alpha: 'a', bravo: 'b', charlie: 'c', delta: 'd', echo: 'e', foxtrot: 'f', golf: 'g', hotel: 'h', india: 'i', juliet: 'j', kilo: 'k', lima: 'l', mike: 'm', november: 'n', oscar: 'o', papa: 'p', quebec: 'q', romeo: 'r', sierra: 's', tango: 't', uniform: 'u', victor: 'v', whiskey: 'w', xray: 'x', yankee: 'y', zulu: 'z' };
const NUM = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', niner: '9', tree: '3', fife: '5' };
const TEENS = { ten: '10', eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19' };
const TENS = { twenty: 2, thirty: 3, forty: 4, fifty: 5, sixty: 6, seventy: 7, eighty: 8, ninety: 9 };
function words(s) {
  const ws = s
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1$2')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  // Spoken numbers to digits: "sixty seven" -> 67, "three thousand" -> 3000.
  const out = [];
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    if (w in TENS) {
      const u = NUM[ws[i + 1]];
      if (u && u !== '0') {
        out.push(`${TENS[w]}${u}`);
        i++;
      } else out.push(`${TENS[w]}0`);
    } else if (w in TEENS) out.push(TEENS[w]);
    else if (w === 'thousand' && /^\d+$/.test(out.at(-1) ?? '')) out.push(`${out.pop()}000`);
    else if (w === 'hundred' && /^\d+$/.test(out.at(-1) ?? '')) out.push(`${out.pop()}00`);
    else out.push(NUM[w] ?? w);
  }
  return out;
}
/** Share of the expected words that were heard (order-insensitive, numbers digit by digit). */
function coverage(expected, heard) {
  // Numbers digit by digit; "C2" as c + 2 (phonetic letters fold to their initial below).
  const flat = (ws) => ws.flatMap((w) => (/^\d+$/.test(w) ? w.split('') : /^[a-z]\d+$/.test(w) ? [w[0], ...w.slice(1).split('')] : [PHON[w] ?? w]));
  const e = flat(words(expected));
  const h = flat(words(heard));
  const pool = new Map();
  for (const w of h) pool.set(w, (pool.get(w) ?? 0) + 1);
  let hit = 0;
  for (const w of e) if (pool.get(w)) (hit++, pool.set(w, pool.get(w) - 1));
  return e.length ? hit / e.length : 1;
}

async function transcribe(file) {
  const form = new FormData();
  form.append('model', 'whisper-1');
  form.append('language', 'en');
  form.append('file', new Blob([readFileSync(`public/${file}`)]), file.split('/').pop());
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${KEY}` }, body: form });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).text;
}

const jobs = [
  ...Object.entries(manifest.radio).flatMap(([take, lines]) => lines.map((l) => ({ id: `${take} ${l.from}`, file: l.file, text: l.said ?? l.text, duration: l.duration }))),
  ...Object.entries(manifest.vo).map(([id, v]) => ({ id: `vo ${id}`, file: v.file, text: v.text, duration: v.duration })),
];
let flagged = 0;
for (const j of jobs) {
  const heard = await transcribe(j.file);
  const cov = coverage(j.text, heard);
  const rate = j.text.length / j.duration; // characters per second
  const bad = cov < 0.8 || rate < 9;
  if (bad) flagged++;
  console.log(`${bad ? 'CHECK' : 'ok   '} ${j.id.padEnd(16)} ${(cov * 100).toFixed(0).padStart(3)}% ${rate.toFixed(1).padStart(5)} ch/s  ${j.file}`);
  if (bad) console.log(`        want: ${j.text}\n        heard: ${heard}`);
}
console.log(`${jobs.length} clips, ${flagged} to check`);

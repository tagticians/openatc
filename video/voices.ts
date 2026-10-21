// Voices for the demo video, from ElevenLabs:
//  - every pilot and controller line the capture logged (public/clips/<take>.json), in the
//    game's own persona voices, run through a VHF radio filter;
//  - the voiceover (vo.json), clean.
// Clips are cached in .voice-cache by voice + text, so re-running only pays for new lines.
//
//   npm run voices        (bundled with esbuild from the project root; see package.json)
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { personaFor, PERSONAS } from '../src/audio/personas';
import { TELEPHONY } from '../src/data/traffic';
import { LETTERS, sayCallsign, sayDigits, sayLevel, sayQnh } from '../src/sim/phraseology';

// Run from the video folder: the project root is one up.
const ROOT = `${process.cwd()}/../`;
const env = Object.fromEntries(
  readFileSync(`${ROOT}.env.local`, 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const KEY = env.ELEVENLABS_API_KEY;
if (!KEY) throw new Error('ELEVENLABS_API_KEY missing in .env.local');

const MODEL = 'eleven_multilingual_v2';
/** Rotterdam Approach / Tower: the Dutch first-officer persona, distinct from the male crews. */
const CONTROLLER = PERSONAS.find((p) => p.id === 'nl-f1')!;
/** Voiceover: Brian, a middle-aged American premade voice. */
const VO_VOICE = 'nPczCjzI2devNBz1zQrb';

mkdirSync('.voice-cache', { recursive: true });
let chars = 0;

async function tts(voice: string, text: string, settings: Record<string, number>, seed?: number): Promise<string> {
  const key = createHash('sha1').update(`${MODEL}|${voice}|${JSON.stringify(settings)}|${text}${seed !== undefined ? `|${seed}` : ''}`).digest('hex').slice(0, 16);
  const file = `.voice-cache/${key}.mp3`;
  if (existsSync(file)) return file;
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ text, model_id: MODEL, voice_settings: settings, ...(seed !== undefined ? { seed } : {}) }),
  });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}`);
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  chars += text.length;
  return file;
}

const duration = (f: string) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());

/** VHF character: band-limited, a little drive and compression, a key-up click and a squelch tail. */
function radioize(src: string, out: string) {
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', src,
    '-f', 'lavfi', '-t', '0.18', '-i', 'anoisesrc=color=pink:amplitude=0.12:sample_rate=44100',
    '-f', 'lavfi', '-t', '0.04', '-i', 'anoisesrc=color=white:amplitude=0.18:sample_rate=44100',
    '-filter_complex',
    // Long pauses inside a call (a TTS hiccup, or slow letters) are cut to a radio-brisk 0.2 s.
    '[0:a]aresample=44100,pan=mono|c0=c0,silenceremove=start_periods=1:start_threshold=-45dB:stop_periods=-1:stop_duration=0.4:stop_threshold=-45dB:stop_silence=0.2,highpass=f=380,lowpass=f=2900,equalizer=f=1700:t=q:w=1:g=5,acompressor=threshold=0.12:ratio=6:attack=5:release=60,volume=1.6,asoftclip=type=tanh[v];' +
      '[2:a]highpass=f=800,lowpass=f=5000[click];[1:a]highpass=f=600,lowpass=f=4000,afade=t=out:st=0.05:d=0.13[tail];' +
      '[click][v][tail]concat=n=3:v=0:a=1[o]',
    '-map', '[o]', '-ac', '1', '-b:a', '128k', out,
  ]);
}

// ------------------------------------------------------------------ controller speech
const NATO = LETTERS as Record<string, string>;
function spokenCallsign(cs: string): string {
  if (cs.startsWith('LIFE')) return `Lifeliner ${sayDigits(cs.slice(4))}`;
  if (/^PH[A-Z]{3}$/.test(cs)) return `Papa Hotel ${cs.slice(2).split('').map((c) => NATO[c]).join(' ')}`;
  const m = cs.match(/^([A-Z]{3})(\w+)$/);
  if (!m) return cs;
  const tel = TELEPHONY[m[1]] ?? m[1];
  const num = m[2];
  // Airline style: "fifty-eight sixteen" for four digits, digit by digit otherwise.
  const pairs = /^\d{4}$/.test(num) && num[2] !== '0' ? `${twoDigits(num.slice(0, 2))} ${twoDigits(num.slice(2))}` : sayDigits(num);
  return `${tel.charAt(0)}${tel.slice(1).toLowerCase()} ${pairs}`;
}
const UNITS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function twoDigits(s: string) {
  const n = Number(s);
  if (n < 10) return `zero ${UNITS[n] || 'zero'}`;
  if (n < 20) return TEENS[n - 10];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${UNITS[n % 10]}` : ''}`;
}

/** Registrations ("PAPA HOTEL QXV") get every letter in the phonetic alphabet. */
const callsignWords = (cs: string, spoken?: string) => {
  const reg = spoken?.match(/^PAPA HOTEL ([A-Z]+)$/);
  if (reg) return `Papa Hotel ${reg[1].split('').map((c) => NATO[c]).join(' ')}`;
  return spoken ? sayCallsign(spoken) : spokenCallsign(cs);
};

function atcSpeech(text: string, cs?: string, spoken?: string): string {
  let s = text;
  if (cs && s.startsWith(cs)) s = `${callsignWords(cs, spoken)},${s.slice(cs.length)}`;
  return s
    .replace(/\bFL(\d{2,3})\b/g, (_, n) => sayLevel(Number(n) * 100))
    .replace(/\b(\d{3,5}) ft\b/g, (_, n) => sayLevel(Number(n)))
    .replace(/\bQNH (\d{4})\b/g, (_, n) => `QNH ${sayQnh(Number(n))}`)
    .replace(/\brunway (\d{2})([LCR]?)\b/gi, (_, n, l) => `runway ${sayDigits(n)}${l ? ` ${{ L: 'left', R: 'right', C: 'center' }[l as 'L']}` : ''}`)
    .replace(/\bheading (\d{3})\b/g, (_, n) => `heading ${sayDigits(n)}`)
    .replace(/\bwind (\d{3}) degrees (\d+) kt\b/g, (_, d, k) => `wind ${sayDigits(d)} degrees ${sayDigits(k)} knots`)
    .replace(/\b(\d{3}) kt\b/g, (_, n) => `${sayDigits(n)} knots`)
    .replace(/\bsquawk (\d{4})\b/g, (_, n) => `squawk ${sayDigits(n)}`)
    .replace(/\b([A-Z]{5})\b/g, (w) => w.charAt(0) + w.slice(1).toLowerCase())
    .replace(/\bILS\b/g, 'I L S');
}

// ------------------------------------------------------------------ radio lines
const manifest: Record<string, { frame: number; play?: number; file: string; duration: number; from: string; callsign?: string; text: string; said?: string }[]> = {};
const only = process.argv.slice(2);
const old = existsSync('public/audio/manifest.json') ? JSON.parse(readFileSync('public/audio/manifest.json', 'utf8')) : { radio: {} };
Object.assign(manifest, old.radio);
const clips = readdirSync('public/clips').filter((f) => f.endsWith('.json') && !f.startsWith('montage') && (!only.length || only.includes(f.replace('.json', ''))));
for (const f of clips) {
  const take = f.replace('.json', '');
  const { radio } = JSON.parse(readFileSync(`public/clips/${f}`, 'utf8')) as { radio: { frame: number; play?: number; from: string; callsign?: string; spoken?: string; text: string; speech?: string }[] };
  mkdirSync(`public/audio/${take}`, { recursive: true });
  manifest[take] = [];
  for (const [i, m] of radio.entries()) {
    if (m.from !== 'pilot' && m.from !== 'atc') continue;
    let voice: string;
    let settings: Record<string, number>;
    let text: string;
    if (m.from === 'pilot') {
      let p = personaFor(m.callsign ?? '');
      if (p.id === CONTROLLER.id) p = PERSONAS.find((x) => x.id === 'nl-m1')!;
      voice = p.eleven.id;
      // Brisk, like real radio: a touch faster than the persona's default.
      settings = { stability: 0.4, similarity_boost: 0.8, style: 0.25, speed: Math.min(1.2, (p.eleven.speed ?? 1.05) + 0.1) };
      text = m.speech ?? m.text;
    } else {
      voice = CONTROLLER.eleven.id;
      settings = { stability: 0.55, similarity_boost: 0.8, style: 0.1, speed: 1.15 };
      text = atcSpeech(m.text, m.callsign, m.spoken);
    }
    // A take that runs far longer than the words need has a stall in it: try other seeds.
    let raw = await tts(voice, text, settings);
    const expected = 0.6 + text.length / 14;
    for (let seed = 1; seed <= 3 && duration(raw) > expected * 1.6; seed++) raw = await tts(voice, text, settings, seed);
    const out = `public/audio/${take}/${String(i).padStart(3, '0')}.mp3`;
    radioize(raw, out);
    manifest[take].push({ frame: m.frame, play: m.play, file: out.replace('public/', ''), duration: duration(out), from: m.from, callsign: m.callsign, text: m.text, said: text });
    process.stdout.write(`\r${take}: ${manifest[take].length} lines`);
  }
  console.log();
}

// ------------------------------------------------------------------ voiceover
const vo = JSON.parse(readFileSync('vo.json', 'utf8')) as Record<string, string>;
mkdirSync('public/audio/vo', { recursive: true });
const voOut: Record<string, { file: string; duration: number; text: string }> = {};
for (const [id, text] of Object.entries(vo)) {
  const raw = await tts(VO_VOICE, text, { stability: 0.5, similarity_boost: 0.8, style: 0.2, speed: 0.98 });
  const out = `public/audio/vo/${id}.mp3`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=7', '-ar', '44100', out]);
  voOut[id] = { file: out.replace('public/', ''), duration: duration(out), text };
}
writeFileSync('public/audio/manifest.json', JSON.stringify({ radio: manifest, vo: voOut }, null, 1));
// Airtime per line for the game's demo director: calls are heard in real time and queue on one
// frequency, so the next capture paces the scenes to the real clips.
const airtime: Record<string, number> = {};
for (const lines of Object.values(manifest)) for (const l of lines) airtime[`${l.from}|${l.text}`] = Math.round(l.duration * 100) / 100;
writeFileSync(`${ROOT}public/demo-voice.json`, JSON.stringify(airtime));
console.log(`done; ${chars} new characters sent to ElevenLabs`);

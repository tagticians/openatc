// Generates the persona reference clips in dev/voice-refs/: ~12 s of each pilot speaking
// their own language (or regional English). Cloning engines (Mistral Voxtral, local Chatterbox)
// read these to give a persona its accent without using any real person's voice.
//
//   node --env-file=.env.local scripts/make-voice-refs.mjs [personaId…]
//
// Source voices are Gemini TTS native-language voices. Costs ~200 characters per clip.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KEY = process.env.GEMINI_API_KEY ?? process.env.GEMINI_API;
if (!KEY) throw new Error('GEMINI_API_KEY missing');
const OUT = path.resolve('dev/voice-refs');
fs.mkdirSync(OUT, { recursive: true });

const TEXT = {
  nl: 'Goedemiddag dames en heren, hier spreekt de gezagvoerder. We zijn zojuist begonnen aan de daling richting Amsterdam. Over een minuut of twintig staan we aan de grond, het is daar droog met een lichte westenwind.',
  de: 'Guten Tag, meine Damen und Herren, hier spricht Ihr Kapitän. Wir haben soeben mit dem Sinkflug nach Amsterdam begonnen und landen in etwa zwanzig Minuten. Das Wetter dort ist trocken, bei leichtem Westwind.',
  fr: "Mesdames et messieurs, bonjour, ici votre commandant de bord. Nous venons de commencer notre descente vers Amsterdam et nous atterrirons dans une vingtaine de minutes. Le temps y est sec, avec un léger vent d'ouest.",
  es: 'Señoras y señores, buenas tardes, les habla el comandante. Acabamos de iniciar el descenso hacia Ámsterdam y aterrizaremos en unos veinte minutos. Allí el tiempo es seco, con un ligero viento del oeste.',
  it: 'Signore e signori, buon pomeriggio, vi parla il comandante. Abbiamo appena iniziato la discesa verso Amsterdam e atterreremo tra circa venti minuti. Il tempo è asciutto, con un leggero vento da ovest.',
  tr: "Sayın yolcularımız, iyi günler, ben kaptan pilotunuz. Amsterdam'a doğru alçalmaya yeni başladık ve yaklaşık yirmi dakika içinde iniş yapacağız. Hava kuru, hafif batı rüzgârı var.",
  pl: 'Szanowni Państwo, dzień dobry, mówi kapitan. Właśnie rozpoczęliśmy zniżanie do Amsterdamu i wylądujemy za około dwadzieścia minut. Pogoda jest sucha, wieje lekki wiatr z zachodu.',
  sv: 'Mina damer och herrar, god eftermiddag, det här är er kapten. Vi har just påbörjat inflygningen mot Amsterdam och landar om ungefär tjugo minuter. Vädret är torrt, med en svag västlig vind.',
  da: 'Mine damer og herrer, god eftermiddag, det er kaptajnen, der taler. Vi er netop begyndt på nedstigningen mod Amsterdam og lander om cirka tyve minutter. Vejret er tørt med en svag vestenvind.',
  en: "Good afternoon ladies and gentlemen, this is the captain speaking. We've just started our descent into Amsterdam and should be on the ground in about twenty minutes. It's dry down there, with a light westerly breeze.",
};

// persona id → [Gemini voice, language of the clip]
const REFS = {
  'nl-m1': ['nl-nl-advisor-2', 'nl'],
  'nl-m2': ['nl-nl-techagent-6', 'nl'],
  'nl-f1': ['nl-nl-advisor-1', 'nl'],
  'de-m1': ['de-de-advisor-10', 'de'],
  'fr-m1': ['fr-fr-advisor-2', 'fr'],
  'es-m1': ['es-es-advisor-9', 'es'],
  'it-m1': ['it-it-assistant-3', 'it'],
  'tr-m1': ['alnilam', 'tr'],
  'pl-m1': ['pl-pl-advisor-1', 'pl'],
  'nordic-m1': ['enceladus', 'sv'],
  'nordic-m2': ['umbriel', 'da'],
  'gb-m1': ['en-gb-advisor-8', 'en'],
  'gb-m2': ['en-gb-podcaster-1', 'en'],
  'gb-f1': ['en-gb-advisor-1', 'en'],
  'ie-m1': ['en-ie-advisor-1', 'en'],
  'us-m1': ['en-us-advisor-5', 'en'],
  'us-m2': ['en-us-advisor-8', 'en'],
  'us-m3': ['en-us-elio', 'en'],
  'us-m4': ['en-us-podcaster-4', 'en'],
  'us-m5': ['en-us-tutor-15', 'en'],
  'us-f1': ['en-us-advisor-10', 'en'],
  'us-f2': ['en-us-advisor-9', 'en'],
  'au-m1': ['en-au-advisor-1', 'en'],
  'in-m1': ['en-in-advisor-9', 'en'],
  'sg-m1': ['puck', 'en'],
};

const want = process.argv.slice(2);
let chars = 0;
for (const [id, [voice, lang]] of Object.entries(REFS)) {
  if (want.length && !want.includes(id)) continue;
  const dest = path.join(OUT, `${id}.mp3`);
  if (fs.existsSync(dest) && !want.length) continue;
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'x-goog-api-key': KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-3.8-flash-tts',
      input: [{ type: 'user_input', content: [{ type: 'text', text: TEXT[lang], annotations: [{ type: 'speech_metadata', style: 'calm, friendly airline captain making a cabin announcement' }] }] }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice }] },
    }),
  });
  const d = await r.json();
  if (!r.ok) {
    console.log('FAIL', id, JSON.stringify(d).slice(0, 200));
    continue;
  }
  const data = d.steps.flatMap((s) => s.content ?? []).find((c) => c.data)?.data;
  const tmp = path.join(os.tmpdir(), `ref-${id}.wav`);
  fs.writeFileSync(tmp, Buffer.from(data, 'base64'));
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', tmp, '-ac', '1', '-ar', '24000', '-b:a', '64k', dest]);
  fs.unlinkSync(tmp);
  chars += TEXT[lang].length;
  console.log('ok', id, voice, lang);
}
console.log('characters', chars);

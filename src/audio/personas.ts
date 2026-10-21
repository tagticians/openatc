// Pilot personas: who is flying, independent of the speech engine. Each persona carries a
// voice definition per provider, so a callsign keeps the same pilot whichever engine speaks.
// Assignment is deterministic (callsign → persona), so a flight never changes voice.

import { accentOf, type Accent } from '../data/traffic';

/** Accent group; which airline flies with which accent lives in data/airlines.json. */
export type Country = Accent;

export interface Persona {
  id: string;
  label: string;
  country: Country;
  gender: 'm' | 'f';
  /** How the accent is described to prompt-driven engines (OpenAI, Gemini). */
  accent: string;
  eleven: { id: string; speed?: number };
  openai: { voice: string };
  /** Gemini TTS voice: regional English, or a native-language voice speaking English. */
  gemini: { voice: string };
  /** Mistral Voxtral: cloned from the persona's reference clip (dev/voice-refs/<id>.mp3). */
  mistral: { ref: string };
  /** Kokoro (local, free): US/UK English voices only, no accents. */
  kokoro: { voice: string };
  /** Preferred system-voice locales, best first. */
  system: string[];
}

const P = (
  id: string,
  label: string,
  country: Country,
  gender: 'm' | 'f',
  accent: string,
  eleven: Persona['eleven'],
  openaiVoice: string,
  geminiVoice: string,
  kokoroVoice: string,
  system: string[],
): Persona => ({
  id,
  label,
  country,
  gender,
  accent,
  eleven,
  openai: { voice: openaiVoice },
  gemini: { voice: geminiVoice },
  mistral: { ref: id },
  kokoro: { voice: kokoroVoice },
  system,
});

export const PERSONAS: Persona[] = [
  P('nl-m1', 'Dutch captain, calm', 'NL', 'm', 'a noticeable Dutch accent (Netherlands)', { id: 'SVmtrm5iuquj8zKn5ZMg' }, 'ash', 'nl-nl-advisor-2', 'bm_george', ['en-GB', 'en-IE']),
  P('nl-m2', 'Dutch captain, clipped', 'NL', 'm', 'a strong Dutch accent, flat intonation', { id: 'TgIvljfrc4ZtKuGsTqVt' }, 'onyx', 'nl-nl-techagent-6', 'bm_lewis', ['en-GB']),
  P('nl-f1', 'Dutch first officer', 'NL', 'f', 'a light Dutch accent', { id: 'sP3q7DZvU8X3maXCONzw', speed: 1.15 }, 'coral', 'nl-nl-advisor-1', 'bf_emma', ['en-GB', 'en-IE']),
  P('de-m1', 'German captain', 'DE', 'm', 'a clear German accent', { id: 'Jvf6TAXwMUVTSR20U0f9' }, 'echo', 'de-de-advisor-10', 'bm_daniel', ['en-GB']),
  P('fr-m1', 'French captain', 'FR', 'm', 'a pronounced French accent', { id: 'xTZlmU8dKXdyk4XGYGFg' }, 'verse', 'fr-fr-advisor-2', 'bm_fable', ['en-GB']),
  P('es-m1', 'Spanish captain', 'ES', 'm', 'a Spanish (Castilian) accent', { id: '86ZLAUcyPNBrbdJKn3u6', speed: 1.12 }, 'ballad', 'es-es-advisor-9', 'am_michael', ['en-GB']),
  P('it-m1', 'Italian captain', 'IT', 'm', 'an Italian accent', { id: 'yowh82B72eMNrxcxHgBh' }, 'verse', 'it-it-assistant-3', 'bm_george', ['en-GB']),
  P('tr-m1', 'Turkish captain', 'TR', 'm', 'a Turkish accent', { id: 'cWzYlIcYTquPCigOQKX0' }, 'onyx', 'alnilam', 'am_onyx', ['en-GB']),
  P('pl-m1', 'Polish captain', 'PL', 'm', 'a strong Polish accent', { id: 'TrFmzBmO31zY93mAN5OF', speed: 1.12 }, 'echo', 'pl-pl-advisor-1', 'bm_lewis', ['en-GB']),
  P('nordic-m1', 'Swedish captain', 'NORDIC', 'm', 'a Swedish accent', { id: '1akQNyt9mMzTni2Y99lv' }, 'ash', 'enceladus', 'bm_daniel', ['en-GB']),
  P('nordic-m2', 'Danish first officer', 'NORDIC', 'm', 'a Danish accent', { id: 'tahWrGVL3fokg7ZEUr3o' }, 'echo', 'umbriel', 'am_puck', ['en-GB']),
  P('gb-m1', 'British captain', 'GB', 'm', 'a crisp British (RP) accent', { id: 'EaCGZNIZYoLgxVzmLOPI' }, 'ballad', 'en-gb-advisor-8', 'bm_george', ['en-GB']),
  P('gb-m2', 'British first officer', 'GB', 'm', 'a southern English accent', { id: 'G17SuINrv2H9FC6nvetn' }, 'ash', 'en-gb-podcaster-1', 'bm_fable', ['en-GB']),
  P('gb-f1', 'British captain', 'GB', 'f', 'a clear British accent', { id: 'MzqUf1HbJ8UmQ0wUsx2p' }, 'sage', 'en-gb-advisor-1', 'bf_isabella', ['en-GB']),
  P('ie-m1', 'Irish captain', 'IE', 'm', 'an Irish accent', { id: '9TYDukkUVpJPDSIuv3ir' }, 'ash', 'en-ie-advisor-1', 'bm_lewis', ['en-IE', 'en-GB']),
  P('us-m1', 'American captain', 'US', 'm', 'a General American accent, relaxed airline-pilot drawl', { id: 'BK54EYgZPb4sYkI91RFj' }, 'onyx', 'en-us-advisor-5', 'am_michael', ['en-US']),
  P('us-m2', 'American first officer', 'US', 'm', 'a General American accent', { id: 'MFZUKuGQUsGJPQjTS4wC' }, 'echo', 'en-us-advisor-8', 'am_fenrir', ['en-US']),
  P('us-m3', 'American captain, East Coast', 'US', 'm', 'a New York / East Coast American accent', { id: 'MFZUKuGQUsGJPQjTS4wC' }, 'onyx', 'en-us-elio', 'am_eric', ['en-US']),
  P('us-m4', 'American first officer, Northwest', 'US', 'm', 'a relaxed Pacific Northwest American accent', { id: 'BK54EYgZPb4sYkI91RFj', speed: 1.1 }, 'ash', 'en-us-podcaster-4', 'am_liam', ['en-US']),
  P('us-m5', 'American captain, Gulf Coast', 'US', 'm', 'a Texas / Gulf Coast drawl', { id: 'MFZUKuGQUsGJPQjTS4wC', speed: 1.0 }, 'ballad', 'en-us-tutor-15', 'am_adam', ['en-US']),
  P('us-f1', 'American captain, West Coast', 'US', 'f', 'a West Coast American accent', { id: '21m00Tcm4TlvDq8ikWAM' }, 'sage', 'en-us-advisor-10', 'af_sarah', ['en-US']),
  P('us-f2', 'American first officer, Midwest', 'US', 'f', 'a Midwestern American accent', { id: 'EXAVITQu4vr4xnSDxMaL', speed: 1.1 }, 'coral', 'en-us-advisor-9', 'af_bella', ['en-US']),
  P('au-m1', 'Australian captain', 'AU', 'm', 'an Australian accent', { id: 'aGkVQvWUZi16EH8aZJvT' }, 'ash', 'en-au-advisor-1', 'am_puck', ['en-AU']),
  P('in-m1', 'Indian captain', 'IN', 'm', 'an Indian English accent', { id: 'siw1N9V8LmYeEWKyWBxv' }, 'echo', 'en-in-advisor-9', 'bm_daniel', ['en-IN']),
  P('sg-m1', 'Singaporean captain', 'SG', 'm', 'a Singaporean English accent', { id: '6EYhQ5gVgyv1Z20WprFH', speed: 1.18 }, 'verse', 'puck', 'am_echo', ['en-IN', 'en-GB']),
];


const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

export const countryOf = (callsign: string): Country => accentOf(callsign);

/** The pilot flying this callsign. Same callsign, same persona, every session. */
export function personaFor(callsign: string): Persona {
  const c = countryOf(callsign);
  const pool = PERSONAS.filter((p) => p.country === c);
  const list = pool.length ? pool : PERSONAS.filter((p) => ['GB', 'NL', 'DE', 'US', 'NORDIC'].includes(p.country));
  return list[hash(callsign) % list.length];
}

/** Delivery instructions for prompt-driven engines. */
export const styleInstruction = (p: Persona) =>
  `You are an airline pilot talking to air traffic control over a VHF radio. Speak English with ${p.accent}. ` +
  'Calm, professional and efficient, slightly clipped, at a brisk radio pace; say numbers crisply digit by digit as written. No dramatic pauses.';

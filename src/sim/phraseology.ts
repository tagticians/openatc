// ICAO-style radio phraseology, written once for display and once for speech.
import { APT } from '../data/airport';

const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
export const LETTERS: Record<string, string> = {
  A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India',
  J: 'Juliett', K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo',
  S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'X-ray', Y: 'Yankee', Z: 'Zulu',
};

export const sayDigits = (s: string | number) =>
  String(s)
    .split('')
    .map((c) => (/\d/.test(c) ? DIGITS[+c] : LETTERS[c.toUpperCase()] ?? c))
    .join(' ');

/** "TRANSAVIA 5123" → "Transavia five one two three" */
export const sayCallsign = (spoken: string) => {
  const m = spoken.match(/^(.*?)\s*([0-9A-Z]+)$/);
  if (!m) return spoken;
  const name = m[1].toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return `${name} ${sayDigits(m[2])}`;
};

/** Transition altitude: levels above it are flight levels (3000 ft in NL, 18,000 ft in the US). */
export const ta = () => APT?.transitionAltitude ?? 3000;

/** Display form: "FL070" or "3000 ft". */
export const fmtLevel = (ft: number) =>
  ft > ta() ? `FL${String(Math.round(ft / 100)).padStart(3, '0')}` : `${Math.round(ft / 100) * 100} ft`;

/** Pressure setting: "QNH 1015" (ICAO) or "altimeter 2997" (FAA). */
export const pressureLabel = () => (APT?.phraseology === 'faa' ? 'altimeter' : 'QNH');

export const sayLevel = (ft: number) => {
  if (ft > ta()) return `flight level ${sayDigits(String(Math.round(ft / 100)).padStart(2, '0'))}`;
  const th = Math.floor(ft / 1000);
  const hu = Math.round((ft % 1000) / 100);
  return [th ? `${sayDigits(th)} thousand` : '', hu ? `${sayDigits(hu)} hundred` : ''].filter(Boolean).join(' ');
};

export const sayHeading = (h: number) => sayDigits(String(Math.round(h) || 360).padStart(3, '0'));
export const saySpeed = (s: number) => `${sayDigits(Math.round(s))} knots`;
export const sayRunway = (r: string) => sayDigits(r);
export const sayFix = (f: string) => (f.length <= 3 ? sayDigits(f) : f.charAt(0) + f.slice(1).toLowerCase());
export const sayQnh = (q: number) => sayDigits(Math.round(q));

/** Build a message in both display and speech forms from parts. */
export function msg(parts: Array<[display: string, speech?: string]>) {
  const kept = parts.filter((p) => p[0] || p[1]);
  return {
    text: kept.map((p) => p[0]).filter(Boolean).join(', '),
    speech: kept.map((p) => p[1] ?? p[0]).filter(Boolean).join(', '),
  };
}

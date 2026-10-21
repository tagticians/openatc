// Natural pilot speech. Standard ICAO phraseology underneath, delivered the way crews
// actually talk on a busy frequency: greetings, "with you", grouped flight numbers,
// clipped or chatty readbacks, the odd "uh". Each aircraft gets a stable personality.
//
// Every function returns { text, speech }: `text` for the radio log, `speech` shaped for
// TTS (spelled-out numbers, pronunciation fixes such as "Skip-hol").
import { LETTERS, ta } from './phraseology';
import { APT, isFaa, isUk } from '../data/airport';
import { accentOf } from '../data/traffic';

export type Style = 'terse' | 'standard' | 'chatty';

export interface Pilot {
  style: Style;
  /** Say the flight number grouped ("twelve thirty-four") rather than digit by digit. */
  grouped: boolean;
  greets: boolean;
  /** Chance of a hesitation ("uh") in a transmission. */
  filler: number;
  /** Uses informal shortcuts ("down to", "left two four zero") in readbacks. */
  casual: boolean;
  /** How often the crew adds a friendly word ("have a good one", "thanks for the help"). */
  warmth: number;
  /** How clipped readbacks are: 0 = textbook, 1 = "down to four, one-oh-one-three". */
  brevity: number;
  /** Puts the callsign first ("Easy two-two-five, left two-seven-zero") instead of last. */
  callsignFirst: number;
}

export interface Said {
  text: string;
  speech: string;
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
/** Deterministic pseudo-random in [0,1) from a seed string. */
const rnd = (seed: string) => (hash(seed) % 10000) / 10000;

export function pilotFor(callsign: string): Pilot {
  const r = rnd(callsign + 'style');
  const style: Style = r < 0.25 ? 'terse' : r < 0.7 ? 'standard' : 'chatty';
  return {
    style,
    grouped: rnd(callsign + 'grp') < 0.55,
    greets: style === 'chatty' || rnd(callsign + 'greet') < 0.4,
    filler: style === 'chatty' ? 0.35 : style === 'standard' ? 0.15 : 0.05,
    casual: style !== 'standard' || rnd(callsign + 'casual') < 0.3,
    warmth: style === 'chatty' ? 0.75 : style === 'standard' ? 0.4 : 0.12,
    brevity: Math.min(1, (style === 'terse' ? 0.75 : style === 'chatty' ? 0.45 : 0.3) + rnd(callsign + 'brev') * 0.3),
    callsignFirst: rnd(callsign + 'csf') < 0.25 ? 0.6 : 0.08,
  };
}

// ---------------------------------------------------------------- friendly asides
// Real frequencies are formal with a human edge: a "good day" on the way out, a "thanks for
// the help" after a long vector. Picked per crew and moment, never on every call.
const evening = () => {
  const h = +new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: APT?.timeZone ?? 'Europe/Amsterdam' }).format(new Date(clock() * 1000));
  return h >= 17;
};

/** A farewell when leaving the frequency, or '' if this crew keeps it formal this time. */
function farewell(callsign: string, p: Pilot, seed: string, kind: 'handoff' | 'vacated' | 'takeoff' = 'handoff') {
  if (rnd(seed + 'warm') >= p.warmth) return '';
  const accent = accentOf(callsign);
  const us = accent === 'US';
  const pool =
    kind === 'takeoff'
      ? ['rolling', "we're rolling", 'off we go']
      : kind === 'vacated'
        ? ['thanks for the help', 'thanks, see you next time', evening() ? 'have a good evening' : 'have a nice day', 'appreciate it', us ? 'have a good one' : 'cheers']
        : [
            'good day',
            evening() ? 'good evening' : 'have a nice day',
            'thanks for the help',
            'see you next time',
            us ? 'have a good one' : 'cheers',
            us ? 'appreciate it, have a good one' : 'thanks, bye',
            accent === 'AU' ? "cheers mate" : us ? 'see ya' : 'bye bye',
            'thanks, take care',
          ];
  return pool[hash(seed + 'pick') % pool.length];
}

/** Occasional acknowledgement in front of a readback: "roger", "copy that", "wilco". */
function ack(p: Pilot, seed: string) {
  if (p.style === 'terse' || rnd(seed + 'ack') > p.warmth * 0.3) return '';
  const pool = isFaa() ? ['roger, ', 'copy that, ', 'alright, ', 'okay, '] : ['roger, ', 'copy, ', 'okay, '];
  return pool[hash(seed + 'ackp') % pool.length];
}

// ---------------------------------------------------------------- spoken numbers
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
const TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const word = (n: number) => (n < 10 ? (n === 9 ? 'nine' : ONES[n]) : n < 20 ? TEENS[n - 10] : TENS[Math.floor(n / 10)] + (n % 10 ? `-${n % 10 === 9 ? 'nine' : ONES[n % 10]}` : ''));

/** Display pass: helpers emit compact log forms (KLM 1234, FL070, 240) instead of words. */
let DISPLAY = false;

export const digits = (s: string | number) =>
  DISPLAY
    ? String(s)
    : String(s)
    .split('')
    .map((c) => (/\d/.test(c) ? ONES[+c] : LETTERS[c.toUpperCase()] ?? c))
    .join(' ');

/** Flight number as airline crews say it: 1234 → "twelve thirty-four", 445 → "four forty-five", 63P → "six three papa". */
export function flightNumber(num: string, grouped: boolean) {
  if (DISPLAY) return num;
  if (grouped && /^[1-9]\d$/.test(num)) return word(+num);
  if (!grouped || !/^\d{3,4}$/.test(num)) return digits(num);
  if (num.length === 3) {
    const tail = +num.slice(1);
    return `${ONES[+num[0]]} ${tail < 10 ? `zero ${ONES[tail]}` : word(tail)}`;
  }
  const a = +num.slice(0, 2);
  const b = +num.slice(2);
  return `${word(a)} ${b === 0 ? 'hundred' : b < 10 ? `zero ${ONES[b]}` : word(b)}`;
}

/** Spoken callsign: telephony word(s) + number. KLM is spelled out so TTS doesn't say "Kalim". */
export function spokenCallsign(spoken: string, p: Pilot) {
  if (DISPLAY && /^PAPA HOTEL [A-Z]{3}$/.test(spoken)) return `PH-${spoken.slice(-3)}`;
  const m = spoken.match(/^(.*?)\s*([0-9A-Z]+)$/);
  if (!m) return spoken;
  const name = m[1] === 'KLM' ? (DISPLAY ? 'KLM' : 'K L M') : m[1].toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return `${name} ${flightNumber(m[2], p.grouped)}`;
}

export const sayLevelNatural = (ft: number, p: Pilot) => {
  if (DISPLAY) return ft > ta() ? `FL${String(Math.round(ft / 100)).padStart(3, '0')}` : `${Math.round(ft / 100) * 100} ft`;
  if (ft > ta()) {
    const fl = Math.round(ft / 100);
    return `flight level ${p.style === 'terse' ? ONES[Math.floor(fl / 10) % 10] + ' ' + ONES[fl % 10] : digits(String(fl).padStart(2, '0'))}`;
  }
  const th = Math.floor(ft / 1000);
  const hu = Math.round((ft % 1000) / 100);
  return [th ? `${word(th)} thousand` : '', hu ? `${word(hu)} hundred` : ''].filter(Boolean).join(' ');
};

/** Pronunciation fixes for TTS. */
export const fixSpeech = (s: string) =>
  s
    .replace(/Schiphol/g, 'Skip-hol')
    .replace(/\bQNH\b/g, 'Q N H')
    .replace(/\bILS\b/g, 'I L S')
    .replace(/\bATIS\b/g, 'atis');

/** Simulation clock (seconds); seeds per-transmission choices and greetings. */
let clock = () => Date.now() / 1000;
export const setTalkClock = (fn: () => number) => (clock = fn);

const greeting = (t = new Date(clock() * 1000)) => {
  const h = +new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: APT?.timeZone ?? 'Europe/Amsterdam' }).format(t);
  return h < 12 ? 'good morning' : h < 18 ? 'good afternoon' : 'good evening';
};

export const greetingNow = () => greeting();

const maybeUh = (p: Pilot, seed: string) => (!DISPLAY && rnd(seed) < p.filler ? 'uh, ' : '');
const ils = () => (DISPLAY ? 'ILS' : 'I L S');
const atisSay = (l: string) => (DISPLAY ? l : LETTERS[l]);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function finish(parts: string[], seed: string, p: Pilot): Said {
  const body = parts.filter(Boolean).join(', ');
  const out = cap(body.replace(/\s+,/g, ',')) + (/[.?!]$/.test(body) ? '' : '.');
  void seed;
  void p;
  return DISPLAY ? { text: out, speech: '' } : { text: out, speech: fixSpeech(out) };
}

/** Run a generator twice with identical choices: compact text for the log, words for speech. */
function dual<A extends unknown[]>(fn: (...a: A) => Said) {
  return (...a: A): Said => {
    DISPLAY = true;
    let text: string;
    try {
      text = fn(...a).text;
    } finally {
      DISPLAY = false;
    }
    return { text, speech: fn(...a).speech };
  };
}

// ---------------------------------------------------------------- transmissions
export interface ContactInfo {
  unit: string; // "Schiphol Arrival"
  spoken: string; // "KLM 1234"
  callsign: string;
  alt: number;
  cfl: number;
  star?: string; // "ARTIP 2A"
  atis: string;
  heavy?: boolean;
}

/** First call on frequency. */
function initialContactRaw(c: ContactInfo, p = pilotFor(c.callsign)): Said {
  const cs = spokenCallsign(c.spoken, p) + (c.heavy ? ' heavy' : '');
  const descending = c.alt > c.cfl + 300;
  const level = (ft: number) => sayLevelNatural(ft, p);
  const star = c.star ? procName(c.star) : '';
  const info = `information ${atisSay(c.atis)}`;
  const seed = c.callsign + 'ic';
  if (p.style === 'terse') {
    return finish([c.unit.replace(/^Schiphol /, ''), cs, descending ? `${level(c.cfl)}` : `level ${level(c.cfl)}`, atisSay(c.atis)], seed, p);
  }
  if (p.style === 'chatty') {
    return finish(
      [
        c.unit,
        p.greets ? greeting() : '',
        cs,
        `with you ${descending ? `${maybeUh(p, seed)}descending ${level(c.cfl)}` : `at ${level(c.cfl)}`}`,
        star ? `on the ${star}` : '',
        `and we have ${info}`,
      ],
      seed,
      p,
    );
  }
  return finish(
    [
      c.unit,
      p.greets ? greeting() : '',
      cs,
      descending ? `passing ${level(Math.round(c.alt / 100) * 100)}, descending ${level(c.cfl)}` : `maintaining ${level(c.cfl)}`,
      star ? `${star} arrival` : '',
      info,
    ],
    seed,
    p,
  );
}

export type Instr =
  | { k: 'heading'; hdg: number; turn?: 'L' | 'R' }
  | { k: 'level'; ft: number; verb: 'climb' | 'descend' | 'maintain'; qnh?: number; exp?: boolean }
  | { k: 'expedite'; what: 'vacate' }
  | { k: 'speed'; kt: number | null }
  | { k: 'direct'; fix: string }
  | { k: 'ils'; rwy: string; name?: string }
  | { k: 'land'; rwy: string }
  | { k: 'takeoff'; rwy: string; immediate?: boolean }
  | { k: 'lineup'; rwy: string }
  | { k: 'hold'; fix: string }
  | { k: 'contact'; unit: string; freq: string }
  | { k: 'own' }
  | { k: 'clearance'; dest: string; sid: string; squawk: string };

/** Procedure names: "RKN 2A" → "R K N two Alpha", "ARTIP 2A" → "ARTIP two Alpha". */
const procName = (n: string) =>
  DISPLAY
    ? n
    : n.replace(/^([A-Z]{2,3})(?= )/, (m) => m.split('').join(' ')).replace(/(\d)([A-Z])$/, (_, d, l) => `${ONES[+d]} ${LETTERS[l]}`);
const rwySay = (r: string) =>
  DISPLAY
    ? r
    : digits(r.slice(0, 2)) + (r[2] ? ` ${({ L: 'left', R: 'right', C: 'center' } as Record<string, string>)[r[2]]}` : '');
const hdgSay = (h: number) =>
  DISPLAY
    ? String(Math.round(h) || 360).padStart(3, '0')
    : digits(String(Math.round(h) || 360).padStart(3, '0'));

/** 180 → "one eighty", 270 → "two seventy" (casual speeds and US headings). */
const grouped3 = (n: number) => {
  if (DISPLAY) return String(n);
  const h = Math.floor(n / 100);
  const t = n % 100;
  return h ? `${ONES[h] === 'niner' ? 'nine' : ONES[h]} ${t === 0 ? 'hundred' : t < 10 ? `oh ${ONES[t]}` : word(t)}` : word(t);
};

/** "level eight zero" for FL080; FL350 → "three five zero". */
const flShort = (ft: number) => {
  const fl = Math.round(ft / 100);
  return DISPLAY ? `FL${String(fl).padStart(3, '0')}` : digits(fl >= 100 ? String(fl) : String(fl).padStart(2, '0'));
};

/** Thousands as crews clip them: "four thousand", US "eleven thousand", or just "four". */
const thousandsShort = (ft: number, us: boolean, bare = false) => {
  if (DISPLAY) return bare ? String(Math.round(ft / 100) * 100) : `${Math.round(ft / 100) * 100} ft`;
  const th = Math.floor(ft / 1000);
  const hu = Math.round((ft % 1000) / 100);
  if (hu) return `${us ? word(th) : digits(String(th))} thousand ${word(hu)} hundred`;
  if (bare) return us ? word(th) : `${digits(String(th))} thousand`;
  return `${us && th >= 10 ? word(th) : digits(String(th))} thousand`;
};

/** QNH / altimeter, in full or clipped ("one zero one three"; US "niner two"). */
const qnhSay = (q: number, us: boolean) => {
  if (DISPLAY) return { full: `${us ? 'altimeter' : 'QNH'} ${q}`, short: String(q) };
  const d = digits(String(q));
  return { full: `${us ? 'altimeter' : 'Q N H'} ${d}`, short: d };
};

/** Frequency in full ("one two six decimal eight two five") or the way crews clip it ("twenty-six eight two five"). */
const freqSay = (f: string, us: boolean) => {
  if (DISPLAY) return { full: f, short: f.replace(/^1/, '').replace(/0+$/, '') };
  const [a, b] = f.split('.');
  const bb = b.replace(/0+$/, '') || '0';
  const full = `${digits(a)} ${us ? 'point' : 'decimal'} ${digits(bb)}`;
  const short = us ? `${word(+a.slice(1))} ${digits(bb)}` : `${digits(a.slice(1))} ${digits(bb)}`;
  return { full, short };
};

/** Readback of one or more instructions, in this pilot's style. */
function readbackRaw(spoken: string, callsign: string, instrs: Instr[], alt0 = 0, p = pilotFor(callsign)): Said {
  const seq = String(instrs.length) + instrs.map((i) => i.k).join('');
  const seed = callsign + seq + Math.floor(clock() / 60);
  const cs = spokenCallsign(spoken, p);
  const us = isFaa();
  /**
   * Pick a phrasing: variants run from textbook to clipped; this crew's brevity decides how far
   * along they tend to land, the seed decides this time.
   */
  const say = (key: string, variants: string[]) => {
    const r = rnd(seed + key);
    const lean = r < p.brevity ? 0.5 + r / (2 * Math.max(p.brevity, 0.01)) : (r - p.brevity) / (2 * Math.max(1 - p.brevity, 0.01));
    return variants[Math.min(variants.length - 1, Math.floor(lean * variants.length))];
  };
  const parts = instrs.map((i, n): string => {
    const k = `${n}${i.k}`;
    switch (i.k) {
      case 'heading': {
        const dir = i.turn === 'L' ? 'left' : i.turn === 'R' ? 'right' : '';
        const h = hdgSay(i.hdg);
        return say(k, [
          `${dir ? `turn ${dir} heading` : 'heading'} ${h}`,
          `${dir ? `${dir} heading` : 'heading'} ${h}`,
          `${dir ? `${dir} ` : 'heading '}${h}`,
          dir ? `${h}, ${dir}` : `${h} on the heading`,
          `${dir ? `${dir} ` : ''}${us && !DISPLAY && i.hdg % 10 === 0 ? grouped3(i.hdg) : h}`,
        ]);
      }
      case 'level': {
        const lvl = sayLevelNatural(i.ft, p);
        const fl = i.ft > ta();
        const short = fl ? (DISPLAY ? flShort(i.ft) : `level ${flShort(i.ft)}`) : thousandsShort(i.ft, us);
        const qn = i.qnh ? qnhSay(i.qnh, us) : null;
        const q = (clip: boolean) => (qn ? `, ${clip ? qn.short : qn.full}` : '');
        if (i.verb === 'maintain') return say(k, [`maintain ${lvl}${q(false)}`, `maintaining ${lvl}${q(true)}`, `${fl ? short : lvl}${q(true)}`]);
        if (i.exp) {
          const up = i.verb === 'climb';
          return say(k, [`expedite ${up ? 'climb' : 'descent'} ${lvl}${q(false)}`, `expediting ${up ? 'up' : 'down'} to ${lvl}${q(true)}`, `${up ? 'up' : 'down'} to ${fl ? short : lvl}, expediting${q(true)}`]);
        }
        const up = i.verb === 'climb';
        const passing = Math.round(alt0 / 1000) * 1000;
        return say(k, [
          us ? `${i.verb} and maintain ${lvl}${q(false)}` : `${i.verb} ${fl ? lvl : `altitude ${lvl}${isUk() && !DISPLAY ? ' feet' : ''}`}${q(false)}`,
          `${i.verb} ${lvl}${q(false)}`,
          `${up ? 'climbing' : 'descending'} ${lvl}${q(true)}`,
          `${up ? 'up' : 'down'} to ${fl ? short : lvl}${q(true)}`,
          us && !fl && passing > i.ft + 1500 ? `out of ${thousandsShort(passing, true, true)} for ${thousandsShort(i.ft, true, true)}${q(true)}` : `${up ? 'up' : 'down'} to ${short}${q(true)}`,
        ]);
      }
      case 'speed': {
        if (i.kt === null) return say(k, ['resume normal speed', 'normal speed', 'speed\'s yours, thanks'].slice(0, p.warmth > 0.5 ? 3 : 2));
        const kts = DISPLAY ? 'kt' : 'knots';
        return say(k, [`speed ${digits(i.kt)} ${kts}`, `${digits(i.kt)} ${kts}`, `${digits(i.kt)}`, `speed ${grouped3(i.kt)}`, `${grouped3(i.kt)}`]);
      }
      case 'direct':
        return say(k, [`proceeding direct ${i.fix}`, `direct ${i.fix}`, `direct to ${i.fix}`, `${i.fix} direct`, `direct ${i.fix}`]);
      case 'ils': {
        const app = !i.name || i.name === 'ILS' ? ils() : i.name;
        const r = rwySay(i.rwy);
        return say(k, [
          `cleared ${app} approach runway ${r}`,
          `cleared ${app} ${r}`,
          p.style === 'chatty' ? `cleared ${app} ${r}, we'll call you established` : `cleared ${app} ${r}`,
          `${app} ${r}, cleared`,
          `cleared the ${app === ils() ? ils() : app}`,
        ]);
      }
      case 'land': {
        const r = rwySay(i.rwy);
        return say(k, [`runway ${r}, cleared to land`, `cleared to land ${r}`, `cleared to land ${r}`, `${r}, cleared to land`, 'cleared to land']);
      }
      case 'takeoff': {
        const r = rwySay(i.rwy);
        if (i.immediate) return say(k, [`cleared immediate take-off runway ${r}`, `cleared immediate take-off ${r}`, `immediate, ${r}${p.style === 'chatty' ? ", we're rolling" : ''}`, 'rolling now']);
        return say(k, [`runway ${r}, cleared for take-off`, `cleared for take-off ${r}`, `cleared take-off ${r}`, `cleared to go ${r}`]);
      }
      case 'expedite':
        return say(k, ['wilco, expediting', 'expediting', 'will do']);
      case 'lineup': {
        const r = rwySay(i.rwy);
        return say(k, [`line up and wait runway ${r}`, `line up and wait ${r}`, `lining up ${r}`, `lining up and waiting`]);
      }
      case 'hold':
        return say(k, [`hold at ${i.fix} as published`, `hold at ${i.fix}`, `holding at ${i.fix}`, `${i.fix}, hold`]);
      case 'contact': {
        const f = freqSay(i.freq, us);
        return say(k, [`${i.unit} ${f.full}`, `${i.unit} ${f.full}`, `${f.full}`, `${f.short}`, `over to ${i.unit.toLowerCase().includes('tower') ? 'tower' : i.unit.split(' ').pop()}, ${f.short}`]);
      }
      case 'own':
        return say(k, ['resume own navigation', 'own navigation', 'own nav']);
      case 'clearance':
        return say(k, [
          `cleared to ${i.dest}, ${procName(i.sid)} departure, squawk ${digits(i.squawk)}`,
          `cleared ${i.dest}, ${procName(i.sid)} departure, squawk ${digits(i.squawk)}`,
          `${procName(i.sid)}, squawk ${digits(i.squawk)}`,
        ]);
    }
  });
  const lead = p.style === 'chatty' && rnd(seed + 'w') < 0.3 ? (instrs.length > 1 ? 'okay, ' : '') : maybeUh(p, seed) || ack(p, seed);
  // Leaving the frequency, cleared to land or for take-off: room for a friendly word.
  const last = instrs[instrs.length - 1];
  const extra =
    last?.k === 'contact'
      ? farewell(callsign, p, seed)
      : last?.k === 'takeoff' && rnd(seed + 'to') < 0.35
        ? farewell(callsign, p, seed, 'takeoff')
        : (last?.k === 'land' || last?.k === 'clearance') && rnd(seed + 'thx') < p.warmth * 0.5
          ? isFaa() ? 'thanks' : 'thank you'
          : '';
  if (rnd(seed + 'csf') < p.callsignFirst) return finish([cs, lead + parts[0], ...parts.slice(1), extra], seed, p);
  return finish([lead + parts[0], ...parts.slice(1), cs, extra], seed, p);
}

function establishedRaw(spoken: string, callsign: string, rwy: string, p = pilotFor(callsign)): Said {
  const cs = spokenCallsign(spoken, p);
  if (p.style === 'terse') return finish([cs, `established ${rwySay(rwy)}`], callsign + 'est', p);
  return finish([cs, `established ${p.style === 'chatty' ? 'on the localizer' : 'localizer'} ${rwySay(rwy)}`], callsign + 'est', p);
}

function goingAroundRaw(spoken: string, callsign: string, p = pilotFor(callsign)): Said {
  return finish([spokenCallsign(spoken, p), p.style === 'chatty' ? 'going around, going around' : 'going around'], callsign + 'ga', p);
}

function enteringHoldRaw(spoken: string, callsign: string, fix: string, ft: number, p = pilotFor(callsign)): Said {
  const cs = spokenCallsign(spoken, p);
  return finish([cs, `${p.style === 'chatty' ? "we're " : ''}entering the hold at ${fix}`, sayLevelNatural(ft, p)], callsign + 'hold', p);
}

function requestHigherRaw(spoken: string, callsign: string, ft: number, p = pilotFor(callsign)): Said {
  const cs = spokenCallsign(spoken, p);
  if (p.style === 'chatty') return finish([cs, `level ${sayLevelNatural(ft, p)}`, 'any chance of higher?'], callsign + 'rh', p);
  return finish([cs, `level ${sayLevelNatural(ft, p)}`, 'request further climb'], callsign + 'rh', p);
}

function sayAgainRaw(spoken: string, callsign: string, p = pilotFor(callsign)): Said {
  const cs = spokenCallsign(spoken, p);
  return p.style === 'terse' ? finish(['say again?', cs], callsign + 'sa', p) : finish([cs, 'sorry, say again?'], callsign + 'sa', p);
}

function vacatedRaw(spoken: string, callsign: string, p = pilotFor(callsign)): Said {
  const seed = callsign + 'vac' + Math.floor(clock() / 60);
  return finish([spokenCallsign(spoken, p), 'runway vacated', farewell(callsign, p, seed, 'vacated')], seed, p);
}

export const initialContact = dual(initialContactRaw);
export const vacated = dual(vacatedRaw);
export const readback = dual(readbackRaw);
export const established = dual(establishedRaw);
export const goingAround = dual(goingAroundRaw);
export const enteringHold = dual(enteringHoldRaw);
export const requestHigher = dual(requestHigherRaw);
export const sayAgain = dual(sayAgainRaw);
/** Log form of a callsign: "TRANSAVIA 5568" → "Transavia 5568" (KLM stays KLM). */
export const displayCallsign = (spoken: string) => {
  const reg = spoken.match(/^PAPA HOTEL ([A-Z]{3})$/);
  if (reg) return `PH-${reg[1]}`;
  const m = spoken.match(/^(.*?)\s*([0-9A-Z]+)$/);
  if (!m) return spoken;
  const name = m[1] === 'KLM' ? 'KLM' : m[1].toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return `${name} ${m[2]}`;
};

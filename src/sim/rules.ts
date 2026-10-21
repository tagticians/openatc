// Radio rules per region: how a controller words clearances and what crews expect to hear.
// An airport picks one with `phraseology` ('icao' default, 'faa', 'uk'); everything that differs
// between countries lives here, so adding a region is one new entry.
import { APT } from '../data/airport';
import { DESTINATIONS } from '../data/traffic';
import { LETTERS, fmtLevel, sayDigits, sayLevel } from './phraseology';

export type Verb = 'climb' | 'descend' | 'maintain';

export interface RadioRules {
  id: 'icao' | 'faa' | 'uk';
  /** Word in front of the pressure setting. */
  pressureWord: 'QNH' | 'altimeter';
  /** Pressure as reported: QNH hPa, or altimeter in hundredths of inHg. */
  pressure(w: { qnh: number; altimeter?: number }): number;
  /** Scope/briefing display of the pressure: label and value. */
  pressureDisplay(w: { qnh: number; altimeter?: number }): { label: string; unit: string; value: string };
  /** Does this level clearance come with the pressure setting? */
  givesPressure(a: { kind: 'arr' | 'dep'; alt: number }, verb: Verb, ft: number): boolean;
  /** "descend" (ICAO) or "descend and maintain" (FAA). */
  verb(v: Verb): string;
  /** Words before an altitude below the transition altitude ("altitude " in the UK). */
  altitudeWord(ft: number): string;
  /** Spoken unit after such an altitude (" feet" in the UK). */
  altitudeUnit(ft: number): string;
  /** Expedited level clearance, display form. */
  expedite(verb: Verb, level: string, pressure: string): string;
  /** "decimal" or "point" in frequencies. */
  decimal: 'decimal' | 'point';
  /** Approach clearance on vectors keeps the assigned altitude until established (FAA). */
  maintainUntilEstablished: boolean;
  approachClearance(appName: string, rwy: string, untilFt: number): string;
  /** IFR clearance: ATC text and the readback (display, speech). */
  ifrClearance(dest: string, sid: string, squawk: string): { atc: string; rb: [string, string] };
  /** Departure first call: from a gate (FAA, "request clearance") or a stand ("request start-up"). */
  deliveryParts(atis: string, dest: string, stand: string): [string, string][];
  /** Departures report to the radar controller (FAA) rather than "<city>, airborne". */
  airborneToRadar: boolean;
  /** US crew habits in readbacks ("copy that", "two seventy", "out of eleven for four"). */
  usCrews: boolean;
}

const sidSay = (sid: string) => sid.replace(/(\d)([A-Z])$/, (_, d, l) => `${d} ${LETTERS[l]}`);

const ICAO: RadioRules = {
  id: 'icao',
  pressureWord: 'QNH',
  pressure: (w) => Math.round(w.qnh),
  pressureDisplay: (w) => ({ label: 'QNH', unit: 'QNH hPa', value: String(w.qnh) }),
  givesPressure: (a, _v, ft) => ft <= APT.transitionAltitude && a.alt > APT.transitionAltitude,
  verb: (v) => v,
  altitudeWord: () => '',
  altitudeUnit: () => '',
  expedite: (v, level, p) => `expedite ${v === 'climb' ? 'climb' : 'descent'} ${level}${p}`,
  decimal: 'decimal',
  maintainUntilEstablished: false,
  approachClearance: (app, rwy) => `cleared ${app} approach runway ${rwy}`,
  // Controllers clear to the destination by name ("cleared to Rome"), not by its ICAO code.
  ifrClearance: (dest, sid, sq) => {
    const city = DESTINATIONS[dest]?.city ?? dest;
    return {
      atc: `cleared to ${city}, ${sid} departure, squawk ${sq}, start-up approved`,
      rb: [`cleared ${city} ${sid}, squawk ${sq}, start-up approved`, `cleared to ${city}, ${sidSay(sid)} departure, squawk ${sayDigits(sq)}, start-up approved`],
    };
  },
  deliveryParts: (atis, dest, stand) => [
    [`stand ${stand}`, `stand ${sayDigits(stand)}`],
    [`information ${atis}`, `information ${LETTERS[atis]}`],
    [`IFR to ${DESTINATIONS[dest]?.city ?? dest}`, `IFR to ${DESTINATIONS[dest]?.city ?? dest}`],
    ['request start-up', 'request start-up'],
  ],
  airborneToRadar: false,
  usCrews: false,
};

const FAA: RadioRules = {
  ...ICAO,
  id: 'faa',
  pressureWord: 'altimeter',
  pressure: (w) => w.altimeter ?? Math.round(w.qnh * 2.953),
  pressureDisplay: (w) => ({ label: 'ALT', unit: 'altimeter inHg', value: ((w.altimeter ?? Math.round(w.qnh * 2.953)) / 100).toFixed(2) }),
  // The approach controller gives the altimeter with the first descent.
  givesPressure: (a, v) => v === 'descend' && a.kind === 'arr',
  verb: (v) => (v === 'maintain' ? v : `${v} and maintain`),
  expedite: (v, level, p) => `${v} and maintain ${level}${p}, expedite`,
  decimal: 'point',
  maintainUntilEstablished: true,
  approachClearance: (app, rwy, until) => `maintain ${fmtLevel(until)} until established, cleared ${app} runway ${rwy} approach`,
  ifrClearance: (dest, sid, sq) => ({
    atc: `cleared to ${DESTINATIONS[dest]?.name ?? dest} airport, ${sid} departure, then as filed, squawk ${sq}`,
    rb: [`cleared ${dest} ${sid}, squawk ${sq}`, `cleared to ${DESTINATIONS[dest]?.city ?? sayDigits(dest)}, ${sidSay(sid)} departure, squawk ${sayDigits(sq)}`],
  }),
  deliveryParts: (atis, dest, gate) => [
    [`IFR to ${DESTINATIONS[dest]?.city ?? dest}`, `IFR to ${DESTINATIONS[dest]?.city ?? dest}`],
    [`with ${atis}`, `with ${LETTERS[atis]}`],
    [`gate ${gate}`, `gate ${gate}`],
  ],
  airborneToRadar: true,
  usCrews: true,
};

const UK: RadioRules = {
  ...ICAO,
  id: 'uk',
  // CAP 413: "descend altitude four thousand feet".
  altitudeWord: (ft) => (ft <= APT.transitionAltitude ? 'altitude ' : ''),
  altitudeUnit: (ft) => (ft <= APT.transitionAltitude ? ' feet' : ''),
};

const RULES = { icao: ICAO, faa: FAA, uk: UK };

/** Radio rules of the current airport. */
export const rules = (): RadioRules => RULES[APT?.phraseology ?? 'icao'];

/** Spoken level with the region's altitude wording ("altitude four thousand feet"). */
export const sayLevelRules = (ft: number) => `${rules().altitudeWord(ft)}${sayLevel(ft)}${rules().altitudeUnit(ft)}`;

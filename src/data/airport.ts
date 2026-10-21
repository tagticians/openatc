// Airport-agnostic data model and the current-airport registry.
// The airport is chosen once at boot (?apt=EHAM) before anything else reads it.
import type { Operator } from './traffic';

export type LatLon = [number, number];

/** Altitude constraint in feet (flight levels expressed as feet, FL070 = 7000). */
export interface AltConstraint {
  at?: number;
  above?: number;
  below?: number;
}

export type Leg =
  | { t: 'CA'; crs: number; alt: number } // course (MAG) to altitude
  | { t: 'VM'; crs: number } // heading (MAG) until radar vectors: SIDs that end in vectors
  | { t: 'FIX'; fix: string; alt?: AltConstraint; spd?: number; flyover?: boolean };

export interface Procedure {
  name: string;
  ident: string;
  runway?: string;
  legs: Leg[];
  initialAlt?: number;
}

export interface Runway {
  id: string;
  thr: LatLon;
  end: LatLon;
  trueHdg: number;
  magHdg: number;
  elevation: number;
  length?: number;
  ils?: { ident: string; freq: string };
  /** Published transitions from an IAF (or VOR) to the intermediate fix, keyed by start fix. */
  transitions: Record<string, Leg[]>;
  /** Intermediate fix where the final approach starts. */
  ifix?: string;
  /** Final approach fix (FAP) and its altitude, on the localizer. */
  fap?: { fix: string; alt: number };
  missed: Leg[];
  circuit?: 'L' | 'R';
  /** Glidepath angle in degrees (3 if not set). LOC-only approaches fly the published VDA. */
  gpAngle?: number;
  /** Localizer without glideslope: cleared "localizer runway 27 approach". */
  locOnly?: boolean;
  /** Curved RNP final (DCA river approach): fly the legs to the IF, never cut in earlier. */
  curvedFinal?: boolean;
}

export interface Airspace {
  name: string;
  cls: string;
  lower: string;
  upper: string;
  polygon: LatLon[];
}

export interface Holding {
  inbound: number;
  turn: 'L' | 'R';
  minAlt: number;
}

export interface RunwayConfig {
  name: string;
  arr: string[];
  dep: string[];
}

export type Role = 'combined' | 'arrival';

export interface AirportData {
  icao: string;
  /** Radio conventions: ICAO (Europe: QNH hPa, TA 3000-ish) or FAA (altimeter inHg, FL180). */
  phraseology?: 'icao' | 'faa' | 'uk';
  /** IANA time zone, for greetings. */
  timeZone?: string;
  iata: string;
  name: string;
  city: string;
  region: string;
  arp: LatLon;
  elevation: number;
  magVar: number;
  transitionAltitude: number;
  frequencies: { approach: string; tower: string; delivery?: string; atis?: string; arrival?: string; departure?: string };
  callsigns: { approach: string; tower: string; delivery: string; departureHandoff: string; handoffFreq: string };
  runways: Record<string, Runway>;
  /** Physical runways as [end A, end B] pairs, for drawing. */
  strips: [string, string][];
  configs: RunwayConfig[];
  sids: Procedure[];
  stars: Procedure[];
  holdings: Record<string, Holding>;
  airspace: Airspace[];
  fixes: Record<string, LatLon>;
  scopeFixes: string[];
  sidInitialAlt: number;
  /** IAF levels: lowest stack level handed over by the ACC, and the top of the stack. */
  stack: { base: number; top: number; maxInbound: number };
  /** Arrivals appear this far out along their STAR (NM from the ARP). */
  spawnDistance: [number, number];
  roles: Role[];
  defaultRates: { arrivals: number; departures: number };
  operators: Operator[];
  view: { center: LatLon; zoom: number; flyoverZoom: number };
  facts: { runways: string; airspace: string; procedures: string; frequencies: string; notes: string };
  /** Fixes on the scope edge offered as quick "direct" targets for departures. */
  exitFixes?: string[];
  /** Who has the aircraft after the player: shown in messages ("with SoCal Departure"). */
  aiDeparture?: string;
  /** Minimum vectoring altitude sectors (FAA MVA chart). Without them, 2000 ft applies everywhere. */
  mva?: { alt: number; polygon: LatLon[] }[];
  /** Prohibited (P) and restricted (R) areas: entering a P area is a violation. */
  restricted?: Airspace[];
  /** VFR general aviation and helicopter emergency services. */
  ga?: GaConfig;
}

export interface Helipad {
  id: string;
  name: string;
  pos: LatLon;
  /** Corridor points (in order from the base) used to get there. */
  via: string[];
}

export interface GaConfig {
  /** VFR reporting points: `entry` ones are where VFR traffic enters and leaves the zone. */
  points: Record<string, LatLon>;
  entry: string[];
  /** Circuit height, ft. */
  circuitAlt: number;
  /** VFR movements per hour (arrivals + departures). */
  rate: number;
  /** Fields VFR traffic comes from or goes to. */
  fields: string[];
  types: string[];
  hems?: {
    callsign: string;
    spoken: string;
    type: string;
    operator: string;
    base: Helipad;
    pads: Helipad[];
    corridor: { name: string; points: Record<string, LatLon> };
    /** Hours between missions. */
    interval: [number, number];
    /** Places an accident scene can be (approximate town centres), and the share of missions that go to one. */
    scenes?: { name: string; pos: LatLon }[];
    sceneShare?: number;
  };
}

// eslint-disable-next-line import/no-mutable-exports
export let APT: AirportData;
export let ROLE: Role = 'combined';

export function setAirport(a: AirportData, role?: Role) {
  APT = a;
  ROLE = role && a.roles.includes(role) ? role : a.roles[0];
}

export const isFaa = () => APT.phraseology === 'faa';
/** UK (CAP 413): "descend altitude four thousand feet". */
export const isUk = () => APT.phraseology === 'uk';

/** QNH (hPa) as the airport reports it: "1015" or, in the US, altimeter "2997". */
export const altimeterFrom = (w: { qnh: number; altimeter?: number }) =>
  isFaa() ? w.altimeter ?? Math.round(w.qnh * 2.953) : Math.round(w.qnh);

const inPoly = (p: LatLon, poly: LatLon[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if (yi > p[0] !== yj > p[0] && p[1] < ((xj - xi) * (p[0] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/**
 * Lowest altitude the controller may vector an aircraft at this position. Overlapping sectors
 * (holes in the chart) resolve to the highest. 2000 ft where no chart is loaded.
 */
export const inside = (p: LatLon, poly: LatLon[]) => inPoly(p, poly);

export function mvaAt(p: LatLon): number {
  if (!APT.mva?.length) return 2000;
  let best = 0;
  for (const s of APT.mva) if (s.alt > best && inPoly(p, s.polygon)) best = s.alt;
  return best || 2000;
}

/** Holding pattern for a fix: published, or a standard right-hand one inbound from the current position. */
export const holdingFor = (fix: string): Holding | undefined => APT.holdings[fix];

// Traffic data: one registry of airlines (callsign word, accent, brand colour), aircraft
// performance, destinations, and per-airport traffic mixes. All of it lives in JSON next to this
// file; adding an airline is one entry in airlines.json, adding it to an airport one line in
// traffic/<ICAO>.json.
import airlinesJson from './airlines.json';
import aircraftJson from './aircraft.json';
import destinationsJson from './destinations.json';
import EHRD from './traffic/EHRD.json';
import EHAM from './traffic/EHAM.json';
import EGLC from './traffic/EGLC.json';
import KSAN from './traffic/KSAN.json';
import KORF from './traffic/KORF.json';
import KDCA from './traffic/KDCA.json';

export type Wake = 'L' | 'M' | 'H' | 'J';

export interface AircraftType {
  icao: string;
  name: string;
  wake: Wake;
  /** Typical speeds, KIAS. */
  v2: number;
  vApp: number;
  vClimb: number; // below FL100
  /** Rates, ft/min. */
  climb: number;
  descent: number;
  /** Acceleration on take-off roll, kt/s. */
  accel: number;
}

/** Accent group a crew is voiced with (see audio/personas.ts). */
export type Accent = 'NL' | 'DE' | 'FR' | 'ES' | 'IT' | 'TR' | 'PL' | 'NORDIC' | 'GB' | 'IE' | 'US' | 'AU' | 'IN' | 'SG' | 'OTHER';

export interface Airline {
  icao: string;
  iata?: string;
  name?: string;
  /** Radio callsign word, e.g. SPEEDBIRD. */
  telephony?: string;
  accent?: Accent;
  /** Brand colour for strips and badges. */
  color?: string;
}

/** An airline (or one of its fleets) as it operates at the current airport. */
export interface Operator {
  icao: string;
  iata: string;
  name: string;
  telephony: string;
  types: string[];
  /** Destinations (ICAO) this operator flies in synthetic traffic. */
  routes: string[];
  weight: number; // relative share of movements
  numbering: [number, number];
}

export interface Destination {
  icao: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
}

interface MixEntry {
  airline: string;
  name?: string;
  types: string[];
  routes: string[];
  weight: number;
  numbering: number[];
}

export const AIRLINES: Record<string, Airline> = Object.fromEntries((airlinesJson as Airline[]).map((a) => [a.icao, a]));
export const airline = (icao: string): Airline | undefined => AIRLINES[icao];
/** Accent group for a callsign (first three letters), 'OTHER' if unknown. */
export const accentOf = (callsign: string): Accent => AIRLINES[callsign.slice(0, 3)]?.accent ?? AIRLINES[callsign.slice(0, 4)]?.accent ?? 'OTHER';

export const AIRCRAFT = aircraftJson as Record<string, AircraftType>;
export const DESTINATIONS = destinationsJson as Record<string, Destination>;
export const TELEPHONY: Record<string, string> = Object.fromEntries(
  Object.values(AIRLINES)
    .filter((a) => a.telephony)
    .map((a) => [a.icao, a.telephony!]),
);

function mix(entries: MixEntry[]): Operator[] {
  return entries.map((e) => {
    const a = AIRLINES[e.airline];
    if (!a) throw new Error(`traffic mix: unknown airline ${e.airline}`);
    for (const t of e.types) if (!AIRCRAFT[t]) throw new Error(`traffic mix: unknown aircraft type ${t} (${e.airline})`);
    return {
      icao: a.icao,
      iata: a.iata ?? '',
      name: e.name ?? a.name ?? a.icao,
      telephony: a.telephony ?? a.icao,
      types: e.types,
      routes: e.routes,
      weight: e.weight,
      numbering: [e.numbering[0], e.numbering[1]],
    };
  });
}

/** Traffic mix per airport (traffic/<ICAO>.json). */
export const TRAFFIC: Record<string, Operator[]> = {
  EHRD: mix(EHRD as MixEntry[]),
  EHAM: mix(EHAM as MixEntry[]),
  EGLC: mix(EGLC as MixEntry[]),
  KSAN: mix(KSAN as MixEntry[]),
  KORF: mix(KORF as MixEntry[]),
  KDCA: mix(KDCA as MixEntry[]),
};

// Names the airport modules use.
export const OPERATORS = TRAFFIC.EHRD;
export const EHAM_OPERATORS = TRAFFIC.EHAM;
export const EGLC_OPERATORS = TRAFFIC.EGLC;
export const KSAN_OPERATORS = TRAFFIC.KSAN;
export const KORF_OPERATORS = TRAFFIC.KORF;
export const KDCA_OPERATORS = TRAFFIC.KDCA;

// San Diego International (KSAN), generated from the FAA CIFP (public domain) by
// scripts/cifp/build_airport.py. One runway, 09/27: west flow lands 27 on the localizer
// (no glideslope, 3.5° descent over downtown); east flow (Santa Ana winds) uses the ILS 09.
import raw from './airports/KSAN.json';
// FAA MVA chart SCT FUS3 2025 v1 (public domain, NOT FOR NAVIGATION), via scripts/cifp/mva.py.
import mva from './airports/KSAN.mva.json';
import { fromCifp, type CifpRaw } from './cifpAirport';
import { KSAN_OPERATORS } from './traffic';

export const KSAN = fromCifp(raw as unknown as CifpRaw, {
  icao: 'KSAN',
  iata: 'SAN',
  name: 'San Diego International',
  city: 'San Diego',
  region: 'Lindbergh Field, California',
  phraseology: 'faa',
  timeZone: 'America/Los_Angeles',
  frequencies: { approach: '119.600', tower: '118.300', delivery: '125.900', atis: '134.800' },
  callsigns: { approach: 'SoCal Approach', tower: 'San Diego Tower', delivery: 'San Diego Clearance', departureHandoff: 'Los Angeles Center', handoffFreq: '132.150' },
  aiDeparture: 'SoCal Departure',
  strips: [['09', '27']],
  configs: [
    { name: 'West', arr: ['27'], dep: ['27'] },
    { name: 'East', arr: ['09'], dep: ['09'] },
  ],
  // "Climb via SID": eastbound departures cross the arrival flows, so they top out above them.
  sidInitialAlt: 15000,
  // STARs end at 5000–6000 ft (LYNDI, TMCAT, NADDO); stack above that when holding.
  stack: { base: 6000, top: 11000, maxInbound: 7 },
  spawnDistance: [42, 50],
  roles: ['combined'],
  defaultRates: { arrivals: 16, departures: 14 },
  operators: KSAN_OPERATORS,
  view: { center: [32.79, -117.08], zoom: 8.35, flyoverZoom: 13.2 },
  exitFixes: ['PADRZ', 'ECHHO', 'CLSSY', 'MMOTO', 'FALCC', 'BROWS'],
  mva: mva as { alt: number; polygon: [number, number][] }[],
  facts: {
    runways: '09 / 27|2865 m (9401 ft) · LOC 27 at 3.5° · ILS 09',
    airspace: 'Class B · SFC–10,000 ft|Transition altitude 18,000 ft',
    frequencies: '119.600|SoCal APP · TWR 118.300 · CLR 125.900 · ATIS 134.800',
    notes: 'Approach & Tower combined: the busiest single runway in the US',
  },
});

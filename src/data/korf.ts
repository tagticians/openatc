// Norfolk International (KORF), generated from the FAA CIFP (public domain) by
// scripts/cifp/build_airport.py. One runway, 05/23, ILS at both ends; Class C airspace;
// arrivals on the KOHLS and OUTLA STARs, departures on the HOLND, NUTIY and SWOPE SIDs.
import raw from './airports/KORF.json';
// FAA MVA chart ORF FUS3 (public domain, NOT FOR NAVIGATION), via scripts/cifp/mva.py.
import mva from './airports/KORF.mva.json';
import { fromCifp, type CifpRaw } from './cifpAirport';
import { KORF_OPERATORS } from './traffic';

export const KORF = fromCifp(raw as unknown as CifpRaw, {
  icao: 'KORF',
  iata: 'ORF',
  name: 'Norfolk International',
  city: 'Norfolk',
  region: 'Hampton Roads, Virginia',
  phraseology: 'faa',
  timeZone: 'America/New_York',
  frequencies: { approach: '118.900', tower: '120.800', delivery: '118.500', atis: '127.150' },
  callsigns: { approach: 'Norfolk Approach', tower: 'Norfolk Tower', delivery: 'Norfolk Clearance', departureHandoff: 'Washington Center', handoffFreq: '133.550' },
  aiDeparture: 'Norfolk Departure',
  strips: [['05', '23']],
  configs: [
    { name: 'Southwest', arr: ['23'], dep: ['23'] },
    { name: 'Northeast', arr: ['05'], dep: ['05'] },
  ],
  sidInitialAlt: 10000,
  stack: { base: 6000, top: 11000, maxInbound: 6 },
  spawnDistance: [38, 46],
  roles: ['combined'],
  defaultRates: { arrivals: 12, departures: 11 },
  operators: KORF_OPERATORS,
  view: { center: [36.92, -76.17], zoom: 8.4, flyoverZoom: 13.2 },
  exitFixes: ['HOLND', 'NUTIY', 'SWOPE', 'KOOKI', 'ECG', 'HCM'],
  mva: mva as { alt: number; polygon: [number, number][] }[],
  facts: {
    runways: '05 / 23|2744 m (9001 ft) · ILS both ends',
    airspace: 'Class C · SFC–4000 ft|Transition altitude 18,000 ft',
    frequencies: '118.900|Norfolk APP · TWR 120.800 · ATIS 127.150',
    notes: 'Approach & Tower combined: Hampton Roads traffic over the water',
  },
});

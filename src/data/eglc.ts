// London City (EGLC), from the UK eAIP (NATS, AIRAC 2026-10-01): coding tables of the SIDs,
// STARs and RNAV approach transitions, ILS 09/27 at 5.5°, CTR and ATZ. Built from the AIP
// charts (see THIRD_PARTY_NOTICES.md: © NATS, reuse needs NATS's permission).
// Computed points (no published name): IF09, FAP09/27 (ILS DME 4.9 / 3.4), MA09/27 (D5.6).
// Magnetic variation 0.6°E as used by the charts (AD 2.2 gives 1.39°E).
import raw from './airports/EGLC.json';
import { fromCifp, type CifpRaw } from './cifpAirport';
import { EGLC_OPERATORS } from './traffic';

export const EGLC = fromCifp(raw as unknown as CifpRaw, {
  icao: 'EGLC',
  iata: 'LCY',
  name: 'London City',
  city: 'London',
  region: 'Royal Docks, Newham',
  phraseology: 'uk',
  timeZone: 'Europe/London',
  // No delivery frequency: clearance by datalink or from City Ground.
  frequencies: { approach: '132.700', tower: '118.080', delivery: '121.830', atis: '136.355' },
  callsigns: { approach: 'Thames Director', tower: 'City Tower', delivery: 'City Ground', departureHandoff: 'London Control', handoffFreq: '133.175' },
  aiDeparture: 'Thames Director',
  strips: [['09', '27']],
  configs: [
    { name: 'West', arr: ['27'], dep: ['27'] },
    { name: 'East', arr: ['09'], dep: ['09'] },
  ],
  // Every SID stops at 3000 ft: the London TMA is just above.
  sidInitialAlt: 3000,
  // JACKO (east) and GODLU (south-east) stacks: FL080 upwards.
  stack: { base: 8000, top: 14000, maxInbound: 9 },
  spawnDistance: [54, 60],
  scopeRadius: 70,
  roles: ['combined'],
  defaultRates: { arrivals: 12, departures: 12 },
  operators: EGLC_OPERATORS,
  view: { center: [51.45, 0.45], zoom: 7.75, flyoverZoom: 13.6 },
  exitFixes: ['SOQQA', 'BPK', 'SAXBI', 'ODUKU'],
  facts: {
    runways: '09 / 27|1508 m · ILS both ends · 5.5° glide path',
    airspace: 'CTR D · SFC–2500 ft|Transition altitude 6000 ft · LTMA above',
    frequencies: '132.700|Thames Director · City Tower 118.080 · ATIS 136.355',
    notes: 'Thames Director & City Tower combined: the steep approach into the Docklands',
  },
});

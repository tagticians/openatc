// Ronald Reagan Washington National (KDCA), generated from the FAA CIFP (public domain) by
// scripts/cifp/build_airport.py. Main runway 01/19 (04/22 and 15/33 are drawn but not used by
// airliners here). Runway 19 is flown on the RNAV (RNP) Z: down the Potomac, lining up only
// half a mile out, alongside the P-56 prohibited areas over the White House and the Mall.
import raw from './airports/KDCA.json';
// FAA MVA chart PCT FUS3 (public domain, NOT FOR NAVIGATION), via scripts/cifp/mva.py.
import mva from './airports/KDCA.mva.json';
import { fromCifp, type CifpRaw } from './cifpAirport';
import type { Leg } from './airport';
import { KDCA_OPERATORS } from './traffic';

const data = raw as unknown as CifpRaw;

// River approach (RNP Z 19): the curved river legs become part of every transition, and the
// final is the short straight piece from FIROP (0.56 NM out, on the centreline).
const r19 = data.runways['19'].approach!;
const river = r19.final.filter((l) => l.t === 'FIX' && ['GREYZ', 'FONVI', 'JUBOL', 'WIRSO'].includes(l.fix));
for (const [k, legs] of Object.entries(r19.transitions)) {
  const last = legs[legs.length - 1];
  const tail: Leg[] = last.t === 'FIX' && last.fix === 'DARIC' ? [{ t: 'FIX', fix: 'SUNEY', alt: { above: 2000 } }] : [];
  r19.transitions[k] = [...legs, ...tail, ...river, { t: 'FIX', fix: 'FIROP' }];
}
r19.final = [{ t: 'FIX', fix: 'FIROP', alt: { at: 300 } }, { t: 'FIX', fix: 'THR19' }];
r19.ifix = 'FIROP';
r19.faf = 'FIROP';

const KDCA_ = fromCifp(data, {
  icao: 'KDCA',
  iata: 'DCA',
  name: 'Reagan Washington National',
  city: 'Washington',
  region: 'Arlington, Virginia',
  phraseology: 'faa',
  timeZone: 'America/New_York',
  frequencies: { approach: '124.700', tower: '119.100', delivery: '128.250', atis: '132.650' },
  callsigns: { approach: 'Potomac Approach', tower: 'National Tower', delivery: 'National Clearance', departureHandoff: 'Washington Center', handoffFreq: '133.550' },
  aiDeparture: 'Potomac Departure',
  strips: [
    ['01', '19'],
    ['04', '22'],
    ['15', '33'],
  ],
  configs: [
    { name: 'North', arr: ['01'], dep: ['01'] },
    { name: 'South', arr: ['19'], dep: ['19'] },
  ],
  sidInitialAlt: 10000,
  stack: { base: 6000, top: 12000, maxInbound: 8 },
  spawnDistance: [40, 48],
  roles: ['combined'],
  defaultRates: { arrivals: 18, departures: 16 },
  operators: KDCA_OPERATORS,
  view: { center: [38.86, -77.03], zoom: 8.3, flyoverZoom: 13.4 },
  exitFixes: ['SCRAM', 'SOOKI', 'REBLL', 'JDUBB', 'DOCTR', 'WYNGS'],
  mva: mva as { alt: number; polygon: [number, number][] }[],
  facts: {
    runways: '01 / 19|2185 m (7169 ft) · ILS 01 · RNP river approach 19',
    airspace: 'Class B · P-56 prohibited areas|Transition altitude 18,000 ft',
    frequencies: '124.700|Potomac APP · TWR 119.100 · ATIS 132.650',
    notes: 'Approach & Tower combined: down the river, past the White House',
  },
});

KDCA_.runways['19'].curvedFinal = true;
export const KDCA = KDCA_;

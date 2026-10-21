// Amsterdam Schiphol (EHAM), loaded from the eAIP-generated airports/EHAM.json
// (scripts/eaip/build_airport.py). Runway configurations follow the preferential
// runway system in spirit (EHAM AD 2.21 §4.3); the real selection sequence is not
// published, so the wind decides between the four common flows.
import raw from './airports/EHAM.json';
import type { AirportData, Airspace, LatLon, Leg, Procedure, Runway } from './airport';
import { EHAM_OPERATORS } from './traffic';

interface RawRunway {
  id: string;
  trueHdg: number;
  length: number;
  thr: LatLon;
  end: LatLon;
  elevation: number;
  ils?: { ident: string; freq: string };
  approach?: { transitions: Record<string, Leg[]>; final: Leg[] | null; missed: Leg[] | null };
}

const data = raw as unknown as {
  arp: LatLon;
  elevation: number;
  magVar: number;
  transitionAltitude: number;
  frequencies: Record<string, string>;
  ctr: { points: LatLon[]; arc: { radius: number; centre: LatLon } | null } | null;
  runways: Record<string, RawRunway>;
  sids: (Procedure & { supplementary?: boolean })[];
  stars: Procedure[];
  holdings: Record<string, { inbound: number; turn: 'L' | 'R'; minAlt: number }>;
  tmas: { name: string; cls: string; lower: string; upper: string; polygon: LatLon[] }[];
  fixes: Record<string, LatLon>;
};

const IAFS = Object.keys(data.holdings).filter((h) => h !== 'NARSO');

const runways: Record<string, Runway> = {};
for (const [id, r] of Object.entries(data.runways)) {
  const final = r.approach?.final ?? null;
  const ifix = final?.[0]?.t === 'FIX' ? final[0].fix : undefined;
  const fapLeg = final?.find((l, i) => i > 0 && l.t === 'FIX' && !l.fix.startsWith('THR') && (l.alt?.above || l.alt?.at));
  const transitions: Record<string, Leg[]> = {};
  for (const [start, legs] of Object.entries(r.approach?.transitions ?? {})) {
    const last = legs[legs.length - 1];
    // Keep transitions from the IAFs (night transitions) and the SPL VOR that join the final
    // at the IF or the FAP.
    const fapFix = fapLeg?.t === 'FIX' ? fapLeg.fix : undefined;
    const joinsFinal = last?.t === 'FIX' && (last.fix === ifix || last.fix === fapFix);
    if ((IAFS.includes(start) || start === 'SPL') && joinsFinal) transitions[start] = legs;
  }
  runways[id] = {
    id,
    thr: r.thr,
    end: r.end,
    trueHdg: r.trueHdg,
    magHdg: Math.round((r.trueHdg - data.magVar + 360) % 360),
    elevation: r.elevation,
    length: r.length,
    ils: r.ils,
    transitions,
    ifix,
    fap: fapLeg && fapLeg.t === 'FIX' ? { fix: fapLeg.fix, alt: fapLeg.alt?.at ?? fapLeg.alt?.above ?? 2000 } : undefined,
    missed: (r.approach?.missed ?? []).filter((l) => l.t === 'FIX' || (l.t === 'CA' && l.alt > 0)),
  };
}

function ctrPolygon(): LatLon[] {
  const c = data.ctr;
  if (!c) return [];
  // The parsed point list also contains the arc centre; drop it.
  const pts = c.points.filter((p) => !c.arc || p[0] !== c.arc.centre[0] || p[1] !== c.arc.centre[1]);
  if (c.arc) {
    // Points run anticlockwise to the arc start, then a clockwise arc back to the first point.
    const [clat, clon] = c.arc.centre;
    const k = Math.cos((clat * Math.PI) / 180);
    const r = c.arc.radius / 60;
    const brg = (p: LatLon) => (Math.atan2((p[1] - clon) * k, p[0] - clat) * 180) / Math.PI;
    const a0 = brg(pts[pts.length - 2] ?? pts[0]);
    let a1 = brg(pts[0]);
    if (a1 < a0) a1 += 360;
    const body = pts.slice(0, -1);
    for (let a = a0; a <= a1; a += 4) {
      const rad = (a * Math.PI) / 180;
      body.push([clat + r * Math.cos(rad), clon + (r * Math.sin(rad)) / k]);
    }
    body.push(body[0]);
    return body;
  }
  return pts;
}

const airspace: Airspace[] = [
  { name: 'SCHIPHOL CTR', cls: 'C', lower: 'GND', upper: '3000', polygon: ctrPolygon() },
  ...data.tmas.map((t) => ({ name: t.name, cls: t.cls, lower: t.lower, upper: t.upper, polygon: t.polygon })),
];

// Labelled fixes: named points on STARs, IAFs, IFs and the SPL VOR (not the AMxxx RNAV points).
const named = new Set<string>(['SPL', ...IAFS]);
for (const p of data.stars) for (const l of p.legs) if (l.t === 'FIX') named.add(l.fix);
for (const r of Object.values(runways)) if (r.ifix) named.add(r.ifix);
const scopeFixes = [...named].filter((f) => f in data.fixes && !/^AM\d{3}$/.test(f) && !f.startsWith('THR'));

export const EHAM: AirportData = {
  icao: 'EHAM',
  iata: 'AMS',
  name: 'Amsterdam Airport Schiphol',
  city: 'Amsterdam',
  region: 'Haarlemmermeer, Noord-Holland',
  arp: data.arp,
  elevation: data.elevation,
  magVar: data.magVar,
  transitionAltitude: data.transitionAltitude,
  frequencies: {
    approach: data.frequencies.approach ?? '119.055',
    arrival: data.frequencies.arrival ?? '118.405',
    tower: '118.280',
    delivery: data.frequencies.delivery,
    atis: '132.980',
    departure: '121.205',
  },
  callsigns: { approach: 'Schiphol Arrival', tower: 'Schiphol Tower', delivery: 'Schiphol Delivery', departureHandoff: 'Amsterdam Radar', handoffFreq: '125.755' },
  runways,
  strips: [
    ['04', '22'],
    ['06', '24'],
    ['09', '27'],
    ['18C', '36C'],
    ['18L', '36R'],
    ['18R', '36L'],
  ],
  configs: [
    { name: 'South', arr: ['18R', '18C'], dep: ['24', '18L'] },
    { name: 'North', arr: ['36R', '36C'], dep: ['36L', '09'] },
    { name: 'West', arr: ['27', '18R'], dep: ['24', '18L'] },
    { name: 'East', arr: ['06', '36R'], dep: ['09', '36L'] },
  ],
  sids: data.sids.filter((s) => !s.supplementary),
  stars: data.stars,
  holdings: data.holdings,
  airspace,
  fixes: data.fixes,
  scopeFixes,
  sidInitialAlt: 6000,
  stack: { base: 7000, top: 12000, maxInbound: 10 },
  spawnDistance: [46, 54],
  roles: ['arrival'],
  defaultRates: { arrivals: 24, departures: 16 },
  operators: EHAM_OPERATORS,
  view: { center: [52.27, 4.66], zoom: 7.95, flyoverZoom: 12.4 },
  facts: {
    runways: '6 runways|18R/36L 3800 m · four parallel/crossing pairs · CAT III ILS',
    airspace: 'CTR C · TMA A|TA 3000 ft · TMA 1–6 up to FL095',
    procedures: `${data.sids.length} SID · ${data.stars.length} STAR|IAFs ARTIP · RIVER · SUGOL`,
    frequencies: '118.405|ARR · APP 119.055 · TWR 118.280 · ATIS 132.980',
    notes: 'Schiphol Arrival: sequence the stacks onto the landing runways',
  },
};

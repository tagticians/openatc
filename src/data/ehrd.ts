// Rotterdam The Hague Airport (EHRD), from the LVNL eAIP, AIRAC AMDT 10-2026.
// Procedure legs follow the published coding tables (EHRD AD 2.22). The RF "Y"
// coding variants are omitted: ATC treats their flight paths as identical.
import { FIXES } from './ehrdFixes';
export type { LatLon, Leg, Procedure, Runway, Airspace } from './airport';

import type { AirportData, Airspace, AltConstraint, GaConfig, LatLon, Leg, Procedure, Runway } from './airport';
import { OPERATORS } from './traffic';

const fix = (name: string, alt?: AltConstraint, spd?: number, flyover?: boolean): Leg => ({
  t: 'FIX',
  fix: name,
  alt,
  spd,
  flyover,
});
const ca = (crs: number, alt: number): Leg => ({ t: 'CA', crs, alt });

export const AIRPORT = {
  icao: 'EHRD',
  iata: 'RTM',
  name: 'Rotterdam The Hague Airport',
  city: 'Rotterdam',
  arp: [51.956944, 4.437222] as [number, number],
  elevation: -14,
  magVar: 2, // degrees east
  transitionAltitude: 3000,
  frequencies: {
    approach: '122.990',
    tower: '118.205',
    delivery: '122.180',
    atis: '128.565',
  },
};

export const RUNWAYS: Record<string, Runway> = {
  '06': {
    id: '06',
    thr: [51.953064, 4.430681],
    end: [51.962825, 4.455117],
    trueHdg: 57.1,
    magHdg: 55,
    elevation: -14,
    ils: { ident: 'ROS', freq: '109.100' },
    transitions: {
      MASOS: [fix('MASOS'), fix('RD254'), fix('HELHO', { above: 2000 })],
      DOFMU: [fix('DOFMU', undefined, 220), fix('RD201'), fix('HELHO', { above: 2000 })],
    },
    ifix: 'HELHO',
    fap: { fix: 'RD250', alt: 2000 },
    missed: [fix('RD212', { at: 2000 }), fix('RD213', undefined, 210), fix('KAKKO'), fix('DOFMU', { at: 2000 })],
    circuit: 'L',
  },
  '24': {
    id: '24',
    thr: [51.961858, 4.452692],
    end: [51.952100, 4.428267],
    trueHdg: 237.12,
    magHdg: 235,
    elevation: -15,
    ils: { ident: 'RSV', freq: '110.900' },
    transitions: {
      MASOS: [fix('MASOS'), fix('KAKKO', { below: 3000, above: 2000 }), fix('REWIK', { at: 2000 }, 190), fix('RD203'), fix('ATWIT')],
      DOFMU: [fix('DOFMU'), fix('KAKKO', { below: 3000, above: 2000 }), fix('REWIK', { at: 2000 }, 190), fix('RD203'), fix('ATWIT')],
    },
    ifix: 'ATWIT',
    fap: { fix: 'RD252', alt: 2000 },
    missed: [fix('RD214', { at: 2000 }), fix('DOFMU', { at: 2000 })],
    circuit: 'R',
  },
};

// ---------------------------------------------------------------- SIDs
// Every SID: "After departure climb to 3000 FT AMSL".
export const SID_INITIAL_ALT = 3000;

const r06East = [fix('RD153'), fix('RD151'), fix('RD150')];
const r06South = [fix('RD157')];
const r06West = [fix('RD181', undefined, undefined, true), fix('RD186', undefined, 220)];
const r24North = (cf: string) => [fix(cf, undefined, undefined, true), ca(235, 500), fix('RD207', undefined, 230), fix('RD163'), fix('RD150')];
const r24West = [fix('RD166', undefined, undefined, true), ca(235, 400), fix('RD158', undefined, 220)];

export const SIDS: Procedure[] = [
  // RWY 06
  { name: 'ANDIK 2A', ident: 'ANDI2A', runway: '06', legs: [ca(55, 500), ...r06East, fix('PAM'), fix('ANDIK')] },
  { name: 'ARNEM 3A', ident: 'ARNE3A', runway: '06', legs: [ca(55, 500), ...r06East, fix('IVLUT'), fix('NYKER'), fix('ARNEM')] },
  { name: 'COA 2A', ident: 'COA2A', runway: '06', legs: [ca(55, 500), ...r06South, fix('RD161'), fix('RD154'), fix('COA', { below: 5000 })] },
  { name: 'INKET 2A', ident: 'INKE2A', runway: '06', legs: [ca(55, 500), ...r06South, fix('INKET')] },
  { name: 'LUNIX 2A', ident: 'LUNI2A', runway: '06', legs: [ca(55, 500), ...r06East, fix('IVLUT'), fix('LUNIX')] },
  { name: 'NEPTU 2A', ident: 'NEPT2A', runway: '06', legs: [ca(55, 500), ...r06South, fix('INKET'), fix('PELUB'), fix('NEPTU')] },
  { name: 'SOMEL 2A', ident: 'SOME2A', runway: '06', legs: [ca(55, 500), ...r06West, fix('SOMEL'), fix('ABNED')] },
  { name: 'TULIP 4A', ident: 'TULI4A', runway: '06', legs: [ca(55, 500), ...r06West, fix('SOMEL'), fix('OBAGU'), fix('TULIP')] },
  { name: 'WOODY 2A', ident: 'WOOD2A', runway: '06', legs: [ca(55, 500), ...r06South, fix('RD161'), fix('RD154'), fix('WOODY')] },
  // RWY 24
  { name: 'ANDIK 2B', ident: 'ANDI2B', runway: '24', legs: [...r24North('RD159'), fix('PAM'), fix('ANDIK')] },
  { name: 'ARNEM 3B', ident: 'ARNE3B', runway: '24', legs: [...r24North('RD159'), fix('IVLUT'), fix('NYKER'), fix('ARNEM')] },
  { name: 'COA 2B', ident: 'COA2B', runway: '24', legs: [...r24West, fix('RD156'), fix('COA', { below: 5000 })] },
  { name: 'INKET 2B', ident: 'INKE2B', runway: '24', legs: [...r24West, fix('RD164'), fix('RD165'), fix('INKET')] },
  { name: 'LUNIX 2B', ident: 'LUNI2B', runway: '24', legs: [...r24North('RD159'), fix('IVLUT'), fix('LUNIX')] },
  { name: 'NEPTU 2B', ident: 'NEPT2B', runway: '24', legs: [...r24West, fix('RD164'), fix('RD165'), fix('INKET'), fix('PELUB'), fix('NEPTU')] },
  { name: 'SOMEL 2B', ident: 'SOME2B', runway: '24', legs: [...r24West, fix('SOMEL'), fix('ABNED')] },
  { name: 'TULIP 3B', ident: 'TULI3B', runway: '24', legs: [...r24West, fix('SOMEL'), fix('OBAGU'), fix('TULIP')] },
  { name: 'WOODY 2B', ident: 'WOOD2B', runway: '24', legs: [...r24West, fix('RD164'), fix('HELHO'), fix('RD162'), fix('WOODY')] },
];

// ---------------------------------------------------------------- STARs
// Clearance limit is the IAF (DOFMU or MASOS).
const viaPam = [fix('PAM'), fix('KAKKO'), fix('DOFMU', { below: 6000, above: 5000 })];
export const STARS: Procedure[] = [
  { name: 'BLUFA 1R', ident: 'BLUF1R', legs: [fix('BLUFA'), fix('FLEVO', { at: 7000 }), ...viaPam] },
  { name: 'COA 2R', ident: 'COA2R', legs: [fix('COA', { below: 5000 }), fix('DOFMU')] },
  { name: 'DENUT 2R', ident: 'DENU2R', legs: [fix('DENUT'), fix('RIMBU'), fix('DOFMU', { below: 6000 })] },
  { name: 'ENKOS 3R', ident: 'ENKO3R', legs: [fix('ENKOS', { at: 7000 }), ...viaPam] },
  { name: 'HELEN 4R', ident: 'HELE4R', legs: [fix('HELEN'), fix('RIMBU'), fix('DOFMU', { below: 6000 })] },
  { name: 'INKET 2R', ident: 'INKE2R', legs: [fix('INKET'), fix('KAKKO'), fix('DOFMU', { below: 6000, above: 5000 })] },
  { name: 'LAMSO 3R', ident: 'LAMS3R', legs: [fix('LAMSO'), fix('MASOS', { below: 6000 })] },
  { name: 'MOLIX 3R', ident: 'MOLI3R', legs: [fix('MOLIX'), fix('MASOS', { below: 6000 })] },
  { name: 'REDFA 3R', ident: 'REDF3R', legs: [fix('REDFA'), fix('MASOS', { below: 6000 })] },
  { name: 'RKN 3R', ident: 'RKN3R', legs: [fix('RKN'), fix('TENLI'), fix('FLEVO', { at: 7000 }), ...viaPam] },
  { name: 'SONEB 3R', ident: 'SONE3R', legs: [fix('SONEB'), fix('TENLI'), fix('FLEVO', { at: 7000 }), ...viaPam] },
  { name: 'TOPPA 3R', ident: 'TOPP3R', legs: [fix('TOPPA'), fix('MASOS', { below: 6000 })] },
];

/** Published holdings: inbound course (MAG), turn direction, minimum altitude. */
export const HOLDINGS: Record<string, { inbound: number; turn: 'L' | 'R'; minAlt: number }> = {
  MASOS: { inbound: 17, turn: 'R', minAlt: 5000 },
  DOFMU: { inbound: 333, turn: 'R', minAlt: 2000 },
  KAKKO: { inbound: 25, turn: 'R', minAlt: 2000 },
};

// ---------------------------------------------------------------- Airspace
function ctrPolygon(): [number, number][] {
  // ROTTERDAM CTR: 4 points, then a clockwise 8 NM arc around the ARP.
  const pts: [number, number][] = [
    [51.847778, 4.313889],
    [51.806111, 4.210833],
    [51.889722, 4.1225],
    [51.931389, 4.225833],
  ];
  const [clat, clon] = [51.956944, 4.437222];
  const r = 8 / 60;
  const brg = (p: [number, number]) =>
    (Math.atan2((p[1] - clon) * Math.cos((clat * Math.PI) / 180), p[0] - clat) * 180) / Math.PI;
  let a0 = brg(pts[3]);
  let a1 = brg(pts[0]);
  if (a1 < a0) a1 += 360;
  for (let a = a0; a <= a1; a += 4) {
    const rad = (a * Math.PI) / 180;
    pts.push([clat + r * Math.cos(rad), clon + (r * Math.sin(rad)) / Math.cos((clat * Math.PI) / 180)]);
  }
  pts.push(pts[0]);
  return pts;
}

const dms = (s: string): [number, number] => {
  const m = s.match(/(\d{2})(\d{2})(\d{2})N\s*(\d{3})(\d{2})(\d{2})E/)!;
  return [+m[1] + +m[2] / 60 + +m[3] / 3600, +m[4] + +m[5] / 60 + +m[6] / 3600];
};
const poly = (s: string) => s.split(' - ').map(dms);

export const AIRSPACE: Airspace[] = [
  { name: 'ROTTERDAM CTR', cls: 'C', lower: 'GND', upper: '3000', polygon: ctrPolygon() },
  {
    name: 'ROTTERDAM TMA 1',
    cls: 'E',
    lower: '1500',
    upper: 'FL055',
    polygon: poly(
      '521706N 0035911E - 515920N 0040640E - 515610N 0042115E - 515311N 0044941E - 513600N 0043615E - 513600N 0041133E - 513701N 0041042E - 513648N 0040733E - 513800N 0040555E - 513800N 0040419E - 513654N 0035910E - 513745N 0035452E - 515626N 0034502E - 521706N 0035911E',
    ),
  },
  {
    name: 'ROTTERDAM TMA 2',
    cls: 'E',
    lower: '2500',
    upper: 'FL055',
    polygon: poly(
      '515626N 0034502E - 513745N 0035452E - 513544N 0035207E - 513617N 0035018E - 513619N 0034757E - 513550N 0034448E - 513559N 0034053E - 513507N 0033738E - 513539N 0033500E - 513550N 0033110E - 515626N 0034502E',
    ),
  },
  {
    name: 'ROTTERDAM TMA 3',
    cls: 'E',
    lower: '3500',
    upper: 'FL055',
    polygon: poly('521730N 0034147E - 521706N 0035911E - 513550N 0033110E - 513550N 0031350E - 521730N 0034147E'),
  },
];

export const VFR_POINTS: Record<string, [number, number]> = {
  FOXTROT: dms('515428N 0043258E'),
  HOTEL: dms('515818N 0040736E'),
  MIKE: dms('515954N 0043905E'),
  OSCAR: dms('515656N 0043150E'),
  PAPA: dms('515626N 0042802E'),
  ROMEO: dms('515125N 0043550E'),
  SIERRA: dms('515822N 0041903E'),
  TANGO: dms('515824N 0042347E'),
  WHISKEY: dms('515820N 0041323E'),
};

export { FIXES };

/** Fixes worth labelling on the scope (procedure fixes, not RNAV RDxxx points). */
export const SCOPE_FIXES = Object.keys(FIXES).filter((k) => !k.startsWith('RD'));

/**
 * A13 motorway, Kleinpolderplein to Ypenburg (OpenStreetMap, ODbL): Lifeliner 2 follows it
 * between the base, Erasmus MC and The Hague. Helipads from OpenStreetMap too.
 */
const A13 = {
  A13KP: [51.93, 4.4466] as LatLon,
  A13OS: [51.945, 4.4222] as LatLon,
  A13RT: [51.955, 4.4137] as LatLon,
  A13BK: [51.975, 4.3986] as LatLon,
  A13DZ: [52.005, 4.3848] as LatLon,
  A13DN: [52.02, 4.3675] as LatLon,
  A13YP: [52.042, 4.3515] as LatLon,
};

export const EHRD_GA: GaConfig = {
  points: VFR_POINTS,
  entry: ['HOTEL', 'WHISKEY', 'MIKE', 'ROMEO', 'FOXTROT'],
  circuitAlt: 1000,
  rate: 6,
  fields: ['EHMZ', 'EHLE', 'EHTE', 'EHSE', 'EBAW', 'EHTX', 'EHHV'],
  types: ['C172', 'C172', 'PA28', 'DA40', 'C152', 'SR22'],
  hems: {
    callsign: 'LIFE2',
    spoken: 'LIFELINER 2',
    type: 'EC35',
    operator: 'ANWB Medical Air Assistance',
    base: { id: 'LL2', name: 'Lifeliner 2 base', pos: [51.95116, 4.44184], via: [] },
    pads: [
      { id: 'EMC', name: 'Erasmus MC', pos: [51.90992, 4.47082], via: ['A13OS', 'A13KP'] },
      { id: 'HMC', name: 'HMC Westeinde', pos: [52.07407, 4.30008], via: ['A13RT', 'A13BK', 'A13DZ', 'A13DN', 'A13YP'] },
    ],
    corridor: { name: 'A13', points: A13 },
    interval: [4, 6],
    // Approximate town centres and motorway junctions around Rotterdam and The Hague.
    scenes: [
      { name: 'Zoetermeer', pos: [52.057, 4.494] },
      { name: 'Delft', pos: [52.011, 4.357] },
      { name: 'Schiedam', pos: [51.919, 4.4] },
      { name: 'Vlaardingen', pos: [51.912, 4.341] },
      { name: 'Maassluis', pos: [51.923, 4.25] },
      { name: 'Capelle aan den IJssel', pos: [51.929, 4.578] },
      { name: 'Barendrecht', pos: [51.856, 4.534] },
      { name: 'Spijkenisse', pos: [51.845, 4.329] },
      { name: 'Ridderkerk', pos: [51.87, 4.603] },
      { name: 'Pijnacker', pos: [52.019, 4.43] },
      { name: 'Berkel en Rodenrijs', pos: [51.993, 4.476] },
      { name: 'Naaldwijk', pos: [51.994, 4.209] },
      { name: 'the A20 at Kethelplein', pos: [51.917, 4.374] },
      { name: 'the A16 at the Van Brienenoord bridge', pos: [51.906, 4.54] },
    ],
    sceneShare: 0.6,
  },
};

export const EHRD: AirportData = {
  icao: 'EHRD',
  iata: 'RTM',
  name: AIRPORT.name,
  city: 'Rotterdam',
  region: 'Rotterdam, Zuid-Holland',
  arp: AIRPORT.arp,
  elevation: AIRPORT.elevation,
  magVar: AIRPORT.magVar,
  transitionAltitude: 3000,
  frequencies: AIRPORT.frequencies,
  callsigns: { approach: 'Rotterdam Approach', tower: 'Rotterdam Tower', delivery: 'Rotterdam Delivery', departureHandoff: 'Amsterdam Radar', handoffFreq: '123.855' },
  runways: RUNWAYS,
  strips: [['06', '24']],
  configs: [
    { name: '24', arr: ['24'], dep: ['24'] },
    { name: '06', arr: ['06'], dep: ['06'] },
  ],
  sids: SIDS,
  stars: STARS,
  holdings: HOLDINGS,
  airspace: AIRSPACE,
  fixes: FIXES,
  scopeFixes: SCOPE_FIXES,
  sidInitialAlt: SID_INITIAL_ALT,
  stack: { base: 6000, top: 10000, maxInbound: 6 },
  spawnDistance: [38, 44],
  roles: ['combined'],
  defaultRates: { arrivals: 14, departures: 12 },
  operators: OPERATORS,
  ga: EHRD_GA,
  view: { center: [51.956944, 4.287222], zoom: 8.55, flyoverZoom: 13.4 },
  facts: {
    runways: '06 / 24|2198 × 45 m asphalt · ILS CAT I both ends',
    airspace: 'CTR C · TMA E|TA 3000 ft · TMA 1–3 up to FL055',
    procedures: `${SIDS.length} SID · ${STARS.length} STAR|RNAV 1 · IAFs DOFMU & MASOS`,
    frequencies: '122.990|APP · TWR 118.205 · DEL 122.180 · ATIS 128.565',
    notes: 'Approach & Tower combined',
  },
};

export type { AltConstraint };

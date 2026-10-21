// Turns an FAA CIFP-generated airport file (scripts/cifp/build_airport.py) into game data.
// Everything procedural comes from the file; the caller supplies what CIFP doesn't carry
// (frequencies, callsigns, runway configurations, traffic mix, presentation).
import type { AirportData, Airspace, Holding, LatLon, Leg, Procedure, Runway } from './airport';

interface RawRunway {
  id: string;
  trueHdg: number;
  length: number;
  thr: LatLon;
  end: LatLon;
  elevation: number;
  displaced?: number;
  ils?: { ident: string; freq: string };
  locOnly?: boolean;
  gpAngle?: number;
  approach?: { ident: string; transitions: Record<string, Leg[]>; final: Leg[]; missed: Leg[]; ifix: string | null; faf: string | null };
}

export interface CifpRaw {
  icao: string;
  name: string;
  arp: LatLon;
  elevation: number;
  magVar: number;
  transitionAltitude: number;
  runways: Record<string, RawRunway>;
  sids: (Procedure & { transition?: string })[];
  stars: (Procedure & { transition?: string })[];
  holdings: Record<string, Holding & { synthetic?: boolean }>;
  airspace: Airspace[];
  restricted?: Airspace[];
  fixes: Record<string, LatLon>;
  source: string;
}

type Extra = Omit<
  AirportData,
  'arp' | 'elevation' | 'magVar' | 'transitionAltitude' | 'runways' | 'sids' | 'stars' | 'holdings' | 'airspace' | 'fixes' | 'scopeFixes' | 'facts' | 'restricted'
> & { facts: Omit<AirportData['facts'], 'procedures'> & { procedures?: string }; scopeRadius?: number };

const nm = (a: LatLon, b: LatLon) => {
  const k = Math.cos(((a[0] + b[0]) / 2) * (Math.PI / 180));
  return Math.hypot((a[0] - b[0]) * 60, (a[1] - b[1]) * 60 * k);
};

export function fromCifp(raw: CifpRaw, extra: Extra): AirportData {
  const runways: Record<string, Runway> = {};
  for (const [id, r] of Object.entries(raw.runways)) {
    const ap = r.approach;
    const fapLeg = ap?.final.find((l) => l.t === 'FIX' && l.fix === ap.faf);
    const fapAlt = fapLeg?.t === 'FIX' ? fapLeg.alt?.at ?? fapLeg.alt?.above ?? 2000 : 2000;
    runways[id] = {
      id,
      thr: r.thr,
      end: r.end,
      trueHdg: r.trueHdg,
      magHdg: Math.round((r.trueHdg - raw.magVar + 360) % 360),
      elevation: r.elevation,
      length: r.length,
      ils: r.ils,
      locOnly: r.locOnly,
      gpAngle: r.gpAngle,
      transitions: ap?.transitions ?? {},
      ifix: ap?.ifix ?? undefined,
      fap: ap?.faf ? { fix: ap.faf, alt: fapAlt } : undefined,
      // The game flies FIX and course-to-altitude legs; drop runway-threshold points.
      missed: (ap?.missed ?? []).filter((l) => (l.t === 'FIX' && !l.fix.startsWith('THR')) || (l.t === 'CA' && l.alt > 0)),
    };
  }

  // Label the fixes that matter within the scope: STAR/approach fixes and the IFs/FAFs.
  const radius = extra.scopeRadius ?? 60;
  const named = new Set<string>();
  for (const p of raw.stars) for (const l of p.legs) if (l.t === 'FIX') named.add(l.fix);
  for (const r of Object.values(runways)) {
    if (r.ifix) named.add(r.ifix);
    if (r.fap) named.add(r.fap.fix);
    for (const t of Object.values(r.transitions)) for (const l of t) if (l.t === 'FIX') named.add(l.fix);
  }
  for (const h of Object.keys(raw.holdings)) named.add(h);
  const scopeFixes = [...named].filter((f) => raw.fixes[f] && !f.startsWith('THR') && nm(raw.fixes[f], raw.arp) <= radius);

  const { scopeRadius: _r, facts, ...rest } = extra;
  return {
    ...rest,
    arp: raw.arp,
    elevation: raw.elevation,
    magVar: raw.magVar,
    transitionAltitude: raw.transitionAltitude,
    runways,
    sids: raw.sids,
    stars: raw.stars,
    holdings: raw.holdings,
    airspace: raw.airspace,
    restricted: raw.restricted?.length ? raw.restricted : undefined,
    fixes: raw.fixes,
    scopeFixes,
    facts: {
      ...facts,
      procedures: facts.procedures ?? `${new Set(raw.sids.map((s) => s.ident)).size} SID · ${new Set(raw.stars.map((s) => s.ident)).size} STAR|${raw.source}`,
    },
  };
}

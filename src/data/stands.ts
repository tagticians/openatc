// Real stand and runway holding positions from OpenStreetMap (ODbL), fetched by
// scripts/osm/stands.mjs. OSM often maps a stand twice (nose-in point and stand centre):
// those are merged into one position per stand reference.
import type { LatLon } from './airport';
import EGLC from './airports/EGLC.stands.json';
import EHRD from './airports/EHRD.stands.json';
import EHAM from './airports/EHAM.stands.json';
import KSAN from './airports/KSAN.stands.json';
import KORF from './airports/KORF.stands.json';
import KDCA from './airports/KDCA.stands.json';

export interface Stand {
  ref: string;
  pos: LatLon;
}

interface Raw {
  stands: { ref: string; lat: number; lon: number }[];
  holds: { ref: string; lat: number; lon: number }[];
}

function load(raw: Raw) {
  const by = new Map<string, LatLon[]>();
  for (const s of raw.stands) {
    // "Stand A1" / "StandB1" → "A1"; "4;5" (a stand spanning two) → "4"; "0" is a mapping placeholder.
    const ref = s.ref.replace(/^stand\s*/i, '').split(';')[0].trim();
    if (!ref || ref === '0') continue;
    by.set(ref, [...(by.get(ref) ?? []), [s.lat, s.lon]]);
  }
  const stands: Stand[] = [...by].map(([ref, ps]) => ({
    ref,
    pos: [ps.reduce((a, p) => a + p[0], 0) / ps.length, ps.reduce((a, p) => a + p[1], 0) / ps.length],
  }));
  return { stands, holds: raw.holds.map((h) => [h.lat, h.lon] as LatLon) };
}

const ALL: Record<string, Raw> = { EGLC, EHRD, EHAM, KSAN, KORF, KDCA };
const cache = new Map<string, ReturnType<typeof load>>();

/** Stands and holding positions for an airport (empty when OSM has none). */
export function groundData(icao: string) {
  if (!cache.has(icao)) cache.set(icao, ALL[icao] ? load(ALL[icao]) : { stands: [], holds: [] });
  return cache.get(icao)!;
}

// Live ADS-B traffic around the airport from adsb.lol (free, community-fed), shown as
// background "other sector" targets. Real flights to/from the airport can be adopted.
import { APT } from '../data/airport';
import { toNM, type Vec } from '../sim/geo';

export interface LiveTarget {
  hex: string;
  callsign: string;
  type: string;
  alt: number; // ft
  gs: number;
  track: number; // TRUE
  vs: number;
  pos: Vec; // NM, at fixTime
  fixTime: number; // sim/unix seconds of the position report
  onGround: boolean;
}

interface AdsbAc {
  hex: string;
  flight?: string;
  t?: string;
  alt_baro?: number | 'ground';
  gs?: number;
  track?: number;
  baro_rate?: number;
  lat?: number;
  lon?: number;
  seen_pos?: number;
}

export async function fetchLive(radiusNm = 45): Promise<LiveTarget[] | null> {
  try {
    const [lat, lon] = APT.arp;
    const r = await fetch(`/api/adsb/point/${lat}/${lon}/${radiusNm}`);
    if (!r.ok) return null;
    const j = (await r.json()) as { ac?: AdsbAc[]; now?: number };
    const now = (j.now ?? Date.now()) / 1000;
    const out: LiveTarget[] = [];
    for (const a of j.ac ?? []) {
      if (a.lat == null || a.lon == null || a.alt_baro == null) continue;
      const pos = toNM([a.lat, a.lon]);
      const ground = a.alt_baro === 'ground';
      // Ground traffic only matters at the airport itself (real departures at the stands).
      if (ground && Math.hypot(pos.x, pos.y) > 2) continue;
      const alt = ground ? 0 : (a.alt_baro as number);
      if (alt > 24500 || (a.seen_pos ?? 0) > 30) continue;
      if (!a.flight?.trim()) continue;
      out.push({
        hex: a.hex,
        callsign: (a.flight ?? a.hex).trim().toUpperCase(),
        type: a.t ?? '',
        alt,
        onGround: ground,
        gs: a.gs ?? 0,
        track: a.track ?? 0,
        vs: a.baro_rate ?? 0,
        pos,
        fixTime: now - (a.seen_pos ?? 0),
      });
    }
    return out;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- routes (adsbdb.com)

export interface RouteAirport {
  icao: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
}
export interface LiveRoute {
  origin: RouteAirport;
  dest: RouteAirport;
  airline?: { name: string; icao: string; iata: string; telephony: string };
}

const routeCache = new Map<string, LiveRoute | null>();
try {
  const saved = JSON.parse(localStorage.getItem('routeCache.v3') ?? '{}') as Record<string, LiveRoute | null>;
  for (const [k, v] of Object.entries(saved)) routeCache.set(k, v);
} catch {
  /* no storage */
}
const persist = () => {
  try {
    localStorage.setItem('routeCache.v3', JSON.stringify(Object.fromEntries([...routeCache].slice(-400))));
  } catch {
    /* no storage */
  }
};

interface AdsbdbAirport {
  icao_code: string;
  name: string;
  municipality: string;
  latitude: number;
  longitude: number;
}

const key = (callsign: string) => `${APT.icao}:${callsign}`;
export const cachedRoute = (callsign: string) => routeCache.get(key(callsign));

interface VrsRoute {
  airport_codes: string;
  _airports?: { icao: string; name: string; location: string; lat: number; lon: number }[];
}

/** VRS standing data (CC0, static JSON, no rate limit): pick the leg touching the current airport. */
async function lookupVrs(callsign: string): Promise<LiveRoute | null | undefined> {
  try {
    const r = await fetch(`https://vrs-standing-data.adsb.lol/routes/${callsign.slice(0, 2)}/${callsign}.json`);
    if (!r.ok) return undefined;
    const ct = r.headers.get('content-type') ?? '';
    if (!ct.includes('json')) return undefined;
    const j = (await r.json()) as VrsRoute;
    const aps = j._airports ?? [];
    const codes = j.airport_codes.split('-');
    const i = codes.indexOf(APT.icao);
    if (i < 0 || aps.length !== codes.length) return null;
    const pick = (k: number): RouteAirport => ({ icao: aps[k].icao, name: aps[k].name, city: aps[k].location, lat: aps[k].lat, lon: aps[k].lon });
    // Arriving here (previous leg) is more useful in play than the onward leg.
    if (i > 0) return { origin: pick(i - 1), dest: pick(i) };
    return { origin: pick(i), dest: pick(i + 1) };
  } catch {
    return undefined;
  }
}

export async function lookupRoute(callsign: string): Promise<LiveRoute | null> {
  if (routeCache.has(key(callsign))) return routeCache.get(key(callsign))!;
  const vrs = await lookupVrs(callsign);
  if (vrs !== undefined) {
    routeCache.set(key(callsign), vrs);
    persist();
    return vrs;
  }
  try {
    const r = await fetch(`/api/adsbdb/callsign/${encodeURIComponent(callsign)}`);
    if (!r.ok && r.status !== 404) return null; // transient: try again later
    const j = (await r.json()) as { response?: { flightroute?: { origin: AdsbdbAirport; destination: AdsbdbAirport; airline?: { name: string; icao: string; iata: string; callsign: string } } } | string };
    const fr = typeof j.response === 'object' ? j.response.flightroute : undefined;
    const ap = (a: AdsbdbAirport): RouteAirport => ({ icao: a.icao_code, name: a.name, city: a.municipality, lat: a.latitude, lon: a.longitude });
    const route: LiveRoute | null = fr
      ? {
          origin: ap(fr.origin),
          dest: ap(fr.destination),
          airline: fr.airline ? { name: fr.airline.name, icao: fr.airline.icao, iata: fr.airline.iata, telephony: fr.airline.callsign } : undefined,
        }
      : null;
    routeCache.set(key(callsign), route);
    persist();
    return route;
  } catch {
    return null;
  }
}

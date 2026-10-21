// Live METAR from aviationweather.gov (proxied by the dev server to avoid CORS).
import type { Weather } from '../sim/sim';

interface AwcMetar {
  rawOb: string;
  wdir: number | 'VRB' | null;
  wspd: number | null;
  wgst?: number | null;
  visib?: number | string;
  altim?: number;
  temp?: number;
  dewp?: number;
  clouds?: { cover: string; base: number | null }[];
}

export async function fetchMetar(icao: string): Promise<Weather | null> {
  try {
    const res = await fetch(`/api/awc/metar?ids=${icao}&format=json&hours=2`);
    if (!res.ok) return null;
    const data = (await res.json()) as AwcMetar[];
    const m = data[0];
    if (!m) return null;
    return parse(m);
  } catch {
    return null;
  }
}

function parse(m: AwcMetar): Weather {
  // The raw report is authoritative for visibility in metres (AWC converts to SM).
  const visM = m.rawOb.match(/\s(\d{4})\s/);
  const cavok = /CAVOK/.test(m.rawOb);
  const ceilingLayer = (m.clouds ?? []).find((c) => (c.cover === 'BKN' || c.cover === 'OVC') && c.base != null);
  const dir = typeof m.wdir === 'number' ? m.wdir : 0;
  return {
    raw: m.rawOb,
    wind: { dir, spd: m.wspd ?? 0, gust: m.wgst ?? undefined },
    qnh: Math.round(m.altim ?? 1013),
    // US reports carry the altimeter setting itself (A2992): use it rather than a rounded conversion.
    altimeter: +(m.rawOb.match(/\sA(\d{4})(\s|$)/)?.[1] ?? 0) || undefined,
    visibility: cavok ? 9999 : visM ? +visM[1] : 9999,
    ceiling: ceilingLayer?.base ?? null,
    temp: m.temp,
    dew: m.dewp,
    live: true,
    fetchedAt: Date.now(),
  };
}

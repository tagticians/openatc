// Local flat-earth frame centred on the airport ARP. x = east, y = north, both in NM.
// Accurate to well under 0.1 NM across the ~100 NM the game covers.
import { APT, type LatLon } from '../data/airport';

export interface Vec {
  x: number;
  y: number;
}

let frame = { icao: '', lat0: 0, lon0: 0, cos0: 1 };
const origin = () => {
  if (frame.icao !== APT.icao) {
    const [lat0, lon0] = APT.arp;
    frame = { icao: APT.icao, lat0, lon0, cos0: Math.cos((lat0 * Math.PI) / 180) };
    fixCache.clear();
  }
  return frame;
};

export const toNM = ([lat, lon]: LatLon): Vec => {
  const o = origin();
  return { x: (lon - o.lon0) * 60 * o.cos0, y: (lat - o.lat0) * 60 };
};
export const toLatLon = (v: Vec): LatLon => {
  const o = origin();
  return [o.lat0 + v.y / 60, o.lon0 + v.x / (60 * o.cos0)];
};

export const D2R = Math.PI / 180;
export const norm360 = (a: number) => ((a % 360) + 360) % 360;
/** Signed smallest difference b - a, in (-180, 180]. */
export const angDiff = (a: number, b: number) => {
  const d = norm360(b - a);
  return d > 180 ? d - 360 : d;
};
export const dist = (a: Vec, b: Vec) => Math.hypot(b.x - a.x, b.y - a.y);
/** True bearing from a to b, degrees. */
export const bearing = (a: Vec, b: Vec) => norm360(Math.atan2(b.x - a.x, b.y - a.y) / D2R);
export const fromBearing = (p: Vec, brg: number, d: number): Vec => ({
  x: p.x + Math.sin(brg * D2R) * d,
  y: p.y + Math.cos(brg * D2R) * d,
});

export const magToTrue = (m: number) => norm360(m + APT.magVar);
export const trueToMag = (t: number) => norm360(t - APT.magVar);

const fixCache = new Map<string, Vec>();
export function fixPos(name: string): Vec {
  origin();
  let v = fixCache.get(name);
  if (!v) {
    const ll = APT.fixes[name];
    if (!ll) throw new Error(`Unknown fix ${name}`);
    v = toNM(ll);
    fixCache.set(name, v);
  }
  return v;
}
export const hasFix = (name: string) => name in APT.fixes;

/** Great-circle initial bearing between two lat/lon points (for far destinations). */
export function gcBearing(a: LatLon, b: LatLon) {
  const [p1, l1, p2, l2] = [a[0] * D2R, a[1] * D2R, b[0] * D2R, b[1] * D2R];
  const y = Math.sin(l2 - l1) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(l2 - l1);
  return norm360(Math.atan2(y, x) / D2R);
}

/** Point-in-polygon test in the local NM frame. */
export function inPolygon(p: Vec, poly: Vec[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

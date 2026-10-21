// Taxi routing over the real taxiway network (OpenStreetMap centrelines, fetched by
// scripts/osm/taxiways.mjs). The ways become a graph: points closer than a few metres merge,
// and a way that ends just short of another is joined to it (mapping gaps). Routes are the
// shortest path between the nearest network points to the start and the end.
import { APT } from '../data/airport';
import EGLC from '../data/airports/EGLC.taxi.json';
import EHRD from '../data/airports/EHRD.taxi.json';
import EHAM from '../data/airports/EHAM.taxi.json';
import KSAN from '../data/airports/KSAN.taxi.json';
import KORF from '../data/airports/KORF.taxi.json';
import KDCA from '../data/airports/KDCA.taxi.json';
import { dist, toNM, type Vec } from './geo';

interface Raw {
  ways: { ref: string; kind: string; pts: [number, number][] }[];
}
const ALL: Record<string, Raw> = { EGLC, EHRD, EHAM, KSAN, KORF, KDCA } as unknown as Record<string, Raw>;

/** Taxi speed on the ground, kt. */
export const TAXI_KT = 15;
const MERGE_NM = 0.004; // ~7 m: the same junction mapped twice
const GAP_NM = 0.02; // ~37 m: a way ending just short of another
const ATTACH_NM = 0.3; // how far a stand or holding point may be from the network

class Graph {
  pts: Vec[] = [];
  adj: { to: number; d: number }[][] = [];
  private grid = new Map<string, number[]>();

  private key(p: Vec) {
    return `${Math.floor(p.x / MERGE_NM)},${Math.floor(p.y / MERGE_NM)}`;
  }

  /** Index of an existing point within MERGE_NM, or a new one. */
  node(p: Vec): number {
    const gx = Math.floor(p.x / MERGE_NM);
    const gy = Math.floor(p.y / MERGE_NM);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const i of this.grid.get(`${gx + dx},${gy + dy}`) ?? []) if (dist(this.pts[i], p) < MERGE_NM) return i;
    const i = this.pts.push(p) - 1;
    this.adj.push([]);
    const k = this.key(p);
    this.grid.set(k, [...(this.grid.get(k) ?? []), i]);
    return i;
  }

  link(a: number, b: number) {
    if (a === b || this.adj[a].some((e) => e.to === b)) return;
    const d = dist(this.pts[a], this.pts[b]);
    this.adj[a].push({ to: b, d });
    this.adj[b].push({ to: a, d });
  }

  nearest(p: Vec, max: number, from?: Set<number>): number | null {
    let best: number | null = null;
    let bd = max;
    this.pts.forEach((q, i) => {
      if (from && !from.has(i)) return;
      const d = dist(p, q);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  /** Dijkstra; fine for a few thousand points. */
  path(a: number, b: number): number[] | null {
    const n = this.pts.length;
    const d = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    d[a] = 0;
    for (;;) {
      let u = -1;
      let best = Infinity;
      for (let i = 0; i < n; i++) if (!done[i] && d[i] < best) (best = d[i]), (u = i);
      if (u < 0) return null;
      if (u === b) break;
      done[u] = 1;
      for (const e of this.adj[u]) if (d[u] + e.d < d[e.to]) (d[e.to] = d[u] + e.d), (prev[e.to] = u);
    }
    const out = [b];
    while (out[0] !== a) out.unshift(prev[out[0]]);
    return out;
  }
}

function build(raw: Raw) {
  const g = new Graph();
  const ends: number[] = [];
  for (const w of raw.ways) {
    const ids = w.pts.map((ll) => g.node(toNM(ll)));
    for (let i = 1; i < ids.length; i++) g.link(ids[i - 1], ids[i]);
    ends.push(ids[0], ids[ids.length - 1]);
  }
  // Dangling ends close to another part of the network get joined to it.
  for (const e of ends) {
    if (g.adj[e].length > 1) continue;
    const near = new Set<number>();
    g.adj[e].forEach((x) => near.add(x.to));
    let best: number | null = null;
    let bd = GAP_NM;
    g.pts.forEach((q, i) => {
      if (i === e || near.has(i)) return;
      const d = dist(g.pts[e], q);
      if (d < bd) (bd = d), (best = i);
    });
    if (best !== null) g.link(e, best);
  }
  return g;
}

const graphs = new Map<string, Graph | null>();
function graph(): Graph | null {
  if (!graphs.has(APT.icao)) graphs.set(APT.icao, ALL[APT.icao] ? build(ALL[APT.icao]) : null);
  return graphs.get(APT.icao)!;
}

/** A taxi route: the points to follow (start and end included) and its length in NM. */
export interface TaxiRoute {
  pts: Vec[];
  length: number;
}

const cache = new Map<string, TaxiRoute | null>();

/** Route from one ground position to another along the taxiways; null when off the network. */
export function taxiRoute(from: Vec, to: Vec): TaxiRoute | null {
  const g = graph();
  if (!g) return null;
  const k = `${APT.icao}:${from.x.toFixed(4)},${from.y.toFixed(4)}>${to.x.toFixed(4)},${to.y.toFixed(4)}`;
  if (cache.has(k)) return cache.get(k)!;
  const a = g.nearest(from, ATTACH_NM);
  const b = g.nearest(to, ATTACH_NM);
  let route: TaxiRoute | null = null;
  if (a !== null && b !== null) {
    const ids = g.path(a, b);
    if (ids) {
      const pts = [from, ...ids.map((i) => g.pts[i]), to];
      route = { pts, length: pts.reduce((s, p, i) => (i ? s + dist(pts[i - 1], p) : 0), 0) };
    }
  }
  cache.set(k, route);
  return route;
}

/** Position a fraction 0..1 of the way along a route. */
export function along(r: TaxiRoute, k: number): Vec {
  let left = Math.min(1, Math.max(0, k)) * r.length;
  for (let i = 1; i < r.pts.length; i++) {
    const a = r.pts[i - 1];
    const b = r.pts[i];
    const d = dist(a, b);
    if (left <= d || i === r.pts.length - 1) {
      const t = d ? Math.min(1, left / d) : 1;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    left -= d;
  }
  return r.pts[r.pts.length - 1];
}

/** The part of a route still ahead, for drawing. */
export function remaining(r: TaxiRoute, k: number): Vec[] {
  const here = along(r, k);
  let left = Math.min(1, Math.max(0, k)) * r.length;
  let i = 1;
  for (; i < r.pts.length; i++) {
    const d = dist(r.pts[i - 1], r.pts[i]);
    if (left <= d) break;
    left -= d;
  }
  return [here, ...r.pts.slice(i)];
}

/** Seconds to taxi a route at TAXI_KT. */
export const taxiSeconds = (r: TaxiRoute) => (r.length / TAXI_KT) * 3600;

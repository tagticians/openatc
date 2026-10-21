// Ground picture: where departures wait and taxi, and arrivals taxiing in after vacating.
// Aircraft follow the real taxiways (taxi.ts); the taxi time comes from the route's length.
// The simulation itself only knows stand, taxiing, holding point and runway.
import { APT } from '../data/airport';
import { groundData } from '../data/stands';
import { angDiff, bearing, dist, fromBearing, toNM, type Vec } from './geo';
import { runwayGeom } from './flight';
import { makeRng, type Rng } from './rng';
import { along, remaining, taxiRoute, taxiSeconds, type TaxiRoute } from './taxi';
import type { Sim } from './sim';
import type { Aircraft } from './types';

/** Seconds from the holding point to lined up on the runway. */
export const LINEUP_S = 12;

export class Ground {
  /** Taxiing-in arrivals, from the runway exit to their stand. */
  taxiIn: { callsign: string; from: Vec; to: Vec; route: TaxiRoute | null; stand?: string; start: number; end: number; kind: 'arr' }[] = [];
  /** Departures taxiing out: their route, when they start moving and when they reach the holding point. */
  private taxiOut = new Map<string, { route: TaxiRoute | null; rwy: string; t0: number; t1: number }>();

  /** Own random stream, so stand choice never shifts the traffic a seed produces. */
  private rngStream?: Rng;

  constructor(private sim: Sim) {}

  private rng() {
    this.rngStream ??= makeRng(this.sim.seed ^ 0x57a4d);
    return this.rngStream();
  }

  vacated(ac: Aircraft) {
    const t = this.sim.time;
    const stand = this.freeStand();
    const to = (stand && this.standPos(stand)) || this.apron();
    const route = taxiRoute({ ...ac.pos }, to);
    const end = t + (route ? taxiSeconds(route) : 60);
    this.taxiIn.push({ callsign: ac.callsign, from: { ...ac.pos }, to, route, stand, start: t, end, kind: 'arr' });
    this.taxiIn = this.taxiIn.filter((x) => t < x.end + 10);
  }

  /** Where a taxiing-in arrival is now (null once it is on its stand). */
  taxiInPos(x: Ground['taxiIn'][number]): Vec | null {
    const k = (this.sim.time - x.start) / Math.max(1, x.end - x.start);
    if (k >= 1) return null;
    return x.route ? along(x.route, k) : { x: x.from.x + (x.to.x - x.from.x) * k, y: x.from.y + (x.to.y - x.from.y) * k };
  }

  /**
   * Plan a departure's taxi from its stand to the holding point, starting to move at `t0`.
   * Returns the taxi time in seconds, or null when there is no route on the network.
   */
  planTaxiOut(ac: Aircraft, t0: number): number | null {
    ac.flags.stand ??= this.assignStand();
    const from = (ac.flags.stand && this.standPos(ac.flags.stand)) || this.apron();
    const route = taxiRoute(from, this.holdingPoint(ac.runway));
    if (!route) {
      this.taxiOut.delete(ac.id);
      return null;
    }
    const secs = taxiSeconds(route);
    this.taxiOut.set(ac.id, { route, rwy: ac.runway, t0, t1: t0 + secs });
    return secs;
  }

  /** The rest of a taxiing aircraft's route, for the scope. */
  routeAhead(ac: Aircraft): Vec[] | null {
    const t = this.taxiOut.get(ac.id);
    if (t?.route && ac.phase === 'taxi') return remaining(t.route, (this.sim.time - t.t0) / Math.max(1, t.t1 - t.t0));
    const i = this.taxiIn.find((x) => x.callsign === ac.callsign);
    return i?.route ? remaining(i.route, (this.sim.time - i.start) / Math.max(1, i.end - i.start)) : null;
  }

  /** Ground position of a taxiing or waiting departure: apron → holding point, beside the runway. */
  pos(ac: Aircraft): Vec | null {
    for (const p of this.sim.plugins) {
      const g = p.groundPos?.(ac);
      if (g) return g;
    }
    const hold = this.holdingPoint(ac.runway);
    if (ac.phase === 'ready') return hold;
    const start = ac.flags.stand && this.standPos(ac.flags.stand);
    if (ac.phase === 'stand') return start || null;
    if (ac.phase !== 'taxi') return null;
    let plan = this.taxiOut.get(ac.id);
    // The runway changed while taxiing (wind shift): re-route from where it is now.
    if (plan?.route && plan.rwy !== ac.runway) {
      const here = along(plan.route, (this.sim.time - plan.t0) / Math.max(1, plan.t1 - plan.t0));
      const route = taxiRoute(here, hold);
      plan = route ? { route, rwy: ac.runway, t0: this.sim.time, t1: this.sim.time + taxiSeconds(route) } : undefined;
      if (plan) this.taxiOut.set(ac.id, plan);
      else this.taxiOut.delete(ac.id);
    }
    if (plan?.route) {
      if (this.sim.time < plan.t0) return start || plan.route.pts[0]; // start-up and push-back
      return along(plan.route, (this.sim.time - plan.t0) / Math.max(1, plan.t1 - plan.t0));
    }
    const t0 = ac.flags.taxiStart ?? this.sim.time;
    const t1 = ac.flags.taxiEnd ?? this.sim.time + 1;
    const k = Math.min(1, Math.max(0, (this.sim.time - t0) / Math.max(1, t1 - t0)));
    const from = start || this.apron();
    return { x: from.x + (hold.x - from.x) * k, y: from.y + (hold.y - from.y) * k };
  }

  /**
   * Where an aircraft moving onto the runway is: a curve from the holding point onto the
   * centreline, turning to line up. Null once it is in position and rolling (radar takes over).
   */
  lineupPos(ac: Aircraft): Vec | null {
    const t0 = ac.flags.lineupAt;
    const from = ac.flags.lineupFrom;
    if (t0 === undefined || !from || !(ac.phase === 'lineup' || (ac.phase === 'takeoff' && ac.ias < 1))) return null;
    const g = runwayGeom(ac.runway);
    const k = Math.min(1, Math.max(0, (this.sim.time - t0) / (ac.flags.lineupDur ?? LINEUP_S)));
    const e = k * k * (3 - 2 * k);
    // Quadratic curve: holding point → (corner on the centreline) → a few metres up the runway.
    const end = fromBearing(g.thr, g.crs, 0.02);
    const corner = g.thr;
    const u = 1 - e;
    return {
      x: u * u * from.x + 2 * u * e * corner.x + e * e * end.x,
      y: u * u * from.y + 2 * u * e * corner.y + e * e * end.y,
    };
  }

  /** Holding point: just short of the threshold, on the terminal side of the runway. */
  holdingPoint(rwy: string): Vec {
    const g = runwayGeom(rwy);
    // A charted holding position near the threshold (OSM), else a nominal one.
    const real = groundData(APT.icao)
      .holds.map((h) => toNM(h))
      .filter((h) => dist(h, g.thr) < 0.35)
      .sort((a, b) => dist(a, g.thr) - dist(b, g.thr))[0];
    if (real) return real;
    const side = angDiff(bearing(g.thr, this.apron()), g.crs + 90) < 90 ? 90 : -90;
    return fromBearing(fromBearing(g.thr, g.crs + 180, 0.08), g.crs + side, 0.12);
  }

  /** Stand reference for a departure: a real, unoccupied stand when the airport has them. */
  assignStand(): string | undefined {
    return this.freeStand();
  }

  standPos(ref: string): Vec | null {
    const s = groundData(APT.icao).stands.find((x) => x.ref === ref);
    return s ? toNM(s.pos) : null;
  }

  private freeStand(): string | undefined {
    const { stands } = groundData(APT.icao);
    if (!stands.length) return undefined;
    const t = this.sim.time;
    const taken = new Set<string>([
      ...this.sim.aircraft.filter((a) => a.phase === 'stand' || a.phase === 'taxi').map((a) => a.flags.stand ?? ''),
      ...this.taxiIn.filter((x) => t < x.end + 60).map((x) => x.stand ?? ''),
    ]);
    const free = stands.filter((s) => !taken.has(s.ref));
    const pool = free.length ? free : stands;
    return pool[Math.floor(this.rng() * pool.length)].ref;
  }

  /** The apron: the centre of the real stands, else 0.3 NM to the left of the first runway's midpoint. */
  apron(): Vec {
    const { stands } = groundData(APT.icao);
    if (stands.length) {
      const ps = stands.map((s) => toNM(s.pos));
      return { x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length };
    }
    const [a, b] = APT.strips[0];
    const ga = runwayGeom(a).thr;
    const gb = runwayGeom(b).thr;
    const mid = { x: (ga.x + gb.x) / 2, y: (ga.y + gb.y) / 2 };
    return fromBearing(mid, runwayGeom(a).crs - 90, 0.3);
  }
}

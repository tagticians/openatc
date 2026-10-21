// Traffic generation: synthetic arrivals and departures from the airport's traffic mix, the
// real schedule (AeroDataBox) and live ADS-B flights adopted as controllable traffic.
import { APT, ROLE, type Procedure } from '../data/airport';
import { AIRCRAFT, DESTINATIONS, TELEPHONY, type AircraftType, type Operator } from '../data/traffic';
import type { ScheduledFlight } from '../live/schedule';
import type { LiveRoute, LiveTarget } from '../live/adsb';
import { angDiff, bearing, dist, fixPos, fromBearing, gcBearing, norm360, trueToMag, type Vec } from './geo';
import { runwayGeom } from './flight';
import type { Sim } from './sim';
import type { Aircraft } from './types';

export class Spawner {
  usedCallsigns = new Set<string>();
  /** Real schedule not yet spawned, and the source label for the UI. */
  schedule: ScheduledFlight[] = [];
  scheduleSource = 'synthetic';

  constructor(private sim: Sim) {}

  private get rng() {
    return this.sim.rng;
  }

  private pickOperator(): Operator {
    const ops = APT.operators;
    const total = ops.reduce((s, o) => s + o.weight, 0);
    let r = this.rng() * total;
    for (const o of ops) if ((r -= o.weight) <= 0) return o;
    return ops[0];
  }

  private makeCallsign(op: Operator) {
    for (let i = 0; i < 50; i++) {
      const n = Math.floor(op.numbering[0] + this.rng() * (op.numbering[1] - op.numbering[0]));
      const cs = op.icao + n;
      if (!this.usedCallsigns.has(cs)) {
        this.usedCallsigns.add(cs);
        return { callsign: cs, spoken: `${op.telephony} ${n}` };
      }
    }
    const cs = op.icao + Math.floor(this.rng() * 9000 + 1000);
    return { callsign: cs, spoken: `${op.telephony} ${cs.slice(3)}` };
  }

  private squawk() {
    // Approach squawk range (illustrative)
    return '25' + String(Math.floor(this.rng() * 64)).padStart(2, '0').replace(/[89]/g, '7');
  }

  bestProc(procs: Procedure[], targetBrg: number, endFix: (p: Procedure) => string) {
    let best = procs[0];
    let bestD = 999;
    for (const p of procs) {
      const b = bearing({ x: 0, y: 0 }, fixPos(endFix(p)));
      const d = Math.abs(angDiff(b, targetBrg));
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /** A blank aircraft of the given kind, from the current airport's traffic mix. */
  baseAircraft(kind: 'arr' | 'dep'): Aircraft {
    const sim = this.sim;
    const op = this.pickOperator();
    const typeId = op.types[Math.floor(this.rng() * op.types.length)];
    const other = op.routes[Math.floor(this.rng() * op.routes.length)];
    const { callsign, spoken } = this.makeCallsign(op);
    return {
      id: callsign,
      callsign,
      spoken,
      operator: op,
      type: AIRCRAFT[typeId],
      category: 'airline',
      kind,
      owner: ROLE === 'arrival' && kind === 'dep' ? 'ai' : 'player',
      origin: kind === 'arr' ? other : APT.icao,
      dest: kind === 'arr' ? APT.icao : other,
      runway: sim.runway,
      squawk: this.squawk(),
      pos: { x: 0, y: 0 },
      alt: 0,
      hdg: 0,
      ias: 0,
      gs: 0,
      vs: 0,
      track: 0,
      cfl: 0,
      spd: null,
      lateral: { mode: 'route' },
      route: [],
      legIdx: 0,
      legFrom: null,
      approachCleared: false,
      locCaptured: false,
      gsCaptured: false,
      landingCleared: false,
      phase: 'airborne',
      age: 0,
      contactAt: sim.time,
      onFrequency: false,
      handedOff: false,
      radar: { pos: { x: 0, y: 0 }, alt: 0, gs: 0, track: 0, vs: 0 },
      history: [],
      tagOffset: { x: 22, y: -34 },
      alerts: { stca: false, los: false },
      flags: {},
    };
  }

  /** SID, runway, cleared level and parking position for a departure. */
  assignDeparture(ac: Aircraft) {
    const sim = this.sim;
    const d = DESTINATIONS[ac.dest];
    const brg = gcBearing(APT.arp, d ? [d.lat, d.lon] : [48, 2]);
    // Best-matching SID over all departure runways in use; the SID decides the runway.
    const sids = APT.sids.filter((s) => s.runway && sim.config.dep.includes(s.runway));
    ac.sid = this.bestProc(sids.length ? sids : APT.sids, brg, (p) => {
      const l = [...p.legs].reverse().find((x) => x.t === 'FIX');
      return l && l.t === 'FIX' ? l.fix : Object.keys(APT.fixes)[0];
    });
    ac.runway = ac.sid.runway ?? sim.config.dep[0];
    ac.cfl = ac.sid.initialAlt ?? APT.sidInitialAlt;
    ac.route = ac.sid.legs;
    ac.legIdx = 0;
    ac.legFrom = null;
    const rw = runwayGeom(ac.runway);
    ac.pos = fromBearing(rw.thr, rw.crs - 90, 0.08);
    ac.hdg = ac.track = norm360(rw.crs + 90);
  }

  spawnDeparture(phase: 'stand' | 'ready' = 'stand', dest?: string) {
    const sim = this.sim;
    const ac = this.baseAircraft('dep');
    if (dest && DESTINATIONS[dest]) ac.dest = dest;
    ac.phase = ac.owner === 'ai' ? 'ready' : phase;
    this.assignDeparture(ac);
    ac.alt = APT.runways[ac.runway].elevation;
    if (ac.phase === 'ready') ac.flags.cleared = true;
    // A real stand from the start, so the aircraft shows there while boarding.
    else ac.flags.stand = sim.ground.assignStand();
    // Crews call for clearance a little after boarding completes.
    ac.contactAt = sim.time + (phase === 'stand' ? 5 + this.rng() * 40 : 2);
    sim.aircraft.push(ac);
    return ac;
  }

  /** Spawn an arrival on a STAR, at the airport's hand-over distance, descending to the stack. */
  spawnArrival(distOut = APT.spawnDistance[0] + this.rng() * (APT.spawnDistance[1] - APT.spawnDistance[0]), origin?: string) {
    const sim = this.sim;
    const ac = this.baseAircraft('arr');
    if (origin && DESTINATIONS[origin]) ac.origin = origin;
    const o = DESTINATIONS[ac.origin];
    const brg = gcBearing(APT.arp, o ? [o.lat, o.lon] : [48, 2]);
    const star = this.bestProc(APT.stars, brg, (p) => (p.legs[0] as { fix: string }).fix);
    ac.star = star;
    ac.route = star.legs;
    // Polyline from an extension point (60 NM before the first fix) to the IAF.
    const fixes = star.legs.map((l) => (l.t === 'FIX' ? l.fix : '')).filter(Boolean);
    const pts: Vec[] = fixes.map(fixPos);
    if (pts.length > 1) pts.unshift(fromBearing(pts[0], bearing(pts[1], pts[0]), 60));
    else pts.unshift(fromBearing(pts[0], bearing({ x: 0, y: 0 }, pts[0]), 60));
    const centre = { x: 0, y: 0 };
    // Keep the spawn on this STAR: a STAR whose IAF lies further out than distOut (London City's
    // JACKO/GODLU stacks) would otherwise start 60 NM before its first fix, outside the sector,
    // and the aircraft would be dropped on the next step.
    const ds = pts.map((p) => dist(p, centre));
    // Spread clamped spawns out along the STAR instead of stacking them on one point.
    const inner = Math.min(...ds.slice(1)) + 1;
    if (distOut < inner) distOut = inner + (inner - distOut) * 0.5;
    distOut = Math.min(distOut, Math.max(...ds) - 1, Math.max(inner, APT.spawnDistance[1]));
    let spawn = pts[0];
    let segIdx = 0;
    for (let i = pts.length - 1; i > 0; i--) {
      const a = pts[i - 1];
      const b = pts[i];
      if (dist(a, centre) >= distOut && dist(b, centre) < distOut) {
        // Bisect along the segment for the crossing point.
        let lo = 0;
        let hi = 1;
        for (let k = 0; k < 20; k++) {
          const m = (lo + hi) / 2;
          const p = { x: a.x + (b.x - a.x) * m, y: a.y + (b.y - a.y) * m };
          if (dist(p, centre) >= distOut) lo = m;
          else hi = m;
        }
        spawn = { x: a.x + (b.x - a.x) * lo, y: a.y + (b.y - a.y) * lo };
        segIdx = i - 1; // leg index into fixes for the segment's end point
        break;
      }
    }
    ac.pos = spawn;
    ac.legIdx = segIdx; // next fix = fixes[segIdx]
    ac.legFrom = segIdx > 0 ? pts[segIdx] : null;
    const nextFix = fixPos(fixes[segIdx]);
    ac.hdg = ac.track = bearing(spawn, nextFix);
    // Higher further out; never above what the area controller would hand over this close in.
    const { base, top } = APT.stack;
    ac.alt = Math.max(base - 1000, Math.min(top + 3000, Math.round((distOut * 260) / 1000) * 1000 + Math.round(this.rng()) * 1000));
    // The area controller stacks arrivals for the same IAF 1000 ft apart.
    const iaf = (star.legs[star.legs.length - 1] as { fix: string }).fix;
    const sameIaf = sim.aircraft.filter(
      (b) => b.kind === 'arr' && b.phase === 'airborne' && !b.approachCleared && (b.star?.legs[b.star.legs.length - 1] as { fix: string } | undefined)?.fix === iaf,
    );
    let level = base;
    while (sameIaf.some((b) => b.cfl === level) && level < top) level += 1000;
    ac.cfl = level;
    ac.alt = Math.max(ac.alt, ac.cfl);
    ac.ias = 250;
    ac.gs = 260;
    ac.runway = sim.arrivalRunwayFor(ac);
    ac.contactAt = sim.time + 3;
    ac.radar = { pos: { ...ac.pos }, alt: ac.alt, gs: ac.gs, track: ac.track, vs: 0 };
    // Don't spawn on top of someone.
    if (sim.aircraft.some((b) => b.phase === 'airborne' && dist(b.pos, ac.pos) < 6 && Math.abs(b.alt - ac.alt) < 1500)) {
      ac.alt += 2000;
    }
    sim.aircraft.push(ac);
    return ac;
  }

  // ------------------------------------------------------------ real traffic adoption
  private typeFor(t: string): AircraftType {
    if (AIRCRAFT[t]) return AIRCRAFT[t];
    const base =
      /^A3[12]|^A2[01]N|^A3[12]N/.test(t) ? 'A20N' : /^B3[78]|^B73|^B38M|^B39M/.test(t) ? 'B738' : /^E1|^E2|^E7/.test(t) ? 'E190' : /^DH8|^AT[47]/.test(t) ? 'DH8D' : /^C|^GL|^F|^LJ|^E5/.test(t) ? 'C56X' : 'B738';
    return { ...AIRCRAFT[base], icao: t || base };
  }

  private operatorFor(callsign: string, a?: { name: string; iata: string; telephony?: string }): Operator {
    const prefix = callsign.slice(0, 3);
    const known = APT.operators.find((o) => o.icao === prefix);
    if (known) return known;
    return {
      icao: prefix,
      iata: a?.iata ?? '',
      name: a?.name || prefix,
      telephony: (TELEPHONY[prefix] ?? a?.telephony ?? prefix).toUpperCase(),
      types: [],
      routes: [],
      weight: 0,
      numbering: [0, 0],
    };
  }

  private registerAirport(ap: LiveRoute['origin']) {
    if (!DESTINATIONS[ap.icao]) DESTINATIONS[ap.icao] = { icao: ap.icao, name: ap.name, city: ap.city || ap.name, lat: ap.lat, lon: ap.lon };
  }

  /** Turn a real aircraft into controllable traffic. Returns true when adopted. */
  adoptLive(t: LiveTarget, route: LiveRoute): boolean {
    const sim = this.sim;
    if (!sim.started || sim.adopted.has(t.hex) || sim.aircraft.some((a) => a.callsign === t.callsign)) return false;
    const d = Math.hypot(t.pos.x, t.pos.y);
    const isArr = !t.onGround && route.dest.icao === APT.icao && d < APT.spawnDistance[1] && t.alt < 16000;
    const isDep = t.onGround && route.origin.icao === APT.icao && ROLE === 'combined';
    if (!isArr && !isDep) return false;
    this.registerAirport(route.origin);
    this.registerAirport(route.dest);
    const op = this.operatorFor(t.callsign, route.airline);
    const suffix = t.callsign.slice(3);
    const ac = this.baseAircraft(isArr ? 'arr' : 'dep');
    this.usedCallsigns.add(t.callsign);
    Object.assign(ac, {
      id: t.callsign,
      callsign: t.callsign,
      spoken: `${op.telephony} ${suffix}`,
      operator: op,
      type: this.typeFor(t.type),
      origin: route.origin.icao,
      dest: route.dest.icao,
    });
    ac.flags.real = true;
    if (isDep) {
      ac.phase = 'stand';
      this.assignDeparture(ac);
      ac.alt = APT.runways[ac.runway].elevation;
      ac.contactAt = sim.time + 5;
    } else {
      // Join the STAR whose entry lies in the aircraft's direction, from the first fix closer in.
      const brg = bearing({ x: 0, y: 0 }, t.pos);
      const star = this.bestProc(APT.stars, brg, (p) => (p.legs[0] as { fix: string }).fix);
      let idx = star.legs.findIndex((l) => l.t === 'FIX' && dist(fixPos(l.fix), { x: 0, y: 0 }) < d - 2);
      if (idx < 0) idx = star.legs.length - 1;
      ac.star = star;
      ac.route = star.legs;
      ac.legIdx = idx;
      ac.legFrom = null;
      ac.pos = { ...t.pos };
      ac.alt = t.alt;
      ac.hdg = ac.track = t.track;
      ac.ias = Math.min(250, Math.max(ac.type.vApp + 30, t.gs * 0.92));
      ac.gs = t.gs;
      ac.cfl = t.alt > APT.stack.base ? APT.stack.base : Math.max(2000, Math.round(t.alt / 1000) * 1000);
      ac.runway = sim.arrivalRunwayFor(ac);
      ac.radar = { pos: { ...ac.pos }, alt: ac.alt, gs: ac.gs, track: ac.track, vs: t.vs };
      ac.contactAt = sim.time + 2;
      // Close in, the crew expects vectors rather than flying back out to an IAF.
      if (d < 20) ac.lateral = { mode: 'heading', hdg: Math.round(trueToMag(t.track)) || 360 };
    }
    sim.adopted.add(t.hex);
    sim.live = sim.live.filter((l) => l.hex !== t.hex);
    sim.aircraft.push(ac);
    sim.say('system', `Live: ${t.callsign} (${op.name}) ${isArr ? `inbound from ${route.origin.city || route.origin.icao}` : `at the stand for ${route.dest.city || route.dest.icao}`}`, undefined, t.callsign);
    return true;
  }

  loadSchedule(flights: ScheduledFlight[], source: string) {
    const now = this.sim.time;
    this.scheduleSource = flights.length ? source : 'synthetic';
    // Keep flights that are still to come (arrivals up to 10 min late, departures up to 20).
    this.schedule = flights.filter((f) => f.scheduled > now - (f.kind === 'arr' ? 600 : 1200)).sort((a, b) => a.scheduled - b.scheduled);
  }

  /** Spawn scheduled flights as their time approaches. */
  runSchedule() {
    const sim = this.sim;
    while (this.schedule.length) {
      const f = this.schedule[0];
      const lead = f.kind === 'arr' ? 14 * 60 : 15 * 60;
      if (sim.time < f.scheduled - lead) break;
      this.schedule.shift();
      if (sim.aircraft.some((a) => a.callsign === f.callsign)) continue;
      const other = { icao: f.other.icao, name: f.other.name, city: f.other.city, lat: f.other.lat ?? 48, lon: f.other.lon ?? 2 };
      if (!DESTINATIONS[other.icao]) DESTINATIONS[other.icao] = other;
      const op = this.operatorFor(f.callsign, f.airline);
      const ac = f.kind === 'arr' ? this.spawnArrival(undefined, f.other.icao) : this.spawnDeparture('stand', f.other.icao);
      this.usedCallsigns.add(f.callsign);
      Object.assign(ac, {
        id: f.callsign,
        callsign: f.callsign,
        spoken: `${op.telephony} ${f.callsign.slice(3)}`,
        operator: op,
      });
      ac.flags.scheduled = f.number;
      if (f.aircraft) {
        ac.flags.model = f.aircraft;
        const m = f.aircraft;
        const t = /737.?800|737 MAX 8/.test(m) ? 'B738' : /737.?700/.test(m) ? 'B737' : /A321/.test(m) ? 'A21N' : /A3[12]0|A319/.test(m) ? 'A20N' : /195/.test(m) ? 'E295' : /E?190|Embraer 1/.test(m) ? 'E190' : /Dash 8|DHC-8|ATR/.test(m) ? 'DH8D' : null;
        if (t) ac.type = AIRCRAFT[t];
      }
    }
  }
}

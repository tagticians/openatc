// General aviation plug-in: VFR traffic entering and leaving the zone via reporting points,
// flying the circuit and landing. (The HEMS helicopter is its own plug-in: hems.ts.)
import { APT, type Leg } from '../data/airport';
import { AIRCRAFT, DESTINATIONS, type Operator } from '../data/traffic';
import { bearing, dist, fixPos, fromBearing, gcBearing, toLatLon, toNM, trueToMag, type Vec } from './geo';
import { runwayGeom } from './flight';
import { msg, sayRunway, LETTERS } from './phraseology';
import { COMMANDS, registerCommands } from './commands';
import * as talk from './pilotTalk';
import type { SimPlugin } from './plugin';
import type { Sim } from './sim';
import type { Aircraft } from './types';

const GA_OP: Operator = { icao: 'GA', iata: 'GA', name: 'General aviation', telephony: '', types: [], routes: [], weight: 0, numbering: [0, 0] };

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

export const isVfr = (a: Aircraft) => a.category !== 'airline';

/** A non-airline aircraft (VFR or helicopter), on frequency soon, at circuit height. */
export function blankAircraft(s: Sim, kind: 'arr' | 'dep', type: string, callsign: string, spoken: string, op: Operator, cfl: number): Aircraft {
  return {
    id: callsign,
    callsign,
    spoken,
    operator: op,
    type: AIRCRAFT[type],
    category: 'ga',
    kind,
    owner: 'player',
    origin: APT.icao,
    dest: APT.icao,
    runway: s.config.arr[0],
    squawk: '7000',
    pos: { x: 0, y: 0 },
    alt: APT.elevation,
    hdg: 0,
    ias: 0,
    gs: 0,
    vs: 0,
    track: 0,
    cfl,
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
    contactAt: s.time + 2,
    onFrequency: false,
    handedOff: false,
    radar: { pos: { x: 0, y: 0 }, alt: 0, gs: 0, track: 0, vs: 0 },
    history: [],
    tagOffset: { x: 18, y: -26 },
    alerts: { stca: false, los: false },
    flags: {},
  };
}

export class GaDirector implements SimPlugin {
  id = 'ga';
  private nextVfr = Infinity;
  private used = new Set<string>();
  /** VFR movements per hour (0 switches GA off). */
  rate = APT?.ga?.rate ?? 0;

  constructor(private sim: Sim) {}

  private rand = (a: number, b: number) => a + this.sim.rng() * (b - a);
  private pick = <T,>(xs: T[]) => xs[Math.floor(this.sim.rng() * xs.length)];

  get cfg() {
    return APT.ga;
  }

  /** Register the reporting points as fixes (DCT, HOLD, drawing). */
  init() {
    const g = this.cfg;
    if (!g) return;
    for (const [k, p] of Object.entries(g.points)) APT.fixes[k] ??= p;
  }

  start() {
    if (!this.cfg) return;
    this.init();
    const t = this.sim.time;
    this.nextVfr = this.rate > 0 ? t + this.rand(60, 240) : Infinity;
  }

  // ------------------------------------------------------------ spawning
  private registration() {
    for (let i = 0; i < 40; i++) {
      const r = Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(this.sim.rng() * 26))).join('');
      if (!this.used.has(r)) {
        this.used.add(r);
        return r;
      }
    }
    return 'XYZ';
  }

  private base(kind: 'arr' | 'dep', type: string, callsign: string, spoken: string, op: Operator): Aircraft {
    return blankAircraft(this.sim, kind, type, callsign, spoken, op, this.cfg!.circuitAlt);
  }

  /** The entry/exit reporting point facing a field. */
  private pointFor(field: string) {
    const g = this.cfg!;
    const d = DESTINATIONS[field];
    const brg = d ? gcBearing(APT.arp, [d.lat, d.lon]) : this.sim.rng() * 360;
    let best = g.entry[0];
    let bd = 999;
    for (const p of g.entry) {
      const b = bearing({ x: 0, y: 0 }, toNM(g.points[p]));
      const diff = Math.abs(((b - brg + 540) % 360) - 180);
      if (diff < bd) {
        bd = diff;
        best = p;
      }
    }
    return best;
  }

  spawnVfrArrival() {
    const g = this.cfg!;
    const reg = this.registration();
    const ac = this.base('arr', this.pick(g.types), `PH${reg}`, `PAPA HOTEL ${reg}`, GA_OP);
    ac.origin = this.pick(g.fields);
    const point = this.pointFor(ac.origin);
    const p = toNM(g.points[point]);
    const out = bearing({ x: 0, y: 0 }, p);
    ac.pos = fromBearing(p, out, 3 + this.sim.rng() * 2);
    ac.alt = 1500;
    ac.cfl = 1500;
    ac.ias = ac.type.vClimb;
    ac.hdg = ac.track = bearing(ac.pos, p);
    ac.route = [{ t: 'FIX', fix: point }];
    ac.category = 'ga';
    ac.flags.point = point;
    ac.radar = { pos: { ...ac.pos }, alt: ac.alt, gs: ac.ias, track: ac.track, vs: 0 };
    this.sim.aircraft.push(ac);
    return ac;
  }

  spawnVfrDeparture() {
    const g = this.cfg!;
    const reg = this.registration();
    const ac = this.base('dep', this.pick(g.types), `PH${reg}`, `PAPA HOTEL ${reg}`, GA_OP);
    ac.dest = this.pick(g.fields);
    ac.runway = this.sim.config.dep[0];
    ac.phase = 'ready';
    ac.category = 'ga';
    ac.flags.cleared = true;
    ac.flags.point = this.pointFor(ac.dest);
    ac.cfl = 1500;
    ac.contactAt = this.sim.time + this.rand(5, 40);
    this.sim.aircraft.push(ac);
    return ac;
  }

  // ------------------------------------------------------------ circuit
  /** Circuit points for a runway, registered as fixes: downwind start, abeam, base, final. */
  circuit(rwy: string) {
    const g = runwayGeom(rwy);
    const side = (APT.runways[rwy].circuit ?? 'L') === 'L' ? -90 : 90;
    const w = 0.9;
    const pts: Record<string, Vec> = {
      [`DS${rwy}`]: fromBearing(g.end, g.crs + side, w),
      [`DW${rwy}`]: fromBearing(g.thr, g.crs + side, w),
      [`BS${rwy}`]: fromBearing(fromBearing(g.thr, g.crs + 180, 1.3), g.crs + side, w),
      [`FN${rwy}`]: fromBearing(g.thr, g.crs + 180, 1.2),
    };
    for (const [k, v] of Object.entries(pts)) APT.fixes[k] = toLatLon(v);
    return Object.keys(pts);
  }

  /** Join the circuit: downwind, base or straight-in final. */
  join(ac: Aircraft, where: 'DW' | 'BASE' | 'FINAL') {
    const rwy = this.sim.config.arr[0];
    ac.runway = rwy;
    const [ds, dw, bs, fn] = this.circuit(rwy);
    // Join downwind at its start, or at mid-downwind when coming from the threshold end.
    const late = dist(ac.pos, fixPos(dw)) < dist(ac.pos, fixPos(ds));
    const legs = where === 'DW' ? (late ? [dw, bs, fn] : [ds, dw, bs, fn]) : where === 'BASE' ? [bs, fn] : [fn];
    ac.route = legs.map((f): Leg => ({ t: 'FIX', fix: f }));
    ac.legIdx = 0;
    ac.legFrom = null;
    ac.lateral = { mode: 'route' };
    ac.cfl = this.cfg!.circuitAlt;
    ac.flags.joined = where;
    return rwy;
  }

  // ------------------------------------------------------------ per-step behaviour
  step() {
    const g = this.cfg;
    if (!g) return;
    const s = this.sim;
    if (s.time >= this.nextVfr && this.rate > 0) {
      if (this.sim.rng() < 0.55) this.spawnVfrArrival();
      else this.spawnVfrDeparture();
      this.nextVfr = s.time + (3600 / this.rate) * this.rand(0.6, 1.4);
    }

    for (const ac of s.aircraft) {
      if (ac.category !== 'ga' || ac.phase !== 'airborne') continue;
      const done = ac.legIdx >= ac.route.length;
      if (ac.kind === 'arr') {
        // Not cleared to join yet: orbit over the reporting point.
        if (done && !ac.flags.joined && ac.lateral.mode === 'route') {
          const fix = String(ac.flags.point);
          ac.lateral = { mode: 'hold', fix, inbound: Math.round(trueToMag(bearing(fixPos(fix), { x: 0, y: 0 }))), turn: 'L', leg: 'entry', timer: 0 };
          const m = msg([[talk.displayCallsign(ac.spoken), talk.spokenCallsign(ac.spoken, talk.pilotFor(ac.callsign))], [`orbiting overhead ${fix}`, `orbiting overhead ${fix.toLowerCase()}`], ['awaiting joining instructions', 'awaiting joining instructions']]);
          s.say('pilot', m.text, m.speech, ac.callsign);
        }
        // Base leg: down to circuit-final height. On final: established on the runway centreline.
        const leg = ac.route[ac.legIdx];
        // Down to 700 ft on base and 450 ft turning final, like a normal circuit.
        if (ac.flags.joined && leg?.t === 'FIX' && leg.fix.startsWith('BS')) ac.cfl = Math.min(ac.cfl, APT.elevation + 700);
        if (ac.flags.joined && leg?.t === 'FIX' && leg.fix.startsWith('FN')) ac.cfl = Math.min(ac.cfl, APT.elevation + 450);
        if (ac.flags.joined && leg?.t === 'FIX' && leg.fix.startsWith('FN') && dist(ac.pos, fixPos(leg.fix)) < 0.35 && !ac.locCaptured) {
          ac.approachCleared = true;
          ac.locCaptured = true;
          ac.gsCaptured = true;
          ac.lateral = { mode: 'loc' };
          ac.cfl = APT.elevation;
          const m = msg([[talk.displayCallsign(ac.spoken), talk.spokenCallsign(ac.spoken, talk.pilotFor(ac.callsign))], [`final runway ${ac.runway}`, `final runway ${sayRunway(ac.runway)}`]]);
          s.say('pilot', m.text, m.speech, ac.callsign);
        }
      } else if (ac.kind === 'dep') {
        // Leaving the zone.
        if (dist(ac.pos, { x: 0, y: 0 }) > 12) {
          s.scoring.award('vfrExit', { ac, freqChange: ac.handedOff });
          ac.phase = 'done';
        }
      }
    }
  }

  /** First call on frequency for VFR traffic. Returns true when handled. */
  call(ac: Aircraft): boolean {
    if (ac.category !== 'ga') return false;
    const s = this.sim;
    const p = talk.pilotFor(ac.callsign);
    const cs: [string, string] = [talk.displayCallsign(ac.spoken), talk.spokenCallsign(ac.spoken, p)];
    const tower: [string, string] = [APT.callsigns.tower, talk.fixSpeech(APT.callsigns.tower)];
    const info: [string, string] = [`information ${s.atis}`, `information ${LETTERS[s.atis]}`];
    ac.onFrequency = true;
    let m;
    if (ac.kind === 'arr') {
      const point = String(ac.flags.point);
      const pp = toNM(this.cfg!.points[point]);
      const dir = COMPASS[Math.round(bearing(pp, ac.pos) / 45) % 8];
      const nm = Math.max(1, Math.round(dist(ac.pos, pp)));
      m = msg([tower, p.greets ? ['good afternoon', talk.greetingNow()] : ['', ''], cs, [ac.type.name, ac.type.name], [`VFR from ${DESTINATIONS[ac.origin]?.city ?? ac.origin}`, `VFR from ${DESTINATIONS[ac.origin]?.city ?? ac.origin}`], [`${nm} miles ${dir} of ${point}`, `${nm} miles ${dir} of ${point.toLowerCase()}`], ['1500 ft', 'one thousand five hundred feet'], info, ['request joining instructions', 'request joining instructions']]);
    } else {
      m = msg([tower, cs, [`holding point runway ${ac.runway}`, `holding point runway ${sayRunway(ac.runway)}`], ['ready for departure', 'ready for departure'], [`VFR to ${DESTINATIONS[ac.dest]?.city ?? ac.dest} via ${ac.flags.point}`, `VFR to ${DESTINATIONS[ac.dest]?.city ?? ac.dest} via ${String(ac.flags.point).toLowerCase()}`]]);
    }
    s.say('pilot', m.text, m.speech, ac.callsign);
    return true;
  }

}

// ------------------------------------------------------------ instructions for VFR traffic
const coreTakeoff = () => COMMANDS.find((c) => c.id === 'takeoff')!;

registerCommands(
  {
    id: 'vfr-takeoff',
    match: /^(CTO|TO)$/,
    when: (ac) => ac.category === 'ga' && ac.kind === 'dep',
    run: (c, m) => {
      const res = coreTakeoff().run(c, m);
      if (res) return res;
      // VFR departure: straight ahead to 500 ft, then to the exit reporting point.
      const ac = c.ac;
      ac.route = [{ t: 'CA', crs: APT.runways[ac.runway].magHdg, alt: APT.elevation + 500 }, { t: 'FIX', fix: String(ac.flags.point) }];
      ac.legIdx = 0;
      ac.legFrom = null;
      ac.lateral = { mode: 'route' };
      ac.cfl = 1500;
    },
  },
  {
    id: 'vfr-freq-change',
    match: /^(HO|CONTACT)$/,
    when: (ac) => ac.category !== 'airline',
    help: ['HO (VFR, helicopter)', 'Leaving the zone: frequency change approved'],
    only: () => !!APT.ga,
    run: ({ sim, ac, atc, rb }) => {
      ac.handedOff = true;
      ac.flags.handoffAt = sim.time;
      atc.push('frequency change approved, squawk 7000');
      rb.push(['frequency change approved', 'frequency change approved']);
    },
  },
  {
    id: 'join',
    match: /^(JOIN|JD|JB|JOINB|STR|JF)$/,
    help: ['JOIN · JB · STR', 'VFR: join downwind · join base · straight-in (then CL)'],
    only: () => !!APT.ga,
    run: ({ sim, ac, atc, rb }, m) => {
      if (ac.category !== 'ga' || ac.kind !== 'arr') return 'joining instructions are for VFR arrivals';
      const t = m[1];
      const where = t === 'JB' || t === 'JOINB' ? 'BASE' : t === 'STR' || t === 'JF' ? 'FINAL' : 'DW';
      const rwy = sim.ga.join(ac, where);
      const side = APT.runways[rwy].circuit === 'R' ? 'right' : 'left';
      const leg = where === 'DW' ? `join ${side}-hand downwind` : where === 'BASE' ? `join ${side} base` : 'straight-in';
      atc.push(`${leg} runway ${rwy}, circuit height ${APT.ga?.circuitAlt ?? 1000} ft, report final`);
      rb.push([`${leg} ${rwy}, wilco`, `${leg} runway ${sayRunway(rwy)}, wilco`]);
    },
  },
  {
    id: 'orbit',
    match: /^(ORB|ORBIT)$/,
    help: ['ORB', 'Orbit right at present position'],
    run: ({ ac, atc, rb }) => {
      if (ac.phase !== 'airborne') return 'not airborne';
      const name = `ORB${ac.callsign}`;
      APT.fixes[name] = toLatLon(ac.pos);
      ac.lateral = { mode: 'hold', fix: name, inbound: Math.round(trueToMag(ac.track)) || 360, turn: 'R', leg: 'entry', timer: 0 };
      atc.push('orbit right present position');
      rb.push(['orbiting right', 'orbiting right']);
    },
  },
);

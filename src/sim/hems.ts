// HEMS plug-in: the trauma helicopter (Lifeliner 2 at Rotterdam). Two kinds of mission:
//   transfer  base → hospital (along the motorway corridor) → back to base later
//   scene     base → accident scene (direct) → nearest trauma hospital → back to base later
// The player clears the lift from the base, keeps it clear of the approach and departure paths
// (ORB to hold it) and gives a frequency change when it leaves the zone.
import { APT, type Helipad, type Leg } from '../data/airport';
import { DESTINATIONS, type Operator } from '../data/traffic';
import { bearing, dist, fixPos, toLatLon, toNM, trueToMag, type Vec } from './geo';
import { msg, sayDigits, sayLevel } from './phraseology';
import { registerCommands } from './commands';
import { blankAircraft } from './ga';
import * as talk from './pilotTalk';
import type { SimPlugin } from './plugin';
import type { Sim } from './sim';
import type { Aircraft } from './types';

type Place = { id: string; name: string; pos: [number, number]; via: string[] };

export class HemsMissions implements SimPlugin {
  id = 'hems';
  private next = Infinity;
  /** Flights waiting to depart a hospital or scene (on the ground there for a while). */
  private pending: { at: number; from: Place; to: Place; stage: 'hospital' | 'base' }[] = [];

  constructor(private sim: Sim) {}

  private rand = (a: number, b: number) => a + this.sim.rng() * (b - a);
  private pick = <T,>(xs: T[]) => xs[Math.floor(this.sim.rng() * xs.length)];

  get cfg() {
    return APT.ga?.hems;
  }

  start() {
    const h = this.cfg;
    if (!h) return;
    for (const [k, p] of Object.entries(h.corridor.points)) APT.fixes[k] ??= p;
    for (const pad of [h.base, ...h.pads]) APT.fixes[pad.id] ??= pad.pos;
    // A mission every 4–6 hours, but the first one comes within the first hour of a shift.
    this.next = this.sim.time + this.rand(15, 55) * 60;
  }

  private get op(): Operator {
    const h = this.cfg!;
    return { icao: 'LIFE', iata: 'LL', name: h.operator, telephony: 'LIFELINER', types: [h.type], routes: [], weight: 0, numbering: [2, 2] };
  }

  private flying() {
    const h = this.cfg;
    return !!h && this.sim.aircraft.some((a) => a.callsign === h.callsign);
  }

  /** Nearest hospital pad to a point. */
  private nearestHospital(pos: Vec): Helipad {
    const h = this.cfg!;
    return [...h.pads].sort((a, b) => dist(toNM(a.pos), pos) - dist(toNM(b.pos), pos))[0];
  }

  /** Register a scene as a fix (so it can be drawn and flown to). */
  private scenePlace(s: { name: string; pos: [number, number] }): Place {
    const id = 'SCENE';
    APT.fixes[id] = s.pos;
    DESTINATIONS[id] = { icao: id, name: `Incident near ${s.name}`, city: s.name, lat: s.pos[0], lon: s.pos[1] };
    return { id, name: `the scene near ${s.name}`, pos: s.pos, via: [] };
  }

  /** Start a mission: the helicopter calls from its pad. Returns null when it is already busy. */
  spawn(kind?: 'scene' | 'transfer') {
    const h = this.cfg;
    if (!h || this.flying() || this.pending.length) return null;
    const scenes = h.scenes ?? [];
    const scene = kind === 'scene' || (!kind && scenes.length > 0 && this.sim.rng() < (h.sceneShare ?? 0.5));
    const target: Place = scene ? this.scenePlace(this.pick(scenes)) : this.pick(h.pads);
    const ac = this.aircraft('dep', h.base, target, scene ? 'scene' : 'hospital');
    ac.phase = 'ready';
    ac.pos = toNM(h.base.pos);
    ac.flags.pad = h.base.id;
    ac.contactAt = this.sim.time + 1;
    this.sim.aircraft.push(ac);
    return ac;
  }

  private aircraft(kind: 'arr' | 'dep', from: Place, to: Place, stage: 'scene' | 'hospital' | 'base'): Aircraft {
    const h = this.cfg!;
    const ac = blankAircraft(this.sim, kind, h.type, h.callsign, h.spoken, this.op, APT.ga!.circuitAlt);
    ac.category = 'heli';
    ac.flags.dest = to.id;
    ac.flags.stage = stage;
    ac.origin = from.id;
    ac.dest = to.id;
    ac.squawk = '0020';
    // Corridor legs between base and hospitals; scenes are flown direct.
    const via = stage === 'scene' || from.id === 'SCENE' ? [] : to.id === h.base.id ? [...from.via].reverse() : to.via;
    ac.route = [...via.map((f): Leg => ({ t: 'FIX', fix: f })), { t: 'FIX', fix: to.id }];
    return ac;
  }

  /** Lifting from a hospital or a scene (outside the player's control until it calls). */
  private liftFrom(from: Place, to: Place, stage: 'hospital' | 'base') {
    const ac = this.aircraft(stage === 'base' ? 'arr' : 'dep', from, to, stage);
    ac.pos = toNM(from.pos);
    ac.alt = 600;
    ac.ias = 90;
    const first = ac.route[0];
    ac.hdg = ac.track = bearing(ac.pos, first.t === 'FIX' ? fixPos(first.fix) : toNM(to.pos));
    ac.radar = { pos: { ...ac.pos }, alt: ac.alt, gs: ac.ias, track: ac.track, vs: 0 };
    this.sim.aircraft.push(ac);
  }

  step() {
    const h = this.cfg;
    if (!h) return;
    const s = this.sim;
    if (s.time >= this.next) {
      this.spawn();
      this.next = s.time + this.rand(h.interval[0], h.interval[1]) * 3600;
    }
    for (const p of [...this.pending]) {
      if (s.time >= p.at && !this.flying()) {
        this.pending.splice(this.pending.indexOf(p), 1);
        this.liftFrom(p.from, p.to, p.stage);
      }
    }
    for (const ac of s.aircraft) if (ac.category === 'heli' && ac.phase === 'airborne') this.fly(ac);
  }

  private placeOf(id: string): Place | null {
    const h = this.cfg!;
    if (id === h.base.id) return h.base;
    const pad = h.pads.find((p) => p.id === id);
    if (pad) return pad;
    if (id === 'SCENE') {
      const ll = APT.fixes.SCENE;
      return { id, name: `the scene near ${DESTINATIONS.SCENE?.city ?? 'the incident'}`, pos: ll, via: [] };
    }
    return null;
  }

  /** Slow down and descend onto the destination pad or scene, land, and plan the next leg. */
  private fly(ac: Aircraft) {
    const h = this.cfg!;
    const place = this.placeOf(String(ac.flags.dest));
    if (!place) return;
    const p = toNM(place.pos);
    const d = dist(ac.pos, p);
    const onLast = ac.flags.landing || (ac.lateral.mode === 'route' && ac.legIdx >= ac.route.length - 1);
    if (!onLast) return;
    if (d < 0.8 && !ac.flags.landing) {
      ac.spd = 60;
      ac.cfl = Math.min(ac.cfl, APT.elevation + 300);
    }
    if (d < 0.3 || ac.flags.landing) {
      // Final approach: point at it and come down to the hover.
      ac.flags.landing = true;
      ac.spd = 35;
      ac.cfl = APT.elevation + 30;
      ac.lateral = { mode: 'heading', hdg: Math.round(trueToMag(bearing(ac.pos, p))) || 360 };
    }
    if (d < 0.12 && ac.alt < APT.elevation + 260) {
      ac.phase = 'done';
      this.sim.scoring.award('hemsLanded', { ac, where: place.name });
      if (place.id === 'SCENE') {
        // Treat the patient on scene, then fly them to the nearest trauma centre.
        this.pending.push({ at: this.sim.time + this.rand(15, 25) * 60, from: place, to: this.nearestHospital(p), stage: 'hospital' });
      } else if (place.id !== h.base.id) {
        this.pending.push({ at: this.sim.time + this.rand(15, 35) * 60, from: place, to: h.base, stage: 'base' });
      }
    }
  }

  /** First call on frequency. */
  call(ac: Aircraft): boolean {
    if (ac.category !== 'heli') return false;
    const s = this.sim;
    const h = this.cfg!;
    const p = talk.pilotFor(ac.callsign);
    const cs: [string, string] = [talk.displayCallsign(ac.spoken), talk.spokenCallsign(ac.spoken, p)];
    const tower: [string, string] = [APT.callsigns.tower, talk.fixSpeech(APT.callsigns.tower)];
    const corridor: [string, string] = [`via the ${h.corridor.name}`, `via the ${h.corridor.name.split('').join(' ')}`];
    const to = this.placeOf(ac.dest);
    ac.onFrequency = true;
    let m;
    if (ac.phase === 'ready') {
      const scene = ac.flags.stage === 'scene';
      m = msg([
        tower,
        cs,
        ['HEMS flight, lifting from the base', 'hems flight, ready to lift from the base'],
        scene ? [`for an incident near ${DESTINATIONS.SCENE?.city}`, `for an incident near ${DESTINATIONS.SCENE?.city}`] : [`to ${to?.name}`, `to ${to?.name}`],
        scene ? ['request direct', 'request direct'] : corridor,
        ['request priority', 'request priority'],
      ]);
      ac.flags.requestedAt = s.time;
    } else if (ac.flags.stage === 'hospital') {
      m = msg([
        tower,
        cs,
        [`HEMS, lifted from the scene near ${DESTINATIONS.SCENE?.city}`, `hems, lifted from the scene near ${DESTINATIONS.SCENE?.city}`],
        ['patient on board', 'patient on board'],
        [`direct ${to?.name}`, `request direct ${to?.name}`],
        ['priority', 'priority'],
      ]);
    } else {
      const from = DESTINATIONS[ac.origin]?.city ?? ac.origin;
      m = msg([tower, cs, [`HEMS, lifted from ${from}`, `hems, lifted from ${from}`], [`${Math.round(ac.alt / 100) * 100} ft`, `${sayDigits(Math.round(ac.alt / 100))} hundred feet`], [`returning to base ${corridor[0]}`, `returning to base ${corridor[1]}`]]);
    }
    s.say('pilot', m.text, m.speech, ac.callsign);
    return true;
  }

  /** Cleared to lift from the base: onto the route, not above circuit height. Returns where to. */
  lift(ac: Aircraft) {
    const wait = this.sim.time - (ac.flags.requestedAt ?? this.sim.time);
    ac.phase = 'airborne';
    ac.alt = APT.elevation + 60;
    ac.ias = 50;
    ac.cfl = APT.ga!.circuitAlt;
    ac.legIdx = 0;
    ac.legFrom = null;
    ac.lateral = { mode: 'route' };
    const first = ac.route[0];
    ac.hdg = ac.track = first?.t === 'FIX' ? bearing(ac.pos, fixPos(first.fix)) : ac.hdg;
    ac.radar = { pos: { ...ac.pos }, alt: ac.alt, gs: 50, track: ac.track, vs: 0 };
    delete ac.flags.pad;
    if (wait > 120) this.sim.scoring.award('hemsWait', { ac, wait });
    return this.placeOf(ac.dest)?.name ?? ac.dest;
  }

  groundPos(ac: Aircraft): Vec | null {
    if (!ac.flags.pad) return null;
    const place = this.placeOf(ac.flags.pad);
    return place ? toNM(place.pos) : null;
  }

  /** Corridor, helipads and the current scene, for the scope. */
  scenery() {
    const h = this.cfg;
    if (!h) return null;
    const scene = APT.fixes.SCENE && (this.flying() || this.pending.length) ? toLatLon(toNM(APT.fixes.SCENE)) : null;
    return { corridor: Object.values(h.corridor.points), pads: [h.base, ...h.pads], scene };
  }
}

registerCommands(
  {
    id: 'heli-lift',
    match: /^(CTO|TO)$/,
    when: (ac) => ac.category === 'heli' && ac.phase === 'ready',
    help: ['CTO (helicopter)', 'Cleared to lift from the pad'],
    only: () => !!APT.ga?.hems,
    run: ({ sim, ac, atc, rb }) => {
      const scene = ac.flags.stage === 'scene';
      const to = sim.hems.lift(ac);
      const corridor = APT.ga?.hems?.corridor.name ?? '';
      const alt = APT.ga?.circuitAlt ?? 1000;
      const route = scene ? `direct ${to}` : `route ${corridor} to ${to}`;
      atc.push(`cleared to lift, ${route}, not above ${alt} ft, QNH ${sim.weather.qnh}`);
      rb.push([`cleared to lift, ${scene ? `direct ${to}` : `${corridor} to ${to}`}, not above ${alt} ft`, `cleared to lift, ${scene ? `direct ${to}` : `${corridor.split('').join(' ')} to ${to}`}, not above ${sayLevel(alt)} feet`]);
    },
  },
  {
    id: 'heli-no-approach',
    match: /^(?:ILS|APP|CA|CL|CTL|LAND)(\d{2}[LCR]?)?$/,
    when: (ac) => ac.category === 'heli',
    run: () => 'the helicopter lands at its pad, not on the runway',
  },
  {
    id: 'heli-no-lineup',
    match: /^(LU|LUW)$/,
    when: (ac) => ac.category === 'heli',
    run: () => 'the helicopter lifts from its pad: CTO',
  },
);

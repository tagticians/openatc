// World simulation: the clock, weather and runway configuration, and the step loop that ties
// the systems together. Each system lives in its own module:
//   spawner.ts    traffic generation (synthetic, live adoption)
//   safety.ts     separation, wake, low altitude, prohibited areas, airprox
//   ai.ts         AI controllers on the other positions
//   radioCalls.ts unprompted pilot calls
//   ground.ts     the ground picture for the scope
//   scoring.ts    every point won or lost
//   events.ts, ga.ts  optional plug-ins (shift events; VFR and helicopter missions)
import { APT, ROLE, type LatLon, type RunwayConfig } from '../data/airport';
import { DESTINATIONS, type Wake } from '../data/traffic';
import { EventDirector, emergencyBonus } from './events';
import { GaDirector, isVfr } from './ga';
import { HemsMissions } from './hems';
import type { SimPlugin } from './plugin';
import { angDiff, bearing, dist, fixPos, fromBearing, trueToMag, type Vec } from './geo';
import { runwayGeom, startGoAround, stepAircraft, locGeometry } from './flight';
import { onGround, type Aircraft, type RadioMsg, type Wind } from './types';
import * as talk from './pilotTalk';
import { makeRng, randomSeed, type Rng } from './rng';
import type { LiveRoute, LiveTarget } from '../live/adsb';
import { Scoring, newScore, type Score } from './scoring';
import { SafetyNet } from './safety';
import { Spawner } from './spawner';
import { AiControllers } from './ai';
import { PilotCalls } from './radioCalls';
import { Ground } from './ground';

const DT = 0.25; // physics step, seconds
export const SWEEP = 2; // radar update interval, seconds
const HISTORY = 6;

export interface Weather {
  raw: string;
  wind: Wind;
  qnh: number;
  /** Altimeter setting in hundredths of inHg, when the METAR reports one (US). */
  altimeter?: number;
  visibility: number; // m
  ceiling: number | null; // ft
  temp?: number;
  dew?: number;
  live: boolean;
  fetchedAt: number;
}

export type { Score };

export interface SimSettings {
  arrivalsPerHour: number;
  departuresPerHour: number;
}

export type Difficulty = 'trainee' | 'standard' | 'busy';

type Listener = () => void;

export class Sim {
  aircraft: Aircraft[] = [];
  selectedId: string | null = null;
  time: number; // seconds, unix epoch (UTC)
  speed = 1;
  paused = false;
  weather: Weather;
  config: RunwayConfig = APT.configs[0];
  atis = 'A';
  radio: RadioMsg[] = [];
  score: Score = newScore();
  settings: SimSettings = { arrivalsPerHour: APT.defaultRates.arrivals, departuresPerHour: APT.defaultRates.departures };
  difficulty: Difficulty = 'standard';
  /** Sim time the shift started, for the end-of-shift summary. */
  startedAt = 0;
  version = 0;
  started = false;
  /** Live ADS-B background traffic: last report, and the radar-sampled position. */
  live: (LiveTarget & { radar: Vec; history: Vec[] })[] = [];
  liveUpdatedAt = 0;
  /** Hex codes of real aircraft adopted as controllable traffic. */
  adopted = new Set<string>();
  /** Last departure off each runway, for wake turbulence time separation. */
  lastDeparture: Record<string, { time: number; wake: Wake; callsign: string }> = {};
  /** Fired when a new conflict starts (for audible alerts). */
  onAlert?: (kind: 'stca' | 'los') => void;

  /** Seeded generator: every random choice in the simulation goes through it. */
  readonly rng: Rng;
  readonly seed: number;

  // Systems
  readonly scoring = new Scoring(this);
  readonly safety = new SafetyNet(this);
  readonly spawner = new Spawner(this);
  readonly ai = new AiControllers(this);
  readonly calls = new PilotCalls(this);
  readonly ground = new Ground(this);
  // Plug-ins (order matters: it is the order their hooks run in)
  readonly ga = new GaDirector(this);
  readonly hems = new HemsMissions(this);
  readonly events = new EventDirector(this);
  readonly plugins: SimPlugin[] = [this.ga, this.hems, this.events];

  private acc = 0;
  private sweepAcc = 0;
  private nextArr = 0;
  private nextDep = 0;
  private msgId = 0;
  private listeners = new Set<Listener>();
  private radioListeners = new Set<(m: RadioMsg) => void>();

  constructor(opts: { seed?: number; startTime?: number } = {}) {
    this.seed = opts.seed ?? randomSeed();
    this.rng = makeRng(this.seed);
    this.time = opts.startTime ?? Date.now() / 1000;
    talk.setTalkClock(() => this.time);
    this.weather = {
      raw: `${APT.icao} ------Z 24010KT 9999 FEW030 12/08 Q1015`,
      wind: { dir: 240, spd: 10 },
      qnh: 1015,
      visibility: 9999,
      ceiling: null,
      live: false,
      fetchedAt: 0,
    };
    this.atis = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(this.rng() * 26)];
  }

  // ------------------------------------------------------------ subscriptions
  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  onRadio(fn: (m: RadioMsg) => void) {
    this.radioListeners.add(fn);
    return () => void this.radioListeners.delete(fn);
  }
  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  say(from: RadioMsg['from'], text: string, speech?: string, callsign?: string, level?: RadioMsg['level']) {
    const m: RadioMsg = { id: ++this.msgId, t: this.time, from, text, speech, callsign, level };
    this.radio.push(m);
    if (this.radio.length > 200) this.radio.shift();
    this.radioListeners.forEach((l) => l(m));
  }

  /** Main landing runway (first arrival runway of the configuration). */
  get runway() {
    return this.config.arr[0];
  }
  set runway(id: string) {
    this.config = APT.configs.find((c) => c.arr[0] === id) ?? APT.configs.find((c) => c.arr.includes(id)) ?? this.config;
  }

  // ------------------------------------------------------------ weather and runways
  setWeather(w: Weather) {
    // A wind-shift event overrides the reported wind for a while.
    if (this.events.windUntil > this.time && !w.raw.includes('(wind shift)')) w = { ...w, wind: this.weather.wind, raw: `${w.raw} (wind shift)` };
    const changed = w.raw !== this.weather.raw;
    this.weather = w;
    const best = this.preferredConfig();
    if (best.name !== this.config.name && this.aircraft.every((a) => a.phase !== 'takeoff' && !a.locCaptured)) {
      this.config = best;
      for (const a of this.aircraft) if (onGround(a) && !isVfr(a)) this.spawner.assignDeparture(a);
      for (const a of this.aircraft) if (a.kind === 'arr' && !a.approachCleared) a.runway = this.arrivalRunwayFor(a);
      if (this.started) this.say('system', `Runway configuration changed: ${this.configLabel()}`, undefined, undefined, 'warn');
    }
    if (changed) {
      this.atis = String.fromCharCode(((this.atis.charCodeAt(0) - 65 + 1) % 26) + 65);
    }
    this.emit();
  }

  configLabel(c = this.config) {
    return c.arr.join(c.arr.length > 1 ? '+' : '') === c.dep.join('')
      ? `runway ${c.arr[0]}`
      : `landing ${c.arr.join('/')}, departing ${c.dep.join('/')}`;
  }

  /**
   * Runway configuration from the wind: the first configuration in preference order whose main
   * landing runway has ≤ 3 kt tailwind and ≤ 20 kt crosswind, else the one with most headwind.
   */
  preferredConfig(): RunwayConfig {
    const { dir, spd } = this.weather.wind;
    const comp = (id: string) => {
      const a = angDiff(dir, APT.runways[id].trueHdg) * (Math.PI / 180);
      return { hw: spd * Math.cos(a), xw: Math.abs(spd * Math.sin(a)) };
    };
    for (const c of APT.configs) {
      const { hw, xw } = comp(c.arr[0]);
      if (hw >= -3 && xw <= 20) return c;
    }
    return [...APT.configs].sort((a, b) => comp(b.arr[0]).hw - comp(a.arr[0]).hw)[0];
  }

  /** Landing runway for an arrival: the active one whose final starts nearest its IAF. */
  arrivalRunwayFor(ac: Aircraft) {
    const last = [...ac.route].reverse().find((l) => l.t === 'FIX');
    const ref = last && last.t === 'FIX' ? fixPos(last.fix) : ac.pos;
    let best = this.config.arr[0];
    let bd = Infinity;
    for (const id of this.config.arr) {
      const r = APT.runways[id];
      const start = r.ifix && APT.fixes[r.ifix] ? fixPos(r.ifix) : fromBearing(runwayGeom(id).thr, (r.trueHdg + 180) % 360, 10);
      const d = dist(ref, start);
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    return best;
  }

  /** Physical runway identity, so 18C and 36C count as the same strip. */
  sameStrip(a: string, b: string) {
    return a === b || APT.strips.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  }

  /** Is the (physical) runway occupied by someone other than `except`, or closed? */
  runwayBusy = (except: Aircraft | null, runway: string) => this.events.isClosed(runway) || !!this.runwayOccupant(except, runway);

  /** Who is on the (physical) runway, if anyone, other than `except`. */
  runwayOccupant = (except: Aircraft | null, runway: string) =>
    this.aircraft.find(
      (a) =>
        a !== except &&
        this.sameStrip(a.runway, runway) &&
        (a.phase === 'lineup' ||
          a.phase === 'rollout' ||
          // A departure stops blocking once airborne or 6000 ft down the runway (FAA/ICAO
          // reduced runway separation), so an arrival behind it can land.
          (a.phase === 'takeoff' && dist(a.pos, runwayGeom(a.runway).thr) < 1)),
    );

  // ------------------------------------------------------------ traffic (see spawner.ts)
  spawnArrival(distOut?: number, origin?: string) {
    return this.spawner.spawnArrival(distOut, origin);
  }
  spawnDeparture(phase: 'stand' | 'ready' = 'stand', dest?: string) {
    return this.spawner.spawnDeparture(phase, dest);
  }
  adoptLive(t: LiveTarget, route: LiveRoute) {
    return this.spawner.adoptLive(t, route);
  }

  // ------------------------------------------------------------ main loop
  start() {
    this.startedAt = this.time;
    for (const p of this.plugins) p.start?.();
    this.started = true;
    this.say('system', `${APT.callsigns.approach}${ROLE === 'combined' ? ' & Tower' : ''} open. ${this.configLabel()[0].toUpperCase()}${this.configLabel().slice(1)}, information ${this.atis}.`);
    const [d0, d1] = APT.spawnDistance;
    const n = ROLE === 'arrival' ? 5 : 3;
    for (let i = 0; i < n; i++) this.spawnArrival(d0 * 0.4 + ((d1 - d0 * 0.4) * i) / n + this.rng() * 3);
    this.spawnDeparture('ready');
    this.spawnDeparture(ROLE === 'arrival' ? 'ready' : 'stand');
    this.nextArr = this.time + this.interval(this.settings.arrivalsPerHour);
    this.nextDep = this.time + this.interval(this.settings.departuresPerHour);
    this.sweep();
  }

  private interval(perHour: number) {
    if (perHour <= 0) return 3600 * 24 * 365; // synthetic traffic off
    const mean = 3600 / perHour;
    return mean * (0.6 + this.rng() * 0.8);
  }

  tick(realDt: number) {
    if (this.paused) return;
    this.acc += Math.min(realDt, 2) * this.speed;
    let stepped = false;
    while (this.acc >= DT) {
      this.acc -= DT;
      this.step(DT);
      stepped = true;
    }
    if (stepped) this.emit();
  }

  private step(dt: number) {
    this.time += dt;
    for (const ac of this.aircraft) {
      const ev = stepAircraft(ac, dt, this.weather.wind, this.runwayBusy);
      if (ev.airborne) this.lastDeparture[ac.runway] = { time: this.time, wake: ac.type.wake, callsign: ac.callsign };
      if (ac.owner === 'ai') {
        if (ev.goAround) startGoAround(ac);
        continue;
      }
      if (ev.goAround) this.goAround(ac);
      if (ev.airborne) this.calls.airborne(ac);
      if (ev.enteredHold && ac.onFrequency) {
        const m = talk.enteringHold(ac.spoken, ac.callsign, ev.enteredHold, ac.cfl);
        this.say('pilot', m.text, m.speech, ac.callsign);
      }
      this.calls.requests(ac);
      if (ev.landed) this.onVacated(ac);
      if (ev.locCaptured && ac.flags.untilEst !== undefined) {
        ac.cfl = Math.min(ac.cfl, ac.flags.untilEst);
        delete ac.flags.untilEst;
      }
      if (ev.locCaptured && ac.onFrequency) {
        const m = talk.established(ac.spoken, ac.callsign, ac.runway);
        this.say('pilot', m.text, m.speech, ac.callsign);
      }
      this.calls.firstContact(ac);
    }
    this.ai.tick();
    for (const p of this.plugins) p.step?.();
    this.leaveSector();

    // Spawning synthetic traffic (live ADS-B flights are adopted separately). When the inbound stack is
    // full, the area controller holds traffic upstream (flow control).
    const inbound = this.aircraft.filter((a) => a.kind === 'arr' && a.phase === 'airborne' && !a.approachCleared).length;
    const flowControl = inbound >= APT.stack.maxInbound;
    // Rates changed in Settings take effect within the next interval.
    const cap = (perHour: number) => this.time + (perHour > 0 ? 3600 / perHour : 1e9);
    this.nextArr = Math.min(this.nextArr, cap(this.settings.arrivalsPerHour));
    this.nextDep = Math.min(this.nextDep, cap(this.settings.departuresPerHour));
    if (this.time >= this.nextArr) {
      if (!flowControl) this.spawnArrival();
      this.nextArr = this.time + (flowControl ? 120 : this.interval(this.settings.arrivalsPerHour));
    }
    if (this.time >= this.nextDep) {
      const waiting = this.aircraft.filter(onGround).length;
      if (waiting < (ROLE === 'arrival' ? 2 * this.config.dep.length : 5)) this.spawnDeparture('stand');
      this.nextDep = this.time + this.interval(this.settings.departuresPerHour);
    }

    this.sweepAcc += dt;
    if (this.sweepAcc >= SWEEP) {
      this.sweepAcc -= SWEEP;
      this.sweep();
      this.safety.check(SWEEP);
      for (const p of this.plugins) p.sweep?.();
    }
  }

  /** Traffic leaving the sector: departures handed off (or not), arrivals that wandered off. */
  private leaveSector() {
    for (const ac of this.aircraft) {
      if (ac.phase !== 'airborne') continue;
      const d = dist(ac.pos, { x: 0, y: 0 });
      if (ac.owner === 'ai') {
        if (d > 40) ac.phase = 'done';
        continue;
      }
      if (ac.kind === 'dep' && (d > 42 || (ac.handedOff && d > 25))) {
        if (!ac.handedOff) this.scoring.award('leftSector', { ac });
        else this.scoring.award('handedOff', { ac, alt: ac.flags.handoffAlt ?? ac.alt });
        ac.phase = 'done';
      }
      if (ac.kind === 'arr' && d > 60) ac.phase = 'done';
    }
    const before = this.aircraft.length;
    this.aircraft = this.aircraft.filter((a) => a.phase !== 'done');
    if (this.aircraft.length !== before && this.selectedId && !this.aircraft.some((a) => a.id === this.selectedId)) {
      this.selectedId = null;
    }
  }

  setLive(targets: LiveTarget[]) {
    const prev = new Map(this.live.map((l) => [l.hex, l]));
    // Reports carry wall-clock time; express them relative to the sim clock.
    const offset = this.time - Date.now() / 1000;
    this.live = targets.filter((t) => !t.onGround && !this.adopted.has(t.hex)).map((t) => {
      const p = prev.get(t.hex);
      return { ...t, fixTime: t.fixTime + offset, radar: p?.radar ?? { ...t.pos }, history: p?.history ?? [] };
    });
    this.liveUpdatedAt = Date.now();
  }

  private sweep() {
    for (const l of this.live) {
      l.history.unshift({ ...l.radar });
      if (l.history.length > 4) l.history.pop();
      // Dead-reckon from the last report (cap the extrapolation at 30 s).
      const dt = Math.min(30, Math.max(0, this.time - l.fixTime));
      l.radar = fromBearing(l.pos, l.track, (l.gs * dt) / 3600);
    }
    for (const ac of this.aircraft) {
      if (onGround(ac)) continue;
      ac.history.unshift({ ...ac.radar.pos });
      if (ac.history.length > HISTORY) ac.history.pop();
      ac.radar = { pos: { ...ac.pos }, alt: ac.alt, gs: ac.gs, track: ac.track, vs: ac.vs };
    }
  }

  // ------------------------------------------------------------ separation (see safety.ts)
  departureWakeWait(ac: Aircraft) {
    return this.safety.departureWakeWait(ac);
  }
  wakePair(a: Aircraft, b: Aircraft, h?: number) {
    return this.safety.wakePair(a, b, h);
  }

  // ------------------------------------------------------------ ground (see ground.ts)
  get taxiIn() {
    return this.ground.taxiIn;
  }
  groundPos(ac: Aircraft) {
    return this.ground.pos(ac);
  }
  holdingPoint(rwy: string) {
    return this.ground.holdingPoint(rwy);
  }
  apron() {
    return this.ground.apron();
  }

  // ------------------------------------------------------------ outcomes
  /** Issue the IFR clearance to a departure at the stand (Delivery). */
  clearDeparture(ac: Aircraft) {
    ac.flags.cleared = true;
    ac.phase = 'taxi';
    ac.onFrequency = false; // switches to Tower for taxi
    // Start-up and push-back, then the taxi along the real taxiways (a fixed guess off-network).
    const r = this.rng();
    const startup = 40 + r * 40;
    const taxi = this.ground.planTaxiOut(ac, this.time + startup);
    ac.contactAt = this.time + (taxi !== null ? startup + taxi : 80 + r * 100);
    ac.flags.taxiStart = this.time + (taxi !== null ? startup : 0);
    ac.flags.taxiEnd = ac.contactAt;
    const wait = this.time - (ac.flags.requestedAt ?? this.time);
    if (wait > 180) this.scoring.award('clearanceWait', { ac, wait });
  }

  /** A departure that has to come back (bird strike): it becomes an arrival on vectors. */
  returnToLand(ac: Aircraft) {
    ac.kind = 'arr';
    ac.handedOff = false;
    ac.origin = APT.icao;
    ac.runway = this.config.arr[0];
    ac.route = [];
    ac.legIdx = 0;
    ac.legFrom = null;
    ac.lateral = { mode: 'heading', hdg: Math.round(trueToMag(ac.hdg)) || 360 };
    ac.cfl = Math.max(3000, Math.min(ac.cfl, Math.round(ac.alt / 1000) * 1000));
    ac.approachCleared = false;
    ac.landingCleared = false;
    ac.onFrequency = true;
  }

  /** Radio failure: fly the procedure to the approach and land, answering nothing. */
  flyNordo(ac: Aircraft) {
    const rwy = this.arrivalRunwayFor(ac);
    const r = APT.runways[rwy];
    ac.runway = rwy;
    const rest = ac.lateral.mode === 'route' ? ac.route.slice(ac.legIdx) : [];
    const last = [...rest].reverse().find((l) => l.t === 'FIX');
    const tr = last && last.t === 'FIX' ? r.transitions[last.fix] : undefined;
    const tail = tr ? tr.slice(1) : r.ifix ? [{ t: 'FIX' as const, fix: r.ifix }] : [];
    ac.route = [...rest, ...tail];
    ac.legIdx = 0;
    ac.legFrom = null;
    ac.lateral = { mode: 'route' };
    ac.flags.clearedFrom = Math.max(ac.cfl, Math.round(ac.alt));
    ac.approachCleared = true;
    ac.landingCleared = true;
    ac.cfl = Math.min(ac.cfl, r.fap?.alt ?? 2000);
  }

  private onVacated(ac: Aircraft) {
    if (ac.flags.emergency) {
      this.scoring.award('emergencyLanded', { ac, bonus: emergencyBonus(ac, this.time), minutes: Math.round((this.time - (ac.flags.emergencyAt ?? this.time)) / 60) });
    }
    this.ground.vacated(ac);
    this.scoring.award('landed', { ac });
    this.calls.vacated(ac);
  }

  goAround(ac: Aircraft, forced?: string, free = false) {
    if (forced) {
      startGoAround(ac);
      this.scoring.award('goAround', { ac, reason: forced, free });
      return;
    }
    if (this.events.isClosed(ac.runway)) {
      startGoAround(ac);
      const m = talk.goingAround(ac.spoken, ac.callsign);
      this.say('pilot', m.text, m.speech, ac.callsign, 'warn');
      this.scoring.award('goAround', { ac, reason: `runway ${ac.runway} is closed` });
      return;
    }
    if (ac.category === 'ga') {
      // VFR go-around: climb straight ahead and rejoin the circuit downwind.
      startGoAround(ac);
      this.ga.join(ac, 'DW');
      this.score.goArounds++;
      this.say('system', `${talk.displayCallsign(ac.spoken)} going around, rejoining downwind`, undefined, ac.callsign, 'warn');
      return;
    }
    const occ = this.runwayOccupant(ac, ac.runway);
    const doing = occ ? ({ lineup: 'lined up', rollout: 'still rolling out', takeoff: 'still on its take-off roll' } as Record<string, string>)[occ.phase] ?? 'on the runway' : '';
    const reason = ac.flags.unstable
      ? 'unstable approach (too high)'
      : ac.landingCleared
        ? ROLE === 'arrival'
          ? 'spacing: previous arrival still on the runway'
          : occ
            ? `runway occupied: ${occ.callsign} ${doing}`
            : 'runway occupied'
        : 'no landing clearance';
    ac.flags.unstable = false;
    startGoAround(ac);
    const m = talk.goingAround(ac.spoken, ac.callsign);
    this.say('pilot', m.text, m.speech, ac.callsign, 'warn');
    this.scoring.award('goAround', { ac, reason });
  }

  // ------------------------------------------------------------ helpers for UI
  get selected() {
    return this.aircraft.find((a) => a.id === this.selectedId) ?? null;
  }

  find(token: string): Aircraft | null {
    const t = token.toUpperCase();
    const exact = this.aircraft.find((a) => a.callsign === t);
    if (exact) return exact;
    const matches = this.aircraft.filter((a) => a.callsign.endsWith(t) || a.callsign.startsWith(t));
    return matches.length === 1 ? matches[0] : null;
  }

  distToThreshold(ac: Aircraft) {
    return locGeometry(ac).along;
  }

  fixExists(f: string) {
    return f in APT.fixes;
  }

  destinationCity(icao: string) {
    return DESTINATIONS[icao]?.city ?? icao;
  }

  /** MAG heading the aircraft would fly direct to a point. */
  magBearingTo(ac: Aircraft, p: Vec) {
    return trueToMag(bearing(ac.pos, p));
  }
}

export type { LatLon };

import type { Leg, Procedure } from '../data/airport';
import type { AircraftType, Operator } from '../data/traffic';
import type { Vec } from './geo';

export type Phase =
  | 'stand' // departure at the gate, awaiting IFR clearance
  | 'taxi' // cleared, taxiing to the holding point
  | 'ready' // at the holding point, ready for departure
  | 'lineup'
  | 'takeoff'
  | 'airborne'
  | 'rollout'
  | 'done';

export type Lateral =
  | { mode: 'route' }
  | { mode: 'heading'; hdg: number; turn?: 'L' | 'R' } // hdg = MAG
  | { mode: 'hold'; fix: string; inbound: number; turn: 'L' | 'R'; leg: 'in' | 'out' | 'entry'; timer: number }
  | { mode: 'loc' };

export interface Aircraft {
  id: string;
  callsign: string; // ICAO, e.g. TRA5123
  spoken: string; // telephony, e.g. "TRANSAVIA 5123"
  operator: Operator;
  type: AircraftType;
  /** What kind of flying: airline IFR traffic, VFR general aviation, or the HEMS helicopter. */
  category: 'airline' | 'ga' | 'heli';
  kind: 'arr' | 'dep';
  /** Who controls it: the player, or an AI controller on another position. */
  owner: 'player' | 'ai';
  origin: string;
  dest: string;
  runway: string;
  sid?: Procedure;
  star?: Procedure;
  squawk: string;

  pos: Vec;
  alt: number; // ft AMSL
  hdg: number; // TRUE heading
  ias: number;
  gs: number;
  vs: number; // ft/min, smoothed
  track: number; // TRUE

  cfl: number; // cleared level, ft
  spd: number | null; // assigned IAS
  lateral: Lateral;
  route: Leg[];
  legIdx: number;
  legFrom: Vec | null;

  approachCleared: boolean;
  locCaptured: boolean;
  gsCaptured: boolean;
  landingCleared: boolean;
  phase: Phase;
  /** Seconds since spawn; drives radio call timing and scoring. */
  age: number;
  /** Sim time (s) at which the aircraft may next call on frequency. */
  contactAt: number;
  onFrequency: boolean;
  handedOff: boolean;

  // Radar presentation (sampled per sweep)
  radar: { pos: Vec; alt: number; gs: number; track: number; vs: number };
  history: Vec[];
  tagOffset: Vec; // screen px
  alerts: { stca: boolean; los: boolean; wake?: boolean; low?: boolean; prohibited?: boolean };
  /** Per-flight state that only some systems use (typed, so a typo is a compile error). */
  flags: Flags;
}

export const onGround = (a: { phase: Phase }) => a.phase === 'stand' || a.phase === 'taxi' || a.phase === 'ready';

export interface Wind {
  dir: number; // TRUE, from
  spd: number; // kt
  gust?: number;
}

export interface RadioMsg {
  id: number;
  t: number;
  from: 'atc' | 'pilot' | 'system';
  callsign?: string;
  text: string;
  /** Text shaped for speech synthesis (numbers spelled ICAO style). */
  speech?: string;
  level?: 'info' | 'warn' | 'alert';
}

export interface Flags {
  // ---- departures
  /** IFR clearance given. */
  cleared?: boolean;
  stand?: string;
  /** When the crew asked for clearance / lift (sim time). */
  requestedAt?: number;
  taxiStart?: number;
  taxiEnd?: number;
  /** Seconds to go before the take-off roll starts. */
  rollDelay?: number;
  /** Line-up: when the aircraft left the holding point, and from where (scope animation). */
  lineupAt?: number;
  lineupFrom?: { x: number; y: number };
  lineupDur?: number;
  handoffAt?: number;
  handoffAlt?: number;
  levelSince?: number;
  askedHigher?: boolean;
  // ---- arrivals and approach
  /** Pressure setting already given. */
  qnh?: boolean;
  expedite?: boolean;
  /** Level when cleared for the approach (ceiling of the descent profile). */
  clearedFrom?: number;
  /** FAA "maintain until established": altitude to descend to once on the localizer. */
  untilEst?: number;
  prevCross?: number;
  unstable?: boolean;
  // ---- live traffic
  real?: boolean;
  model?: string;
  // ---- events
  emergency?: string;
  emergencyAt?: number;
  nordo?: boolean;
  windshear?: boolean;
  // ---- VFR and helicopter missions
  /** VFR entry/exit reporting point. */
  point?: string;
  /** Circuit joined: downwind, base or straight-in. */
  joined?: 'DW' | 'BASE' | 'FINAL';
  /** Helicopter: destination pad id, pad it is standing on, and on final to the pad. */
  dest?: string;
  pad?: string;
  landing?: boolean;
  /** HEMS mission stage (scene → hospital → base). */
  stage?: 'scene' | 'hospital' | 'base';
  scene?: string;
}

// Scoring: every point the game gives or takes, in one table, with the message the controller
// sees. Systems report what happened (`award('los', …)`); this decides what it is worth.
import { WAKE_NAME } from './wake';
import * as talk from './pilotTalk';
import type { Sim } from './sim';
import type { Aircraft } from './types';
import type { Wake } from '../data/traffic';

export interface Score {
  landed: number;
  departed: number;
  goArounds: number;
  separationLosses: number;
  stcaSeconds: number;
  runwayIncursions: number;
  wakeInfringements?: number;
  points: number;
}

export const newScore = (): Score => ({ landed: 0, departed: 0, goArounds: 0, separationLosses: 0, stcaSeconds: 0, runwayIncursions: 0, points: 0 });

/** Points per event. Negative = penalty. */
export const POINTS = {
  landed: 25,
  handedOffHigh: 30, // departure handed off at or above 5000 ft
  handedOffLow: 15,
  leftSector: -20,
  los: -50,
  airprox: -40,
  wake: -25,
  wakeDeparture: -25,
  low: -30,
  prohibited: -100,
  incursion: -40,
  goAround: -15,
  lateTransfer: -5,
  clearanceWait: -5,
  hemsLanded: 10,
  hemsWait: -10,
  vfrExit: 10,
  vfrNoFreqChange: -10,
} as const;

type Ev =
  | ['landed', { ac: Aircraft }]
  | ['handedOff', { ac: Aircraft; alt: number }]
  | ['leftSector', { ac: Aircraft }]
  | ['los', { a: Aircraft; b: Aircraft; h: number; v: number }]
  | ['airprox', { a: Aircraft; b: Aircraft }]
  | ['wake', { lead: Aircraft; follow: Aircraft; h: number; need: number }]
  | ['wakeDeparture', { ac: Aircraft; wake: { left: number; need: number; leader: { wake: Wake; callsign: string } } }]
  | ['low', { ac: Aircraft; mva: number }]
  | ['prohibited', { ac: Aircraft; area: string }]
  | ['incursion', { ac: Aircraft; other?: Aircraft }]
  | ['goAround', { ac: Aircraft; reason: string; free?: boolean; pilot?: boolean }]
  | ['lateTransfer', { ac: Aircraft }]
  | ['clearanceWait', { ac: Aircraft; wait: number }]
  | ['emergencyLanded', { ac: Aircraft; bonus: number; minutes: number }]
  | ['hemsLanded', { ac: Aircraft; where: string }]
  | ['hemsWait', { ac: Aircraft; wait: number }]
  | ['vfrExit', { ac: Aircraft; freqChange: boolean }];

const sign = (n: number) => (n < 0 ? `−${-n}` : `+${n}`);

export class Scoring {
  constructor(private sim: Sim) {}

  award<K extends Ev[0]>(kind: K, e: Extract<Ev, [K, unknown]>[1]): void;
  award(kind: Ev[0], e: Record<string, unknown>) {
    const s = this.sim.score;
    const say = (text: string, cs?: string, level?: 'warn' | 'alert') => this.sim.say('system', text, undefined, cs, level);
    const add = (n: number) => (s.points += n);
    switch (kind) {
      case 'landed':
        s.landed++;
        add(POINTS.landed);
        return;
      case 'handedOff': {
        add((e.alt as number) >= 5000 ? POINTS.handedOffHigh : POINTS.handedOffLow);
        s.departed++;
        return;
      }
      case 'leftSector': {
        const ac = e.ac as Aircraft;
        add(POINTS.leftSector);
        say(`${ac.callsign} left the sector without hand-off (${sign(POINTS.leftSector)})`, ac.callsign, 'warn');
        s.departed++;
        return;
      }
      case 'los': {
        const { a, b, h, v } = e as { a: Aircraft; b: Aircraft; h: number; v: number };
        s.separationLosses++;
        add(POINTS.los);
        say(`SEPARATION LOST ${a.callsign} / ${b.callsign} — ${h.toFixed(1)} NM, ${Math.round(v)} ft (${sign(POINTS.los)})`, undefined, 'alert');
        return;
      }
      case 'airprox': {
        const { a, b } = e as { a: Aircraft; b: Aircraft };
        add(POINTS.airprox);
        const d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
        say(`AIRPROX ${a.callsign} / ${b.callsign}: ${d.toFixed(1)} NM, ${Math.round(Math.abs(a.alt - b.alt))} ft (${sign(POINTS.airprox)})`, undefined, 'alert');
        return;
      }
      case 'wake': {
        const { lead, follow, h, need } = e as { lead: Aircraft; follow: Aircraft; h: number; need: number };
        s.wakeInfringements = (s.wakeInfringements ?? 0) + 1;
        add(POINTS.wake);
        say(`WAKE ${follow.callsign} ${h.toFixed(1)} NM behind ${WAKE_NAME[lead.type.wake]} ${lead.callsign}, ${need} NM required (${sign(POINTS.wake)})`, follow.callsign, 'warn');
        return;
      }
      case 'wakeDeparture': {
        const { ac, wake: wk } = e as { ac: Aircraft; wake: { left: number; need: number; leader: { wake: Wake; callsign: string } } };
        s.wakeInfringements = (s.wakeInfringements ?? 0) + 1;
        add(POINTS.wakeDeparture);
        say(`WAKE ${ac.callsign} cleared ${wk.need - wk.left} s after ${WAKE_NAME[wk.leader.wake]} ${wk.leader.callsign}, ${wk.need / 60} min required (${sign(POINTS.wakeDeparture)})`, ac.callsign, 'warn');
        return;
      }
      case 'low': {
        const { ac, mva } = e as { ac: Aircraft; mva: number };
        add(POINTS.low);
        say(`LOW ALTITUDE ${ac.callsign}: ${Math.round(ac.alt / 100) * 100} ft on vectors, MVA here ${mva} ft (${sign(POINTS.low)})`, ac.callsign, 'alert');
        return;
      }
      case 'prohibited': {
        const { ac, area } = e as { ac: Aircraft; area: string };
        add(POINTS.prohibited);
        say(`${ac.callsign} ENTERED PROHIBITED AREA ${area} (${sign(POINTS.prohibited)})`, ac.callsign, 'alert');
        return;
      }
      case 'incursion': {
        const { ac, other } = e as { ac: Aircraft; other?: Aircraft };
        s.runwayIncursions++;
        add(POINTS.incursion);
        say(`Take-off clearance with runway not available${other ? ` (${other.callsign} on short final)` : ''} (${sign(POINTS.incursion)})`, ac.callsign, 'alert');
        return;
      }
      case 'goAround': {
        const { ac, reason, free } = e as { ac: Aircraft; reason: string; free?: boolean };
        s.goArounds++;
        if (reason.startsWith('runway occupied')) s.runwayIncursions++;
        if (!free) add(POINTS.goAround);
        say(`${ac.callsign} go-around: ${reason}${free ? '' : ` (${sign(POINTS.goAround)})`}`, ac.callsign, 'warn');
        return;
      }
      case 'lateTransfer': {
        const ac = e.ac as Aircraft;
        add(POINTS.lateTransfer);
        say(`${ac.callsign} transferred to Tower late (${sign(POINTS.lateTransfer)})`, ac.callsign, 'warn');
        return;
      }
      case 'clearanceWait': {
        const { ac, wait } = e as { ac: Aircraft; wait: number };
        add(POINTS.clearanceWait);
        say(`${ac.callsign} waited ${Math.round(wait / 60)} min for clearance (${sign(POINTS.clearanceWait)})`, ac.callsign, 'warn');
        return;
      }
      case 'emergencyLanded': {
        const { ac, bonus, minutes } = e as { ac: Aircraft; bonus: number; minutes: number };
        add(bonus);
        say(`${ac.callsign} (${ac.flags.emergency}) safely on the ground after ${minutes} min (+${bonus})`, ac.callsign);
        return;
      }
      case 'hemsLanded': {
        const { ac, where } = e as { ac: Aircraft; where: string };
        add(POINTS.hemsLanded);
        say(`${talk.displayCallsign(ac.spoken)} landed at ${where}`, ac.callsign);
        return;
      }
      case 'hemsWait': {
        const { ac, wait } = e as { ac: Aircraft; wait: number };
        add(POINTS.hemsWait);
        say(`${talk.displayCallsign(ac.spoken)} waited ${Math.round(wait / 60)} min for its lift clearance (${sign(POINTS.hemsWait)})`, ac.callsign, 'warn');
        return;
      }
      case 'vfrExit': {
        const { ac, freqChange } = e as { ac: Aircraft; freqChange: boolean };
        s.departed++;
        add(freqChange ? POINTS.vfrExit : POINTS.vfrNoFreqChange);
        if (!freqChange) say(`${talk.displayCallsign(ac.spoken)} left the zone without a frequency change (${sign(POINTS.vfrNoFreqChange)})`, ac.callsign, 'warn');
        return;
      }
    }
  }
}

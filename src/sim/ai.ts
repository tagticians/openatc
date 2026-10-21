// AI controllers on the positions the player doesn't work: Tower launching AI departures, the
// departure/centre sector climbing traffic out (around the player's), and (Schiphol) Tower
// taking over established arrivals.
import { ROLE } from '../data/airport';
import { dist } from './geo';
import { locGeometry, runwayGeom } from './flight';
import { isVfr } from './ga';
import type { Sim } from './sim';
import type { Aircraft } from './types';

export class AiControllers {
  private lastTakeoff: Record<string, number> = {};

  constructor(private sim: Sim) {}

  /**
   * Centre/departure radar climbing a departure it owns: climb to cruise, but level off
   * beneath anyone within 6 NM ahead in the climb (the player's arrivals included).
   */
  private climb(a: Aircraft) {
    const blocker = this.sim.aircraft
      .filter((b) => b !== a && b.phase === 'airborne' && dist(a.pos, b.pos) < 6 && b.alt > a.alt - 300 && b.alt < a.alt + 2500)
      .sort((x, y) => x.alt - y.alt)[0];
    if (blocker) {
      const level = Math.max(Math.round(a.alt / 1000) * 1000, 3000);
      a.cfl = Math.min(a.cfl, Math.max(level, Math.floor((blocker.alt - 1000) / 1000) * 1000));
      if (a.cfl < a.alt - 200) a.cfl = Math.round(a.alt / 100) * 100; // never descend: just stop climbing
    } else if (a.cfl < 24000) a.cfl = 24000;
  }

  tick() {
    const sim = this.sim;
    for (const rwy of sim.config.dep) {
      const next = sim.aircraft.find((a) => a.owner === 'ai' && a.kind === 'dep' && a.phase === 'ready' && a.runway === rwy);
      if (!next) continue;
      const since = sim.time - (this.lastTakeoff[rwy] ?? 0);
      const arrivalClose = sim.aircraft.some((a) => a.kind === 'arr' && a.locCaptured && sim.sameStrip(a.runway, rwy) && locGeometry(a).along < 4);
      if (since > 100 && !sim.departureWakeWait(next) && !sim.runwayBusy(next, rwy) && !arrivalClose) {
        const rw = runwayGeom(rwy);
        next.pos = { ...rw.thr };
        next.hdg = next.track = rw.crs;
        next.phase = 'takeoff';
        next.ias = 0;
        next.flags.rollDelay = 4; // AI tower clears them as they reach the runway: a rolling start
        this.lastTakeoff[rwy] = sim.time;
      }
    }
    for (const a of sim.aircraft) {
      if (a.phase !== 'airborne') continue;
      if (isVfr(a)) continue;
      if (a.owner === 'ai' && a.kind === 'dep') {
        // AI departure controller: climb out of the TMA once clear of the arrival flows.
        if (Math.hypot(a.pos.x, a.pos.y) > 12) this.climb(a);
      }
      if (a.kind === 'dep' && a.handedOff && sim.time - (a.flags.handoffAt ?? sim.time) > 20) {
        this.climb(a); // the next sector climbs it to cruise, around the traffic
        a.spd = null;
      }
      if (ROLE === 'arrival' && a.kind === 'arr' && a.owner === 'player' && a.locCaptured) {
        const along = locGeometry(a).along;
        if (!a.handedOff && along < 4) {
          a.handedOff = true;
          sim.scoring.award('lateTransfer', { ac: a });
        }
        if (a.handedOff && !a.landingCleared && along < 5) a.landingCleared = true; // AI Tower
      }
    }
  }
}

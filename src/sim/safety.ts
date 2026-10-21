// Safety nets: radar separation and STCA, wake turbulence, the minimum safe altitude warning,
// prohibited areas and VFR airprox. Runs once per radar sweep and reports to scoring.
import { APT, inside, mvaAt } from '../data/airport';
import { angDiff, bearing, dist, fromBearing, toLatLon } from './geo';
import { locGeometry, runwayGeom } from './flight';
import { isVfr } from './ga';
import { wakeDepSeconds, wakeNm } from './wake';
import type { Sim } from './sim';
import type { Aircraft } from './types';

export class SafetyNet {
  private stcaPairs = new Set<string>();
  private losPairs = new Set<string>();
  private wakePairs = new Set<string>();
  private lowSet = new Set<string>();
  private prohibitedSet = new Set<string>();

  constructor(private sim: Sim) {}

  check(dt: number) {
    const sim = this.sim;
    const air = sim.aircraft.filter((a) => a.phase === 'airborne' && a.alt > 1000);
    const ownedPair = (a: Aircraft, b: Aircraft) => a.owner === 'player' || b.owner === 'player';
    for (const a of sim.aircraft) a.alerts = { stca: false, los: false, wake: false };
    for (let i = 0; i < air.length; i++) {
      for (let j = i + 1; j < air.length; j++) {
        const a = air[i];
        const b = air[j];
        if (!ownedPair(a, b)) continue;
        // VFR traffic and the helicopter: traffic information, not radar separation; only an
        // airprox counts.
        if (isVfr(a) || isVfr(b)) {
          const key = [a.id, b.id].sort().join('|');
          const close = dist(a.pos, b.pos) < 0.5 && Math.abs(a.alt - b.alt) < 400;
          if (close) {
            a.alerts.stca = b.alerts.stca = true;
            if (!this.losPairs.has(key)) {
              this.losPairs.add(key);
              sim.scoring.award('airprox', { a, b });
              sim.onAlert?.('stca');
            }
          } else if (dist(a.pos, b.pos) > 1) this.losPairs.delete(key);
          continue;
        }
        // Independent parallel approaches: established on different localizers.
        if (a.locCaptured && b.locCaptured && !sim.sameStrip(a.runway, b.runway)) continue;
        // Same final: 2.5 NM in-trail minimum (reduced separation on final).
        const minH = a.locCaptured && b.locCaptured ? 2.5 : 3;
        const v = Math.abs(a.alt - b.alt);
        const h = dist(a.pos, b.pos);
        const key = [a.id, b.id].sort().join('|');
        if (h < minH && v < 950) {
          a.alerts.los = b.alerts.los = true;
          if (!this.losPairs.has(key)) {
            this.losPairs.add(key);
            sim.scoring.award('los', { a, b, h, v });
            sim.onAlert?.('los');
          }
        } else {
          this.losPairs.delete(key);
          // Wake turbulence: in trail behind a heavier aircraft needs more than the radar minimum.
          const wk = this.wakePair(a, b, h);
          if (wk && h < wk.need) {
            wk.follow.alerts.wake = wk.lead.alerts.wake = true;
            if (!this.wakePairs.has(key)) {
              this.wakePairs.add(key);
              sim.scoring.award('wake', { lead: wk.lead, follow: wk.follow, h, need: wk.need });
            }
          } else if (h > (wk?.need ?? 3) + 0.5) this.wakePairs.delete(key);
          // STCA: linear prediction 90 s ahead.
          for (let t = 15; t <= 90; t += 15) {
            const pa = this.predict(a, t);
            const pb = this.predict(b, t);
            if (dist(pa.p, pb.p) < minH && Math.abs(pa.alt - pb.alt) < 950) {
              a.alerts.stca = b.alerts.stca = true;
              if (!this.stcaPairs.has(key)) {
                this.stcaPairs.add(key);
                sim.onAlert?.('stca');
              }
              break;
            }
          }
        }
      }
    }
    // Minimum safe altitude warning: an aircraft on vectors below the minimum vectoring altitude.
    for (const a of sim.aircraft) {
      if (a.phase !== 'airborne' || a.owner !== 'player' || a.handedOff || a.locCaptured) continue;
      if (a.lateral.mode !== 'heading' || a.alt < APT.elevation + 400 || isVfr(a)) continue;
      const mva = mvaAt(toLatLon(a.pos));
      if (a.alt < mva - 100) {
        a.alerts.low = true;
        if (!this.lowSet.has(a.id)) {
          this.lowSet.add(a.id);
          sim.scoring.award('low', { ac: a, mva });
          sim.onAlert?.('los');
        }
      } else if (a.alt > mva + 200) this.lowSet.delete(a.id);
    }
    // Prohibited areas (P-56 over the White House and the Mall): never.
    for (const a of sim.aircraft) {
      if (a.phase !== 'airborne' || a.owner !== 'player' || !APT.restricted) continue;
      const ll = toLatLon(a.pos);
      const area = APT.restricted.find((r) => r.cls === 'P' && a.alt < (parseInt(r.upper, 10) || 18000) && inside(ll, r.polygon));
      if (area) {
        a.alerts.prohibited = true;
        if (!this.prohibitedSet.has(a.id + area.name)) {
          this.prohibitedSet.add(a.id + area.name);
          sim.scoring.award('prohibited', { ac: a, area: area.name });
          sim.onAlert?.('los');
        }
      }
    }
    if (air.some((a) => a.alerts.stca)) sim.score.stcaSeconds += dt;
    // Forget pairs no longer in conflict so a new conflict alerts again.
    for (const k of this.stcaPairs) {
      const [x, y] = k.split('|');
      const ax = sim.aircraft.find((a) => a.id === x);
      const ay = sim.aircraft.find((a) => a.id === y);
      if (!ax?.alerts.stca || !ay?.alerts.stca) this.stcaPairs.delete(k);
    }
  }

  /** Seconds this departure must still wait behind the previous (heavier) departure, and who. */
  departureWakeWait(ac: Aircraft) {
    const sim = this.sim;
    const prev = Object.entries(sim.lastDeparture)
      .filter(([rw]) => sim.sameStrip(rw, ac.runway))
      .map(([, d]) => d)
      .sort((x, y) => y.time - x.time)[0];
    if (!prev) return null;
    const need = wakeDepSeconds(prev.wake, ac.type.wake);
    const left = need - (sim.time - prev.time);
    return left > 0 ? { left: Math.ceil(left), need, leader: prev } : null;
  }

  /**
   * In-trail pair for wake purposes: two arrivals for the same runway (ordered by distance to
   * go), or one aircraft following another's track at or below it within 1000 ft.
   */
  wakePair(a: Aircraft, b: Aircraft, h = dist(a.pos, b.pos)) {
    if (h > 9 || isVfr(a) || isVfr(b)) return null;
    let lead: Aircraft | null = null;
    let follow: Aircraft | null = null;
    const toGo = (x: Aircraft) => (x.locCaptured ? locGeometry(x).along : dist(x.pos, runwayGeom(x.runway).thr));
    if (a.kind === 'arr' && b.kind === 'arr' && a.approachCleared && b.approachCleared && this.sim.sameStrip(a.runway, b.runway)) {
      [lead, follow] = toGo(a) <= toGo(b) ? [a, b] : [b, a];
    } else {
      for (const [l, f] of [
        [a, b],
        [b, a],
      ]) {
        const behind = angDiff(bearing(l.pos, f.pos), l.track + 180) < 30 && angDiff(l.track, f.track) < 45;
        if (behind && f.alt <= l.alt + 100 && l.alt - f.alt < 1000) {
          lead = l;
          follow = f;
        }
      }
    }
    if (!lead || !follow) return null;
    const need = wakeNm(lead.type.wake, follow.type.wake);
    return need ? { lead, follow, need } : null;
  }

  private predict(a: Aircraft, t: number) {
    const p = fromBearing(a.pos, a.track, (a.gs * t) / 3600);
    const target = a.gsCaptured ? 0 : a.cfl;
    let alt = a.alt + (a.vs / 60) * t;
    alt = a.vs > 0 ? Math.min(alt, Math.max(target, a.alt)) : Math.max(alt, Math.min(target, a.alt));
    return { p, alt };
  }
}

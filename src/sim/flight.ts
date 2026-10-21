// Per-aircraft flight model and navigation. Pure functions over Aircraft state.
import { APT, type Leg } from '../data/airport';
import {
  angDiff,
  bearing,
  D2R,
  dist,
  fixPos,
  fromBearing,
  magToTrue,
  norm360,
  toNM,
  type Vec,
} from './geo';
import type { Aircraft, Wind } from './types';

/** Glidepath gradient for a runway: 3° unless published otherwise (KSAN 27: 3.5°). */
const glideFtPerNm = (rwy?: string) => Math.tan((APT.runways[rwy ?? '']?.gpAngle ?? 3) * D2R) * 6076;
const TCH = 50;

export const runwayGeom = (id: string) => {
  const r = APT.runways[id];
  return { thr: toNM(r.thr), end: toNM(r.end), crs: r.trueHdg, rwy: r };
};

/** TAS from IAS with a simple density-altitude correction (~2%/1000 ft). */
export const tas = (ias: number, alt: number) => ias * (1 + Math.max(0, alt) * 0.00002);

/** Rate of turn at 25° bank, deg/s, capped at standard rate. */
export const turnRate = (tasKt: number) => Math.min(3, (1091 * Math.tan(25 * D2R)) / Math.max(tasKt, 60));
/** Turn radius in NM. */
export const turnRadius = (tasKt: number) => tasKt / 3600 / (turnRate(tasKt) * D2R);

function windVec(w: Wind): Vec {
  // Wind blows *from* dir, so the air mass moves toward dir + 180.
  const to = (w.dir + 180) * D2R;
  return { x: Math.sin(to) * w.spd, y: Math.cos(to) * w.spd };
}

/** Heading that achieves `track` given TAS and wind. */
function headingForTrack(track: number, tasKt: number, w: Wind) {
  const wv = windVec(w);
  const tr = track * D2R;
  const cross = wv.x * Math.cos(tr) - wv.y * Math.sin(tr); // wind component to the right of track
  const wca = Math.asin(Math.max(-0.5, Math.min(0.5, cross / Math.max(tasKt, 60)))) / D2R;
  return norm360(track - wca);
}

/** Along-track distance to threshold (positive on the approach side) and signed cross-track (right of course positive). */
export function locGeometry(ac: Aircraft) {
  const { thr, crs } = runwayGeom(ac.runway);
  const dx = ac.pos.x - thr.x;
  const dy = ac.pos.y - thr.y;
  const c = crs * D2R;
  const along = -(dx * Math.sin(c) + dy * Math.cos(c)); // distance before threshold
  const cross = dx * Math.cos(c) - dy * Math.sin(c); // + = right of inbound course
  return { along, cross, crs };
}

export const glideAlt = (ac: Aircraft) => {
  const { along } = locGeometry(ac);
  return APT.runways[ac.runway].elevation + TCH + along * glideFtPerNm(ac.runway);
};

function legTarget(leg: Leg): Vec | null {
  return leg.t === 'FIX' ? fixPos(leg.fix) : null;
}

function advanceLeg(ac: Aircraft) {
  const leg = ac.route[ac.legIdx];
  ac.legFrom = leg?.t === 'FIX' ? fixPos(leg.fix) : { ...ac.pos };
  ac.legIdx++;
}

/** Desired TRUE track from route following, or null when the route is exhausted. */
function routeTrack(ac: Aircraft, tasKt: number): number | null {
  while (ac.legIdx < ac.route.length) {
    const leg = ac.route[ac.legIdx];
    if (leg.t === 'VM') {
      // "Fly heading, expect vectors": holds it until the controller turns it (or gives own
      // navigation). The AI controller simply lets its departures join the route.
      if (ac.owner === 'ai') {
        advanceLeg(ac);
        continue;
      }
      return magToTrue(leg.crs);
    }
    if (leg.t === 'CA') {
      // Reached (or levelled just short of) the altitude: the level-off settles a few feet low.
      if (ac.alt >= leg.alt - 60 || (ac.cfl <= leg.alt && ac.alt >= ac.cfl - 60)) {
        advanceLeg(ac);
        continue;
      }
      return magToTrue(leg.crs);
    }
    const tgt = legTarget(leg)!;
    const d = dist(ac.pos, tgt);
    const brgTo = bearing(ac.pos, tgt);
    // Fly-by anticipation: start the turn r*tan(Δ/2) before the fix.
    const next = ac.route[ac.legIdx + 1];
    let lead = 0.3;
    if (!leg.flyover && next?.t === 'FIX') {
      const nextBrg = bearing(tgt, fixPos(next.fix));
      const delta = Math.abs(angDiff(brgTo, nextBrg));
      lead = Math.min(4, turnRadius(tasKt) * Math.tan((Math.min(delta, 150) / 2) * D2R)) + 0.1;
    }
    const passed = Math.abs(angDiff(ac.track, brgTo)) > 100 && d < 2;
    if (d < lead || passed) {
      advanceLeg(ac);
      continue;
    }
    // Track-to-fix with cross-track correction when we have a defined leg start.
    if (ac.legFrom && dist(ac.legFrom, tgt) > 0.5) {
      const legCrs = bearing(ac.legFrom, tgt);
      const dx = ac.pos.x - ac.legFrom.x;
      const dy = ac.pos.y - ac.legFrom.y;
      const c = legCrs * D2R;
      const xtk = dx * Math.cos(c) - dy * Math.sin(c); // + right of course
      // Only use TF guidance when roughly established; otherwise go direct.
      if (Math.abs(xtk) < 3 && Math.abs(angDiff(legCrs, brgTo)) < 60) {
        return norm360(legCrs - Math.max(-35, Math.min(35, xtk * 25)));
      }
    }
    return brgTo;
  }
  return null;
}

function holdTrack(ac: Aircraft, dt: number, tasKt: number): number {
  const h = ac.lateral as Extract<Aircraft['lateral'], { mode: 'hold' }>;
  const fp = fixPos(h.fix);
  const inbound = magToTrue(h.inbound);
  const outbound = norm360(inbound + 180);
  const d = dist(ac.pos, fp);
  if (h.leg === 'entry') {
    if (d < 0.5) {
      h.leg = 'out';
      h.timer = 60;
    }
    return bearing(ac.pos, fp);
  }
  if (h.leg === 'out') {
    h.timer -= dt;
    if (h.timer <= 0) h.leg = 'in';
    // Turn (in hold direction) to outbound, offset by the turn diameter.
    return outbound;
  }
  // Inbound: steer to the fix, keeping the inbound course.
  if (d < 0.4 || (Math.abs(angDiff(ac.track, bearing(ac.pos, fp))) > 100 && d < 1.5)) {
    h.leg = 'out';
    h.timer = 60 + turnRadius(tasKt) * 0; // 1-minute legs
    return outbound;
  }
  const brgTo = bearing(ac.pos, fp);
  return Math.abs(angDiff(inbound, brgTo)) < 45 ? brgTo : inbound;
}

/** Try to capture the localizer from heading or route mode. */
function tryLocCapture(ac: Aircraft, tasKt: number) {
  const { along, cross, crs } = locGeometry(ac);
  // Crossed the centreline since the last step without a normal capture (steep or late
  // intercept): join anyway and turn back onto it, overshooting like a real aircraft would.
  const prev = ac.flags.prevCross as number | undefined;
  ac.flags.prevCross = cross;
  if (ac.lateral.mode === 'heading' && prev !== undefined && Math.sign(prev) !== Math.sign(cross) && along > 0.8 && along < 32) {
    const intercept = Math.abs(angDiff(ac.track, crs));
    if (intercept < 150) {
      ac.locCaptured = true;
      ac.lateral = { mode: 'loc' };
      return true;
    }
  }
  if (along < 1 || along > 30) return false;
  const intercept = Math.abs(angDiff(ac.track, crs));
  if (intercept > 120) return false;
  // Converging (or nearly on course)?
  const towards = cross > 0 ? angDiff(ac.track, crs) > -5 : angDiff(ac.track, crs) < 5;
  const r = turnRadius(tasKt);
  const leadDist = r * (1 - Math.cos(Math.min(intercept, 90) * D2R)) + 0.15;
  if (Math.abs(cross) <= Math.max(leadDist, 0.2) && (towards || Math.abs(cross) < 0.3)) {
    // Localizer coverage: within ±35° of the course, seen from the antenna.
    if (Math.abs(cross) / Math.max(along, 0.1) < Math.tan(35 * D2R)) {
      ac.locCaptured = true;
      ac.lateral = { mode: 'loc' };
      return true;
    }
  }
  return false;
}

export interface StepEvents {
  goAround?: boolean;
  landed?: boolean;
  airborne?: boolean;
  locCaptured?: boolean;
  gsCaptured?: boolean;
  routeEnded?: boolean;
  enteredHold?: string;
}

/** Advance one aircraft by dt seconds. */
export function stepAircraft(ac: Aircraft, dt: number, wind: Wind, runwayBusy: (except: Aircraft, runway: string) => boolean): StepEvents {
  const ev: StepEvents = {};
  ac.age += dt;

  // -------------------------------------------------------- ground phases
  if (ac.phase === 'stand' || ac.phase === 'taxi' || ac.phase === 'ready' || ac.phase === 'done') return ev;
  const rw = runwayGeom(ac.runway);
  if (ac.phase === 'lineup') {
    ac.hdg = ac.track = rw.crs;
    return ev;
  }
  if (ac.phase === 'takeoff') {
    // Entering the runway and spooling up before the roll starts.
    const wait = (ac.flags.rollDelay as number | undefined) ?? 0;
    if (wait > 0) {
      ac.flags.rollDelay = wait - dt;
      ac.hdg = ac.track = rw.crs;
      return ev;
    }
    // Take-off roll: ~30–35 s to rotation for a jet.
    ac.ias = Math.min(ac.type.v2 + 10, ac.ias + ac.type.accel * 1.35 * dt);
    ac.hdg = ac.track = rw.crs;
    ac.gs = ac.ias;
    ac.pos = fromBearing(ac.pos, rw.crs, (ac.gs * dt) / 3600);
    if (ac.ias >= ac.type.v2 - 8) {
      ac.vs = ac.type.climb * 0.7;
      ac.alt += (ac.vs / 60) * dt;
      if (ac.alt > rw.rwy.elevation + 35) {
        ac.phase = 'airborne';
        ev.airborne = true;
      }
    }
    return ev;
  }
  if (ac.phase === 'rollout') {
    // Expedite vacating: firmer braking and a high-speed exit instead of the end of the runway.
    const fast = !!ac.flags.expedite;
    ac.ias = Math.max(0, ac.ias - (fast ? 6 : 4) * dt);
    ac.gs = ac.ias;
    ac.pos = fromBearing(ac.pos, rw.crs, (ac.gs * dt) / 3600);
    ac.vs = 0;
    if (ac.ias < (fast ? 45 : 25)) {
      ac.flags.expedite = false;
      ac.phase = 'done';
      ev.landed = true;
    }
    return ev;
  }

  // -------------------------------------------------------- airborne
  const tasKt = tas(ac.ias, ac.alt);

  // Localizer capture check
  // On a curved RNP final the centreline is only joined at the IF itself.
  const rc = APT.runways[ac.runway];
  const curvedHold = !!rc?.curvedFinal && ac.lateral.mode === 'route' && ac.route.slice(ac.legIdx + 1).some((l) => l.t === 'FIX' && l.fix === rc.ifix);
  if (ac.approachCleared && !ac.locCaptured && ac.lateral.mode !== 'hold' && !curvedHold) {
    if (tryLocCapture(ac, tasKt)) ev.locCaptured = true;
    else {
      // Flying the procedure to the IF (which lies on the final): the FMS turns onto final there.
      const r = APT.runways[ac.runway];
      const leg = ac.route[ac.legIdx];
      const joinFix = leg?.t === 'FIX' && (leg.fix === r?.ifix || leg.fix === r?.fap?.fix) ? leg.fix : null;
      if (joinFix && ac.lateral.mode === 'route' && dist(ac.pos, fixPos(joinFix)) < 1.2 + turnRadius(tasKt) * 0.5) {
        ac.locCaptured = true;
        ac.lateral = { mode: 'loc' };
        ev.locCaptured = true;
      }
    }
  }

  // Lateral: desired heading
  let desiredHdg = ac.hdg;
  let turnDir: 'L' | 'R' | undefined;
  const lat = ac.lateral;
  if (lat.mode === 'heading') {
    desiredHdg = magToTrue(lat.hdg);
    turnDir = lat.turn;
  } else if (lat.mode === 'route') {
    const trk = routeTrack(ac, tasKt);
    if (trk === null) {
      ev.routeEnded = true;
      // Route exhausted: arrivals hold at the IAF, others continue.
      const last = ac.route[ac.route.length - 1];
      if (ac.kind === 'arr' && last?.t === 'FIX' && APT.holdings[last.fix] && !ac.approachCleared) {
        const h = APT.holdings[last.fix];
        ac.lateral = { mode: 'hold', fix: last.fix, inbound: h.inbound, turn: h.turn, leg: 'entry', timer: 0 };
        ev.enteredHold = last.fix;
      } else {
        ac.lateral = { mode: 'heading', hdg: norm360(ac.track - 2) };
      }
    } else {
      desiredHdg = headingForTrack(trk, tasKt, wind);
    }
  } else if (lat.mode === 'hold') {
    const trk = holdTrack(ac, dt, tasKt);
    desiredHdg = headingForTrack(trk, tasKt, wind);
    turnDir = lat.turn;
    if (Math.abs(angDiff(ac.hdg, desiredHdg)) < 30) turnDir = undefined;
  } else if (lat.mode === 'loc') {
    const { cross, crs, along } = locGeometry(ac);
    const corr = Math.max(-30, Math.min(30, cross * 60));
    desiredHdg = headingForTrack(norm360(crs - corr), tasKt, wind);
    if (along < -0.5) {
      ac.lateral = { mode: 'heading', hdg: norm360(crs - 2) };
    }
  }

  const diff = angDiff(ac.hdg, desiredHdg);
  const maxTurn = turnRate(tasKt) * dt;
  if (Math.abs(diff) <= maxTurn) {
    ac.hdg = desiredHdg;
  } else {
    let dir = Math.sign(diff);
    if (turnDir === 'L') dir = -1;
    if (turnDir === 'R') dir = 1;
    ac.hdg = norm360(ac.hdg + dir * maxTurn);
  }

  // Vertical
  let tgtAlt = ac.cfl;
  // Cleared for the approach but not yet on the glideslope: continuous descent on a ~3° profile
  // to the final approach fix instead of diving straight to the approach altitude.
  if (ac.kind === 'arr' && ac.approachCleared && !ac.gsCaptured) {
    const r = APT.runways[ac.runway];
    const fapAlt = r.fap?.alt ?? 2000;
    const thr = runwayGeom(ac.runway).thr;
    const via = r.ifix && APT.fixes[r.ifix] ? fixPos(r.ifix) : null;
    const remaining = ac.locCaptured ? locGeometry(ac).along : via ? dist(ac.pos, via) + dist(via, thr) : dist(ac.pos, thr);
    // Descend on a ~3° path to the FAP altitude and meet steeper glidepaths (London City 5.5°)
    // from below, as crews do: nobody captures a 5.5° glideslope from above.
    const slope = Math.min(glideFtPerNm(ac.runway), Math.tan(3.2 * D2R) * 6076);
    const intercept = fapAlt / glideFtPerNm(ac.runway);
    const profile = fapAlt + Math.max(0, remaining - intercept - 1.5) * slope;
    const ceiling = (ac.flags.clearedFrom as number | undefined) ?? ac.alt;
    tgtAlt = Math.max(ac.cfl, Math.min(profile, ceiling));
  }
  if (ac.locCaptured) {
    const ga = glideAlt(ac);
    if (!ac.gsCaptured && ac.alt >= ga - 60 && locGeometry(ac).along < 12) {
      ac.gsCaptured = true;
      ev.gsCaptured = true;
    }
    if (ac.gsCaptured) tgtAlt = ga;
  }
  // Leg altitude constraints act as "at or above" floors while on route.
  // Expedite: best rate until within 1000 ft of the cleared level.
  const dAlt = tgtAlt - ac.alt;
  if (ac.flags.expedite && Math.abs(dAlt) < 100) ac.flags.expedite = false;
  const boost = ac.flags.expedite && Math.abs(dAlt) > 1000 ? 1 : 0;
  const climbRate = ac.type.climb * Math.max(0.45, 1 - ac.alt / 40000) * (1 + 0.5 * boost);
  const descRate = ac.gsCaptured ? 1400 : ac.type.descent * (1 + 0.8 * boost);
  let wantVs = 0;
  if (ac.gsCaptured) {
    wantVs = Math.max(-1600, Math.min(200, dAlt * 6 - (ac.gs * glideFtPerNm(ac.runway)) / 60));
  } else if (Math.abs(dAlt) > 5) {
    wantVs = dAlt > 0 ? Math.min(climbRate, dAlt * (4 + 2 * boost)) : Math.max(-descRate, dAlt * (4 + 2 * boost));
  }
  ac.vs += (wantVs - ac.vs) * Math.min(1, dt * 0.8);
  ac.alt += (ac.vs / 60) * dt;

  // Speed
  let tgtSpd: number;
  const { along } = locGeometry(ac);
  if (ac.spd !== null) {
    tgtSpd = ac.spd;
  } else if (ac.kind === 'dep') {
    tgtSpd = ac.alt < 1500 ? ac.type.v2 + 15 : ac.alt < 10000 ? ac.type.vClimb : 290;
  } else if (ac.locCaptured) {
    tgtSpd = along < 4 ? ac.type.vApp : along < 6 ? Math.min(160, ac.type.vApp + 25) : Math.min(180, ac.type.vClimb);
  } else if (ac.approachCleared) {
    tgtSpd = Math.min(210, ac.type.vClimb);
  } else {
    tgtSpd = ac.alt < 10000 ? Math.min(250, ac.type.vClimb) : 280;
  }
  // Published speed limits on the active leg (maximum).
  const leg = ac.lateral.mode === 'route' ? ac.route[ac.legIdx] : undefined;
  if (leg?.t === 'FIX' && leg.spd) tgtSpd = Math.min(tgtSpd, leg.spd);
  if (ac.locCaptured && along < 4 && ac.spd !== null) tgtSpd = Math.min(tgtSpd, ac.type.vApp + 10);
  tgtSpd = Math.max(tgtSpd, ac.type.vApp - 5);
  const accel = ac.ias < tgtSpd ? 1.6 : 1.2;
  ac.ias += Math.max(-accel * dt, Math.min(accel * dt, tgtSpd - ac.ias));

  // Integrate position with wind
  const t2 = tas(ac.ias, ac.alt);
  const wv = windVec(wind);
  const vx = Math.sin(ac.hdg * D2R) * t2 + wv.x;
  const vy = Math.cos(ac.hdg * D2R) * t2 + wv.y;
  ac.gs = Math.hypot(vx, vy);
  ac.track = norm360(Math.atan2(vx, vy) / D2R);
  ac.pos = { x: ac.pos.x + (vx * dt) / 3600, y: ac.pos.y + (vy * dt) / 3600 };

  // Landing / go-around decision at the threshold area
  if (ac.kind === 'arr' && ac.gsCaptured) {
    const agl = ac.alt - rw.rwy.elevation;
    const { cross } = locGeometry(ac);
    // Stabilised-approach criteria: on the centreline and near the glidepath by short final.
    const unstable = along < 0.6 && ac.alt - glideAlt(ac) > 200;
    if (unstable || ((!ac.landingCleared || Math.abs(cross) > 0.25) && agl < 200)) {
      ac.flags.unstable = unstable;
      ev.goAround = true;
    } else if (ac.landingCleared && (along < 0.05 || agl < 15)) {
      if (runwayBusy(ac, ac.runway)) {
        ev.goAround = true;
      } else {
        ac.phase = 'rollout';
        ac.alt = rw.rwy.elevation;
        ac.hdg = ac.track = rw.crs;
        ac.ias = ac.type.vApp - 10;
        ev.landed = false;
      }
    }
  }
  return ev;
}

export function startGoAround(ac: Aircraft) {
  const rw = APT.runways[ac.runway];
  ac.approachCleared = false;
  ac.locCaptured = false;
  ac.gsCaptured = false;
  ac.landingCleared = false;
  delete ac.flags.untilEst;
  ac.cfl = Math.max(2000, ...rw.missed.map((l) => (l.t === 'FIX' ? l.alt?.at ?? 0 : l.t === 'CA' ? l.alt : 0)));
  ac.spd = null;
  ac.route = [{ t: 'CA', crs: rw.magHdg, alt: 1000 }, ...rw.missed];
  ac.legIdx = 0;
  ac.legFrom = null;
  ac.lateral = { mode: 'route' };
}

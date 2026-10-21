// Direct-to suggestions for the command card.
import { APT } from '../data/airport';
import { dist, fixPos, toNM } from './geo';
import type { Sim } from './sim';
import type { Aircraft } from './types';

/**
 * Direct-to chips for this aircraft: fixes still ahead of it. Arrivals get their remaining STAR
 * fixes and the nearest published transition to their runway, in order (only points closer to
 * the threshold than the aircraft), always ending with the intermediate fix. Departures get the rest of their SID
 * and the sector exit fixes nearest its end.
 */
export function suggestFixes(ac: Aircraft, sim: Sim) {
  const known = (f: string) => f in APT.fixes && !/^(THR|FAP|MA)\d/.test(f);
  const routeAhead = ac.route.slice(ac.legIdx).flatMap((l) => (l.t === 'FIX' ? [l.fix] : [])).filter(known);
  if (ac.kind === 'arr') {
    const rw = APT.runways[ac.runway] ?? APT.runways[sim.config.arr[0]];
    if (!rw) return [];
    const thr = toNM(rw.thr);
    const here = dist(ac.pos, thr);
    const isAhead = (f: string) => f !== rw.ifix && dist(fixPos(f), thr) < here - 1;
    // The published transition the aircraft is nearest to (not a mix of all of them), followed
    // in order from the first point still ahead.
    const paths = Object.values(rw.transitions ?? {}).map((legs) => legs.flatMap((l) => (l.t === 'FIX' ? [l.fix] : [])).filter(known).filter(isAhead));
    const near = (p: string[]) => (p.length ? Math.min(...p.map((f) => dist(fixPos(f), ac.pos))) : Infinity);
    const path = paths.sort((a, b) => near(a) - near(b))[0] ?? [];
    let ahead = [...new Set([...routeAhead.filter(isAhead), ...path])];
    // Coded RNAV points (LCE21, RD203) only when there are few named ones to offer.
    const named = ahead.filter((f) => !/^[A-Z]{2,3}\d{2,3}$/.test(f));
    if (named.length >= 3) ahead = named;
    const out = ahead.slice(0, 5);
    if (rw.ifix && known(rw.ifix)) out.push(rw.ifix);
    return out;
  }
  const sid = [...new Set(routeAhead)];
  const end = sid.length ? fixPos(sid[sid.length - 1]) : ac.pos;
  const fallback = APT.icao === 'EHAM' ? ['SPY', 'ANDIK', 'ARNEM', 'LOPIK', 'VALKO', 'KUDAD'] : APT.icao === 'EHRD' ? ['SOMEL', 'INKET', 'PAM', 'IVLUT', 'COA', 'WOODY'] : [];
  const exits = (APT.exitFixes ?? fallback).filter((f) => known(f) && !sid.includes(f)).sort((a, b) => dist(fixPos(a), end) - dist(fixPos(b), end));
  let out = [...sid.slice(-4), ...exits];
  const named = out.filter((f) => !/^[A-Z]{2,3}\d{2,3}$/.test(f));
  if (named.length >= 3) out = named;
  return out.slice(0, 6);
}

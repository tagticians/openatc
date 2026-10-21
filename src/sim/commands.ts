// Controller command language. Examples (callsign optional when one is selected):
//   TRA5123 L240 D30        turn left heading 240, descend 3000 ft
//   H180 S210               heading 180, speed 210
//   DCT KAKKO  |  DKAKKO    direct KAKKO
//   ILS  |  ILS24           cleared for the approach (runway in use, or named)
//   CL · LU · CTO · HO      land · line up · take-off · hand off
//
// Each instruction is one entry in COMMANDS: what it matches, when it applies, and what it does
// to the aircraft, ATC's words and the readback. Help, autocomplete and plug-ins (VFR, the
// helicopter) use the same list; plug-ins add their own with registerCommands().
import { APT, ROLE, mvaAt, type Leg } from '../data/airport';
import { bearing, fixPos, fromBearing, magToTrue, toLatLon, trueToMag, norm360 } from './geo';
import { runwayGeom } from './flight';
import { LINEUP_S } from './ground';
import { fmtLevel, msg, sayCallsign, sayDigits, sayFix, sayHeading, sayLevel, sayRunway, saySpeed } from './phraseology';
import type { Sim } from './sim';
import { displayCallsign, readback, sayAgain, type Instr } from './pilotTalk';
import { rules, sayLevelRules, type RadioRules } from './rules';
import { DESTINATIONS } from '../data/traffic';
import type { Aircraft } from './types';

type Part = [string, string];

export interface CommandResult {
  ok: boolean;
  error?: string;
  target?: Aircraft;
}

/** What a command works with while one transmission is being built. */
export interface Ctx {
  sim: Sim;
  ac: Aircraft;
  /** ATC's words, the readback parts (display, speech) and structured instructions. */
  atc: string[];
  rb: Part[];
  ins: Instr[];
  /** EXP was in the transmission. */
  exp: boolean;
  R: RadioRules;
  /** The next token (e.g. the fix after DCT), consumed. */
  next(): string | undefined;
  peek(): string | undefined;
}

export interface CommandDef {
  id: string;
  /** Token pattern; capture groups are passed to run(). */
  match: RegExp;
  /** Applies to this aircraft (first matching definition wins). */
  when?: (ac: Aircraft) => boolean;
  /** Help: syntax and what it does; `only` limits it to airports where it makes sense. */
  help?: [string, string];
  only?: () => boolean;
  /** Performs it; a string is an error ("not airborne"). 'stop' ends the transmission silently. */
  run(c: Ctx, m: RegExpMatchArray): string | void | 'stop';
}

const pad3 = (n: number) => String(Math.round(n)).padStart(3, '0');
const airborne = (ac: Aircraft) => ac.phase === 'airborne';

export const COMMANDS: CommandDef[] = [
  {
    id: 'heading',
    match: /^([HLR])(\d{1,3})$/,
    help: ['L240 / R240 / H240', 'Turn left / right / fly heading 240'],
    run: ({ ac, atc, rb, ins }, m) => {
      const hdg = norm360(+m[2]) || 360;
      if (!airborne(ac)) return 'not airborne';
      const turn = m[1] === 'L' ? 'L' : m[1] === 'R' ? 'R' : undefined;
      ac.lateral = { mode: 'heading', hdg, turn };
      ac.locCaptured = false;
      ac.gsCaptured = false;
      // Phraseology states the turn direction unless the change is trivial.
      const delta = ((hdg - trueToMag(ac.hdg) + 540) % 360) - 180;
      const dir = turn ?? (Math.abs(delta) < 5 ? undefined : delta < 0 ? 'L' : 'R');
      const word = dir ? `turn ${dir === 'L' ? 'left' : 'right'} heading` : 'fly heading';
      atc.push(`${word} ${pad3(hdg)}`);
      rb.push([`${word} ${pad3(hdg)}`, `${word} ${sayHeading(hdg)}`]);
      ins.push({ k: 'heading', hdg, turn: dir });
    },
  },
  {
    id: 'present-heading',
    match: /^(FH|PH)$/,
    run: ({ ac, atc, rb, ins }) => {
      const hdg = Math.round(trueToMag(ac.hdg));
      ac.lateral = { mode: 'heading', hdg };
      atc.push('fly present heading');
      rb.push([`present heading ${pad3(hdg)}`, `present heading ${sayHeading(hdg)}`]);
      ins.push({ k: 'heading', hdg });
    },
  },
  {
    id: 'level',
    match: /^([CDA])(\d{2,3})$/,
    help: ['D30 · C60 · A40', 'Descend 3000 · climb 6000 · altitude 4000 (hundreds of feet)'],
    run: ({ sim, ac, atc, rb, ins, exp, R }, m) => {
      const ft = +m[2] * 100;
      // Not below the minimum vectoring altitude, here or 2 minutes ahead on the present track.
      if (!ac.approachCleared && ac.phase === 'airborne') {
        const ahead = fromBearing(ac.pos, ac.track, (ac.gs / 60) * 2);
        const mva = Math.max(mvaAt(toLatLon(ac.pos)), mvaAt(toLatLon(ahead)));
        if (ft < mva) return `below the minimum vectoring altitude (${mva} ft here)`;
      }
      if (ft > 24000) return 'level outside sector';
      const verb = ft > ac.alt + 50 ? 'climb' : ft < ac.alt - 50 ? 'descend' : 'maintain';
      ac.cfl = ft;
      // First clearance below the transition level comes with the pressure setting (rules).
      const qnh = !ac.flags.qnh && R.givesPressure(ac, verb, ft) ? R.pressure(sim.weather) : null;
      if (qnh) ac.flags.qnh = true;
      const P = R.pressureWord;
      const v = R.verb(verb);
      const fast = exp && verb !== 'maintain';
      ac.flags.expedite = fast;
      const alt = R.altitudeWord(ft);
      const p = qnh ? `, ${P} ${qnh}` : '';
      atc.push(fast ? R.expedite(verb, `${alt}${fmtLevel(ft)}`, p) : `${v} ${alt}${fmtLevel(ft)}${p}`);
      rb.push([`${v} ${alt}${fmtLevel(ft)}${p}`, `${v} ${sayLevelRules(ft)}${qnh ? `, ${P} ${sayDigits(qnh)}` : ''}`]);
      ins.push({ k: 'level', ft, verb, qnh: qnh ?? undefined, exp: fast || undefined });
    },
  },
  {
    id: 'speed',
    match: /^(?:S(\d{1,3})|SR)$/,
    help: ['S180 · SR', 'Speed 180 kt · resume normal speed'],
    run: ({ ac, atc, rb, ins }, m) => {
      if (!m[1] || +m[1] === 0) {
        ac.spd = null;
        atc.push('resume normal speed');
        rb.push(['resume normal speed', 'resume normal speed']);
        ins.push({ k: 'speed', kt: null });
        return;
      }
      const s = +m[1];
      if (s < ac.type.vApp - 5 || s > 300) return `unable speed ${s}`;
      ac.spd = s;
      atc.push(`speed ${s} kt`);
      rb.push([`speed ${s}`, `speed ${saySpeed(s)}`]);
      ins.push({ k: 'speed', kt: s });
    },
  },
  {
    id: 'direct',
    match: /^(?:DCT|D([A-Z]{2,5}|[A-Z]{2}\d{3}))$/,
    help: ['DCT KAKKO  or  DKAKKO', 'Proceed direct to a fix (Tab completes)'],
    run: (c, m) => {
      const { sim, ac, atc, rb, ins } = c;
      const fix = m[1] ?? c.next();
      if (!fix || !sim.fixExists(fix)) return `unknown fix ${fix ?? ''}`.trim();
      if (!airborne(ac)) return 'not airborne';
      directTo(ac, fix);
      atc.push(`proceed direct ${fix}`);
      rb.push([`direct ${fix}`, `direct ${sayFix(fix)}`]);
      ins.push({ k: 'direct', fix });
    },
  },
  {
    id: 'approach',
    match: /^(?:ILS|APP|CA)(\d{2}[LCR]?)?$/,
    help: ['ILS  ·  ILS24', 'Cleared for the approach (runway in use, or named)'],
    run: ({ sim, ac, atc, rb, ins, R }, m) => {
      if (ac.kind !== 'arr' || !airborne(ac)) return 'not an arrival';
      const rwy = m[1] ?? ac.runway;
      const r = APT.runways[rwy];
      if (!r?.ils && !r?.ifix) return `no approach to runway ${rwy}`;
      if (!sim.config.arr.includes(rwy)) sim.say('system', `${ac.callsign}: runway ${rwy} is not a landing runway in use`, undefined, ac.callsign, 'warn');
      ac.runway = rwy;
      const assigned = ac.cfl;
      if (!ac.approachCleared) ac.flags.clearedFrom = Math.max(ac.cfl, Math.round(ac.alt));
      delete ac.flags.prevCross;
      ac.approachCleared = true;
      // FAA: "maintain <alt> until established" on vectors: descend only once on the localizer.
      // An altitude given in the same transmission ("descend 3000, cleared ILS") is kept until
      // established, then the aircraft follows the procedure down; so is the FAA "maintain until".
      const altGiven = ins.some((i) => i.k === 'level');
      if (!ac.locCaptured && (altGiven || (R.maintainUntilEstablished && ac.lateral.mode === 'heading'))) ac.flags.untilEst = r.fap?.alt ?? 2000;
      else ac.cfl = Math.min(ac.cfl, r.fap?.alt ?? 2000);
      // Already routing direct to a point on the approach (the IF, or a fix of a published
      // transition): keep flying there and continue the procedure from it, never back out to
      // the IAF.
      const next = ac.lateral.mode === 'route' ? ac.route[ac.legIdx] : undefined;
      const nextFix = next?.t === 'FIX' ? next.fix : null;
      const joinAt = nextFix ? joinPoint(rwy, nextFix) : null;
      if (joinAt) {
        ac.route = joinAt.legs;
        ac.legIdx = joinAt.idx;
        ac.legFrom = null;
      } else if (ac.lateral.mode === 'route' || ac.lateral.mode === 'hold') {
        // On own navigation: join the published transition from its IAF, or go direct to the IF.
        const iaf = transitionFor(ac, rwy);
        if (iaf) {
          ac.route = r.transitions[iaf];
          const idx = ac.lateral.mode === 'hold' ? 1 : 0;
          ac.legIdx = idx;
          ac.legFrom = idx > 0 ? fixPos(iaf) : null;
          ac.lateral = { mode: 'route' };
        } else if (r.ifix) {
          ac.route = [{ t: 'FIX', fix: r.ifix }];
          ac.legIdx = 0;
          ac.legFrom = null;
          ac.lateral = { mode: 'route' };
        }
      }
      const appName = r.locOnly ? 'localizer' : r.ils ? 'ILS' : 'RNAV';
      atc.push(R.approachClearance(appName, rwy, Math.max(r.fap?.alt ?? 2000, assigned)));
      rb.push([`cleared ${appName} ${rwy}`, `cleared ${appName} approach runway ${sayRunway(rwy)}`]);
      ins.push({ k: 'ils', rwy, name: appName });
    },
  },
  {
    id: 'land',
    match: /^(CL|CTL|LAND)$/,
    help: ['CL', 'Cleared to land'],
    run: ({ sim, ac, atc, rb, ins }) => {
      if (ac.kind !== 'arr') return 'not an arrival';
      if (ROLE === 'arrival') return 'Tower issues the landing clearance: transfer with HO once established';
      ac.landingCleared = true;
      const w = sim.weather.wind;
      atc.push(`wind ${pad3(trueToMag(w.dir))} degrees ${w.spd} kt, runway ${ac.runway} cleared to land`);
      rb.push([`runway ${ac.runway} cleared to land`, `runway ${sayRunway(ac.runway)} cleared to land`]);
      ins.push({ k: 'land', rwy: ac.runway });
    },
  },
  {
    id: 'clearance',
    match: /^(CLR|CLD|CLEAR)$/,
    help: ['CLR', 'IFR clearance for a departure at the stand or gate'],
    run: ({ sim, ac, atc, rb, ins, R }) => {
      if (ac.phase !== 'stand') return 'already cleared';
      sim.clearDeparture(ac);
      const c = R.ifrClearance(ac.dest, ac.sid?.name ?? '', ac.squawk);
      atc.push(c.atc);
      ins.push({ k: 'clearance', dest: DESTINATIONS[ac.dest]?.city ?? ac.dest, sid: ac.sid?.name ?? '', squawk: ac.squawk });
      rb.push(c.rb);
    },
  },
  {
    id: 'lineup',
    match: /^(LU|LUW)$/,
    run: ({ sim, ac, atc, rb, ins }) => {
      if (ac.phase !== 'ready') return 'not at the holding point';
      const rw = runwayGeom(ac.runway);
      startLineUp(sim, ac);
      ac.phase = 'lineup';
      ac.pos = { ...rw.thr };
      ac.hdg = ac.track = rw.crs;
      ac.onFrequency = true;
      atc.push(`line up and wait runway ${ac.runway}`);
      rb.push([`line up and wait ${ac.runway}`, `line up and wait runway ${sayRunway(ac.runway)}`]);
      ins.push({ k: 'lineup', rwy: ac.runway });
    },
  },
  {
    id: 'takeoff',
    match: /^(CTO|TO)$/,
    help: ['LU · CTO · CTO EXP', 'Line up and wait · cleared for take-off · immediate take-off'],
    run: ({ sim, ac, atc, rb, ins, exp }) => {
      if (ac.phase !== 'ready' && ac.phase !== 'lineup') return 'not ready for departure';
      if (sim.events.isClosed(ac.runway)) return `runway ${ac.runway} is closed`;
      const rw = runwayGeom(ac.runway);
      const shortFinal = sim.aircraft.find((a) => a.kind === 'arr' && a.locCaptured && sim.distToThreshold(a) < 2.5 && sim.distToThreshold(a) > 0);
      if (sim.runwayBusy(ac, ac.runway) || shortFinal) sim.scoring.award('incursion', { ac, other: shortFinal });
      const wk = sim.departureWakeWait(ac);
      if (wk) sim.scoring.award('wakeDeparture', { ac, wake: wk });
      // Taxiing on and spooling up takes time; an immediate take-off rolls as it lines up.
      // Still moving onto the runway after a line-up: the roll waits until it is in position.
      const lining = ac.phase === 'lineup' && ac.flags.lineupAt !== undefined ? Math.max(0, (ac.flags.lineupDur ?? LINEUP_S) - (sim.time - ac.flags.lineupAt)) : 0;
      // An immediate take-off from the holding point is a rolling line-up: quicker onto the runway.
      if (ac.phase === 'ready') startLineUp(sim, ac, exp ? 7 : LINEUP_S);
      ac.flags.rollDelay = ac.phase === 'lineup' ? lining + (exp ? 1 : 4) : exp ? 7 : 12;
      ac.pos = { ...rw.thr };
      ac.hdg = ac.track = rw.crs;
      ac.phase = 'takeoff';
      ac.ias = 0;
      ac.onFrequency = true;
      const w = sim.weather.wind;
      const kind = exp ? 'cleared for immediate take-off' : 'cleared for take-off';
      atc.push(`wind ${pad3(trueToMag(w.dir))} degrees ${w.spd} kt, runway ${ac.runway} ${kind}`);
      rb.push([`${kind} ${ac.runway}`, `${kind} runway ${sayRunway(ac.runway)}`]);
      ins.push({ k: 'takeoff', rwy: ac.runway, immediate: exp || undefined });
    },
  },
  {
    id: 'handoff',
    match: /^(HO|CONTACT)$/,
    help: ['HO', 'Hand off (departures to the next sector; at Schiphol arrivals to Tower)'],
    run: ({ sim, ac, atc, rb, ins, R }) => {
      if (ac.kind === 'dep') {
        ac.handedOff = true;
        ac.flags.handoffAt = sim.time;
        ac.flags.handoffAlt = Math.round(ac.alt);
        const { departureHandoff: unit, handoffFreq: f } = APT.callsigns;
        const [a, b] = f.split('.');
        atc.push(`contact ${unit} ${f}, good day`);
        rb.push([`${unit} ${f}, good day`, `${unit} ${sayDigits(a)} ${R.decimal} ${sayDigits(b)}, good day`]);
        ins.push({ k: 'contact', unit, freq: f });
      } else if (ROLE === 'arrival') {
        if (!ac.locCaptured) return 'transfer to Tower once established on the localizer';
        ac.handedOff = true;
        const f = APT.frequencies.tower;
        const [a, b] = f.split('.');
        atc.push(`contact Tower ${f}`);
        rb.push([`Tower ${f}`, `Tower ${sayDigits(a)} ${R.decimal} ${sayDigits(b)}`]);
        ins.push({ k: 'contact', unit: 'Tower', freq: f });
      } else return 'arrivals stay with you until landing';
    },
  },
  {
    id: 'hold',
    match: /^(HOLD|HLD)$/,
    help: ['HOLD [fix]', 'Hold as published (at the fix, or the end of the route)'],
    run: (c) => {
      const { sim, ac, atc, rb, ins } = c;
      const nxt = c.peek();
      const fix = nxt && sim.fixExists(nxt) ? c.next()! : lastFix(ac);
      if (!fix) return 'hold where?';
      const h = APT.holdings[fix] ?? { inbound: Math.round(trueToMag(bearing(ac.pos, fixPos(fix)))), turn: 'R' as const };
      ac.lateral = { mode: 'hold', fix, inbound: h.inbound, turn: h.turn, leg: 'entry', timer: 0 };
      atc.push(`hold at ${fix} as published`);
      rb.push([`hold at ${fix}`, `hold at ${sayFix(fix)}`]);
      ins.push({ k: 'hold', fix });
    },
  },
  {
    id: 'own-nav',
    match: /^(RES|OWN)$/,
    help: ['RES', 'Resume own navigation'],
    run: ({ ac, atc, rb, ins }) => {
      if (!ac.route.length) return 'no route to resume';
      // Past a "heading until vectors" leg: own navigation means join the route itself.
      while (ac.route[ac.legIdx]?.t === 'VM') ac.legIdx++;
      ac.lateral = { mode: 'route' };
      ac.legFrom = null;
      atc.push('resume own navigation');
      rb.push(['resume own navigation', 'resume own navigation']);
      ins.push({ k: 'own' });
    },
  },
  {
    id: 'go-around',
    match: /^GA$/,
    help: ['GA', 'Go around'],
    run: ({ sim, ac }) => {
      sim.goAround(ac);
      return 'stop';
    },
  },
];

/** Plug-ins (VFR, helicopters) add instructions; theirs are tried before the core ones. */
export function registerCommands(...defs: CommandDef[]) {
  for (const d of defs) if (!COMMANDS.some((c) => c.id === d.id)) COMMANDS.unshift(d);
}

/** Instructions for the help screen at the current airport. */
export const commandHelp = () => COMMANDS.filter((c) => c.help && (!c.only || c.only())).map((c) => c.help!);

const isCommand = (t: string) => t === 'EXP' || t === 'X' || COMMANDS.some((c) => c.match.test(t));

export function execute(sim: Sim, input: string): CommandResult {
  let tokens = input.trim().toUpperCase().split(/[\s,]+/).filter(Boolean);
  if (!tokens.length) return { ok: false };

  let ac: Aircraft | null = null;
  // Callsign token: matches an aircraft and is not itself a command.
  const first = tokens[0];
  if (!isCommand(first)) {
    ac = sim.find(first);
    if (ac) tokens.shift();
    else if (!sim.selected || tokens.length > 1) return { ok: false, error: `Unknown callsign "${first}"` };
  }
  if (!ac) ac = sim.selected;
  if (!ac) return { ok: false, error: 'Select an aircraft first (click it, or type its callsign)' };
  sim.selectedId = ac.id;
  if (!tokens.length) return { ok: true, target: ac };
  if (ac.owner === 'ai') return { ok: false, error: `${ac.callsign} is with ${ac.kind === 'dep' ? APT.aiDeparture ?? 'Schiphol Departure' : 'another controller'}`, target: ac };
  // Once transferred, the aircraft is on another frequency: it can't hear you any more.
  if (ac.handedOff && (ac.kind === 'dep' || ROLE === 'arrival')) {
    return { ok: false, error: `${ac.callsign} is with ${ac.kind === 'dep' ? APT.callsigns.departureHandoff : 'Tower'} now`, target: ac };
  }
  if (ac.flags.nordo) return { ok: false, error: `${ac.callsign}: no reply, radio failure (squawking 7600)`, target: ac };

  const atc: string[] = [];
  const rb: Part[] = [];
  const ins: Instr[] = [];
  const prevAlt = Math.round(ac.alt);
  const target = ac;

  // EXP makes the rest of the transmission urgent: expedite the climb/descent, immediate
  // take-off. On its own it expedites what the aircraft is already doing.
  const exp = tokens.includes('EXP') || tokens.includes('X');
  tokens = tokens.filter((t) => t !== 'EXP' && t !== 'X');
  if (exp && !tokens.length) {
    if (ac.phase === 'rollout') {
      ac.flags.expedite = true;
      atc.push('expedite vacating the runway');
      rb.push(['expediting', 'expediting']);
      ins.push({ k: 'expedite', what: 'vacate' });
    } else if (airborne(ac) && Math.abs(ac.cfl - ac.alt) > 300) {
      ac.flags.expedite = true;
      const what = ac.cfl > ac.alt ? 'climb' : 'descent';
      atc.push(`expedite ${what} ${fmtLevel(ac.cfl)}`);
      rb.push([`expediting ${what === 'climb' ? 'climb' : 'descent'} ${fmtLevel(ac.cfl)}`, `expediting ${what} ${sayLevel(ac.cfl)}`]);
      ins.push({ k: 'level', ft: ac.cfl, verb: what === 'climb' ? 'climb' : 'descend', exp: true });
    } else if (ac.phase === 'ready' || ac.phase === 'lineup') {
      tokens.push('CTO');
    } else return fail(ac, 'nothing to expedite');
  }

  let i = 0;
  const ctx: Ctx = {
    sim,
    ac,
    atc,
    rb,
    ins,
    exp,
    R: rules(),
    next: () => tokens[++i],
    peek: () => tokens[i + 1],
  };
  for (; i < tokens.length; i++) {
    const t = tokens[i];
    let res: string | void | 'stop' = undefined;
    let found = false;
    for (const def of COMMANDS) {
      const m = t.match(def.match);
      if (!m || (def.when && !def.when(target))) continue;
      found = true;
      res = def.run(ctx, m);
      break;
    }
    if (!found) {
      const sa = sayAgain(ac.spoken, ac.callsign);
      sim.say('pilot', sa.text, sa.speech, ac.callsign);
      return { ok: false, error: `Unknown instruction "${t}"`, target: ac };
    }
    if (res === 'stop') return { ok: true, target: ac };
    if (typeof res === 'string') return fail(ac, res);
  }

  sim.say('atc', `${ac.callsign} ${atc.join(', ')}`, undefined, ac.callsign);
  // Pilot readback in this crew's own style (procedural, see pilotTalk.ts).
  const r = ins.length === rb.length ? readback(ac.spoken, ac.callsign, ins, prevAlt) : msg([...rb, [displayCallsign(ac.spoken), sayCallsign(ac.spoken)]]);
  r.text = r.text.charAt(0).toUpperCase() + r.text.slice(1);
  sim.say('pilot', r.text, r.speech, ac.callsign);
  // After clearance delivery the crew leaves the frequency to taxi with Tower.
  if (ac.phase !== 'taxi') ac.onFrequency = true;
  return { ok: true, target: ac };
}

function fail(ac: Aircraft, why: string): CommandResult {
  return { ok: false, error: `${ac.callsign}: ${why}`, target: ac };
}

export function directTo(ac: Aircraft, fix: string) {
  // Keep the remainder of the route after the fix if it is on it.
  const idx = ac.route.findIndex((l, i) => i >= 0 && l.t === 'FIX' && l.fix === fix);
  if (idx >= 0) {
    ac.legIdx = idx;
  } else {
    ac.route = [{ t: 'FIX', fix }];
    ac.legIdx = 0;
  }
  ac.legFrom = null;
  ac.lateral = { mode: 'route' };
  ac.locCaptured = false;
  ac.gsCaptured = false;
}

function lastFix(ac: Aircraft) {
  for (let i = ac.route.length - 1; i >= 0; i--) {
    const l = ac.route[i];
    if (l.t === 'FIX') return l.fix;
  }
  return null;
}

/** Published transition starting at the IAF the aircraft is heading for (or holding at). */
/** Begin the move from the holding point onto the runway (drawn by the scope, LINEUP_S long). */
function startLineUp(sim: Sim, ac: Aircraft, dur = LINEUP_S) {
  ac.flags.lineupAt = sim.time;
  ac.flags.lineupDur = dur;
  ac.flags.lineupFrom = sim.holdingPoint(ac.runway);
  ac.radar = { ...ac.radar, pos: { ...runwayGeom(ac.runway).thr } };
}

/** The rest of the approach from a fix on it: the IF itself, or a fix of a published transition. */
function joinPoint(rwy: string, fix: string): { legs: Leg[]; idx: number } | null {
  const r = APT.runways[rwy];
  if (fix === r.ifix) return { legs: [{ t: 'FIX', fix }], idx: 0 };
  for (const legs of Object.values(r.transitions)) {
    const idx = legs.findIndex((l) => l.t === 'FIX' && l.fix === fix);
    if (idx >= 0) return { legs, idx };
  }
  return null;
}

function transitionFor(ac: Aircraft, rwy: string) {
  const tr = APT.runways[rwy].transitions;
  const target = ac.lateral.mode === 'hold' ? ac.lateral.fix : lastFix(ac);
  if (target && tr[target]) return target;
  // Rotterdam-style transitions from nearby IAFs: use the nearest one within 15 NM.
  let best: string | null = null;
  let bd = 15;
  for (const k of Object.keys(tr)) {
    if (k === 'SPL') continue;
    const p = fixPos(k);
    const d = Math.hypot(p.x - ac.pos.x, p.y - ac.pos.y);
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  return best;
}

/** Heading command from a mouse drag: MAG heading from aircraft to a point. */
export function headingTo(ac: Aircraft, p: { x: number; y: number }) {
  return Math.round(trueToMag(bearing(ac.pos, p)) / 5) * 5 || 360;
}

export { magToTrue };

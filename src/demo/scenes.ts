// The demo video's takes, one per scene (the capture and edit tooling lives in a local video/ folder, not in the repository). Each sets up its own traffic on a
// fixed seed and weather, then a timeline of cues drives the cursor and the controller's
// actions through the real UI.
import { APT } from '../data/airport';
import { AIRCRAFT, TELEPHONY, TRAFFIC } from '../data/traffic';
import { execute, headingTo } from '../sim/commands';
import { bearing, dist, fixPos, fromBearing, toLatLon, toNM, type Vec } from '../sim/geo';
import type { Sim } from '../sim/sim';
import type { Aircraft } from '../sim/types';
import { clickEffect, elementPos, heard, hooks, moveCursor, radioBusy, scopePos, setCursor, type Camera, type Ctx, type Cue, type SceneDef } from './demo';

// ------------------------------------------------------------------ traffic helpers
function make(ac: Aircraft, icao: string, num: string, type: string) {
  const op = (TRAFFIC[APT.icao] ?? []).find((o) => o.icao === icao);
  if (op) ac.operator = op;
  ac.callsign = ac.id = `${icao}${num}`;
  ac.spoken = `${TELEPHONY[icao] ?? icao} ${num}`;
  if (AIRCRAFT[type]) ac.type = AIRCRAFT[type];
  return ac;
}

export function arrival(sim: Sim, icao: string, num: string, type: string, origin: string, distOut: number) {
  return make(sim.spawnArrival(distOut, origin), icao, num, type);
}

export function departure(sim: Sim, icao: string, num: string, type: string, dest: string) {
  return make(sim.spawnDeparture('stand', dest), icao, num, type);
}

/** Run the simulation without filming (traffic history, positions). */
function preroll(sim: Sim, seconds: number) {
  for (let t = 0; t < seconds; t += 1) sim.tick(1);
}

const ll = (p: Vec): [number, number] => toLatLon(p) as [number, number];
const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const find = (c: Ctx, cs: string) => c.sim.aircraft.find((a) => a.callsign === cs);

/** Click a button on the command card, located by its label. */
function buttonCue(at: number, label: string | RegExp, selector = '.ac-card button', glide = 0.6): Cue[] {
  return [
    {
      at,
      run: () => {
        const p = elementPos(selector, label);
        if (p) moveCursor(p.x, p.y, glide);
      },
    },
    {
      at: at + glide + 0.15,
      free: true,
      run: () => {
        clickEffect();
        elementPos(selector, label)?.el.click();
      },
    },
  ];
}

/** The same, fired a fixed time after a condition first holds. */
function buttonWhen(when: (c: Ctx) => boolean, delay: number, label: string | RegExp, selector = '.ac-card button'): Cue[] {
  return [
    {
      when,
      delay,
      run: () => {
        const p = elementPos(selector, label);
        if (p) moveCursor(p.x, p.y, 0.6);
      },
    },
    {
      when,
      delay: delay + 0.75,
      free: true,
      run: () => {
        clickEffect();
        elementPos(selector, label)?.el.click();
      },
    },
  ];
}

/** Smoothly follow a moving camera target. */
function follower(target: (c: Ctx) => Camera, k = 0.06) {
  let cur: Camera | null = null;
  return (c: Ctx): Camera => {
    const t = target(c);
    if (!cur) cur = t;
    else
      cur = {
        center: [cur.center[0] + (t.center[0] - cur.center[0]) * k, cur.center[1] + (t.center[1] - cur.center[1]) * k],
        zoom: cur.zoom + (t.zoom - cur.zoom) * k,
      };
    return cur;
  };
}

/** Ends a scene once a call matching this has been made and the frequency is quiet again. */
const doneAfter = (re: RegExp) => () => heard(re) && !radioBusy(0.3);

// ------------------------------------------------------------------ scenes
const ARP: Vec = { x: 0, y: 0 };

/** 1. Cold open: the scope at work. */
const open: SceneDef = {
  duration: 7,
  setup: ({ sim }) => {
    arrival(sim, 'TRA', '5816', 'B738', 'LEBL', 34);
    arrival(sim, 'CND', '7012', 'B738', 'LTAI', 26);
    arrival(sim, 'CFE', '8422', 'E190', 'EGLC', 40);
    departure(sim, 'TRA', '6731', 'B738', 'LIRF');
    preroll(sim, 90);
  },
  camera: [
    [0, { center: [51.95, 4.4], zoom: 8.55 }],
    [7, { center: [51.95, 4.43], zoom: 8.95 }],
  ],
  cues: [],
};

/** 2. The briefing: pick a level, turn on events, take the frequency. */
const briefing: SceneDef = {
  briefing: true,
  duration: 9,
  cues: [
    ...buttonCue(1.2, 'Busy', '.seg.diff button', 0.8),
    ...buttonCue(3.2, 'Occasional', '[aria-label="Events"] button', 0.7),
    {
      at: 5.6,
      run: () => {
        const p = elementPos('button.start');
        if (p) moveCursor(p.x, p.y, 1.0);
      },
    },
    { at: 7.6, run: () => clickEffect() },
  ],
};

/** TRA5816 has read back the direct and the frequency is quiet. */
const readbackDone = () => heard(/HELHO.*Transavia/i) && !radioBusy(0.3);

/** 3. First contact, a drag that snaps to a waypoint, and a combined transmission. */
let helho: Vec = ARP;
const contact: SceneDef = {
  duration: 45,
  endWhen: doneAfter(/cleared (the )?ILS|ILS 06/i),
  onFrame: (c) => dragFrame(c),
  setup: ({ sim }) => {
    arrival(sim, 'TRA', '5816', 'B738', 'LEBL', 21);
    const ifix = APT.runways[sim.config.arr[0]].ifix!;
    helho = fixPos(ifix);
  },
  cameraFn: (() => {
    let cam: Camera | null = null;
    return (c: Ctx) => {
      if (!cam) {
        const a = find(c, 'TRA5816')!;
        const m = mid(a.pos, helho);
        cam = { center: ll(fromBearing(m, 0, 0)), zoom: 9.75 };
      }
      return cam;
    };
  })(),
  cues: [
    // Select it while it is still talking.
    {
      when: (c) => !!find(c, 'TRA5816')?.onFrequency,
      delay: 1.5,
      run: (c) => {
        const a = find(c, 'TRA5816')!;
        const p = scopePos(a.radar.pos);
        moveCursor(p.x, p.y, 0.8);
      },
    },
    {
      when: (c) => !!find(c, 'TRA5816')?.onFrequency,
      delay: 2.45,
      run: (c) => {
        clickEffect();
        c.sim.selectedId = find(c, 'TRA5816')!.id;
      },
    },
    // Once it has finished its call: right-drag towards the IF, which snaps to a direct.
    {
      when: (c) => c.sim.selectedId === 'TRA5816' && !radioBusy(0.4),
      run: (c) => {
        const a = find(c, 'TRA5816')!;
        const p = scopePos(a.radar.pos);
        moveCursor(p.x, p.y, 0.4);
      },
    },
    {
      when: (c) => c.sim.selectedId === 'TRA5816' && !radioBusy(0.4),
      delay: 0.6,
      run: (c) => {
        dragFrom = c.t;
      },
    },
    {
      when: (c) => dragFrom !== null && c.t - dragFrom >= 2.0,
      free: true,
      run: (c) => {
        dragFrom = null;
        c.renderer.setDrag(null);
        clickEffect();
        execute(c.sim, `DCT ${APT.runways[c.sim.config.arr[0]].ifix}`);
      },
    },
    // After the readback: stack three instructions and send them in one go.
    ...buttonWhen(readbackDone, 0.5, /^3000/),
    ...buttonWhen(readbackDone, 1.5, /^160/),
    ...buttonWhen(readbackDone, 2.5, /^ILS/),
    ...buttonWhen(readbackDone, 3.7, /^TRANSMIT/),
  ],
};
let dragFrom: number | null = null;
/** Per-frame drag drawing for the contact scene (called from the director's camera hook). */
export function dragFrame(c: Ctx) {
  if (dragFrom === null) return;
  const a = find(c, 'TRA5816');
  if (!a) return;
  const k = Math.min(1, (c.t - dragFrom) / 1.8);
  const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  // Head off to one side first, then curve onto the fix: it reads as a hand movement.
  const straight = { x: a.pos.x + (helho.x - a.pos.x) * e, y: a.pos.y + (helho.y - a.pos.y) * e };
  const side = fromBearing(straight, bearing(a.pos, helho) + 90, Math.sin(e * Math.PI) * 1.2);
  const near = dist(side, helho) < 1.6;
  const to = near ? helho : side;
  const fix = APT.runways[c.sim.config.arr[0]].ifix!;
  c.renderer.setDrag(near ? { from: a.pos, to, label: `DCT ${fix}`, snap: true } : { from: a.pos, to, label: `HDG ${String(headingTo(a, to)).padStart(3, '0')}` });
  const p = scopePos(side);
  setCursor(p.x, p.y);
}

/** 4. Start-up, taxi along the real taxiways, take-off. */
const taxi: SceneDef = {
  duration: 95,
  setup: ({ sim }) => {
    const d = departure(sim, 'TRA', '6731', 'B738', 'LIRF');
    d.contactAt = sim.time + 1;
    sim.selectedId = d.id;
  },
  speed: (c) => {
    const d = find(c, 'TRA6731');
    if (!d) return 1;
    if (d.phase === 'taxi') return 14;
    if (d.phase === 'takeoff') return d.gs < 40 ? 6 : 2;
    if (d.phase === 'airborne') return 3;
    return 1;
  },
  cameraFn: follower((c) => {
    const d = find(c, 'TRA6731');
    const g = d ? c.sim.groundPos(d) : null;
    const hold = c.sim.holdingPoint(c.sim.config.dep[0]);
    if (d && (d.phase === 'takeoff' || d.phase === 'airborne')) return { center: ll(d.pos), zoom: d.phase === 'airborne' ? 11 : 13.5 };
    const stand = d?.flags.stand ? c.sim.ground.standPos(d.flags.stand) : null;
    return { center: ll(mid(stand ?? g ?? hold, hold)), zoom: 15.2 };
  }, 0.05),
  endWhen: doneAfter(/airborne/i),
  cues: [
    ...buttonWhen((c) => !!find(c, 'TRA6731')?.onFrequency, 3.2, /^CLEARANCE/),
    ...buttonWhen((c) => find(c, 'TRA6731')?.phase === 'ready' && !!find(c, 'TRA6731')?.onFrequency, 2.6, /^LINE UP/),
    ...buttonWhen((c) => find(c, 'TRA6731')?.phase === 'lineup', 9, /^CLEARED FOR TAKE-OFF/),
  ],
};

/** 5. Lifeliner 2: lift, the scene, the hospital. */
const lifeliner: SceneDef = {
  duration: 70,
  setup: ({ sim }) => {
    const hems = sim.hems as unknown as { pick: <T>(xs: T[]) => T };
    const pick = hems.pick;
    hems.pick = <T,>(xs: T[]) => (xs.find((x) => (x as { name?: string }).name === 'Schiedam') ?? pick(xs)) as T;
    const h = sim.hems.spawn('scene');
    hems.pick = pick;
    if (h) sim.selectedId = h.id;
  },
  speed: (c) => {
    const h = c.sim.aircraft.find((a) => a.category === 'heli');
    if (h && h.phase === 'ready') return 1;
    if (h && h.phase === 'airborne') return 12;
    return 240; // on scene: the crew at work
  },
  camera: [
    [0, { center: [51.938, 4.43], zoom: 11.1 }],
    [70, { center: [51.93, 4.44], zoom: 11.0 }],
  ],
  endWhen: () => heard(/landed at Erasmus/i),
  cues: [...buttonWhen((c) => !!c.sim.aircraft.find((a) => a.category === 'heli')?.onFrequency, 2.8, /^CLEARED TO LIFT/)],
};

/** 6. A light aircraft joins the circuit. */
const vfr: SceneDef = {
  duration: 42,
  endWhen: doneAfter(/downwind 06, wilco|wilco/i),
  setup: ({ sim }) => {
    const ga = sim.ga as unknown as { pick: <T>(xs: T[]) => T };
    const pick = ga.pick;
    ga.pick = <T,>(xs: T[]) => (xs.includes('EHSE' as T) ? ('EHSE' as T) : xs.includes('C172' as T) ? ('C172' as T) : pick(xs));
    const a = sim.ga.spawnVfrArrival();
    ga.pick = pick;
    a.contactAt = sim.time + 1;
    sim.selectedId = a.id;
  },
  speed: () => 3,
  cameraFn: follower((c) => {
    const a = c.sim.aircraft.find((x) => x.category === 'ga');
    return { center: ll(a ? mid(a.pos, ARP) : ARP), zoom: 10.7 };
  }, 0.03),
  cues: [...buttonWhen((c) => !!c.sim.aircraft.find((a) => a.category === 'ga')?.onFrequency, 3.2, /^DOWNWIND/)],
};

/** 7. Events: windshear on short final, then the runway closes. */
const events: SceneDef = {
  duration: 25,
  endWhen: doneAfter(/CLOSED/),
  setup: ({ sim }) => {
    const a = arrival(sim, 'CND', '7012', 'B738', 'LTAI', 22);
    a.onFrequency = true;
    sim.selectedId = a.id;
    execute(sim, `DCT ${APT.runways[sim.config.arr[0]].ifix}`);
    execute(sim, 'ILS');
    execute(sim, 'CL');
    for (let i = 0; i < 2400 && !(a.locCaptured && sim.distToThreshold(a) < 2.2); i++) sim.tick(0.5);
  },
  cameraFn: follower((c) => {
    const a = find(c, 'CND7012');
    return { center: ll(a ? mid(a.pos, ARP) : ARP), zoom: 11.4 };
  }, 0.04),
  speed: () => 2,
  cues: [
    { at: 1.0, run: (c) => c.sim.events.trigger('windshear') },
    { at: 7.5, run: (c) => c.sim.events.trigger('closure') },
  ],
};

/** 8. End of shift. */
const summary: SceneDef = {
  duration: 5,
  setup: ({ sim }) => {
    Object.assign(sim.score, { landed: 26, departed: 17, goArounds: 1, separationLosses: 0, runwayIncursions: 0, stcaSeconds: 150, points: 1385, wakeInfringements: 1 });
    (sim as unknown as { startedAt: number }).startedAt = sim.time - 48 * 60;
  },
  speed: () => 0,
  cues: [{ at: 0.6, run: () => hooks.showSummary?.() }],
};

/** 9. Montage: any airport (?apt=...) at work. */
const montage: SceneDef = {
  duration: 3.2,
  setup: ({ sim }) => {
    for (let i = 0; i < 4; i++) sim.spawnArrival();
    sim.spawnDeparture('ready');
    preroll(sim, 150);
  },
  cameraFn: (c) => ({ center: APT.view.center as [number, number], zoom: APT.view.zoom + 0.3 + (0.3 * c.t) / 3.2 }),
  cues: [],
};

export const SCENES: Record<string, SceneDef> = { open, briefing, contact, taxi, lifeliner, vfr, events, summary, montage };
export { toNM };

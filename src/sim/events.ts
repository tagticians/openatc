// Shift events: the things that break up a routine session. Off by default; switched on as
// "occasional" or "frequent" in the shift settings, or fired by hand from the ⌘K palette.
import { APT } from '../data/airport';
import { locGeometry } from './flight';
import { trueToMag } from './geo';
import * as talk from './pilotTalk';
import type { SimPlugin } from './plugin';
import type { Sim } from './sim';
import type { Aircraft } from './types';

export type EventKind = 'medical' | 'engine' | 'birdstrike' | 'nordo' | 'windshear' | 'closure' | 'windshift';
export type EventRate = 'off' | 'occasional' | 'frequent';

export const EVENTS: { kind: EventKind; label: string; detail: string; weight: number }[] = [
  { kind: 'medical', label: 'Medical emergency', detail: 'An inbound crew declares PAN PAN and asks for priority', weight: 3 },
  { kind: 'engine', label: 'Engine failure (MAYDAY)', detail: 'An arrival squawks 7700 and needs the shortest way in', weight: 2 },
  { kind: 'birdstrike', label: 'Bird strike on departure', detail: 'A departure returns to land', weight: 2 },
  { kind: 'nordo', label: 'Radio failure (7600)', detail: 'An arrival stops answering and flies the published procedure', weight: 2 },
  { kind: 'windshear', label: 'Windshear go-around', detail: 'The next arrival on short final goes around', weight: 2 },
  { kind: 'closure', label: 'Runway closure', detail: 'Debris on the runway: closed for an inspection', weight: 1.5 },
  { kind: 'windshift', label: 'Wind shift', detail: 'The wind swings round: change of runway direction', weight: 1 },
];

const MEAN_GAP: Record<EventRate, number> = { off: Infinity, occasional: 20 * 60, frequent: 8 * 60 };


export class EventDirector implements SimPlugin {
  id = 'events';
  rate: EventRate = 'off';
  /** Next random event (sim seconds); never until a shift starts with events on. */
  private next = Infinity;
  /** Runway strip → closed until (sim seconds). */
  closedUntil: Record<string, number> = {};
  windUntil = 0;

  constructor(private sim: Sim) {}

  start() {
    this.schedule(5 * 60);
  }

  setRate(r: EventRate) {
    this.rate = r;
    this.schedule(Math.min(MEAN_GAP[r], 4 * 60));
  }

  private schedule(min = 0) {
    const mean = MEAN_GAP[this.rate];
    this.next = Number.isFinite(mean) ? this.sim.time + Math.max(min, mean * (0.5 + this.sim.rng())) : Infinity;
  }

  isClosed(rwy: string) {
    return Object.entries(this.closedUntil).some(([r, t]) => t > this.sim.time && this.sim.sameStrip(r, rwy));
  }

  sweep() {
    const s = this.sim;
    for (const [r, t] of Object.entries(this.closedUntil)) {
      if (t <= s.time) {
        delete this.closedUntil[r];
        s.say('system', `Runway ${r} inspected and open again`, undefined, undefined, 'warn');
      }
    }
    // A wind shift waits for the final and the runway to be clear before the flow changes.
    if (this.windUntil > s.time) s.setWeather(s.weather);
    if (this.rate !== 'off' && s.time >= this.next) {
      const kinds = EVENTS.filter((e) => this.candidates(e.kind).length || e.kind === 'closure' || e.kind === 'windshift');
      let r = this.sim.rng() * kinds.reduce((a, e) => a + e.weight, 0);
      const ev = kinds.find((e) => (r -= e.weight) < 0) ?? kinds[0];
      if (ev) this.trigger(ev.kind);
      this.schedule(90);
    }
  }

  /** Aircraft that could take part in an event of this kind. */
  private candidates(kind: EventKind): Aircraft[] {
    const s = this.sim;
    const mine = s.aircraft.filter((a) => a.owner === 'player' && a.phase === 'airborne' && !a.flags.emergency && !a.handedOff);
    switch (kind) {
      case 'medical':
      case 'engine':
      case 'nordo':
        return mine.filter((a) => a.kind === 'arr' && !a.approachCleared && a.onFrequency);
      case 'birdstrike':
        return mine.filter((a) => a.kind === 'dep' && a.alt < 6000);
      case 'windshear':
        return mine.filter((a) => a.kind === 'arr' && a.locCaptured && locGeometry(a).along < 4);
      default:
        return [];
    }
  }

  /** Fire an event now. Returns a message for the UI when nothing suitable is flying. */
  trigger(kind: EventKind): string | null {
    const s = this.sim;
    const cands = this.candidates(kind);
    const ac = cands[Math.floor(this.sim.rng() * cands.length)];
    const cs = (a: Aircraft) => talk.displayCallsign(a.spoken);
    const sp = (a: Aircraft) => talk.spokenCallsign(a.spoken, talk.pilotFor(a.callsign));
    const unit = APT.callsigns.approach;
    const mark = (a: Aircraft, what: string) => {
      a.flags.emergency = what;
      a.flags.emergencyAt = s.time;
    };
    switch (kind) {
      case 'medical': {
        if (!ac) return 'No arrival on frequency to declare a medical emergency';
        mark(ac, 'PAN');
        const body = `${unit}, ${'%cs'}, we have a medical emergency on board, passenger unconscious, request priority and the most direct routing`;
        s.say('pilot', `PAN PAN, PAN PAN, PAN PAN, ${body.replace('%cs', cs(ac))}`, `Pan pan, pan pan, pan pan, ${body.replace('%cs', sp(ac))}`, ac.callsign, 'warn');
        s.say('system', `${ac.callsign} PAN PAN (medical): give priority. Landing within 10 minutes earns a bonus.`, undefined, ac.callsign, 'alert');
        return null;
      }
      case 'engine': {
        if (!ac) return 'No arrival on frequency for an engine failure';
        mark(ac, 'MAYDAY');
        ac.squawk = '7700';
        ac.spd = Math.min(ac.spd ?? 210, 210);
        const body = `${unit}, ${'%cs'}, engine failure, number two engine shut down, request vectors for an immediate approach`;
        s.say('pilot', `MAYDAY, MAYDAY, MAYDAY, ${body.replace('%cs', cs(ac))}`, `Mayday, mayday, mayday, ${body.replace('%cs', sp(ac))}`, ac.callsign, 'alert');
        s.say('system', `${ac.callsign} MAYDAY, squawking 7700: clear the way and get it on the ground.`, undefined, ac.callsign, 'alert');
        return null;
      }
      case 'birdstrike': {
        if (!ac) return 'No departure low enough for a bird strike';
        mark(ac, 'PAN');
        s.returnToLand(ac);
        const body = `${'%cs'}, bird strike on departure, we need to come back, request vectors for runway ${ac.runway}`;
        s.say('pilot', `PAN PAN, ${body.replace('%cs', cs(ac))}`, `Pan pan, ${body.replace('%cs', sp(ac))}`, ac.callsign, 'warn');
        s.say('system', `${ac.callsign} returns after a bird strike: it is an arrival now, sequence it in.`, undefined, ac.callsign, 'alert');
        return null;
      }
      case 'nordo': {
        if (!ac) return 'No arrival on frequency for a radio failure';
        mark(ac, 'RCF');
        ac.flags.nordo = true;
        ac.squawk = '7600';
        s.flyNordo(ac);
        s.say('system', `${ac.callsign} squawks 7600 (radio failure): it will fly the published procedure and land on ${ac.runway}. Keep everyone clear.`, undefined, ac.callsign, 'alert');
        return null;
      }
      case 'windshear': {
        if (!ac) return 'Nobody on short final for windshear';
        ac.flags.windshear = true;
        s.say('pilot', `${cs(ac)}, windshear, going around`, `${sp(ac)}, windshear, windshear, going around`, ac.callsign, 'warn');
        s.goAround(ac, 'windshear on short final', true);
        return null;
      }
      case 'closure': {
        const rwy = s.config.arr[0];
        const mins = 4 + Math.floor(this.sim.rng() * 4);
        this.closedUntil[rwy] = s.time + mins * 60;
        s.say('system', `RUNWAY ${rwy} CLOSED for ${mins} min: debris reported, inspection under way. Hold your arrivals.`, undefined, undefined, 'alert');
        return null;
      }
      case 'windshift': {
        const w = s.weather.wind;
        const dir = (APT.runways[s.config.arr[0]].trueHdg + 180 + (this.sim.rng() * 40 - 20) + 360) % 360;
        s.setWeather({ ...s.weather, wind: { dir: Math.round(dir / 10) * 10, spd: Math.min(25, Math.max(12, w.spd + 6)), gust: Math.min(35, w.spd + 16) }, raw: `${s.weather.raw} (wind shift)` });
        this.windUntil = s.time + 30 * 60;
        s.say('system', `Wind shift: now ${String(Math.round(trueToMag(dir) / 10) * 10).padStart(3, '0')}° ${Math.min(25, Math.max(12, w.spd + 6))} kt. The runway direction changes as soon as the final is clear.`, undefined, undefined, 'alert');
        return null;
      }
    }
  }
}

/** Bonus for getting an emergency on the ground quickly. */
export function emergencyBonus(ac: Aircraft, now: number) {
  const mins = (now - ((ac.flags.emergencyAt as number) ?? now)) / 60;
  return mins <= 10 ? 50 : mins <= 15 ? 25 : 10;
}

export const emergencyLabel = (ac: Aircraft) => (ac.flags.emergency as string | undefined) ?? null;

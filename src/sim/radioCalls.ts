// Calls crews make without being asked: first contact, clearance and start-up requests,
// "ready for departure", "airborne", requests for higher, "runway vacated".
import { APT } from '../data/airport';
import { fmtLevel, msg, sayLevel, sayRunway, LETTERS } from './phraseology';
import { isVfr } from './ga';
import { rules } from './rules';
import * as talk from './pilotTalk';
import type { Sim } from './sim';
import type { Aircraft } from './types';

export class PilotCalls {
  constructor(private sim: Sim) {}

  /** First call on frequency, when the aircraft is due to call. */
  firstContact(ac: Aircraft) {
    const sim = this.sim;
    if (ac.onFrequency || sim.time < ac.contactAt) return;
    if (sim.plugins.some((p) => p.call?.(ac))) return;
    if (ac.kind === 'arr' && ac.phase === 'airborne') {
      ac.onFrequency = true;
      const m = talk.initialContact({
        unit: APT.callsigns.approach,
        spoken: ac.spoken,
        callsign: ac.callsign,
        alt: ac.alt,
        cfl: ac.cfl,
        star: ac.lateral.mode === 'route' ? ac.star?.name : undefined,
        atis: sim.atis,
        heavy: ac.type.wake === 'H' || ac.type.wake === 'J',
      });
      sim.say('pilot', m.text, m.speech, ac.callsign);
    } else if (ac.kind === 'dep' && ac.phase === 'stand') {
      ac.onFrequency = true;
      const p = talk.pilotFor(ac.callsign);
      const R = rules();
      // Gate numbers (FAA) or stand codes (Europe): drawn once per flight.
      ac.flags.stand ??= sim.ground.assignStand() ?? (R.id === 'faa' ? String(1 + Math.floor(sim.rng() * 51)) : 'D' + (1 + Math.floor(sim.rng() * 9)));
      const m = msg([
        [APT.callsigns.delivery, talk.fixSpeech(APT.callsigns.delivery)],
        p.greets ? ['good morning', talk.greetingNow()] : ['', ''],
        [talk.displayCallsign(ac.spoken), talk.spokenCallsign(ac.spoken, p)],
        ...R.deliveryParts(sim.atis, ac.dest, ac.flags.stand),
      ]);
      sim.say('pilot', m.text, m.speech, ac.callsign);
      ac.flags.requestedAt = sim.time;
    } else if (ac.kind === 'dep' && ac.phase === 'taxi') {
      ac.phase = 'ready';
      ac.contactAt = sim.time;
    } else if (ac.kind === 'dep' && ac.phase === 'ready') {
      if (!sim.aircraft.some((a) => a.kind === 'dep' && a.phase === 'ready' && a.onFrequency && a !== ac)) {
        ac.onFrequency = true;
        const m = msg([
          [talk.displayCallsign(ac.spoken), talk.spokenCallsign(ac.spoken, talk.pilotFor(ac.callsign))],
          [`holding point runway ${ac.runway}`, `holding point runway ${sayRunway(ac.runway)}`],
          ['ready for departure', 'ready for departure'],
        ]);
        sim.say('pilot', m.text, m.speech, ac.callsign);
      } else {
        ac.contactAt = sim.time + 20;
      }
    }
  }

  /** Unprompted calls that nudge the controller. */
  requests(ac: Aircraft) {
    const sim = this.sim;
    if (ac.phase !== 'airborne' || !ac.onFrequency || isVfr(ac)) return;
    // Departures levelling at the SID altitude ask for higher.
    if (ac.kind === 'dep' && ac.cfl <= (ac.sid?.initialAlt ?? APT.sidInitialAlt) && Math.abs(ac.alt - ac.cfl) < 80) {
      ac.flags.levelSince ??= sim.time;
      if (!ac.flags.askedHigher && sim.time - ac.flags.levelSince > 25) {
        ac.flags.askedHigher = true;
        const m = talk.requestHigher(ac.spoken, ac.callsign, ac.cfl);
        sim.say('pilot', m.text, m.speech, ac.callsign);
      }
    }
  }

  airborne(ac: Aircraft) {
    const sim = this.sim;
    ac.contactAt = sim.time;
    const cs: [string, string] = [talk.displayCallsign(ac.spoken), talk.spokenCallsign(ac.spoken, talk.pilotFor(ac.callsign))];
    let m;
    if (ac.category === 'ga') {
      m = msg([cs, ['airborne', 'airborne'], [`for ${ac.flags.point}`, `for ${String(ac.flags.point).toLowerCase()}`]]);
    } else if (rules().airborneToRadar) {
      // US: departures check in with the radar controller, passing altitude for the assigned one.
      const passing = Math.max(1000, Math.round(ac.alt / 100) * 100);
      m = msg([[APT.callsigns.approach, APT.callsigns.approach], cs, [`passing ${fmtLevel(passing)} for ${fmtLevel(ac.cfl)}`, `passing ${sayLevel(passing)} for ${sayLevel(ac.cfl)}`]]);
    } else {
      m = msg([
        [APT.city, talk.fixSpeech(APT.city)],
        cs,
        ['airborne', 'airborne'],
        [`climbing ${fmtLevel(ac.cfl)}`, `climbing ${sayLevel(ac.cfl)}`],
        [`${ac.sid?.name}`, `${ac.sid?.name.replace(/(\d)([A-Z])/, (_, d, l) => `${d} ${LETTERS[l]}`)}`],
      ]);
    }
    sim.say('pilot', m.text, m.speech, ac.callsign);
  }

  vacated(ac: Aircraft) {
    const m = talk.vacated(ac.spoken, ac.callsign);
    this.sim.say('pilot', m.text, m.speech, ac.callsign);
  }
}

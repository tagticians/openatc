// Headless smoke test: an autopilot "controller" clears everything and we watch the outcomes.
import { setAirport } from '../src/data/airport';
import { AIRPORTS } from '../src/data/registry';
const apt = AIRPORTS.find((a) => a.icao === (process.argv[3] ?? 'EHRD'))!;
setAirport(apt);
import { Sim } from '../src/sim/sim';
import { execute } from '../src/sim/commands';
import { trueToMag } from '../src/sim/geo';

const rwy = process.argv[2] ?? '24';
// Deterministic: same seed, same shift (SEED=n to vary).
const sim = new Sim({ seed: Number(process.env.SEED ?? 1), startTime: 1792411200 });
const hdg = apt.runways[rwy].trueHdg;
sim.setWeather({ ...sim.weather, wind: { dir: hdg, spd: 12 }, raw: 'TEST' + rwy });
sim.settings.arrivalsPerHour = apt.icao === 'EHAM' ? 30 : 12;
sim.settings.departuresPerHour = apt.icao === 'EHAM' ? 16 : 10;
console.log('CONFIG', sim.configLabel());
sim.ga.rate = process.env.GA ? +process.env.GA : 0;
sim.start();
if (process.env.EVENTS) sim.events.setRate(process.env.EVENTS as 'frequent');
const log: string[] = [];
const full: string[] = [];
sim.onRadio((m) => full.push(`${Math.round(sim.time)} ${m.from} ${m.callsign ?? ''}: ${m.text} | ${m.speech ?? ''}`));
sim.onRadio((m) => {
  if (m.from === 'system' || /going around|vacated|airborne|established|hold|further climb|start-up/.test(m.text)) log.push(`${(sim.time % 86400 / 60).toFixed(1).padStart(7)}m ${m.from}: ${m.text}`);
});
const cleared = new Set<string>();
for (let s = 0; s < 3600 * 1.5 * 4; s++) {
  sim['step'](0.25);
  if (s % 8) continue;
  for (const a of sim.aircraft) {
    if (a.category !== 'airline') continue; // VFR and the helicopter have their own tests
    sim.selectedId = a.id;
    if (a.kind === 'arr' && a.phase === 'airborne') {
      if (!cleared.has(a.id + 'd') && a.onFrequency) { execute(sim, 'D30'); cleared.add(a.id + 'd'); }
      if (!a.approachCleared && !cleared.has(a.id + 'i') && a.onFrequency) { execute(sim, 'ILS'); cleared.add(a.id + 'i'); }
      if (a.locCaptured && !a.landingCleared && sim.distToThreshold(a) < 6) execute(sim, apt.roles[0] === 'arrival' ? 'HO' : 'CL');
    }
    if (a.kind === 'dep' && a.phase === 'stand' && a.onFrequency) execute(sim, 'CLR');
    if (a.kind === 'dep' && a.phase === 'ready' && a.onFrequency) {
      const busy = sim.aircraft.some((b) => b.kind === 'arr' && b.locCaptured && sim.distToThreshold(b) < 4) || sim.aircraft.some((b) => b !== a && (b.phase === 'takeoff' || b.phase === 'lineup' || b.phase === 'rollout'));
      if (!busy) execute(sim, 'CTO');
    }
    // SIDs that end in "heading, expect vectors": send it on its route once clear of the field.
    if (a.kind === 'dep' && a.phase === 'airborne' && a.alt > 1500 && a.lateral.mode === 'route' && a.route[a.legIdx]?.t === 'VM') execute(sim, 'RES');
    if (a.kind === 'dep' && apt.phraseology !== 'faa' && a.phase === 'airborne' && a.alt > 2500 && !cleared.has(a.id + 'c')) { execute(sim, 'C70'); cleared.add(a.id + 'c'); }
    if (a.kind === 'dep' && a.phase === 'airborne' && Math.hypot(a.pos.x, a.pos.y) > 20 && !a.handedOff) execute(sim, 'HO');
  }
}
console.log(log.join('\n'));
console.log('SCORE', JSON.stringify(sim.score));
console.log('REMAINING', sim.aircraft.map((a) => `${a.callsign} ${a.kind} ${a.phase} ${a.lateral.mode} alt${Math.round(a.alt)} d${Math.hypot(a.pos.x,a.pos.y).toFixed(1)} hdg${Math.round(trueToMag(a.hdg))} app${a.approachCleared} loc${a.locCaptured} leg${a.legIdx}/${a.route.length}`).join('\n'));

if (process.env.FULL) {
  console.log('---FULL');
  console.log(full.join('\n'));
  console.log(sim.aircraft.map((a) => `${a.callsign} ${a.phase} ${a.pos.x.toFixed(3)} ${a.pos.y.toFixed(3)} ${Math.round(a.alt)}`).join('\n'));
}

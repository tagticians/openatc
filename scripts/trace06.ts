import { setAirport } from '../src/data/airport';
import { AIRPORTS } from '../src/data/registry';
setAirport(AIRPORTS.find((a) => a.icao === (process.env.APT ?? 'EHRD'))!);
import { Sim } from '../src/sim/sim';
import { execute } from '../src/sim/commands';
import { trueToMag } from '../src/sim/geo';
import { locGeometry, glideAlt } from '../src/sim/flight';
const sim = new Sim();
sim.setWeather({ ...sim.weather, wind: { dir: 60, spd: 12 }, raw: 'X' });
sim.runway = '06';
sim.settings.arrivalsPerHour = 0.01; sim.settings.departuresPerHour = 0.01;
sim['nextArr'] = 1e12; sim['nextDep'] = 1e12;
const star = process.argv[2] ?? 'MOLIX';
let a = sim.spawnArrival(30);
for (let i = 0; i < 20 && !a.star!.name.startsWith(star); i++) { sim.aircraft = []; a = sim.spawnArrival(30); }
console.log('STAR', a.star!.name);
sim.selectedId = a.id; a.onFrequency = true;
execute(sim, 'D30'); execute(sim, 'ILS');
for (let s = 0; s < 4 * 1800; s++) {
  sim['step'](0.25);
  if (!sim.aircraft.includes(a)) { console.log('gone at', s/4); break; }
  if (a.locCaptured && !a.landingCleared) execute(sim, 'CL');
  if (s % 40 === 0) { const g = locGeometry(a); console.log(`${(s/4).toFixed(0)}s ${a.phase} ${a.lateral.mode} leg${a.legIdx} alt${a.alt.toFixed(0)} gsAlt${glideAlt(a).toFixed(0)} along${g.along.toFixed(2)} cross${g.cross.toFixed(2)} hdg${trueToMag(a.hdg).toFixed(0)} ias${a.ias.toFixed(0)} loc${a.locCaptured} gs${a.gsCaptured}`); }
}

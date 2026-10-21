// Vectors onto the localizer at awkward angles: every case should end established.
import { setAirport } from '../src/data/airport';
import { AIRPORTS } from '../src/data/registry';
setAirport(AIRPORTS[0]);
import { Sim } from '../src/sim/sim';
import { execute } from '../src/sim/commands';
import { fromBearing, toNM } from '../src/sim/geo';
const cases: [string, number, number, number][] = [
  // label, distance out on the 06 final, offset NM (+ right of course), heading MAG
  ['30° intercept', 14, 3, 25],
  ['90° base', 9, 4, 325],
  ['110° steep', 9, 4, 305],
  ['130° very steep', 9, 3, 285],
  ['far out 27 NM', 27, 4, 15],
];
for (const [label, d, off, hdg] of cases) {
  const sim = new Sim();
  sim.settings.arrivalsPerHour = 0; sim.settings.departuresPerHour = 0;
  sim.runway = '06';
  const ac = sim.spawnArrival(30);
  sim.aircraft = [ac];
  const thr = toNM([51.953064, 4.430681]);
  const onCl = fromBearing(thr, 237.1, d);
  ac.pos = fromBearing(onCl, 237.1 + 90 * Math.sign(-off), Math.abs(off));
  ac.alt = 3000; ac.cfl = 3000; ac.runway = '06'; ac.onFrequency = true;
  sim.selectedId = ac.id;
  execute(sim, `H${String(hdg).padStart(3, '0')}`);
  ac.hdg = (hdg + 2) % 360; ac.track = ac.hdg;
  execute(sim, 'ILS');
  let t = 0;
  while (t < 600 && !ac.locCaptured) { sim['step'](0.25); t += 0.25; }
  let landed = false;
  execute(sim, 'CL');
  for (let i = 0; i < 4 * 600 && sim.aircraft.includes(ac); i++) { sim['step'](0.25); if (ac.phase === 'rollout') landed = true; }
  console.log(`${label.padEnd(18)} captured ${ac.locCaptured || landed ? 'yes' : 'NO '} after ${t.toFixed(0)}s, landed ${landed ? 'yes' : 'no'}`);
}

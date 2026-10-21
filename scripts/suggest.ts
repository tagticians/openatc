// Prints the direct-to chips for every airborne aircraft after some minutes of simulation.
// Usage: npx tsx scripts/suggest.ts <ICAO> [minutes]
import { setAirport } from '../src/data/airport';
import { AIRPORTS } from '../src/data/registry';
const apt = AIRPORTS.find((a) => a.icao === (process.argv[2] ?? 'EGLC'))!;
setAirport(apt);
const { Sim } = await import('../src/sim/sim');
const { suggestFixes } = await import('../src/sim/suggest');
const sim = new Sim({ seed: 1, startTime: 1792411200 });
sim.start();
const steps = Number(process.argv[3] ?? 12) * 60 * 4;
for (let i = 0; i < steps; i++) sim['step'](0.25);
for (const a of sim.aircraft) console.log(a.kind, a.callsign, a.phase, a.route[a.legIdx]?.t === 'FIX' ? (a.route[a.legIdx] as { fix: string }).fix : '-', '→', suggestFixes(a, sim).join(' '));

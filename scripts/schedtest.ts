import { setAirport } from '../src/data/airport';
import { AIRPORTS } from '../src/data/registry';
setAirport(AIRPORTS.find((a) => a.icao === (process.env.APT ?? 'EHRD'))!);
import { Sim } from '../src/sim/sim';
const sim = new Sim();
const now = sim.time;
sim.loadSchedule([
  { kind: 'arr', callsign: 'TFL123', number: 'OR 123', airline: { name: 'TUI fly', icao: 'TFL', iata: 'OR' }, other: { icao: 'LEPA', name: 'Palma', city: 'Palma' }, scheduled: now + 15 * 60, aircraft: 'Boeing 737-800', status: 'Expected' },
  { kind: 'dep', callsign: 'VLG8320', number: 'VY 8320', airline: { name: 'Vueling', icao: 'VLG', iata: 'VY' }, other: { icao: 'LEBL', name: 'Barcelona', city: 'Barcelona', lat: 41.3, lon: 2.08 }, scheduled: now + 16 * 60, aircraft: 'Airbus A320', status: 'Expected' },
], 'test');
sim.settings.arrivalsPerHour = 0.01; sim.settings.departuresPerHour = 0.01;
sim.start();
for (let i = 0; i < 4 * 120; i++) sim['step'](0.25);
for (const a of sim.aircraft.filter((a) => a.flags.scheduled)) console.log(a.callsign, a.spoken, a.kind, a.phase, a.type.icao, a.origin, '>', a.dest, a.star?.name ?? a.sid?.name);
console.log('remaining in schedule', sim.schedule.length);

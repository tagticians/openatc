import { setAirport } from '../../src/data/airport';
import { AIRPORTS } from '../../src/data/registry';
import { Sim } from '../../src/sim/sim';

/** A started, deterministic simulation at an airport, landing on `rwy`. */
export function simAt(icao: string, rwy?: string, seed = 7) {
  const apt = AIRPORTS.find((a) => a.icao === icao)!;
  setAirport(apt);
  const sim = new Sim({ seed, startTime: 1792411200 });
  const r = rwy ?? apt.configs[0].arr[0];
  sim.setWeather({ ...sim.weather, wind: { dir: apt.runways[r].trueHdg, spd: 10 }, raw: `TEST ${r}` });
  sim.settings.arrivalsPerHour = 0;
  sim.settings.departuresPerHour = 0;
  sim.ga.rate = 0;
  return sim;
}

// Airports the game can load, and boot-time selection from the URL (?apt=EHAM&role=arrival).
import { setAirport, type AirportData, type Role } from './airport';
import { EHRD } from './ehrd';
import { EHAM } from './eham';
import { KSAN } from './ksan';
import { KORF } from './korf';
import { EGLC } from './eglc';
import { KDCA } from './kdca';

export const AIRPORTS: AirportData[] = [EHRD, EHAM, EGLC, KSAN, KORF, KDCA];

export function selectAirportFromUrl() {
  const q = new URLSearchParams(window.location.search);
  const icao = (q.get('apt') ?? '').toUpperCase();
  const apt = AIRPORTS.find((a) => a.icao === icao) ?? EHRD;
  setAirport(apt, (q.get('role') as Role | null) ?? undefined);
  document.title = `${apt.callsigns.approach} · ${apt.icao}`;
}

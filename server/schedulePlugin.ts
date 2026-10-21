// Dev-server middleware: real airport schedule (FIDS) from AeroDataBox (RapidAPI), cached on disk.
// The free tier allows ~100 requests/month, so each of the two daily windows (local
// 05–17h and 17–24h) is fetched at most once and served from .schedule-cache/ (≤ 62 calls/month).
import type { Plugin } from 'vite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HOST = 'aerodatabox.p.rapidapi.com';

export interface ScheduledFlight {
  kind: 'arr' | 'dep';
  callsign: string; // ICAO callsign, e.g. TRA5123
  number: string; // e.g. HV 5123
  airline: { name: string; icao: string; iata: string };
  other: { icao: string; name: string; city: string; lat?: number; lon?: number };
  scheduled: number; // unix seconds (UTC)
  aircraft: string; // model name
  status: string;
}

interface AdbMovement {
  airport?: { icao?: string; iata?: string; name?: string; municipalityName?: string; location?: { lat: number; lon: number } };
  scheduledTime?: { utc?: string };
}
interface AdbFlight {
  number?: string;
  callSign?: string;
  status?: string;
  isCargo?: boolean;
  movement?: AdbMovement;
  departure?: AdbMovement;
  arrival?: AdbMovement;
  aircraft?: { model?: string };
  airline?: { name?: string; icao?: string; iata?: string };
}

function normalise(f: AdbFlight, kind: 'arr' | 'dep'): ScheduledFlight | null {
  const mv = f.movement ?? (kind === 'arr' ? f.departure : f.arrival);
  const utc = mv?.scheduledTime?.utc;
  if (!utc || !f.number) return null;
  const t = Date.parse(utc.replace(' ', 'T').replace(/Z?$/, 'Z'));
  if (Number.isNaN(t)) return null;
  const icao = f.airline?.icao ?? '';
  const digits = f.number.replace(/^[A-Z0-9]{2}\s*/, '');
  return {
    kind,
    callsign: (f.callSign ?? (icao ? icao + digits : f.number.replace(/\s/g, ''))).toUpperCase(),
    number: f.number,
    airline: { name: f.airline?.name ?? '', icao, iata: f.airline?.iata ?? '' },
    other: {
      icao: mv?.airport?.icao ?? '',
      name: mv?.airport?.name ?? '',
      city: mv?.airport?.municipalityName ?? mv?.airport?.name ?? '',
      lat: mv?.airport?.location?.lat,
      lon: mv?.airport?.location?.lon,
    },
    scheduled: t / 1000,
    aircraft: f.aircraft?.model ?? '',
    status: f.status ?? '',
  };
}

export function schedulePlugin(apiKey: string | undefined): Plugin {
  const dir = join(process.cwd(), '.schedule-cache');
  if (!existsSync(dir)) mkdirSync(dir);

  /** Airport-local date and hour (AeroDataBox windows are in local time). */
  const TZ: Record<string, string> = { KSAN: 'America/Los_Angeles', KORF: 'America/New_York', EGLC: 'Europe/London', KDCA: 'America/New_York' };
  const local = (d: Date, icao = 'EHRD') => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', { timeZone: TZ[icao] ?? 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
        .formatToParts(d)
        .map((x) => [x.type, x.value]),
    );
    return { day: `${p.year}-${p.month}-${p.day}`, hour: +p.hour };
  };

  async function windowFlights(icao: string, at: Date): Promise<ScheduledFlight[]> {
    const { day, hour } = local(at, icao);
    // Two windows cover the operating day: 05:00–16:59 and 17:00–23:59 local.
    const [h0, h1, tag] = hour < 17 ? ['05:00', '16:59', 'a'] : ['17:00', '23:59', 'b'];
    const file = join(dir, `${icao}-${day}-${tag}.json`);
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
    if (!apiKey) return [];
    const url = `https://${HOST}/flights/airports/icao/${icao}/${day}T${h0}/${day}T${h1}?withLeg=false&direction=Both&withCancelled=false&withCodeshared=false&withCargo=false&withPrivate=false&withLocation=true`;
    const r = await fetch(url, { headers: { 'X-RapidAPI-Key': apiKey, 'X-RapidAPI-Host': HOST } });
    if (r.status === 204) {
      writeFileSync(file, '[]');
      return [];
    }
    if (!r.ok) throw new Error(`AeroDataBox ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as { arrivals?: AdbFlight[]; departures?: AdbFlight[] };
    const flights = [
      ...(j.arrivals ?? []).map((f) => normalise(f, 'arr')),
      ...(j.departures ?? []).map((f) => normalise(f, 'dep')),
    ].filter((f): f is ScheduledFlight => !!f);
    writeFileSync(file, JSON.stringify(flights));
    return flights;
  }

  return {
    name: 'aerodatabox-schedule',
    configureServer(server) {
      server.middlewares.use('/api/schedule', async (req, res) => {
        res.setHeader('content-type', 'application/json');
        try {
          const icao = (new URL(req.url ?? '/', 'http://x').searchParams.get('icao') ?? 'EHRD').toUpperCase();
          if (!/^[A-Z]{4}$/.test(icao)) throw new Error('bad icao');
          const now = new Date();
          const flights = await windowFlights(icao, now);
          // Late in the first window, include the evening window too.
          const { hour } = local(now, icao);
          if (hour >= 15 && hour < 17) flights.push(...(await windowFlights(icao, new Date(now.getTime() + 3 * 3600 * 1000))));
          res.end(JSON.stringify({ source: apiKey ? 'aerodatabox' : 'none', flights }));
        } catch (e) {
          res.statusCode = 502;
          res.end(JSON.stringify({ source: 'error', error: String(e), flights: [] }));
        }
      });
    },
  };
}

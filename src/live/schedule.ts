// Real airport schedule (AeroDataBox via the dev-server cache). Empty when no key is configured.
export interface ScheduledFlight {
  kind: 'arr' | 'dep';
  callsign: string;
  number: string;
  airline: { name: string; icao: string; iata: string };
  other: { icao: string; name: string; city: string; lat?: number; lon?: number };
  scheduled: number;
  aircraft: string;
  status: string;
}

export async function fetchSchedule(icao: string): Promise<{ source: string; flights: ScheduledFlight[] }> {
  try {
    const r = await fetch(`/api/schedule?icao=${icao}`);
    return await r.json();
  } catch {
    return { source: 'error', flights: [] };
  }
}

// Fetch real stand (parking_position) and runway holding positions from OpenStreetMap (ODbL)
// for each airport and write src/data/airports/<ICAO>.stands.json.
// Usage: node scripts/osm/stands.mjs EGLC EHRD ...
import { writeFileSync } from 'node:fs';

const icaos = process.argv.slice(2);
for (const icao of icaos) {
  const q = `[out:json][timeout:60];
area["aeroway"="aerodrome"]["icao"="${icao}"]->.a;
(nwr["aeroway"="parking_position"](area.a);node["aeroway"="holding_position"](area.a););
out center tags;`;
  const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'User-Agent': 'atc-game-local/1.0' } });
  if (!res.ok) {
    console.error(icao, res.status);
    continue;
  }
  const j = await res.json();
  const ll = (e) => (e.type === 'node' ? [e.lat, e.lon] : [e.center.lat, e.center.lon]);
  const r5 = (x) => Math.round(x * 1e5) / 1e5;
  const stands = j.elements
    .filter((e) => e.tags?.aeroway === 'parking_position')
    .map((e) => ({ ref: e.tags.ref ?? e.tags.name ?? '', lat: r5(ll(e)[0]), lon: r5(ll(e)[1]) }))
    .filter((s) => s.ref)
    .sort((a, b) => a.ref.localeCompare(b.ref, 'en', { numeric: true }));
  const holds = j.elements
    .filter((e) => e.tags?.aeroway === 'holding_position')
    .map((e) => ({ ref: e.tags.ref ?? '', lat: r5(e.lat), lon: r5(e.lon) }));
  writeFileSync(`src/data/airports/${icao}.stands.json`, JSON.stringify({ source: 'OpenStreetMap contributors (ODbL)', stands, holds }, null, 0) + '\n');
  console.log(icao, 'stands', stands.length, 'holds', holds.length);
  await new Promise((r) => setTimeout(r, 2000));
}

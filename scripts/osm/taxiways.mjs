// Fetch the taxiway network (aeroway=taxiway / taxilane centrelines) from OpenStreetMap (ODbL)
// and write src/data/airports/<ICAO>.taxi.json: one polyline per way, [lat, lon] at ~1 m.
// Usage: node scripts/osm/taxiways.mjs EGLC EHRD ...
import { writeFileSync } from 'node:fs';

const icaos = process.argv.slice(2);
for (const icao of icaos) {
  const q = `[out:json][timeout:90];
area["aeroway"="aerodrome"]["icao"="${icao}"]->.a;
way["aeroway"~"^(taxiway|taxilane)$"](area.a);
out geom tags;`;
  let j = null;
  for (let attempt = 0; attempt < 4 && !j; attempt++) {
    const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'User-Agent': 'atc-game-local/1.0' } });
    if (res.ok) j = await res.json();
    else {
      console.error(icao, res.status, 'retrying');
      await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)));
    }
  }
  if (!j) continue;
  const r5 = (x) => Math.round(x * 1e5) / 1e5;
  const ways = j.elements
    .filter((e) => e.geometry?.length > 1)
    .map((e) => ({ ref: e.tags?.ref ?? '', kind: e.tags.aeroway === 'taxilane' ? 'lane' : 'way', pts: e.geometry.map((g) => [r5(g.lat), r5(g.lon)]) }));
  writeFileSync(`src/data/airports/${icao}.taxi.json`, JSON.stringify({ source: 'OpenStreetMap contributors (ODbL)', ways }) + '\n');
  console.log(icao, 'ways', ways.length, 'points', ways.reduce((a, w) => a + w.pts.length, 0));
  await new Promise((r) => setTimeout(r, 4000));
}

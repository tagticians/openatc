// Vendors airline logos into public/logos for the operators the game uses.
// Source: soaring-symbols (SVG + brand colours, MIT). Airlines without artwork there get a
// coloured text badge in the game (no unlicensed logo sets).
import { writeFile } from 'node:fs/promises';

import { readdirSync, readFileSync } from 'node:fs';
// Airlines to fetch: the ones named on the command line, else every airline in a traffic mix.
const OPERATORS = process.argv.length > 2
  ? process.argv.slice(2)
  : [...new Set(readdirSync('src/data/traffic').flatMap((f) => JSON.parse(readFileSync(`src/data/traffic/${f}`, 'utf8')).map((e) => e.airline)))];
const SS = 'https://raw.githubusercontent.com/soaring-symbols/soaring-symbols/main';

const airlines = await (await fetch(`${SS}/airlines.json`)).json();
const index = {};
for (const icao of OPERATORS) {
  const a = airlines.find((x) => x.icao === icao);
  const entry = { color: a?.branding?.primary_color ?? null };
  if (a) {
    for (const kind of ['icon', 'logo']) {
      const r = await fetch(`${SS}/assets/${a.slug}/${kind}.svg`);
      if (r.ok) {
        await writeFile(`public/logos/${icao}-${kind}.svg`, await r.text());
        entry[kind] = `/logos/${icao}-${kind}.svg`;
      }
    }
  }
  index[icao] = entry;
  console.log(icao, JSON.stringify(entry));
}
// soaring-symbols wordmarks sit in a square 64×64 viewBox; crop them to their measured bounds
// (measured in a browser with getBBox; see scripts/logo-crops.json).
import { readFile } from 'node:fs/promises';
const crops = JSON.parse(await readFile('scripts/logo-crops.json', 'utf8'));
for (const [icao, [x, y, w, h]] of Object.entries(crops)) {
  if (!index[icao]?.logo?.endsWith('.svg')) continue;
  const p = `public/logos/${icao}-logo.svg`;
  const svg = await readFile(p, 'utf8');
  await writeFile(p, svg.replace(/viewBox="[^"]*"/, `viewBox="${x - 1} ${(y - 0.8).toFixed(2)} ${w + 2} ${(h + 1.6).toFixed(2)}"`));
}
await writeFile('public/logos/index.json', JSON.stringify(index, null, 2));

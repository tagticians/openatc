// Capture → voice → recapture until every call in every take was paced with its real clip length.
// A take paced with estimates (new lines) is filmed again once ElevenLabs has voiced them.
//
//   node converge.mjs [takes...]     (default: every EHRD take that has radio)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const DEFAULT = ['open', 'contact', 'taxi', 'lifeliner', 'vfr', 'events'];
let todo = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT;
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });

for (let round = 1; round <= 4 && todo.length; round++) {
  console.log(`\n=== round ${round}: ${todo.join(' ')}`);
  run('node', ['capture.mjs', ...todo]);
  run('npm', ['run', 'voices', '--', ...todo]);
  const real = JSON.parse(readFileSync('../public/demo-voice.json', 'utf8'));
  todo = todo.filter((t) => {
    const { radio } = JSON.parse(readFileSync(`public/clips/${t}.json`, 'utf8'));
    const off = radio.filter((r) => r.airtime !== undefined && Math.abs((real[`${r.from}|${r.text}`] ?? 0) - r.airtime) > 0.15);
    if (off.length) console.log(`${t}: ${off.length} call(s) paced on estimates, filming again`);
    return off.length > 0;
  });
}
console.log(todo.length ? `still estimated: ${todo.join(' ')}` : 'all takes paced on real clips');

// Golden-run regression: every airport, both flows, fixed seed. Compares the full radio log and
// final traffic state with tests/golden/. `node scripts/golden.mjs --update` rewrites them.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const CASES = [['24', 'EHRD'], ['06', 'EHRD'], ['18R', 'EHAM'], ['27', 'EGLC'], ['09', 'EGLC'], ['27', 'KSAN'], ['09', 'KSAN'], ['23', 'KORF'], ['05', 'KORF'], ['01', 'KDCA'], ['19', 'KDCA']];
const update = process.argv.includes('--update');
execFileSync('npx', ['esbuild', 'scripts/simtest.ts', '--bundle', '--platform=node', '--format=esm', '--outfile=node_modules/.cache/simtest.mjs', '--log-level=warning']);
mkdirSync('tests/golden', { recursive: true });
let failed = 0;
for (const [rwy, apt] of CASES) {
  const out = execFileSync('node', ['node_modules/.cache/simtest.mjs', rwy, apt], { env: { ...process.env, FULL: '1', SEED: '1' }, maxBuffer: 64 << 20 }).toString();
  const body = out.slice(out.indexOf('SCORE'));
  const file = `tests/golden/${apt}-${rwy}.txt`;
  if (update || !existsSync(file)) {
    writeFileSync(file, body);
    console.log('wrote', file, body.split('\n')[0]);
    continue;
  }
  const old = readFileSync(file, 'utf8');
  if (old === body) console.log('same ', apt, rwy, body.split('\n')[0]);
  else {
    failed++;
    const a = old.split('\n');
    const b = body.split('\n');
    const i = a.findIndex((l, k) => l !== b[k]);
    console.log('DIFF ', apt, rwy, `first difference at line ${i + 1}:\n   was: ${a[i]}\n   now: ${b[i]}`);
  }
}
process.exit(failed ? 1 : 0);

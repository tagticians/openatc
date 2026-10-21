// Films the game's demo scenes frame by frame (the game must be running: `npm run dev` in the
// project root). Each scene is a separate take: ?demo=<scene> makes the game wait for this script
// to step it, so every frame is complete (map tiles loaded, UI updated) before its screenshot.
//
//   node capture.mjs                 all scenes
//   node capture.mjs taxi lifeliner  just these
//
// Output: public/clips/<take>.mp4 and public/clips/<take>.json (radio lines with frame numbers).
import { chromium } from 'playwright';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = process.env.GAME_URL ?? 'http://localhost:5173/';
const TAKES = [
  { id: 'open', apt: 'EHRD', scene: 'open' },
  { id: 'briefing', apt: 'EHRD', scene: 'briefing' },
  { id: 'contact', apt: 'EHRD', scene: 'contact' },
  { id: 'taxi', apt: 'EHRD', scene: 'taxi' },
  { id: 'lifeliner', apt: 'EHRD', scene: 'lifeliner' },
  { id: 'vfr', apt: 'EHRD', scene: 'vfr' },
  { id: 'events', apt: 'EHRD', scene: 'events' },
  { id: 'summary', apt: 'EHRD', scene: 'summary' },
  { id: 'montage-EGLC', apt: 'EGLC', scene: 'montage' },
  { id: 'montage-KDCA', apt: 'KDCA', scene: 'montage' },
  { id: 'montage-KSAN', apt: 'KSAN', scene: 'montage' },
];
const want = process.argv.slice(2);
const takes = want.length ? TAKES.filter((t) => want.includes(t.id)) : TAKES;

mkdirSync('public/clips', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });

for (const take of takes) {
  const dir = `frames/${take.id}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error(`[${take.id}] page error:`, e.message));
  // A cold dev server sometimes reloads the page once while it optimises dependencies: retry.
  for (let attempt = 1; ; attempt++) {
    await page.goto(`${BASE}?apt=${take.apt}&demo=${take.scene}`);
    const ok = await page.waitForFunction(() => window.__demo?.ready(), null, { timeout: 30000 }).then(() => true, () => false);
    if (ok) break;
    if (attempt === 3) throw new Error(`[${take.id}] never became ready`);
    console.warn(`[${take.id}] not ready, reloading`);
  }
  await page.waitForFunction(() => window.__demo.mapIdle(), null, { timeout: 60000 }).catch(() => console.warn(`[${take.id}] map slow to load`));
  await page.waitForTimeout(2500); // fonts, logos, first map paint
  const t0 = Date.now();
  for (let n = 0; ; n++) {
    const { done } = await page.evaluate(() => window.__demo.step());
    // Wait for the map to have every tile and for React to commit the frame.
    await page.waitForFunction(() => window.__demo.mapIdle(), null, { timeout: 8000 }).catch(() => console.warn(`[${take.id}] frame ${n}: map not idle`));
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 20)))));
    await page.screenshot({ path: `${dir}/${String(n).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 93 });
    if (n % 60 === 0) process.stdout.write(`\r[${take.id}] ${n} frames, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    if (done) break;
  }
  const result = await page.evaluate(() => window.__demo.result());
  writeFileSync(`public/clips/${take.id}.json`, JSON.stringify(result, null, 1));
  await page.close();
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', `${dir}/%05d.jpg`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', `public/clips/${take.id}.mp4`]);
  console.log(`\r[${take.id}] ${result.frames} frames → public/clips/${take.id}.mp4, ${result.radio.length} radio lines`);
}
await browser.close();

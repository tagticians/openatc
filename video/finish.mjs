// After rendering: loudness to -16 LUFS (web/social standard), and a smaller copy for sharing.
import { execFileSync } from 'node:child_process';
import { renameSync } from 'node:fs';

for (const name of ['rotterdam-approach', 'rotterdam-approach-radio']) {
  const f = `out/${name}.mp4`;
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', f, '-c:v', 'copy', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '192k', `out/${name}.tmp.mp4`]);
  renameSync(`out/${name}.tmp.mp4`, f);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', f, '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-c:a', 'copy', '-movflags', '+faststart', `out/${name}-share.mp4`]);
  console.log(`${f} and out/${name}-share.mp4`);
}

// The edit: which takes, in what order, with which callouts, and where every radio call and
// voiceover line lands. Built from the capture logs (public/clips/*.json) and the voice
// manifest (public/audio/manifest.json).
import manifest from '../public/audio/manifest.json';
import open from '../public/clips/open.json';
import briefing from '../public/clips/briefing.json';
import contact from '../public/clips/contact.json';
import taxi from '../public/clips/taxi.json';
import lifeliner from '../public/clips/lifeliner.json';
import vfr from '../public/clips/vfr.json';
import events from '../public/clips/events.json';
import summary from '../public/clips/summary.json';
import mEGLC from '../public/clips/montage-EGLC.json';
import mKDCA from '../public/clips/montage-KDCA.json';
import mKSAN from '../public/clips/montage-KSAN.json';

export const FPS = 30;
export const FADE = 10; // frames of cross-fade between takes
export const INTRO = 75; // title card
export const OUTRO = 120; // end card

export interface Callout {
  at: number; // seconds into the take (or relative to `on`)
  /** Anchor to the first radio call whose text matches: `at` is then an offset from it. */
  on?: RegExp;
  dur?: number;
  title: string;
  sub?: string;
}

interface TakeDef {
  id: string;
  log: { frames: number; speed: number[] };
  vo?: string;
  callouts: Callout[];
  /** Trim from the start, frames. */
  trim?: number;
  /** Cut the take here (frame in the capture). */
  end?: number;
}

const TAKES: TakeDef[] = [
  { id: 'open', log: open, vo: 'open', callouts: [] },
  {
    id: 'briefing',
    log: briefing,
    vo: 'briefing',
    callouts: [
      { at: 0.6, title: 'Real airports, real procedures', sub: 'SIDs and STARs from the AIP · live METAR' },
      { at: 4.6, title: 'Pick your shift', sub: 'Difficulty, traffic levels and random events' },
    ],
  },
  {
    id: 'contact',
    log: contact,
    vo: 'contact',
    callouts: [
      { at: 1.5, title: 'Every pilot has a voice', sub: 'Accents per airline · natural, clipped readbacks' },
      { on: /proceed direct/, at: -3, title: 'Drag to vector', sub: 'Near a waypoint it snaps to a direct' },
      { on: /descend 3000/, at: -3.2, title: 'Stack instructions', sub: 'Click the chips, send one transmission' },
    ],
  },
  {
    id: 'taxi',
    log: taxi,
    vo: 'taxi',
    callouts: [
      { at: 1.0, title: 'Real stands, real taxiways', sub: 'Routed over the OpenStreetMap ground network' },
      { on: /line up and wait/, at: 0, title: 'Line up and wait', sub: 'From the holding point onto the runway' },
    ],
  },
  {
    id: 'lifeliner',
    log: lifeliner,
    vo: 'lifeliner',
    callouts: [
      { at: 0.8, title: 'Lifeliner 2', sub: 'The trauma helicopter based at Rotterdam' },
      { on: /cleared to lift/, at: 5, title: 'Scene missions', sub: 'Direct to the incident, then on to the trauma centre' },
    ],
  },
  { id: 'vfr', log: vfr, vo: 'vfr', callouts: [{ at: 0.8, title: 'General aviation', sub: 'VFR reporting points, circuit joins, orbits' }] },
  { id: 'events', log: events, vo: 'events', callouts: [{ at: 0.6, title: 'Events', sub: 'Windshear, go-arounds, runway closures, emergencies' }] },
  { id: 'summary', log: summary, vo: 'summary', callouts: [] },
  { id: 'montage-EGLC', log: mEGLC, vo: 'montage', callouts: [{ at: 0.3, dur: 2.6, title: 'London City', sub: '5.5° glide path into the Docklands' }] },
  { id: 'montage-KDCA', log: mKDCA, callouts: [{ at: 0.3, dur: 2.6, title: 'Washington National', sub: 'The River Visual, and P-56 right next door' }] },
  { id: 'montage-KSAN', log: mKSAN, callouts: [{ at: 0.3, dur: 2.6, title: 'San Diego', sub: 'One runway, both directions' }] },
];

export interface PlacedTake extends TakeDef {
  from: number;
  frames: number;
}
export interface PlacedAudio {
  from: number;
  file: string;
  frames: number;
  kind: 'radio' | 'vo';
}

type Manifest = {
  radio: Record<string, { frame: number; play?: number; file: string; duration: number; text: string }[]>;
  vo: Record<string, { file: string; duration: number }>;
};
const M = manifest as Manifest;

export function buildTimeline() {
  const takes: PlacedTake[] = [];
  const radio: PlacedAudio[] = [];
  const vo: PlacedAudio[] = [];
  let at = INTRO - FADE;
  for (const t of TAKES) {
    const frames = Math.min(t.log.frames, t.end ?? Infinity) - (t.trim ?? 0);
    // Callouts anchored to a radio call land on it, wherever the take's pacing put it.
    const lines = M.radio[t.id] ?? [];
    const callouts = t.callouts.flatMap((c) => {
      if (!c.on) return [c];
      const hit = lines.find((l) => c.on!.test(l.text));
      return hit ? [{ ...c, at: Math.max(0.3, ((hit.play ?? hit.frame) - (t.trim ?? 0)) / FPS + c.at) }] : [];
    });
    takes.push({ ...t, callouts, from: at, frames });
    // Radio: in order, never overlapping (one frequency), within the take.
    let free = 0;
    for (const line of M.radio[t.id] ?? []) {
      // The capture already queued calls on one frequency (play); keep them from overlapping anyway.
      const start = Math.max((line.play ?? line.frame) - (t.trim ?? 0), free);
      const len = Math.ceil(line.duration * FPS);
      if (start + len > frames + FPS) break; // would run past the take
      radio.push({ from: at + start, file: line.file, frames: len, kind: 'radio' });
      free = start + len + 6;
    }
    if (t.vo && M.vo[t.vo]) vo.push({ from: at + 8, file: M.vo[t.vo].file, frames: Math.ceil(M.vo[t.vo].duration * FPS), kind: 'vo' });
    at += frames - FADE;
  }
  const outroFrom = at;
  if (M.vo.end) vo.push({ from: outroFrom + 15, file: M.vo.end.file, frames: Math.ceil(M.vo.end.duration * FPS), kind: 'vo' });
  return { takes, radio, vo, outroFrom, total: outroFrom + OUTRO };
}

/** Time-lapse factor at a frame of a take (1 = real time). */
export const speedAt = (t: PlacedTake, f: number) => t.log.speed[Math.min(t.log.speed.length - 1, f + (t.trim ?? 0))] ?? 1;

// Shift results kept in this browser: best score per airport and difficulty.
import type { Difficulty, Score } from '../sim/sim';

export interface ShiftRecord {
  points: number;
  landed: number;
  departed: number;
  minutes: number;
  date: string;
}

const KEY = 'atc.best';

function load(): Record<string, ShiftRecord> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

export const bestFor = (icao: string, d: Difficulty): ShiftRecord | null => load()[`${icao}:${d}`] ?? null;

/** Store the shift if it beats the best; returns the previous best (null if none). */
export function recordShift(icao: string, d: Difficulty, score: Score, minutes: number) {
  const all = load();
  const k = `${icao}:${d}`;
  const prev = all[k] ?? null;
  if (!prev || score.points > prev.points) {
    all[k] = { points: score.points, landed: score.landed, departed: score.departed, minutes: Math.round(minutes), date: new Date().toISOString().slice(0, 10) };
    try {
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch {
      /* storage unavailable: nothing kept */
    }
  }
  return prev;
}

export const DIFFICULTY: Record<Difficulty, { label: string; rate: number; events: 'off' | 'occasional' | 'frequent'; note: string }> = {
  trainee: { label: 'Trainee', rate: 0.6, events: 'off', note: 'Lighter traffic, no surprises' },
  standard: { label: 'Standard', rate: 1, events: 'off', note: 'A normal shift' },
  busy: { label: 'Busy', rate: 1.35, events: 'occasional', note: 'Peak traffic, things go wrong' },
};

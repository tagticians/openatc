// Shared drawing helpers and palette for the scope layers.
import type { Graphics } from 'pixi.js';
import type { Sim } from '../sim/sim';
import type { Projector } from './projection';

export const C = {
  arr: 0x5fd4ff,
  dep: 0x6dffa8,
  pending: 0x6f8aa6,
  selected: 0xffffff,
  alert: 0xff4d5e,
  stca: 0xffb020,
  ring: 0x223a58,
  airspace: 0x2c5681,
  ctr: 0x4a84c8,
  fix: 0x7391b0,
  star: 0x9478f0,
  sid: 0x3bb898,
  runway: 0xe4eefa,
  centerline: 0x8fb3d9,
  route: 0xffd166,
  history: 0x5fd4ff,
  live: 0x7a8fa8,
  ai: 0x5f9e86,
  vfr: 0xe0b45c,
  hems: 0xff6fae,
};

export const MONO = 'JetBrains Mono, ui-monospace, monospace';

export interface ScopeOptions {
  showStars: boolean;
  showSids: boolean;
  showFixes: boolean;
  showAirspace: boolean;
  showLive: boolean;
  showMva?: boolean;
  speedVector: number; // minutes
}

/** What every layer reads each frame. */
export interface ScopeCtx {
  sim: Sim;
  proj: Projector;
  opts: ScopeOptions;
  /** Seconds since the scope started (blinking). */
  t: number;
  hoverId: string | null;
}

type Pt = { x: number; y: number };

export function polyline(g: Graphics, pts: Pt[], close = false) {
  if (pts.length < 2) return;
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  if (close) g.closePath();
}

export function dashed(g: Graphics, a: Pt, b: Pt, dash = 6, gap = 5) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  for (let d = 0; d < len; d += dash + gap) {
    const e = Math.min(len, d + dash);
    g.moveTo(a.x + ux * d, a.y + uy * d).lineTo(a.x + ux * e, a.y + uy * e);
  }
}

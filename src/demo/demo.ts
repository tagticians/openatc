// Demo mode (?demo=<scene>): the game runs frame by frame under the control of a scripted
// director instead of real time, so a video capture (video/capture.mjs) gets identical,
// smooth takes. Nothing here runs in normal play.
import type { Map as MapboxMap } from 'mapbox-gl';
import type { Sim } from '../sim/sim';
import type { ScopeRenderer } from '../scope/ScopeRenderer';

const q = new URLSearchParams(window.location.search);
/** The scene being filmed, or null in normal play. */
export const DEMO: string | null = import.meta.env.DEV ? q.get('demo') : null;
export const FPS = 30;

/** Video clock (seconds since the take started), used instead of performance.now() in demo mode. */
let videoTime = 0;
export const demoNow = () => (DEMO ? videoTime * 1000 : performance.now());

export interface RadioEvent {
  frame: number;
  from: string;
  callsign?: string;
  spoken?: string;
  text: string;
  speech?: string;
  /** Frame the call is heard: one frequency, so calls queue behind each other. */
  play?: number;
  /** Seconds of airtime (the voiced clip, or an estimate). */
  airtime?: number;
}

export interface DemoHooks {
  sim: Sim;
  renderer: ScopeRenderer;
  map: MapboxMap | null;
  /** Draw the scope once (set by Scope). */
  draw: (() => void) | null;
  /** App-level actions the director can ask for. */
  showSummary: () => void;
}

export const hooks: Partial<DemoHooks> = {};

// ------------------------------------------------------------------ cursor overlay
let cursorEl: HTMLDivElement | null = null;
let rippleEl: HTMLDivElement | null = null;
function ensureCursor() {
  if (cursorEl) return;
  cursorEl = document.createElement('div');
  cursorEl.className = 'demo-cursor';
  cursorEl.innerHTML =
    '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2 L4 19 L8.6 14.8 L11.6 21.6 L14.4 20.4 L11.4 13.7 L17.6 13.7 Z" fill="#fff" stroke="#05080e" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  rippleEl = document.createElement('div');
  rippleEl.className = 'demo-ripple';
  document.body.append(rippleEl, cursorEl);
}

export const cursor = { x: -100, y: -100, visible: false };
let anim: { fx: number; fy: number; tx: number; ty: number; t0: number; dur: number } | null = null;
let ripple: { x: number; y: number; t0: number } | null = null;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Glide the cursor to a page position over `dur` seconds. */
export function moveCursor(x: number, y: number, dur = 0.7) {
  ensureCursor();
  if (!cursor.visible) {
    cursor.visible = true;
    cursor.x = x + 160;
    cursor.y = y + 120;
  }
  anim = { fx: cursor.x, fy: cursor.y, tx: x, ty: y, t0: videoTime, dur };
}

/** Put the cursor somewhere at once (for drags that follow something every frame). */
export function setCursor(x: number, y: number) {
  ensureCursor();
  cursor.visible = true;
  cursor.x = x;
  cursor.y = y;
  anim = null;
}

export function clickEffect() {
  ripple = { x: cursor.x, y: cursor.y, t0: videoTime };
}

function paintCursor() {
  if (!cursorEl || !rippleEl) return;
  if (anim) {
    const k = Math.min(1, (videoTime - anim.t0) / anim.dur);
    const e = ease(k);
    cursor.x = anim.fx + (anim.tx - anim.fx) * e;
    cursor.y = anim.fy + (anim.ty - anim.fy) * e;
    if (k >= 1) anim = null;
  }
  cursorEl.style.display = cursor.visible ? 'block' : 'none';
  cursorEl.style.transform = `translate(${cursor.x - 4}px, ${cursor.y - 2}px)`;
  if (ripple) {
    const k = (videoTime - ripple.t0) / 0.45;
    if (k >= 1) {
      ripple = null;
      rippleEl.style.opacity = '0';
    } else {
      rippleEl.style.opacity = String(0.9 * (1 - k));
      rippleEl.style.transform = `translate(${ripple.x - 22}px, ${ripple.y - 22}px) scale(${0.3 + k * 0.9})`;
    }
  } else rippleEl.style.opacity = '0';
}

// ------------------------------------------------------------------ director
export interface Ctx {
  sim: Sim;
  renderer: ScopeRenderer;
  map: MapboxMap | null;
  t: number;
  frame: number;
}

export interface Cue {
  /** Video second to fire at, or after the condition first holds (plus `delay`). */
  at?: number;
  when?: (c: Ctx) => boolean;
  delay?: number;
  /** A transmission: waits until the frequency is free (nobody talks over a pilot). */
  free?: boolean;
  run: (c: Ctx) => void;
}

export interface Camera {
  center: [number, number]; // lat, lon
  zoom: number;
}

export interface SceneDef {
  /** Seconds of video; a scene may end earlier with `endWhen`. */
  duration: number;
  endWhen?: (c: Ctx) => boolean;
  /** Called once the scope is up, before the first frame. */
  setup?: (c: Ctx) => void;
  /** Sim seconds per video second at time t (1 = real time). */
  speed?: (c: Ctx) => number;
  /** Camera keyframes [video second, camera]; eased between. */
  camera?: [number, Camera][];
  /** Follow a camera function instead of keyframes. */
  cameraFn?: (c: Ctx) => Camera | null;
  cues: Cue[];
  /** Runs every frame before drawing. */
  onFrame?: (c: Ctx) => void;
  /** Stay on the briefing screen (no shift started). */
  briefing?: boolean;
}

const state = {
  frame: 0,
  fired: new Set<number>(),
  armed: new Map<number, number>(),
  radio: [] as RadioEvent[],
  speedLog: [] as number[],
  ended: false,
  endAt: null as number | null,
};

function camAt(cams: [number, Camera][], t: number): Camera {
  if (t <= cams[0][0]) return cams[0][1];
  for (let i = 1; i < cams.length; i++) {
    const [t1, c1] = cams[i];
    const [t0, c0] = cams[i - 1];
    if (t <= t1) {
      const k = ease((t - t0) / Math.max(0.001, t1 - t0));
      return {
        center: [c0.center[0] + (c1.center[0] - c0.center[0]) * k, c0.center[1] + (c1.center[1] - c0.center[1]) * k],
        zoom: c0.zoom + (c1.zoom - c0.zoom) * k,
      };
    }
  }
  return cams[cams.length - 1][1];
}

function applyCamera(scene: SceneDef, c: Ctx) {
  const cam = scene.cameraFn?.(c) ?? (scene.camera ? camAt(scene.camera, c.t) : null);
  if (cam && c.map) c.map.jumpTo({ center: [cam.center[1], cam.center[0]], zoom: cam.zoom });
}

let scene: SceneDef | null = null;

function ctx(): Ctx {
  return { sim: hooks.sim!, renderer: hooks.renderer!, map: hooks.map ?? null, t: videoTime, frame: state.frame };
}

function startDirector(def: SceneDef) {
  scene = def;
  hooks.sim?.onRadio((m) => {
    const ev: RadioEvent = { frame: state.frame, from: m.from, callsign: m.callsign, spoken: hooks.sim?.aircraft.find((a) => a.callsign === m.callsign)?.spoken, text: m.text, speech: m.speech };
    if (m.from === 'pilot' || m.from === 'atc') {
      // Airtime from the voiced clip when we have it (video/voices.ts), else a speaking-rate estimate.
      const airtime = voice[`${m.from}|${m.text}`] ?? 0.4 + (m.speech ?? m.text).length / 16;
      const start = Math.max(videoTime, airUntil + 0.25);
      airUntil = start + airtime;
      ev.play = Math.round(start * FPS);
      ev.airtime = airtime;
    }
    state.radio.push(ev);
  });
}

/** Voiced clip lengths by "from|text", written by video/voices.ts. */
let voice: Record<string, number> = {};
let voiceLoaded = false;
/** The frequency is in use until this video second. */
let airUntil = 0;
/** Someone is talking (or just finished, within `tail` seconds). */
export const radioBusy = (tail = 0) => videoTime < airUntil + tail;

let pending: SceneDef | null = null;
/** Called by the app at boot with the scene to film. */
export function prepareDemo(def: SceneDef) {
  pending = def;
  exposeApi();
  fetch('/demo-voice.json')
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}))
    .then((j) => {
      voice = j as Record<string, number>;
      voiceLoaded = true;
    });
  if (def.briefing) startDirector(def);
}
/** Called by the scope once it can draw: set up the traffic and start the take. */
export function onDemoScopeReady() {
  if (!pending || pending.briefing || scene) return;
  if (!voiceLoaded) {
    setTimeout(onDemoScopeReady, 50);
    return;
  }
  pending.setup?.(ctx());
  startDirector(pending);
}

/** Advance the take by one video frame. */
function step() {
  if (!scene || state.ended) return { done: true };
  const c = ctx();
  // Cues
  scene.cues.forEach((cue, i) => {
    if (state.fired.has(i)) return;
    if (cue.free && radioBusy(0.6)) return;
    if (cue.at !== undefined && c.t >= cue.at && !cue.when) {
      state.fired.add(i);
      cue.run(c);
    } else if (cue.when) {
      if (!state.armed.has(i) && (cue.at === undefined || c.t >= cue.at) && cue.when(c)) state.armed.set(i, c.t);
      const armedAt = state.armed.get(i);
      if (armedAt !== undefined && c.t >= armedAt + (cue.delay ?? 0)) {
        state.fired.add(i);
        cue.run(c);
      }
    }
  });
  // Simulation
  // Time-lapse only while the frequency is quiet: every call is heard in real time.
  const want = scene.briefing ? 0 : (scene.speed?.(c) ?? 1);
  const speed = radioBusy(0.5) ? Math.min(want, 1) : want;
  state.speedLog.push(speed);
  if (!scene.briefing && speed > 0) {
    // Several small steps for big time-lapses keep the sim's own 2 s step cap out of the way.
    let left = speed / FPS;
    while (left > 1e-6) {
      const dt = Math.min(1.5, left);
      c.sim.tick(dt);
      left -= dt;
    }
  }
  applyCamera(scene, c);
  scene.onFrame?.(ctx());
  hooks.draw?.();
  paintCursor();
  videoTime += 1 / FPS;
  state.frame++;
  if (state.endAt === null && scene.endWhen?.(ctx())) state.endAt = videoTime + 1.5;
  if (videoTime >= scene.duration || (state.endAt !== null && videoTime >= state.endAt)) state.ended = true;
  return { done: state.ended };
}

/** Everything the capture script needs, on window.__demo. */
export function exposeApi() {
  const w = window as unknown as Record<string, unknown>;
  w.__demo = {
    step,
    frame: () => state.frame,
    /** True once the map has every tile for the current view. */
    mapIdle: () => !hooks.map || (hooks.map.isStyleLoaded() && hooks.map.areTilesLoaded()),
    ready: () => voiceLoaded && !!scene && (scene.briefing || (!!hooks.draw && !!hooks.sim?.started)),
    result: () => ({ radio: state.radio, speed: state.speedLog, frames: state.frame, fps: FPS }),
  };
}

// ------------------------------------------------------------------ helpers for scenes
/** Has a radio or system message matching this been heard in the take so far? */
export const heard = (re: RegExp) => state.radio.some((m) => re.test(m.text));

/** Page position of an element found by selector and (optionally) its text. */
export function elementPos(selector: string, text?: string | RegExp): { x: number; y: number; el: HTMLElement } | null {
  const els = [...document.querySelectorAll<HTMLElement>(selector)];
  const el = text === undefined ? els[0] : els.find((e) => (typeof text === 'string' ? e.textContent?.trim().startsWith(text) : text.test(e.textContent ?? '')));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, el };
}

/** Page position of a scope point (NM from the airport). */
export function scopePos(p: { x: number; y: number }) {
  const r = hooks.renderer!;
  const s = r.proj.nm(p);
  const host = r.app.canvas.getBoundingClientRect();
  return { x: host.left + s.x, y: host.top + s.y };
}

/** Glide to a UI element; returns a cue pair (move, then click) helper. */
export function clickOn(selector: string, text: string | RegExp | undefined, at: number, glide = 0.7): Cue[] {
  return [
    {
      at,
      run: () => {
        const p = elementPos(selector, text);
        if (p) moveCursor(p.x, p.y, glide);
      },
    },
    {
      at: at + glide + 0.15,
      run: () => {
        const p = elementPos(selector, text);
        clickEffect();
        p?.el.click();
      },
    },
  ];
}


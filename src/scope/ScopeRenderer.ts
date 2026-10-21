// Radar scope renderer: PixiJS overlay drawn in screen space over the Mapbox base map.
// The drawing lives in layers (scope/layers/*); this class owns the Pixi app, the frame loop
// and the public API the scope component uses.
import { Application } from 'pixi.js';
import { APT } from '../data/airport';
import { toNM, type Vec } from '../sim/geo';
import type { Sim } from '../sim/sim';
import { Projector } from './projection';
import { C, type ScopeCtx, type ScopeOptions } from './draw';
import { MapLayer } from './layers/map';
import { LiveLayer } from './layers/live';
import { TrafficLayer } from './layers/traffic';
import { OverlayLayer } from './layers/overlay';

export { C };
export type { ScopeOptions };

export class ScopeRenderer implements ScopeCtx {
  app = new Application();
  proj = new Projector();
  opts: ScopeOptions = { showStars: true, showSids: false, showFixes: true, showAirspace: true, showLive: true, showMva: true, speedVector: 1 };
  t = 0;
  hoverId: string | null = null;
  ready = false;

  private map = new MapLayer(this);
  private live = new LiveLayer(this);
  private traffic = new TrafficLayer(this);
  private overlay = new OverlayLayer(this);

  constructor(public sim: Sim) {}

  async init(host: HTMLElement) {
    // A remount (e.g. hot reload) gets fresh Pixi objects; destroyed ones cannot be reused.
    this.app = new Application();
    this.map = new MapLayer(this);
    this.live = new LiveLayer(this);
    this.traffic = new TrafficLayer(this);
    this.overlay = new OverlayLayer(this);
    await this.app.init({
      resizeTo: host,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
    });
    this.app.canvas.style.position = 'absolute';
    this.app.canvas.style.inset = '0';
    this.app.canvas.style.pointerEvents = 'none';
    host.appendChild(this.app.canvas);
    // We drive rendering ourselves (one render per frame, also from the hidden-tab fallback).
    this.app.ticker.stop();

    for (const l of [this.map, this.live, this.traffic, this.overlay]) l.init();
    this.app.stage.addChild(this.map.root, this.live.root, this.traffic.glow, this.traffic.root, this.traffic.tagLayer, this.overlay.root);
    this.ready = true;
  }

  destroy() {
    this.ready = false;
    this.app.destroy(true, { children: true });
  }

  setDrag(d: { from: Vec; to: Vec; label: string; snap?: boolean } | null) {
    this.overlay.dragLine = d;
  }
  setHover(id: string | null) {
    this.hoverId = id;
  }
  /** Range and bearing line (Shift-drag on the scope). */
  setRbl(r: { from: Vec; to: Vec; fromId?: string; toId?: string } | null) {
    this.overlay.rbl = r;
  }

  // ---------------------------------------------------------------- frame
  render(dtMs: number) {
    if (!this.ready) return;
    this.t += dtMs / 1000;
    this.map.draw();
    this.live.draw();
    this.traffic.draw();
    this.overlay.draw();
    this.app.render();
  }

  // ---------------------------------------------------------------- hit testing
  hitTest(px: number, py: number, radius = 14): string | null {
    return this.traffic.hitTest(px, py, radius);
  }
  hitTag(px: number, py: number): string | null {
    return this.traffic.hitTag(px, py);
  }

  /** Nearest labelled fix within `radius` px (route fixes of `extra` count too). */
  hitFix(px: number, py: number, radius = 10, extra: string[] = []): string | null {
    let best: string | null = null;
    let bd = radius;
    for (const name of new Set([...APT.scopeFixes, ...extra])) {
      if (!APT.fixes[name] || name.startsWith('THR')) continue;
      const p = this.proj.ll(APT.fixes[name]);
      const d = Math.hypot(p.x - px, p.y - py);
      if (d < bd) {
        bd = d;
        best = name;
      }
    }
    return best;
  }
}

export { toNM };

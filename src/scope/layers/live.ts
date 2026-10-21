// Live ADS-B layer: dim, uncontrolled background targets.
import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { fromBearing } from '../../sim/geo';
import { C, MONO, type ScopeCtx } from '../draw';

export class LiveLayer {
  root = new Container();
  private g = new Graphics();
  private liveTags = new Map<string, Text>();

  constructor(private r: ScopeCtx) {}
  private get sim() {
    return this.r.sim;
  }
  private get proj() {
    return this.r.proj;
  }
  private get opts() {
    return this.r.opts;
  }

  init() {
    this.root.addChild(this.g);
  }

  /** Live ADS-B traffic: dim, uncontrolled background targets. */
  draw() {
    const g = this.g;
    const P = this.proj;
    g.clear();
    const seen = new Set<string>();
    if (this.opts.showLive) {
      const col = C.live;
      for (const l of this.sim.live) {
        const p = P.nm(l.radar);
        if (p.x < -50 || p.y < -50 || p.x > P.view.w + 50 || p.y > P.view.h + 50) continue;
        seen.add(l.hex);
        l.history.forEach((h, i) => {
          const hp = P.nm(h);
          g.circle(hp.x, hp.y, 1.2).fill({ color: col, alpha: 0.35 - i * 0.07 });
        });
        const v = P.nm(fromBearing(l.radar, l.track, l.gs / 60));
        g.moveTo(p.x, p.y).lineTo(v.x, v.y).stroke({ width: 1, color: col, alpha: 0.45 });
        g.moveTo(p.x - 3.5, p.y).lineTo(p.x + 3.5, p.y).moveTo(p.x, p.y - 3.5).lineTo(p.x, p.y + 3.5).stroke({ width: 1.3, color: col, alpha: 0.75 });
        let t = this.liveTags.get(l.hex);
        if (!t) {
          t = new Text({ text: '', style: new TextStyle({ fontFamily: MONO, fontSize: 9.5, fill: col, lineHeight: 11 }) });
          t.resolution = 2;
          t.alpha = 0.7;
          this.root.addChild(t);
          this.liveTags.set(l.hex, t);
        }
        const lvl = String(Math.round(l.alt / 100)).padStart(3, '0');
        const trend = l.vs > 300 ? '↑' : l.vs < -300 ? '↓' : '';
        const str = `${l.callsign}\n${lvl}${trend}`;
        if (t.text !== str) t.text = str;
        t.position.set(p.x + 7, p.y - 18);
      }
    }
    for (const [hex, t] of this.liveTags) {
      if (!seen.has(hex)) {
        t.destroy();
        this.liveTags.delete(hex);
      }
    }
  }
}

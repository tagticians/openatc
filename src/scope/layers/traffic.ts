// Controlled traffic layer: targets with their glow, history, speed vectors and data tags.
import { BlurFilter, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { fromBearing } from '../../sim/geo';
import { onGround, type Aircraft } from '../../sim/types';
import { C, MONO, type ScopeCtx } from '../draw';

interface TagView {
  text: Text;
  fill: number;
  w: number;
  h: number;
  x: number;
  y: number;
}

export class TrafficLayer {
  /** Glow sits under the crisp symbols; tags on top. */
  glow = new Container();
  root = new Container();
  tagLayer = new Container();
  private g = new Graphics();
  private glowG = new Graphics();
  private tags = new Map<string, TagView>();

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
    this.glow.addChild(this.glowG);
    this.glow.filters = [new BlurFilter({ strength: 6, quality: 3 })];
    this.glow.blendMode = 'add';
    this.root.addChild(this.g);
  }

  private colorFor(ac: Aircraft) {
    if (ac.owner === 'ai') return ac.alerts.los ? C.alert : C.ai;
    if (ac.alerts.los || ac.alerts.low || ac.alerts.prohibited || ac.flags.emergency === 'MAYDAY') return C.alert;
    if (ac.alerts.stca || ac.alerts.wake) return C.stca;
    if (!ac.onFrequency) return C.pending;
    if ((ac.category === 'heli')) return C.hems;
    if ((ac.category === 'ga')) return C.vfr;
    return ac.kind === 'arr' ? C.arr : C.dep;
  }

  private tagText(ac: Aircraft) {
    const r = ac.radar;
    const alt = String(Math.max(0, Math.round(r.alt / 100))).padStart(3, '0');
    const trend = r.vs > 300 ? '↑' : r.vs < -300 ? '↓' : ' ';
    const cfl = String(Math.round(ac.cfl / 100)).padStart(3, '0');
    const gs = String(Math.round(r.gs / 10)).padStart(2, '0');
    const em = ac.flags.emergency as string | undefined;
    const l1 = `${ac.callsign}${em ? ` ${em}` : ''}${ac.alerts.prohibited ? ' P-AREA' : ac.alerts.low ? ' LOW' : ac.alerts.los ? ' LOS' : ac.alerts.stca ? ' STCA' : ac.alerts.wake ? ' WAKE' : ''}`;
    const l2 = `${alt}${trend}${ac.gsCaptured ? 'GS ' : cfl}`;
    let l3 = `${gs} ${ac.type.icao}${ac.type.wake === 'H' || ac.type.wake === 'J' ? `/${ac.type.wake}` : ''}`;
    if (ac.kind === 'arr') l3 += ac.landingCleared ? ' CL' : ac.locCaptured ? ' LOC' : ac.approachCleared ? ` I${ac.runway}` : '';
    else l3 += ac.handedOff ? ' HO' : '';
    return `${l1}\n${l2}\n${l3}`;
  }

  draw() {
    const g = this.g;
    const gl = this.glowG;
    const P = this.proj;
    g.clear();
    gl.clear();
    const ppn = P.pxPerNm();
    const seen = new Set<string>();
    const sel = this.sim.selectedId;
    const blink = Math.sin(this.r.t * 8) > 0;

    for (const ac of this.sim.aircraft) {
      if (onGround(ac)) continue;
      seen.add(ac.id);
      const col = this.colorFor(ac);
      const isSel = ac.id === sel;
      // Moving from the holding point onto the runway: drawn where it really is, no trail.
      const lining = this.sim.ground.lineupPos(ac);
      const p = P.nm(lining ?? ac.radar.pos);

      // History trail
      if (!lining)
        ac.history.forEach((h, i) => {
          const hp = P.nm(h);
          g.circle(hp.x, hp.y, Math.max(1.2, 2.5 - i * 0.2)).fill({ color: col, alpha: 0.6 - i * 0.075 });
        });

      // Speed vector (1 min)
      if (!lining) {
        const vEnd = P.nm(fromBearing(ac.radar.pos, ac.radar.track, (ac.radar.gs / 60) * this.opts.speedVector));
        g.moveTo(p.x, p.y).lineTo(vEnd.x, vEnd.y).stroke({ width: 1.3, color: col, alpha: 0.9 });
      }

      // Target symbol: diamond for arrivals, square for departures
      const s = isSel ? 5.5 : 4.5;
      const drawSym = (gg: Graphics, width: number, alpha: number) => {
        if (ac.kind === 'arr') gg.poly([p.x, p.y - s, p.x + s, p.y, p.x, p.y + s, p.x - s, p.y]);
        else gg.rect(p.x - s * 0.85, p.y - s * 0.85, s * 1.7, s * 1.7);
        gg.stroke({ width, color: col, alpha });
      };
      drawSym(gl, isSel ? 4 : 3.2, 1);
      drawSym(g, 1.7, 1);
      if (isSel) {
        gl.circle(p.x, p.y, 13).stroke({ width: 2, color: C.selected, alpha: 0.5 });
        g.circle(p.x, p.y, 13).stroke({ width: 1, color: C.selected, alpha: 0.8 });
      }
      if (ac.alerts.los || (ac.alerts.stca && blink)) {
        gl.circle(p.x, p.y, 16).stroke({ width: 3, color: col, alpha: 0.9 });
        g.circle(p.x, p.y, 16).stroke({ width: 1.5, color: col, alpha: 1 });
      }

      // Tag
      let tag = this.tags.get(ac.id);
      if (!tag) {
        const text = new Text({
          text: '',
          style: new TextStyle({ fontFamily: MONO, fontSize: 11, fill: 0xffffff, lineHeight: 13, fontWeight: '500', letterSpacing: 0.2 }),
        });
        text.resolution = 2;
        this.tagLayer.addChild(text);
        tag = { text, fill: -1, w: 0, h: 0, x: 0, y: 0 };
        this.tags.set(ac.id, tag);
      }
      const str = this.tagText(ac);
      if (tag.text.text !== str) tag.text.text = str;
      const fill = isSel ? C.selected : col;
      if (tag.fill !== fill) {
        tag.text.style.fill = fill;
        tag.fill = fill;
      }
      tag.text.alpha = ac.owner === 'ai' && !isSel ? 0.6 : ac.onFrequency || isSel ? 1 : 0.75;
      const tx = p.x + ac.tagOffset.x;
      const ty = p.y + ac.tagOffset.y;
      tag.text.position.set(tx, ty);
      tag.x = tx;
      tag.y = ty;
      tag.w = tag.text.width;
      tag.h = tag.text.height;
      // Leader line to the tag corner
      const lx = ac.tagOffset.x > 0 ? tx - 2 : tx + tag.w + 2;
      const ly = ty + 7;
      g.moveTo(p.x, p.y).lineTo(lx, ly).stroke({ width: 0.8, color: col, alpha: 0.55 });
      if (isSel || this.r.hoverId === ac.id) {
        g.roundRect(tx - 5, ty - 3, tag.w + 10, tag.h + 6, 4).stroke({ width: 1, color: col, alpha: isSel ? 0.7 : 0.35 });
        g.roundRect(tx - 5, ty - 3, tag.w + 10, tag.h + 6, 4).fill({ color: 0x07101c, alpha: 0.72 });
      }
    }
    for (const [id, tag] of this.tags) {
      if (!seen.has(id)) {
        tag.text.destroy();
        this.tags.delete(id);
      }
    }
    void ppn;
  }

  // ---------------------------------------------------------------- hit testing
  hitTest(px: number, py: number, radius = 14): string | null {
    let best: string | null = null;
    let bd = radius;
    for (const ac of this.sim.aircraft) {
      if (onGround(ac)) continue;
      const p = this.proj.nm(this.sim.ground.lineupPos(ac) ?? ac.radar.pos);
      const d = Math.hypot(p.x - px, p.y - py);
      if (d < bd) {
        bd = d;
        best = ac.id;
      }
      const t = this.tags.get(ac.id);
      if (!best && t && px >= t.x - 4 && px <= t.x + t.w + 4 && py >= t.y - 2 && py <= t.y + t.h + 2) best = ac.id;
    }
    return best;
  }

  hitTag(px: number, py: number): string | null {
    for (const [id, t] of this.tags) {
      if (px >= t.x - 4 && px <= t.x + t.w + 4 && py >= t.y - 2 && py <= t.y + t.h + 2) return id;
    }
    return null;
  }
}

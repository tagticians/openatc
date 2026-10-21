// Static map layer: range rings, MVA sectors, restricted areas, airspace, VFR points and the
// helicopter corridor, procedures, holdings, centrelines, runways and fixes.
import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { APT, type LatLon, type Leg } from '../../data/airport';
import { fromBearing, toNM } from '../../sim/geo';
import { C, MONO, dashed, polyline, type ScopeCtx } from '../draw';

export class MapLayer {
  root = new Container();
  private g = new Graphics();
  private fixText = new Map<string, Text>();
  private ringText: Text[] = [];
  private mvaText: Text[] = [];
  private vfrText: Text[] = [];
  private sceneText = new Text({ text: 'SCENE', style: new TextStyle({ fontFamily: MONO, fontSize: 9, fill: C.hems, letterSpacing: 0.4 }) });

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
    for (const name of APT.scopeFixes) {
      const t = new Text({ text: name, style: new TextStyle({ fontFamily: MONO, fontSize: 10, fill: C.fix, letterSpacing: 0.6 }) });
      t.alpha = 0.8;
      t.resolution = 2;
      this.fixText.set(name, t);
      this.root.addChild(t);
    }
    // VFR reporting points and helipads (their own labels, small and warm-coloured).
    const vfrNames = [...Object.keys(APT.ga?.points ?? {}), ...(APT.ga?.hems ? [APT.ga.hems.base, ...APT.ga.hems.pads].map((p) => p.name) : [])];
    for (const n of vfrNames) {
      const t = new Text({ text: n, style: new TextStyle({ fontFamily: MONO, fontSize: 9, fill: C.vfr, letterSpacing: 0.4 }) });
      t.resolution = 2;
      t.alpha = 0.75;
      this.vfrText.push(t);
      this.root.addChild(t);
    }
    for (const s of APT.mva ?? []) {
      const t = new Text({ text: String(Math.round(s.alt / 100)), style: new TextStyle({ fontFamily: MONO, fontSize: 9, fill: 0x8a6f4a }) });
      t.resolution = 2;
      t.anchor.set(0.5);
      this.mvaText.push(t);
      this.root.addChild(t);
    }
    for (let i = 0; i < 6; i++) {
      const t = new Text({ text: `${(i + 1) * 10}`, style: new TextStyle({ fontFamily: MONO, fontSize: 9, fill: C.ring }) });
      t.resolution = 2;
      this.ringText.push(t);
      this.root.addChild(t);
    }
    this.sceneText.resolution = 2;
    this.sceneText.visible = false;
    this.root.addChild(this.sceneText);
  }

  private procLines(legs: Leg[], startLL?: LatLon) {
    const pts: { x: number; y: number }[] = [];
    if (startLL) pts.push(this.proj.ll(startLL));
    for (const l of legs) if (l.t === 'FIX' && APT.fixes[l.fix]) pts.push(this.proj.ll(APT.fixes[l.fix]));
    return pts;
  }

  draw() {
    const g = this.g;
    const P = this.proj;
    g.clear();
    const ppn = P.pxPerNm();
    const arp = P.nm({ x: 0, y: 0 });

    // Range rings, 10 NM
    for (let i = 1; i <= 6; i++) {
      const r = i * 10 * ppn;
      g.circle(arp.x, arp.y, r).stroke({ width: 1, color: C.ring, alpha: i % 2 === 0 ? 0.5 : 0.3 });
      const lt = this.ringText[i - 1];
      lt.position.set(arp.x + r * 0.7071 + 3, arp.y - r * 0.7071 - 12);
      lt.alpha = 0.6;
    }
    // Compass ticks on the 40 NM ring
    for (let a = 0; a < 360; a += 10) {
      const p1 = P.nm(fromBearing({ x: 0, y: 0 }, a + 2, 40));
      const p2 = P.nm(fromBearing({ x: 0, y: 0 }, a + 2, a % 30 === 0 ? 41.5 : 40.7));
      g.moveTo(p1.x, p1.y).lineTo(p2.x, p2.y);
    }
    g.stroke({ width: 1, color: C.ring, alpha: 0.5 });

    // Minimum vectoring altitude sectors (hundreds of feet), drawn faintly under everything.
    const mvaOn = !!this.opts.showMva && !!APT.mva;
    (APT.mva ?? []).forEach((s, i) => {
      const t = this.mvaText[i];
      if (!t) return;
      t.visible = mvaOn;
      if (!mvaOn) return;
      const pts = s.polygon.map((ll) => P.ll(ll));
      polyline(g, pts, true);
      g.stroke({ width: 0.8, color: 0x6b5638, alpha: 0.4 });
      // Label at the vertex average, nudged inside: good enough for these mostly convex sectors.
      const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
      const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      t.position.set(cx, cy);
      t.alpha = 0.75;
    });

    // Prohibited and restricted areas
    for (const a of APT.restricted ?? []) {
      const pts = a.polygon.map((ll) => P.ll(ll));
      polyline(g, pts, true);
      g.stroke({ width: a.cls === 'P' ? 1.4 : 1, color: C.alert, alpha: a.cls === 'P' ? 0.8 : 0.4 });
      g.poly(pts.flatMap((p) => [p.x, p.y])).fill({ color: C.alert, alpha: a.cls === 'P' ? 0.1 : 0.04 });
    }

    // Airspace
    if (this.opts.showAirspace) {
      for (const a of APT.airspace) {
        const pts = a.polygon.map((ll) => P.ll(ll));
        const ctr = a.name.includes('CTR');
        polyline(g, pts, true);
        g.stroke({ width: ctr ? 1.4 : 1, color: ctr ? C.ctr : C.airspace, alpha: ctr ? 0.75 : 0.45 });
        if (ctr) {
          g.poly(pts.flatMap((p) => [p.x, p.y])).fill({ color: C.ctr, alpha: 0.04 });
        }
      }
    }

    // VFR reporting points (diamonds), the helicopter corridor and helipads.
    if (APT.ga) {
      const names = Object.keys(APT.ga.points);
      names.forEach((n, i) => {
        const p = P.ll(APT.ga!.points[n]);
        g.moveTo(p.x, p.y - 4).lineTo(p.x + 4, p.y).lineTo(p.x, p.y + 4).lineTo(p.x - 4, p.y).closePath();
        g.stroke({ width: 1, color: C.vfr, alpha: 0.7 });
        this.vfrText[i]?.position.set(p.x + 6, p.y - 5);
      });
      const h = APT.ga.hems;
      if (h) {
        const pts = Object.values(h.corridor.points).map((ll) => P.ll(ll));
        for (let i = 1; i < pts.length; i++) dashed(g, pts[i - 1], pts[i], 5, 4);
        g.stroke({ width: 1.2, color: C.hems, alpha: 0.35 });
        [h.base, ...h.pads].forEach((pad, i) => {
          const p = P.ll(pad.pos);
          g.circle(p.x, p.y, 5).stroke({ width: 1.2, color: C.hems, alpha: 0.85 });
          g.moveTo(p.x - 2, p.y - 3).lineTo(p.x - 2, p.y + 3).moveTo(p.x + 2, p.y - 3).lineTo(p.x + 2, p.y + 3).moveTo(p.x - 2, p.y).lineTo(p.x + 2, p.y);
          g.stroke({ width: 1, color: C.hems, alpha: 0.85 });
          this.vfrText[names.length + i]?.position.set(p.x + 7, p.y - 5);
        });
      }
      // The current accident scene: a pulsing cross while the helicopter is on a scene mission.
      const scene = this.r.sim.hems.scenery()?.scene;
      this.sceneText.visible = !!scene;
      if (scene) {
        const p = P.ll(scene);
        const r = 6 + 2 * Math.sin(this.r.t * 4);
        g.circle(p.x, p.y, r).stroke({ width: 1.4, color: C.hems, alpha: 0.9 });
        g.moveTo(p.x - 4, p.y).lineTo(p.x + 4, p.y).moveTo(p.x, p.y - 4).lineTo(p.x, p.y + 4);
        g.stroke({ width: 1.6, color: C.hems, alpha: 0.95 });
        this.sceneText.position.set(p.x + 9, p.y - 5);
      }
    }

    // STARs / SIDs
    if (this.opts.showStars) {
      for (const s of APT.stars) {
        const pts = this.procLines(s.legs);
        for (let i = 1; i < pts.length; i++) dashed(g, pts[i - 1], pts[i], 8, 6);
      }
      g.stroke({ width: 1, color: C.star, alpha: 0.34 });
    }
    if (this.opts.showSids) {
      for (const s of APT.sids.filter((s) => s.runway && this.sim.config.dep.includes(s.runway))) {
        const rw = APT.runways[s.runway!];
        const pts = this.procLines(s.legs, rw.end);
        polyline(g, pts);
      }
      g.stroke({ width: 1, color: C.sid, alpha: 0.45 });
    }

    // Holding patterns at the published holding fixes (racetrack, 1-minute legs at ~220 kt).
    for (const [fix, h] of Object.entries(APT.holdings)) {
      if (!APT.fixes[fix]) continue;
      const f = toNM(APT.fixes[fix]);
      const inb = (h.inbound + APT.magVar + 360) % 360;
      const side = h.turn === 'R' ? 90 : -90;
      const len = 3.7;
      const w = 2.2;
      const a0 = fromBearing(f, inb + 180, len); // start of inbound leg
      const b0 = fromBearing(f, inb + side, w);
      const c0 = fromBearing(a0, inb + side, w);
      const pts = [a0, f, b0, c0, a0].map((p) => P.nm(p));
      for (let i = 1; i < pts.length; i++) dashed(g, pts[i - 1], pts[i], 3, 4);
    }
    g.stroke({ width: 1, color: C.star, alpha: 0.28 });

    // Extended centrelines of the landing runways in use, 1 NM ticks to 15 NM
    for (const id of this.sim.config.arr) {
      const active = APT.runways[id];
      const thr = toNM(active.thr);
      const back = (active.trueHdg + 180) % 360;
      const far = P.nm(fromBearing(thr, back, 15));
      const thrPx = P.nm(thr);
      dashed(g, thrPx, far, 4, 4);
      g.stroke({ width: 1, color: C.centerline, alpha: 0.6 });
      // Tick marks keep a fixed on-screen size at every zoom level.
      const ux = Math.cos((back * Math.PI) / 180);
      const uy = Math.sin((back * Math.PI) / 180);
      for (let d = 1; d <= 15; d++) {
        const c = P.nm(fromBearing(thr, back, d));
        const len = d % 5 === 0 ? 9 : 4.5;
        // Screen perpendicular of a course: (cos, sin) of the bearing in screen axes (y down).
        g.moveTo(c.x - ux * len, c.y - uy * len).lineTo(c.x + ux * len, c.y + uy * len);
      }
      g.stroke({ width: 1, color: C.centerline, alpha: 0.7 });
    }

    // Runways (active ones brighter)
    for (const [ra, rb] of APT.strips) {
      const r = APT.runways[ra];
      const a = P.ll(r.thr);
      const b = P.ll(r.end);
      const active = [...this.sim.config.arr, ...this.sim.config.dep].some((x) => x === ra || x === rb);
      // Exaggerated at radar scale, but never wider than about the real runway when zoomed right in.
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: Math.max(active ? 3 : 2, Math.min(ppn * 0.06, 12)), color: C.runway, alpha: active ? 1 : 0.45, cap: 'round' });
    }

    // Fixes
    const showFix = this.opts.showFixes;
    for (const [name, t] of this.fixText) {
      t.visible = showFix;
      if (!showFix) continue;
      const p = P.ll(APT.fixes[name]);
      const s = 4;
      g.poly([p.x, p.y - s, p.x + s * 0.87, p.y + s * 0.5, p.x - s * 0.87, p.y + s * 0.5]);
      t.position.set(p.x + 6, p.y - 5);
    }
    if (showFix) g.stroke({ width: 1, color: C.fix, alpha: 0.8 });
  }
}

// Overlay layer: intent of the selected/hovered aircraft, in-trail spacing, ground movements,
// the range-and-bearing line and the drag line, with a pooled set of labels.
import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { APT, type Leg } from '../../data/airport';
import { fixPos, fromBearing, magToTrue, toNM, type Vec } from '../../sim/geo';
import type { Aircraft } from '../../sim/types';
import { locGeometry, runwayGeom } from '../../sim/flight';
import { wakeNm } from '../../sim/wake';
import { C, MONO, dashed, type ScopeCtx } from '../draw';

export class OverlayLayer {
  root = new Container();
  private g = new Graphics();
  private labels = new Container();
  dragLine: { from: Vec; to: Vec; label: string; snap?: boolean } | null = null;

  constructor(private r: ScopeCtx) {}
  private get sim() {
    return this.r.sim;
  }
  private get proj() {
    return this.r.proj;
  }

  init() {
    this.root.addChild(this.g, this.labels);
  }

  /**
   * In-trail spacing on each final: distance from every arrival to the one ahead, against
   * what it needs (2.5 NM, or the wake minimum behind a heavier aircraft).
   */
  private drawSpacing() {
    const g = this.g;
    const P = this.proj;
    for (const rwy of this.sim.config.arr) {
      const line = this.sim.aircraft
        .filter((a) => a.kind === 'arr' && a.phase === 'airborne' && a.approachCleared && this.sim.sameStrip(a.runway, rwy))
        .map((a) => ({ a, d: a.locCaptured ? locGeometry(a).along : Math.hypot(a.pos.x - runwayGeom(a.runway).thr.x, a.pos.y - runwayGeom(a.runway).thr.y) }))
        .sort((x, y) => x.d - y.d);
      for (let i = 1; i < line.length; i++) {
        const lead = line[i - 1].a;
        const f = line[i].a;
        const gap = Math.hypot(f.radar.pos.x - lead.radar.pos.x, f.radar.pos.y - lead.radar.pos.y);
        const need = Math.max(2.5, wakeNm(lead.type.wake, f.type.wake) ?? 0);
        const color = gap < need ? C.alert : gap < need + 1 ? C.stca : C.dep;
        const a = P.nm(lead.radar.pos);
        const b = P.nm(f.radar.pos);
        dashed(g, a, b, 3, 4);
        g.stroke({ width: 1, color, alpha: 0.55 });
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        this.routeLabel(mx + 6, my + 2, `${gap.toFixed(1)}${need > 2.5 ? `/${need}` : ''}`, color, 0.95);
      }
    }
  }

  /** Ground movements: departures taxiing out and waiting, arrivals taxiing in. */
  private drawGround() {
    const g = this.g;
    const P = this.proj;
    const big = P.pxPerNm() > 28;
    // The selected departure's taxi route, faint, so its way to the runway can be followed.
    const sel = this.sim.selected;
    const ahead = sel && sel.phase === 'taxi' ? this.sim.ground.routeAhead(sel) : null;
    if (ahead && ahead.length > 1) {
      for (let i = 1; i < ahead.length; i++) dashed(g, P.nm(ahead[i - 1]), P.nm(ahead[i]), 3, 3);
      g.stroke({ width: 1.2, color: C.dep, alpha: 0.55 });
    }
    for (const ac of this.sim.aircraft) {
      const pos = this.sim.groundPos(ac);
      if (!pos) continue;
      const p = P.nm(pos);
      const sel = ac.id === this.sim.selectedId;
      const col = (ac.category === 'heli') ? C.hems : (ac.category === 'ga') ? C.vfr : C.dep;
      g.circle(p.x, p.y, sel ? 3.5 : 2.5).fill({ color: col, alpha: ac.phase === 'ready' ? 0.95 : ac.phase === 'stand' ? 0.35 : 0.6 });
      if (big || sel || (ac.category === 'heli')) this.routeLabel(p.x + 5, p.y - 5, (ac.category === 'heli') ? `${ac.callsign} (pad)` : ac.callsign, col, sel ? 1 : 0.8);
    }
    for (const t of this.sim.taxiIn) {
      const pos = this.sim.ground.taxiInPos(t);
      if (!pos) continue;
      const p = P.nm(pos);
      g.circle(p.x, p.y, 2.5).fill({ color: C.arr, alpha: 0.6 });
      if (big) this.routeLabel(p.x + 5, p.y - 5, t.callsign, C.arr, 0.6);
    }
  }

  /** Range and bearing line (Shift-drag on the scope). */
  rbl: { from: Vec; to: Vec; fromId?: string; toId?: string } | null = null;
  private drawRbl() {
    if (!this.rbl) return;
    const find = (id?: string) => (id ? this.sim.aircraft.find((a) => a.id === id) : undefined);
    const fa = find(this.rbl.fromId);
    const ta = find(this.rbl.toId);
    const from = fa ? fa.radar.pos : this.rbl.from;
    const to = ta ? ta.radar.pos : this.rbl.to;
    const a = this.proj.nm(from);
    const b = this.proj.nm(to);
    const g = this.g;
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1.2, color: 0xffffff, alpha: 0.8 });
    g.circle(b.x, b.y, 2.5).fill({ color: 0xffffff });
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const nm = Math.hypot(dx, dy);
    const brg = Math.round(((Math.atan2(dx, dy) * 180) / Math.PI - APT.magVar + 720) % 360) || 360;
    const gs = fa?.radar.gs ?? 0;
    const time = gs > 30 ? ` · ${Math.floor((nm / gs) * 60)}:${String(Math.round(((nm / gs) * 3600) % 60)).padStart(2, '0')}` : '';
    this.routeLabel((a.x + b.x) / 2 + 8, (a.y + b.y) / 2 - 14, `${String(brg).padStart(3, '0')}° ${nm.toFixed(1)} NM${time}`, 0xffffff, 0.95);
  }

  private routeLabelPool: Text[] = [];
  private routeLabelUsed = 0;

  private routeLabel(x: number, y: number, str: string, color: number, alpha: number) {
    let t = this.routeLabelPool[this.routeLabelUsed];
    if (!t) {
      t = new Text({ text: '', style: new TextStyle({ fontFamily: MONO, fontSize: 10, fill: 0xffffff, fontWeight: '500' }) });
      t.resolution = 2;
      this.labels.addChild(t);
      this.routeLabelPool.push(t);
    }
    this.routeLabelUsed++;
    if (t.text !== str) t.text = str;
    t.style.fill = color;
    t.alpha = alpha;
    t.visible = true;
    t.position.set(x, y);
  }

  /** Filed route, projected path and level-off point for one aircraft. */
  private drawIntent(ac: Aircraft, strong: boolean) {
    const g = this.g;
    const P = this.proj;
    const a = strong ? 0.85 : 0.5;
    const pos = ac.pos;
    const here = P.nm(pos);
    const lat = ac.lateral;
    // A SID that says "heading, expect vectors": draw it like a vector, the route dimmed.
    const cur = lat.mode === 'route' ? ac.route[ac.legIdx] : undefined;
    const vm = cur?.t === 'VM' ? cur : null;

    // Remaining filed route (STAR / SID / approach transition)
    const fixes: { name: string; leg: Leg }[] = [];
    const from = lat.mode === 'route' ? ac.legIdx : lat.mode === 'heading' ? ac.legIdx : ac.route.length;
    for (let i = from; i < ac.route.length; i++) {
      const l = ac.route[i];
      if (l.t === 'FIX') fixes.push({ name: l.fix, leg: l });
    }
    if (fixes.length) {
      const pts = fixes.map((f) => P.nm(fixPos(f.name)));
      const onRoute = lat.mode === 'route' && !vm;
      if (onRoute) dashed(g, here, pts[0], 5, 4);
      for (let i = 1; i < pts.length; i++) dashed(g, pts[i - 1], pts[i], 5, 4);
      g.stroke({ width: strong ? 1.3 : 1, color: C.route, alpha: onRoute ? a : a * 0.45 });
      fixes.forEach((f, i) => {
        const p = pts[i];
        g.circle(p.x, p.y, 2.5).fill({ color: C.route, alpha: onRoute ? a : a * 0.5 });
        if (f.leg.t !== 'FIX') return;
        const c = f.leg.alt;
        const lvl = (ft: number) => (ft > APT.transitionAltitude ? `FL${String(ft / 100).padStart(3, '0')}` : `${ft}`);
        let txt = '';
        if (c?.at) txt = `@${lvl(c.at)}`;
        else if (c?.above && c?.below) txt = `${lvl(c.above)}–${lvl(c.below)}`;
        else if (c?.below) txt = `≤${lvl(c.below)}`;
        else if (c?.above) txt = `≥${lvl(c.above)}`;
        if (f.leg.spd) txt += `${txt ? ' ' : ''}≤${f.leg.spd}kt`;
        if (txt && (strong || onRoute)) this.routeLabel(p.x + 6, p.y + 5, txt, C.route, onRoute ? a : a * 0.6);
      });
    }

    // Projected path on vectors: heading line, plus the localizer intercept if cleared.
    if (lat.mode === 'heading' || vm) {
      // Project the assigned heading (plus the current drift) rather than the mid-turn track.
      const drift = ((ac.track - ac.hdg + 540) % 360) - 180;
      const trk = (magToTrue(vm ? vm.crs : lat.mode === 'heading' ? lat.hdg : 0) + drift + 360) % 360;
      const len = Math.max(8, (ac.gs / 60) * 4); // ~4 minutes
      const end = fromBearing(pos, trk, len);
      const ep = P.nm(end);
      dashed(g, here, ep, 3, 4);
      g.stroke({ width: 1.2, color: C.route, alpha: a });
      if (ac.kind === 'arr') {
        const rw = APT.runways[ac.runway];
        const thr = toNM(rw.thr);
        const crs = rw.trueHdg;
        // Intersect the heading line with the extended centreline (approach side).
        const d1 = { x: Math.sin((trk * Math.PI) / 180), y: Math.cos((trk * Math.PI) / 180) };
        const back = ((crs + 180) * Math.PI) / 180;
        const d2 = { x: Math.sin(back), y: Math.cos(back) };
        const den = d1.x * d2.y - d1.y * d2.x;
        if (Math.abs(den) > 1e-3) {
          const t = ((thr.x - pos.x) * d2.y - (thr.y - pos.y) * d2.x) / den;
          const u = ((thr.x - pos.x) * d1.y - (thr.y - pos.y) * d1.x) / den;
          const angle = Math.abs((((trk - crs) % 360) + 540) % 360 - 180);
          if (t > 0 && t < 40 && u > 1 && u < 25) {
            const ip = P.nm({ x: pos.x + d1.x * t, y: pos.y + d1.y * t });
            const ok = angle <= 45;
            const col = ok ? C.dep : C.stca;
            g.circle(ip.x, ip.y, 5).stroke({ width: 1.5, color: col, alpha: a });
            this.routeLabel(ip.x + 8, ip.y - 14, `joins final ${u.toFixed(1)} NM out · ${Math.round(angle)}° intercept${ok ? '' : ' (too wide: will overshoot)'}`, col, a);
          }
        }
      }
    }
    if (lat.mode === 'hold') {
      const fp = P.nm(fixPos(lat.fix));
      dashed(g, here, fp, 5, 4);
      g.stroke({ width: 1.2, color: C.route, alpha: a });
      this.routeLabel(fp.x + 6, fp.y + 5, `HOLD ${lat.fix}`, C.route, a);
    }

    // Level-off / top-of-descent marker along the current track.
    const dAlt = ac.cfl - ac.alt;
    if (!ac.gsCaptured && Math.abs(dAlt) > 200 && Math.abs(ac.vs) > 300 && Math.sign(dAlt) === Math.sign(ac.vs)) {
      const mins = Math.abs(dAlt / ac.vs);
      if (mins < 8) {
        const lp = P.nm(fromBearing(pos, ac.track, (ac.gs / 60) * mins));
        g.moveTo(lp.x - 5, lp.y).lineTo(lp.x + 5, lp.y).stroke({ width: 2, color: C.route, alpha: a });
        this.routeLabel(lp.x + 7, lp.y - 6, `${String(Math.round(ac.cfl / 100)).padStart(3, '0')}`, C.route, a);
      }
    }
  }

  draw() {
    const g = this.g;
    g.clear();
    this.routeLabelUsed = 0;
    const sel = this.sim.selected;
    const hover = this.r.hoverId && this.r.hoverId !== sel?.id ? this.sim.aircraft.find((a) => a.id === this.r.hoverId) : null;
    if (hover?.phase === 'airborne') this.drawIntent(hover, false);
    if (sel?.phase === 'airborne') this.drawIntent(sel, true);
    this.drawSpacing();
    this.drawGround();
    this.drawRbl();
    const P = this.proj;
    if (this.dragLine) {
      const a = P.nm(this.dragLine.from);
      const b = P.nm(this.dragLine.to);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1.5, color: C.route, alpha: 0.95 });
      if (this.dragLine.snap) {
        // Snapped to a waypoint: ring it, the release means "direct".
        g.circle(b.x, b.y, 9).stroke({ width: 1.5, color: C.route, alpha: 0.95 });
        g.circle(b.x, b.y, 2).fill({ color: C.route });
      } else g.circle(b.x, b.y, 3).fill({ color: C.route });
      this.routeLabel(b.x + 12, b.y - 16, this.dragLine.label, C.route, 1);
    }
    for (let i = this.routeLabelUsed; i < this.routeLabelPool.length; i++) this.routeLabelPool[i].visible = false;
  }
}

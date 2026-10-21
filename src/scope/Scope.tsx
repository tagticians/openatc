import { useEffect, useRef } from 'react';
import { DEMO, demoNow, hooks as demoHooks, onDemoScopeReady } from '../demo/demo';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { APT } from '../data/airport';
import type { Sim } from '../sim/sim';
import { execute, headingTo } from '../sim/commands';
import { mercX, mercY } from './projection';
import { ScopeRenderer } from './ScopeRenderer';
import { draft } from '../ui/draft';
import { fixPos } from '../sim/geo';
import { styleRadarMap } from './mapStyle';

const TOKEN = import.meta.env.MAPBOX_API_KEY as string | undefined;

interface Props {
  sim: Sim;
  renderer: ScopeRenderer;
  mapOpacity: number;
  onCommandResult: (err?: string) => void;
}

export function Scope({ sim, renderer, mapOpacity, onCommandResult }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    const host = hostRef.current!;
    const mapDiv = document.createElement('div');
    mapDiv.className = 'scope-map';
    host.appendChild(mapDiv);

    let map: mapboxgl.Map | null = null;
    const view = { lng: APT.view.center[1], lat: APT.view.center[0], zoom: APT.view.zoom };
    if (TOKEN) {
      mapboxgl.accessToken = TOKEN;
      map = new mapboxgl.Map({
        container: mapDiv,
        style: 'mapbox://styles/mapbox/dark-v11',
        center: [view.lng, view.lat],
        zoom: view.zoom,
        minZoom: 6.5,
        maxZoom: DEMO ? 16 : 13,
        projection: 'mercator',
        dragRotate: false,
        boxZoom: false, // Shift-drag is the range/bearing line
        pitchWithRotate: false,
        touchPitch: false,
        attributionControl: false,
        logoPosition: 'bottom-right',
        fadeDuration: 0,
      });
      map.touchZoomRotate.disableRotation();
      map.keyboard.disable();
      map.on('style.load', () => styleRadarMap(map!));
      map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
      mapRef.current = map;
      if (import.meta.env.DEV) (window as unknown as { __atcMap: unknown }).__atcMap = map;
    }

    let disposed = false;
    let raf = 0;
    let last = performance.now();
    // The simulation clock runs on its own timer so it keeps time even when rendering is throttled.
    let simLast = performance.now();
    // Demo mode: the director steps the sim and draws frame by frame.
    const simTimer = DEMO
      ? 0
      : window.setInterval(() => {
          const now = performance.now();
          sim.tick(Math.min(2, (now - simLast) / 1000));
          simLast = now;
        }, 50);
    let hiddenTimer = 0;
    // The scope can change size without the window resizing (panels, drawers, fonts):
    // keep Mapbox and the Pixi canvas in step with the element itself.
    const ro = new ResizeObserver(() => {
      map?.resize();
      if (renderer.ready) renderer.app.resize();
    });
    ro.observe(host);
    renderer.init(host).then(() => {
      if (disposed) return;
      const draw = (now: number) => {
        const dt = now - last;
        last = now;
        // Use the map canvas's own size so both layers share one frame of reference.
        const mc = map?.getCanvas();
        const w = mc ? mc.clientWidth : host.clientWidth;
        const h = mc ? mc.clientHeight : host.clientHeight;
        if (map) {
          const c = map.getCenter();
          renderer.proj.set({ cx: mercX(c.lng), cy: mercY(c.lat), zoom: map.getZoom(), w, h });
        } else {
          renderer.proj.set({ cx: mercX(view.lng), cy: mercY(view.lat), zoom: view.zoom, w, h });
        }
        renderer.render(dt);
      };
      if (DEMO) {
        demoHooks.map = map;
        demoHooks.renderer = renderer;
        demoHooks.draw = () => draw(demoNow());
        onDemoScopeReady();
        return;
      }
      const frame = (now: number) => {
        draw(now);
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      // Hidden or occluded tabs get no animation frames; keep the scope fresh at 2 Hz.
      hiddenTimer = window.setInterval(() => {
        if (document.hidden) draw(performance.now());
      }, 500);
    });

    // ------------------------------------------------------------ mouse
    // Left click: select aircraft. Right-drag starting on (or near) the selected aircraft:
    // heading vector. Right-drag anywhere else: pan the scope. Right-click on a fix:
    // direct-to. Drag a tag: move it.
    let rightDown: { x: number; y: number; mode: 'vector' | 'pan'; last: { x: number; y: number }; fix?: string | null } | null = null;
    const snapFix = (x: number, y: number) => {
      const route = sim.selected?.route.flatMap((l) => (l.t === 'FIX' ? [l.fix] : [])) ?? [];
      return renderer.hitFix(x, y, 16, route);
    };
    /** Send now, or add to the transmission being composed (Shift, or a draft is open). */
    const issue = (cmd: string, compose: boolean) => {
      if (compose || draft.get().trim()) draft.stage(cmd);
      else onCommandResult(execute(sim, cmd).error);
    };
    let tagDrag: { id: string; sx: number; sy: number; ox: number; oy: number } | null = null;
    // Shift-drag: range/bearing line, anchored to aircraft at either end when started/ended on one.
    let rbl: { fromId?: string; from: { x: number; y: number } } | null = null;
    let rblShown = false;
    const local = (e: MouseEvent) => {
      const r = host.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onDown = (e: MouseEvent) => {
      const p = local(e);
      if (e.button === 0 && e.shiftKey) {
        const id = renderer.hitTest(p.x, p.y) ?? undefined;
        const from = renderer.proj.unproject(p.x, p.y);
        rbl = { fromId: id, from };
        renderer.setRbl({ from, to: from, fromId: id });
        rblShown = true;
        map?.dragPan.disable();
        e.stopPropagation();
        return;
      }
      if (e.button === 0 && rblShown) {
        renderer.setRbl(null);
        rblShown = false;
      }
      if (e.button === 0) {
        const tagId = renderer.hitTag(p.x, p.y);
        if (tagId) {
          const ac = sim.aircraft.find((a) => a.id === tagId)!;
          tagDrag = { id: tagId, sx: p.x, sy: p.y, ox: ac.tagOffset.x, oy: ac.tagOffset.y };
          sim.selectedId = tagId;
          map?.dragPan.disable();
          e.stopPropagation();
        }
      }
      if (e.button === 2) {
        const ac = sim.selected;
        let mode: 'vector' | 'pan' = 'pan';
        if (ac && ac.phase === 'airborne') {
          const sp = renderer.proj.nm(ac.radar.pos);
          const onTag = renderer.hitTag(p.x, p.y) === ac.id;
          if (onTag || Math.hypot(sp.x - p.x, sp.y - p.y) < 36) mode = 'vector';
        }
        rightDown = { ...p, mode, last: p };
      }
    };
    const onMove = (e: MouseEvent) => {
      const p = local(e);
      if (tagDrag) {
        const ac = sim.aircraft.find((a) => a.id === tagDrag!.id);
        if (ac) ac.tagOffset = { x: tagDrag.ox + p.x - tagDrag.sx, y: tagDrag.oy + p.y - tagDrag.sy };
        return;
      }
      if (rbl) {
        const id = renderer.hitTest(p.x, p.y) ?? undefined;
        renderer.setRbl({ from: rbl.from, fromId: rbl.fromId, to: renderer.proj.unproject(p.x, p.y), toId: id !== rbl.fromId ? id : undefined });
        return;
      }
      renderer.setHover(renderer.hitTest(p.x, p.y));
      host.style.cursor = renderer.hitTest(p.x, p.y) ? 'pointer' : '';
      if (rightDown?.mode === 'pan') {
        const dx = p.x - rightDown.last.x;
        const dy = p.y - rightDown.last.y;
        rightDown.last = p;
        if (map) map.panBy([-dx, -dy], { animate: false });
        else {
          const z = 512 * 2 ** view.zoom;
          view.lng -= (dx / z) * 360;
          view.lat += (dy / z) * 360 * Math.cos((view.lat * Math.PI) / 180);
        }
        host.style.cursor = 'grabbing';
        return;
      }
      const ac = sim.selected;
      if (rightDown && ac && ac.phase === 'airborne' && Math.hypot(p.x - rightDown.x, p.y - rightDown.y) > 6) {
        // Near a waypoint the vector snaps to it and becomes "direct"; Alt keeps a raw heading.
        const fix = e.altKey ? null : snapFix(p.x, p.y);
        rightDown.fix = fix;
        if (fix) renderer.setDrag({ from: ac.pos, to: fixPos(fix), label: `DCT ${fix}`, snap: true });
        else {
          const to = renderer.proj.unproject(p.x, p.y);
          renderer.setDrag({ from: ac.pos, to, label: `HDG ${String(headingTo(ac, to)).padStart(3, '0')}` });
        }
      }
    };
    const onUp = (e: MouseEvent) => {
      const p = local(e);
      if (rbl && e.button === 0) {
        rbl = null;
        map?.dragPan.enable();
        return;
      }
      if (tagDrag) {
        const moved = Math.hypot(p.x - tagDrag.sx, p.y - tagDrag.sy) > 3;
        tagDrag = null;
        map?.dragPan.enable();
        if (moved) return;
      }
      if (e.button === 0) {
        const id = renderer.hitTest(p.x, p.y);
        if (id) sim.selectedId = id;
      }
      if (e.button === 2 && rightDown) {
        const ac = sim.selected;
        const dragged = Math.hypot(p.x - rightDown.x, p.y - rightDown.y) > 6;
        const mode = rightDown.mode;
        const snapped = rightDown.fix;
        rightDown = null;
        renderer.setDrag(null);
        host.style.cursor = '';
        if (mode === 'pan' && dragged) return;
        if (!ac) return;
        if (dragged && mode === 'vector' && ac.phase === 'airborne') {
          const to = renderer.proj.unproject(p.x, p.y);
          issue(snapped && !e.altKey ? `DCT ${snapped}` : `H${String(headingTo(ac, to)).padStart(3, '0')}`, e.shiftKey);
        } else {
          const fix = snapFix(p.x, p.y);
          if (fix) issue(`DCT ${fix}`, e.shiftKey);
        }
      }
    };
    // ESC while dragging a heading vector: cancel it, transmit nothing, keep the selection.
    const onKeyCapture = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && rblShown && !rightDown) {
        renderer.setRbl(null);
        rblShown = false;
        rbl = null;
        map?.dragPan.enable();
        return;
      }
      if (e.key !== 'Escape' || !rightDown || rightDown.mode !== 'vector') return;
      e.preventDefault();
      e.stopPropagation();
      rightDown = null;
      renderer.setDrag(null);
      host.style.cursor = '';
    };
    window.addEventListener('keydown', onKeyCapture, true);

    // ------------------------------------------------------------ touch
    // Tap: select (bigger target than the mouse). Drag starting on the selected aircraft: heading
    // vector (snaps to waypoints, like right-drag). Anything else: Mapbox pans and pinch-zooms.
    let touch: { x: number; y: number; vector: boolean; moved: boolean; fix: string | null } | null = null;
    const tLocal = (t: Touch) => {
      const r = host.getBoundingClientRect();
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        touch = null;
        renderer.setDrag(null);
        map?.dragPan.enable();
        return;
      }
      const p = tLocal(e.touches[0]);
      const ac = sim.selected;
      let vector = false;
      if (ac && ac.phase === 'airborne') {
        const sp = renderer.proj.nm(ac.radar.pos);
        vector = Math.hypot(sp.x - p.x, sp.y - p.y) < 40 || renderer.hitTag(p.x, p.y) === ac.id;
      }
      touch = { ...p, vector, moved: false, fix: null };
      if (vector) {
        map?.dragPan.disable();
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!touch || e.touches.length !== 1) return;
      const p = tLocal(e.touches[0]);
      if (Math.hypot(p.x - touch.x, p.y - touch.y) > 10) touch.moved = true;
      const ac = sim.selected;
      if (!touch.vector || !ac || !touch.moved) return;
      e.preventDefault();
      const fix = snapFix(p.x, p.y - 30); // the finger hides the point: aim a little above it
      touch.fix = fix;
      if (fix) renderer.setDrag({ from: ac.pos, to: fixPos(fix), label: `DCT ${fix}`, snap: true });
      else {
        const to = renderer.proj.unproject(p.x, p.y - 30);
        renderer.setDrag({ from: ac.pos, to, label: `HDG ${String(headingTo(ac, to)).padStart(3, '0')}` });
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      const t = touch;
      touch = null;
      map?.dragPan.enable();
      if (!t) return;
      const ac = sim.selected;
      if (t.vector && t.moved && ac && ac.phase === 'airborne') {
        e.preventDefault();
        renderer.setDrag(null);
        const end = e.changedTouches[0] ? tLocal(e.changedTouches[0]) : t;
        const to = renderer.proj.unproject(end.x, end.y - 30);
        issue(t.fix ? `DCT ${t.fix}` : `H${String(headingTo(ac, to)).padStart(3, '0')}`, false);
        return;
      }
      if (!t.moved) {
        const id = renderer.hitTest(t.x, t.y, 26);
        if (id) {
          sim.selectedId = id;
          e.preventDefault(); // no synthetic mouse click on top
        }
      }
    };
    host.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
    host.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    host.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
    const onContext = (e: MouseEvent) => e.preventDefault();
    host.addEventListener('mousedown', onDown, true);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    host.addEventListener('contextmenu', onContext);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      clearInterval(simTimer);
      clearInterval(hiddenTimer);
      ro.disconnect();
      host.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      host.removeEventListener('contextmenu', onContext);
      window.removeEventListener('keydown', onKeyCapture, true);
      host.removeEventListener('touchstart', onTouchStart, true);
      host.removeEventListener('touchmove', onTouchMove, true);
      host.removeEventListener('touchend', onTouchEnd, true);
      renderer.destroy();
      map?.remove();
      mapDiv.remove();
    };
  }, [sim, renderer, onCommandResult]);

  useEffect(() => {
    hostRef.current?.style.setProperty('--map-opacity', String(mapOpacity));
  }, [mapOpacity]);

  return <div ref={hostRef} className="scope" />;
}

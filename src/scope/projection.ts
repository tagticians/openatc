// Web-Mercator projection matching Mapbox GL (512 px tiles, no rotation/pitch),
// so the Pixi overlay lines up exactly with the base map.
import type { LatLon } from '../data/airport';
import { toLatLon, toNM, type Vec } from '../sim/geo';

const D2R = Math.PI / 180;
export const mercX = (lon: number) => (lon + 180) / 360;
export const mercY = (lat: number) => {
  const s = Math.sin(lat * D2R);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};

export interface View {
  cx: number; // mercator
  cy: number;
  zoom: number;
  w: number;
  h: number;
}

export class Projector {
  view: View = { cx: 0.5, cy: 0.5, zoom: 8, w: 1, h: 1 };
  private ws = 512 * 2 ** 8;

  set(v: View) {
    this.view = v;
    this.ws = 512 * 2 ** v.zoom;
  }
  ll(ll: LatLon) {
    return {
      x: (mercX(ll[1]) - this.view.cx) * this.ws + this.view.w / 2,
      y: (mercY(ll[0]) - this.view.cy) * this.ws + this.view.h / 2,
    };
  }
  nm(v: Vec) {
    return this.ll(toLatLon(v));
  }
  /** Screen pixel → local NM frame. */
  unproject(px: number, py: number): Vec {
    const mx = (px - this.view.w / 2) / this.ws + this.view.cx;
    const my = (py - this.view.h / 2) / this.ws + this.view.cy;
    const lon = mx * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180) / Math.PI;
    return toNM([lat, lon]);
  }
  /** Pixels per NM at the current zoom near the airport. */
  pxPerNm() {
    const a = this.nm({ x: 0, y: 0 });
    const b = this.nm({ x: 0, y: 10 });
    return Math.abs(b.y - a.y) / 10;
  }
}

import { AIRLINES } from '../data/traffic';
import { useEffect, useState } from 'react';
import type { Sim } from '../sim/sim';

/** Re-render at most every `ms` while the simulation advances. */
export function useSimTick(sim: Sim, ms = 250) {
  const [, setV] = useState(0);
  useEffect(() => {
    let dirty = false;
    const unsub = sim.subscribe(() => {
      dirty = true;
    });
    const id = setInterval(() => {
      if (dirty) {
        dirty = false;
        setV((v) => v + 1);
      }
    }, ms);
    return () => {
      unsub();
      clearInterval(id);
    };
  }, [sim, ms]);
}

export interface LogoInfo {
  color: string | null;
  icon?: string;
  logo?: string;
}

/** Brand colours from the airline registry (data/airlines.json). */
const brand = (icao: string) => AIRLINES[icao]?.color ?? null;

let logoIndex: Record<string, LogoInfo> | null = null;
let logoPromise: Promise<Record<string, LogoInfo>> | null = null;

export function useLogos() {
  const [idx, setIdx] = useState(logoIndex);
  useEffect(() => {
    if (logoIndex) return;
    logoPromise ??= fetch('/logos/index.json')
      .then((r) => r.json())
      .catch(() => ({}));
    logoPromise.then((j) => {
      for (const k of Object.keys(j)) j[k].color ??= brand(k);
      logoIndex = j;
      setIdx(j);
    });
  }, []);
  return idx ?? {};
}

export const fmtUtc = (t: number) => {
  const d = new Date(t * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
};

/** Logo for an operator: soaring-symbols artwork (MIT) where it exists, else a coloured text badge. */
/**
 * Regional operators that fly in a mainline brand's livery: they show that brand's logo
 * (soaring-symbols has no artwork for most regionals).
 */
const FLIES_AS: Record<string, string> = { CFE: 'BAW', KLC: 'KLM', EDV: 'DAL', QXE: 'ASA', JZA: 'ACA' };

export function logoFor(idx: Record<string, LogoInfo>, icao: string): LogoInfo {
  const own = idx[icao];
  if (own?.icon || own?.logo) return own;
  const parent = FLIES_AS[icao] && idx[FLIES_AS[icao]];
  if (parent && (parent.icon || parent.logo)) return parent;
  return own ?? { color: brand(icao) };
}

/** Hide broken logo images (unknown operators) and let the text badge show instead. */
export const hideOnError = (e: { currentTarget: HTMLImageElement }) => {
  e.currentTarget.style.display = 'none';
  const badge = e.currentTarget.nextElementSibling as HTMLElement | null;
  if (badge) badge.style.display = 'inline';
};

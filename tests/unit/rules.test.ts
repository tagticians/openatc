import { describe, expect, it } from 'vitest';
import { simAt } from './helpers';
import { wakeDepSeconds, wakeNm } from '../../src/sim/wake';
import { APT, inside, mvaAt } from '../../src/data/airport';
import { makeRng } from '../../src/sim/rng';

describe('separation rules', () => {
  it('applies ICAO wake minima', () => {
    expect(wakeNm('H', 'M')).toBe(5);
    expect(wakeNm('J', 'L')).toBe(8);
    expect(wakeNm('M', 'M')).toBeNull();
    expect(wakeDepSeconds('H', 'L')).toBe(120);
  });

  it('reads minimum vectoring altitudes from the FAA chart', () => {
    simAt('KSAN');
    expect(mvaAt(APT.arp)).toBeGreaterThanOrEqual(1500);
    expect(mvaAt([32.75, -116.95])).toBeGreaterThan(3000); // hills east of San Diego
  });

  it('knows where P-56 is', () => {
    simAt('KDCA');
    const p56 = APT.restricted!.find((r) => r.name === 'P-56')!;
    expect(inside([38.8977, -77.0365], p56.polygon)).toBe(true); // the White House
    expect(inside(APT.arp, p56.polygon)).toBe(false);
  });

  it('replays the same random sequence from a seed', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

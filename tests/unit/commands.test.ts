import { describe, expect, it } from 'vitest';
import { simAt } from './helpers';
import { execute } from '../../src/sim/commands';

describe('commands', () => {
  it('vectors, descends and expedites in one transmission', () => {
    const sim = simAt('EHRD', '24');
    const ac = sim.spawnArrival(30);
    ac.onFrequency = true;
    ac.alt = 9000;
    ac.cfl = 9000;
    const r = execute(sim, `${ac.callsign} L240 D50 EXP S210`);
    expect(r.ok).toBe(true);
    expect(ac.lateral).toMatchObject({ mode: 'heading', hdg: 240, turn: 'L' });
    expect(ac.cfl).toBe(5000);
    expect(ac.spd).toBe(210);
    expect(ac.flags.expedite).toBe(true);
  });

  it('refuses an altitude below the minimum vectoring altitude', () => {
    const sim = simAt('KSAN', '27');
    const ac = sim.spawnArrival(40);
    ac.onFrequency = true;
    const r = execute(sim, `${ac.callsign} D20`);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/minimum vectoring altitude/);
  });

  it('rejects unknown instructions with a say-again', () => {
    const sim = simAt('EHRD', '24');
    const ac = sim.spawnArrival(30);
    ac.onFrequency = true;
    expect(execute(sim, `${ac.callsign} FOO`).ok).toBe(false);
  });

  it('clears the helicopter to lift and VFR traffic to join', () => {
    const sim = simAt('EHRD', '24');
    sim.start();
    const heli = sim.hems.spawn('transfer')!;
    heli.onFrequency = true;
    expect(execute(sim, `${heli.callsign} CTO`).ok).toBe(true);
    expect(heli.phase).toBe('airborne');
    const vfr = sim.ga.spawnVfrArrival();
    vfr.onFrequency = true;
    expect(execute(sim, `${vfr.callsign} JOIN`).ok).toBe(true);
    expect(vfr.flags.joined).toBe('DW');
  });
});

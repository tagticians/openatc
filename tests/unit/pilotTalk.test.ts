import { describe, expect, it } from 'vitest';
import { simAt } from './helpers';
import { displayCallsign, flightNumber, readback } from '../../src/sim/pilotTalk';

describe('pilot speech', () => {
  it('groups flight numbers like crews do', () => {
    expect(flightNumber('1234', true)).toBe('twelve thirty-four');
    expect(flightNumber('445', true)).toBe('four forty-five');
    expect(flightNumber('1234', false)).toBe('one two three four');
  });

  it('shows Dutch registrations as PH-ABC', () => {
    expect(displayCallsign('PAPA HOTEL ABC')).toBe('PH-ABC');
    expect(displayCallsign('TRANSAVIA 5123')).toBe('Transavia 5123');
  });

  it('reads back every instruction and ends with the callsign or starts with it', () => {
    simAt('EHRD');
    for (const cs of ['TRA5123', 'KLM1234', 'EZY8401', 'DLH992']) {
      const r = readback('TRANSAVIA 5123', cs, [
        { k: 'heading', hdg: 270, turn: 'L' },
        { k: 'level', ft: 3000, verb: 'descend', qnh: 1013 },
      ]);
      expect(r.text).toMatch(/270/);
      expect(r.text).toMatch(/3000|FL030|thousand/);
      expect(r.text).toMatch(/Transavia 5123/);
      expect(r.speech).toMatch(/two seven zero|two seventy/);
    }
  });

  it('speaks US altimeter and "point" frequencies at an FAA airport', () => {
    simAt('KSAN');
    const r = readback('SOUTHWEST 2143', 'SWA2143', [{ k: 'level', ft: 4000, verb: 'descend', qnh: 2992 }, { k: 'contact', unit: 'San Diego Tower', freq: '118.300' }], 11000);
    expect(r.speech).toMatch(/two niner niner two/);
    expect(r.speech).toMatch(/point three|eighteen three/);
  });
});

import { initialContact, readback, established, goingAround, enteringHold, requestHigher, pilotFor } from '../src/sim/pilotTalk';
const cast = ['KLM1234', 'KLM657', 'BAW420', 'DLH992', 'TRA5123', 'THY1957', 'DAL44', 'AFR1205', 'LOT282', 'QFA1', 'IBE3254', 'SIA324'];
const tele: Record<string, string> = { KLM: 'KLM', BAW: 'SPEEDBIRD', DLH: 'LUFTHANSA', TRA: 'TRANSAVIA', THY: 'TURKISH', DAL: 'DELTA', AFR: 'AIRFRANS', LOT: 'POLLOT', QFA: 'QANTAS', IBE: 'IBERIA', SIA: 'SINGAPORE' };
for (const cs of cast) {
  const spoken = `${tele[cs.slice(0, 3)]} ${cs.slice(3)}`;
  const p = pilotFor(cs);
  console.log(`\n${cs} [${p.style}${p.grouped ? ', grouped' : ''}${p.casual ? ', casual' : ''}]`);
  const a = initialContact({ unit: 'Schiphol Arrival', spoken, callsign: cs, alt: 9400, cfl: 7000, star: 'RKN 2A', atis: 'H', heavy: ['DAL', 'QFA', 'SIA'].includes(cs.slice(0, 3)) });
  console.log('  ', a.speech);
  console.log('  ', readback(spoken, cs, [{ k: 'heading', hdg: 240, turn: 'L' }, { k: 'level', ft: 3000, verb: 'descend', qnh: 1027 }]).speech);
  console.log('  ', readback(spoken, cs, [{ k: 'ils', rwy: '18R' }]).speech);
  console.log('  ', established(spoken, cs, '18R').speech, '|', goingAround(spoken, cs).speech);
}

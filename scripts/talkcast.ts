import { initialContact, readback, pilotFor } from '../src/sim/pilotTalk';
const cast: [string, string, string, string, string][] = [
  // callsign, telephony, voiceId, voice label, origin STAR
  ['KLM1234', 'KLM', 'SVmtrm5iuquj8zKn5ZMg', 'Will · library (round 1 “Dutch”)', 'RKN 2A'],
  ['KLM657', 'KLM', 'TgIvljfrc4ZtKuGsTqVt', 'Designed Dutch captain', 'NORKU 2A'],
  ['BAW420', 'SPEEDBIRD', 'EaCGZNIZYoLgxVzmLOPI', 'David – Airline Captain · British', 'REDFA 1A'],
  ['DLH992', 'LUFTHANSA', 'Jvf6TAXwMUVTSR20U0f9', 'Klaus · German accent', 'RKN 2A'],
  ['TRA5123', 'TRANSAVIA', 'sP3q7DZvU8X3maXCONzw', 'Kim · Dutch', 'DENUT 3A'],
  ['THY1957', 'TURKISH', 'cWzYlIcYTquPCigOQKX0', 'Omer · Turkish', 'RKN 2A'],
  ['DAL44', 'DELTA', 'BK54EYgZPb4sYkI91RFj', 'Nik – Aviation Storyteller · American', 'TOPPA 2A'],
  ['AFR1205', 'AIRFRANS', 'xTZlmU8dKXdyk4XGYGFg', 'Antoine · French', 'HELEN 2A'],
  ['LOT282', 'POLLOT', 'TrFmzBmO31zY93mAN5OF', 'Torpediusz – pilot voice · Polish', 'RKN 2A'],
  ['QFA1', 'QANTAS', 'aGkVQvWUZi16EH8aZJvT', 'Steve · Australian', 'TOPPA 2A'],
  ['IBE3254', 'IBERIA', '86ZLAUcyPNBrbdJKn3u6', 'Chris · Spanish', 'HELEN 2A'],
  ['SIA324', 'SINGAPORE', '6EYhQ5gVgyv1Z20WprFH', 'Adam Faris · Singaporean', 'TOPPA 2A'],
];
const out = cast.map(([cs, tel, voice, label, star]) => {
  const spoken = `${tel} ${cs.slice(3)}`;
  const p = pilotFor(cs);
  const heavy = ['DAL', 'QFA', 'SIA'].includes(cs.slice(0, 3));
  const first = initialContact({ unit: 'Schiphol Arrival', spoken, callsign: cs, alt: 9400, cfl: 7000, star, atis: 'H', heavy });
  const rb = readback(spoken, cs, [{ k: 'heading', hdg: 240, turn: 'L' }, { k: 'level', ft: 3000, verb: 'descend', qnh: 1027 }]);
  return { callsign: cs, voice, label, style: p.style, grouped: p.grouped, lines: [first, rb] };
});
console.log(JSON.stringify(out));

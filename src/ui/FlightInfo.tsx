// The flight at a glance on the command card: type with its wake category, the procedure, and
// the route drawn as origin ── ✈ ── destination, the aeroplane at our end of the line.
import { APT } from '../data/airport';
import { DESTINATIONS } from '../data/traffic';
import { onGround, type Aircraft } from '../sim/types';

/** City (or helipad name) for an ICAO code or pad id; the code itself when unknown. */
function place(code: string): string {
  if (code === APT.icao) return APT.city;
  const pad = APT.ga?.hems && [APT.ga.hems.base, ...APT.ga.hems.pads].find((p) => p.id === code);
  if (pad) return pad.name;
  if (code === 'SCENE') return 'incident';
  return DESTINATIONS[code]?.city ?? '';
}

const WAKE: Record<string, string> = { L: 'Light', M: 'Medium', H: 'Heavy', J: 'Super' };

export function FlightInfo({ ac }: { ac: Aircraft }) {
  const proc = ac.kind === 'arr' ? ac.star?.name : ac.sid?.name;
  const tag = ac.category === 'heli' ? 'HEMS' : ac.category === 'ga' ? 'VFR' : null;
  // Where the aeroplane sits on the line: at the gate, just out, or nearly here.
  const at = ac.kind === 'arr' ? 84 : onGround(ac) ? 2 : 16;
  const end = (code: string, home: boolean, right?: boolean) => (
    <span className={`fi-end${right ? ' r' : ''}${home ? ' home' : ''}`} title={place(code) || code}>
      <b>{code}</b>
      <small>{place(code)}</small>
    </span>
  );
  return (
    <div className={`fi ${ac.kind}`} title={`${ac.operator.name} · ${ac.type.name}`}>
      <div className="fi-tags">
        <span className="fi-type">
          {ac.type.icao}
          <b className={`wake w-${ac.type.wake}`} title={`Wake category: ${WAKE[ac.type.wake] ?? ac.type.wake}`}>
            {ac.type.wake}
          </b>
        </span>
        {proc && <span className="fi-proc">{proc}</span>}
        {tag && <span className="fi-cat">{tag}</span>}
      </div>
      <div className="fi-route">
        {end(ac.origin, ac.origin === APT.icao)}
        <span className="fi-line">
          <svg viewBox="0 0 16 16" style={{ left: `${at}%` }} aria-hidden="true">
            <path d="M15 8 9.6 6.6 6 1.5H4.6l1.9 5H2.8L1.4 4.6H.4l.8 3.4-.8 3.4h1l1.4-1.9h3.7l-1.9 5H6l3.6-5.1z" fill="currentColor" />
          </svg>
        </span>
        {end(ac.dest, ac.dest === APT.icao, true)}
      </div>
    </div>
  );
}

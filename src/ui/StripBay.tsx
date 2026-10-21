import type { Sim } from '../sim/sim';
import { APT, ROLE } from '../data/airport';
import type { Aircraft } from '../sim/types';
import { DESTINATIONS } from '../data/traffic';
import { execute } from '../sim/commands';
import { hideOnError, logoFor, useLogos, type LogoInfo } from './hooks';

interface Props {
  sim: Sim;
  onResult: (err?: string) => void;
}

type BayKey = 'inbound' | 'approach' | 'landing' | 'clearance' | 'pending' | 'holding' | 'departing' | 'outbound';
export type StripSide = 'arr' | 'dep';

const BAYS: { key: BayKey; title: string; hint: string }[] = [
  // Inbound side (left of the scope), in flow order
  { key: 'inbound', title: 'Inbound', hint: 'Arrivals on STARs: descend, vector, clear ILS' },
  { key: 'approach', title: 'Approach', hint: 'Cleared ILS / established' },
  { key: 'landing', title: ROLE === 'arrival' ? 'Transferred to Tower' : 'Landing', hint: ROLE === 'arrival' ? 'Handed to Tower: landing clearance is theirs' : 'On the runway after landing' },
  // Outbound side (right of the scope), in flow order
  { key: 'clearance', title: 'Clearance delivery', hint: 'At the stand requesting IFR clearance and start-up' },
  { key: 'pending', title: 'Taxiing', hint: 'Taxiing to the holding point' },
  { key: 'holding', title: 'Holding point', hint: 'Ready for departure: line up / clear for take-off' },
  { key: 'departing', title: 'Runway', hint: 'Lined up or rolling' },
  { key: 'outbound', title: 'Outbound', hint: 'Departures on SIDs: climb, hand off' },
];

/** Which bays each column shows. At Schiphol (Arrival role) departures belong to AI controllers. */
const SIDE_BAYS: Record<StripSide, BayKey[]> =
  ROLE === 'arrival'
    ? { arr: ['inbound'], dep: ['approach', 'landing'] }
    : { arr: ['inbound', 'approach', 'landing'], dep: ['clearance', 'pending', 'holding', 'departing', 'outbound'] };

function bayOf(a: Aircraft): BayKey {
  if (a.kind === 'arr') {
    if (a.phase === 'rollout' || (ROLE === 'arrival' && a.handedOff)) return 'landing';
    return a.approachCleared ? 'approach' : 'inbound';
  }
  if (a.phase === 'stand') return 'clearance';
  if (a.phase === 'taxi') return 'pending';
  if (a.phase === 'ready') return 'holding';
  if (a.phase === 'lineup' || a.phase === 'takeoff') return 'departing';
  return 'outbound';
}

export function StripBay({ sim, onResult, side }: Props & { side: StripSide }) {
  const logos = useLogos();
  const groups = new Map<BayKey, Aircraft[]>();
  for (const a of sim.aircraft) {
    if (a.owner !== 'player') continue;
    const k = bayOf(a);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(a);
  }
  // Order arrivals by distance to the threshold: the next lander on top.
  groups.get('approach')?.sort((a, b) => sim.distToThreshold(a) - sim.distToThreshold(b));
  groups.get('inbound')?.sort((a, b) => Math.hypot(a.pos.x, a.pos.y) - Math.hypot(b.pos.x, b.pos.y));

  return (
    <aside className={`strips strips-${side}`}>
      <div className="side-title">{side === 'arr' && ROLE !== 'arrival' ? 'Inbound' : side === 'arr' ? 'Stacks' : ROLE === 'arrival' ? 'Final' : 'Outbound'}</div>
      {BAYS.filter((b) => SIDE_BAYS[side].includes(b.key)).map((bay) => {
        const list = groups.get(bay.key) ?? [];
        return (
          <section key={bay.key} className={`bay bay-${bay.key}`}>
            <h3 title={bay.hint}>
              {bay.title}
              <span className={`count ${list.length ? 'has' : ''}`}>{list.length}</span>
            </h3>
            {list.length === 0 && <div className="bay-empty">—</div>}
            {list.map((a) => (
              <Strip key={a.id} a={a} sim={sim} logo={logoFor(logos, a.operator.icao)} onResult={onResult} />
            ))}
          </section>
        );
      })}
    </aside>
  );
}

function Strip({ a, sim, logo, onResult }: { a: Aircraft; sim: Sim; logo?: LogoInfo; onResult: (e?: string) => void }) {
  const selected = sim.selectedId === a.id;
  const other = a.kind === 'arr' ? a.origin : a.dest;
  const city = DESTINATIONS[other]?.city ?? other;
  const proc = a.kind === 'arr' ? a.star?.name : a.sid?.name;
  const cmd = (c: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    sim.selectedId = a.id;
    onResult(execute(sim, c).error);
  };
  const lvl = (ft: number) => (ft > APT.transitionAltitude ? `FL${String(Math.round(ft / 100)).padStart(3, '0')}` : `A${String(Math.round(ft / 100)).padStart(2, '0')}`);
  const status: string[] = [];
  if (a.kind === 'arr') {
    if (a.lateral.mode === 'hold') status.push('HOLD');
    if (a.approachCleared && !a.locCaptured) status.push(`ILS ${a.runway}`);
    if (a.locCaptured) status.push(a.gsCaptured ? 'LOC/GS' : 'LOC');
    if (a.landingCleared) status.push('CLRD LAND');
  } else {
    if (a.phase === 'taxi' && a.flags.taxiEnd) {
      const left = Math.max(0, Math.round((a.flags.taxiEnd as number) - sim.time));
      status.push(`TAXI ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`);
    }
    if (a.phase === 'lineup') status.push('LINED UP');
    if (a.phase === 'takeoff') status.push('ROLLING');
    if (a.handedOff) status.push('HANDED OFF');
  }
  if ((a.category === 'heli')) status.push(a.phase === 'ready' ? 'REQ LIFT' : 'PRIORITY');
  else if ((a.category === 'ga')) status.push(a.flags.joined ? `VFR · ${a.flags.joined === 'DW' ? 'DOWNWIND' : a.flags.joined === 'BASE' ? 'BASE' : 'STRAIGHT-IN'}` : 'VFR');
  if (a.flags.emergency) status.push(a.flags.emergency === 'RCF' ? 'RADIO FAIL 7600' : `${a.flags.emergency}${a.squawk === '7700' ? ' 7700' : ''}`);
  if (a.lateral.mode === 'heading') status.push(`H${String(a.lateral.hdg).padStart(3, '0')}`);
  else if (a.lateral.mode === 'route' && a.route[a.legIdx]?.t === 'VM' && a.phase === 'airborne') status.push('RWY HDG · VECTORS');
  if (a.spd) status.push(`S${a.spd}`);
  if (a.kind === 'arr' && a.locCaptured && !a.landingCleared && sim.distToThreshold(a) < 5) status.push('CLEAR TO LAND?');
  if (a.phase === 'stand') status.push(a.onFrequency ? (APT.phraseology === 'faa' ? 'REQ CLEARANCE' : 'REQ START-UP') : 'BOARDING');
  if (!a.onFrequency && a.phase !== 'taxi' && a.phase !== 'stand') status.push('NOT ON FREQ');

  const dist = a.kind === 'arr' && a.locCaptured ? sim.distToThreshold(a) : Math.hypot(a.pos.x, a.pos.y);
  return (
    <div
      className={`strip strip-${a.kind} ${selected ? 'sel' : ''} ${a.alerts.los ? 'los' : a.alerts.stca ? 'stca' : ''}`}
      style={{ ['--brand' as string]: logo?.color ?? '#5f7a99' }}
      onClick={() => (sim.selectedId = a.id)}
    >
      <div className="strip-band">
        {logo?.icon && <img src={logo.icon} alt="" onError={hideOnError} />}
        <span className={a.category !== 'airline' ? 'cat' : ''}>{a.category === 'heli' ? 'HEMS' : a.category === 'ga' ? 'VFR' : a.operator.iata || a.operator.icao}</span>
      </div>
      <div className="strip-main">
        <div className="strip-row1">
          <span className="cs">{a.callsign}</span>
          {a.flags.real && <span className="live-badge" title="Real flight, adopted from live ADS-B">LIVE</span>}
          <span className="type">
            {a.type.icao}/{a.type.wake}
          </span>
          <span className="sq">{a.squawk}</span>
        </div>
        <div className="strip-row2">
          <span className="route">
            {a.kind === 'arr' ? `${other} → ${APT.icao}` : `${APT.icao} → ${other}`}
            <em>{city}</em>
          </span>
          <span className="proc">{proc}</span>
        </div>
        <div className="strip-row3">
          {status.map((s) => (
            <span key={s} className={`chip ${s === 'NOT ON FREQ' || s === 'BOARDING' ? 'dim' : s.endsWith('?') || s.startsWith('REQ ') || /^(PAN|MAYDAY|RADIO|RCF)/.test(s) ? 'urgent' : ''}`}>
              {s}
            </span>
          ))}
          {a.phase === 'airborne' && (
            <span className="dist">
              {a.kind === 'arr' && <b className="eta">ETA {eta(sim, a)}</b>}
              {dist.toFixed(1)} NM{a.kind === 'arr' && a.locCaptured ? ' final' : ''}
            </span>
          )}
        </div>
      </div>
      <div className="strip-side">
        <div className="cfl" title="Cleared level">
          <span className="k">CFL</span>
          {a.phase === 'stand' || a.phase === 'taxi' || a.phase === 'ready' ? `A${a.cfl / 100}` : lvl(a.cfl)}
        </div>
        <div className="actions">
          {a.phase === 'stand' && a.onFrequency && (
            <button className="go" onClick={cmd('CLR')} title="Issue IFR clearance and approve start-up">
              CLR
            </button>
          )}
          {a.phase === 'ready' && a.category === 'heli' && a.onFrequency && (
            <button className="go" onClick={cmd('CTO')} title="Cleared to lift">
              LIFT
            </button>
          )}
          {a.phase === 'ready' && a.category !== 'heli' && (
            <>
              <button onClick={cmd('LU')} title="Line up and wait">
                LU
              </button>
              <button className="go" onClick={cmd('CTO')} title="Cleared for take-off">
                CTO
              </button>
            </>
          )}
          {a.phase === 'lineup' && (
            <button className="go" onClick={cmd('CTO')} title="Cleared for take-off">
              CTO
            </button>
          )}
          {(a.category === 'ga') && a.kind === 'arr' && a.phase === 'airborne' && !a.flags.joined && (
            <button onClick={cmd('JOIN')} title="Join the circuit downwind">
              JOIN
            </button>
          )}
          {a.kind === 'arr' && a.phase === 'airborne' && !a.approachCleared && !(a.category === 'ga') && !(a.category === 'heli') && (
            <button onClick={cmd(`ILS${a.runway}`)} title={`Cleared ILS approach runway ${a.runway}`}>
              {APT.runways[a.runway]?.locOnly ? 'LOC' : 'ILS'}{sim.config.arr.length > 1 ? ` ${a.runway}` : ''}
            </button>
          )}
          {ROLE !== 'arrival' && a.kind === 'arr' && a.phase === 'airborne' && a.approachCleared && !a.landingCleared && (
            <button className="go" onClick={cmd('CL')} title="Cleared to land">
              LAND
            </button>
          )}
          {ROLE === 'arrival' && a.kind === 'arr' && a.locCaptured && !a.handedOff && (
            <button className="go" onClick={cmd('HO')} title="Transfer to Tower">
              TWR
            </button>
          )}
          {a.kind === 'dep' && a.phase === 'airborne' && !a.handedOff && (
            <button onClick={cmd('HO')} title={`Hand off to ${APT.callsigns.departureHandoff}`}>
              HO
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Rough landing ETA (UTC hh:mm) from track distance to the threshold. */
function eta(sim: Sim, a: Aircraft) {
  const direct = Math.hypot(a.pos.x, a.pos.y);
  const along = a.locCaptured ? sim.distToThreshold(a) : direct * 1.35 + 6; // vectoring allowance
  const t = sim.time + (along / Math.max(140, a.gs)) * 3600;
  const d = new Date(t * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

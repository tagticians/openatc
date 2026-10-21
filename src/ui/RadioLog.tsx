import { useEffect, useRef } from 'react';
import type { Sim } from '../sim/sim';
import type { RadioMsg } from '../sim/types';
import { APT } from '../data/airport';
import { fmtUtc } from './hooks';

function Line({ m, sim }: { m: RadioMsg; sim: Sim }) {
  return (
    <div
      className={`rmsg rmsg-${m.from} ${m.level ?? ''}`}
      onClick={() => m.callsign && sim.aircraft.some((a) => a.id === m.callsign) && (sim.selectedId = m.callsign)}
    >
      <span className="rt">{fmtUtc(m.t).slice(0, 5)}</span>
      <span className="rbody">
        {m.from === 'atc' && <span className="who">ATC</span>}
        {m.from === 'pilot' && <span className="who pilot">{m.callsign}</span>}
        <span className="rtext">{m.text}</span>
      </span>
    </div>
  );
}

/** Full radio log: a drawer over the scope's right edge, opened from the top bar or F6. */
export function RadioLog({ sim, open, onClose }: { sim: Sim; open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const last = sim.radio[sim.radio.length - 1]?.id;
  useEffect(() => {
    const el = ref.current;
    if (el && open) el.scrollTop = el.scrollHeight;
  }, [last, open]);
  if (!open) return null;
  return (
    <aside className="radio radio-drawer" aria-label="Radio log">
      <h3>
        <span className="rx">
          <span className="rx-dot" />
          Frequency
        </span>
        <span className="freq">
          {APT.frequencies.arrival && APT.icao === 'EHAM' ? APT.frequencies.arrival : `${APT.frequencies.approach} / ${APT.frequencies.tower}`}
        </span>
        <button type="button" className="drawer-close" onClick={onClose} aria-label="Close radio log (F6)">
          ×
        </button>
      </h3>
      <div className="radio-list" ref={ref}>
        {sim.radio.slice(-120).map((m) => (
          <Line key={m.id} m={m} sim={sim} />
        ))}
      </div>
    </aside>
  );
}

/** With the log closed: the last two transmissions above the command line. */
export function RadioTicker({ sim }: { sim: Sim }) {
  const recent = sim.radio.filter((m) => m.from !== 'system' || m.level === 'alert').slice(-2);
  if (!recent.length) return null;
  return (
    <div className="radio-ticker" aria-live="polite">
      {recent.map((m) => (
        <Line key={m.id} m={m} sim={sim} />
      ))}
    </div>
  );
}

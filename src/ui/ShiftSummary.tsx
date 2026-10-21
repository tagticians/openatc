import { useMemo } from 'react';
import { APT } from '../data/airport';
import type { Sim } from '../sim/sim';
import { DIFFICULTY, bestFor, recordShift } from './progress';

interface Props {
  sim: Sim;
  onResume: () => void;
}

/** Grade from points per movement: separation and clean flow count, volume alone doesn't. */
function grade(points: number, moves: number) {
  const ppm = moves ? points / moves : 0;
  return ppm >= 40 ? 'A' : ppm >= 30 ? 'B' : ppm >= 20 ? 'C' : ppm >= 10 ? 'D' : 'E';
}

/** End of shift: what happened, how it rates, and whether it beat the best here. */
export function ShiftSummary({ sim, onResume }: Props) {
  const s = sim.score;
  // A summary opened before the shift started (startedAt still 0) has no duration.
  const minutes = sim.started ? Math.max(1, (sim.time - sim.startedAt) / 60) : 0;
  // Record once, when the summary opens; short sessions don't count.
  const counts = minutes >= 10;
  const prev = useMemo(() => (counts ? recordShift(APT.icao, sim.difficulty, s, minutes) : bestFor(APT.icao, sim.difficulty)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const moves = s.landed + s.departed;
  const g = moves ? grade(s.points, moves) : null;
  const isBest = counts && (!prev || s.points > prev.points);
  // With no movements a clean sheet means nothing: zeros stay grey, not "good" green.
  const good = moves ? 'good' : 'zero';
  const rows: [string, string | number, string?][] = [
    ['Landed', s.landed],
    ['Departed', s.departed],
    ['Movements per hour', minutes ? Math.round((moves / minutes) * 60) : 0],
    ['Go-arounds', s.goArounds, s.goArounds ? 'warn' : ''],
    ['Separation losses', s.separationLosses, s.separationLosses ? 'bad' : good],
    ['Wake infringements', s.wakeInfringements ?? 0, s.wakeInfringements ? 'warn' : good],
    ['Runway incursions', s.runwayIncursions, s.runwayIncursions ? 'bad' : good],
    ['Time in conflict alert', `${Math.round(s.stcaSeconds / 60)} min`],
  ];
  return (
    <div className="overlay">
      <div className="panel summary" role="dialog" aria-label="Shift summary">
        <div className="panel-kicker">
          {APT.callsigns.approach} · {DIFFICULTY[sim.difficulty].label} · {Math.round(minutes)} min
        </div>
        <h2>End of shift</h2>
        <div className="sum-head">
          <div className={`sum-grade ${g ? `g-${g}` : 'none'}`} title={g ? undefined : 'No movements to grade'}>
            {g ?? '—'}
          </div>
          <div>
            <div className="sum-points">{s.points} pts</div>
            <div className="note">
              {!counts
                ? `Shifts under 10 minutes aren't recorded.${prev ? ` Best here: ${prev.points} pts (${prev.date}).` : ''}`
                : isBest
                  ? prev
                    ? `New best here, beating ${prev.points} pts (${prev.date}).`
                    : 'First recorded shift at this airport and level.'
                  : `Best here: ${prev!.points} pts (${prev!.date}).`}
              {moves > 0 && ` ${Math.round(s.points / moves)} pts per movement; 40 for an A.`}
            </div>
          </div>
        </div>
        <table className="sum-table">
          <tbody>
            {rows.map(([k, v, c]) => (
              <tr key={k} className={c}>
                <th>{k}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="sum-actions">
          <button type="button" onClick={onResume}>
            Keep working
          </button>
          <button type="button" className="go" onClick={() => window.location.reload()}>
            New shift
          </button>
        </div>
      </div>
    </div>
  );
}

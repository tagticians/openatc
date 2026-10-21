import { useState } from 'react';
import type { Sim } from '../sim/sim';
import { APT, ROLE, altimeterFrom, isFaa } from '../data/airport';
import { trueToMag } from '../sim/geo';
import { fmtUtc } from './hooks';

interface Props {
  sim: Sim;
  onHelp: () => void;
  onSettings: () => void;
  onEnd?: () => void;
  bay?: 'arr' | 'dep' | null;
  onBay?: (b: 'arr' | 'dep') => void;
  logOpen: boolean;
  onToggleLog: () => void;
  transmitting: string | null;
}

export function TopBar({ sim, onHelp, onSettings, onEnd, bay, onBay, transmitting, logOpen, onToggleLog }: Props) {
  const closed = Object.entries(sim.events.closedUntil).find(([, t]) => t > sim.time);
  const w = sim.weather;
  const rwy = APT.runways[sim.runway];
  const windMag = Math.round(trueToMag(w.wind.dir) / 10) * 10 || 360;
  const rel = w.wind.dir - rwy.trueHdg;
  const head = Math.round(w.wind.spd * Math.cos((rel * Math.PI) / 180));
  const cross = Math.round(w.wind.spd * Math.sin((rel * Math.PI) / 180));
  const s = sim.score;
  const [more, setMore] = useState(false);
  const pick = (f?: () => void) => () => {
    setMore(false);
    f?.();
  };
  return (
    <header className="topbar">
      <div className="brand">
        <svg viewBox="0 0 32 32" className="brand-mark" aria-hidden>
          <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeOpacity=".35" />
          <circle cx="16" cy="16" r="8" fill="none" stroke="currentColor" strokeOpacity=".5" />
          <path d="M16 16 L16 2 A14 14 0 0 1 29 11 Z" fill="currentColor" fillOpacity=".35" />
          <circle cx="22" cy="9" r="1.8" fill="currentColor" />
        </svg>
        <div>
          <div className="brand-title">{APT.callsigns.approach}</div>
          <div className="brand-sub">
            {APT.icao} · {ROLE === 'arrival' ? `ARR ${APT.frequencies.arrival}` : `APP ${APT.frequencies.approach} · TWR ${APT.frequencies.tower}`}
          </div>
        </div>
      </div>

      <div className="topbar-sep" />

      <div className="clock-group">
        <div className="clock">
          {fmtUtc(sim.time).slice(0, 5)}
          <span className="clock-s">{fmtUtc(sim.time).slice(5)}</span>
          <span className="clock-z">UTC</span>
        </div>
        <div className="speed-ctl" role="group" aria-label="Simulation speed">
          <button className={sim.paused ? 'on' : ''} onClick={() => (sim.paused = !sim.paused)} title="Pause (F4)">
            {sim.paused ? '▶' : '❚❚'}
          </button>
          {[1, 2, 4, 8].map((x) => (
            <button key={x} className={!sim.paused && sim.speed === x ? 'on' : ''} onClick={() => ((sim.speed = x), (sim.paused = false))}>
              {x}×
            </button>
          ))}
        </div>
      </div>

      <div className="topbar-sep" />

      <div className="wx">
        <div className="wx-cluster">
        <div className="wx-item">
          <span className="k">{sim.config.arr.length > 1 ? 'LDG' : 'RWY'}</span>
          <span className="v big">{sim.config.arr.join(' ')}</span>
        </div>
        <div className="wx-item">
          <span className="k">ATIS</span>
          <span className="v big atis">{sim.atis}</span>
        </div>
        <div className="wx-item wind">
          <svg viewBox="-20 -20 40 40" className="wind-dial" aria-hidden>
            <circle r="17" fill="none" stroke="currentColor" strokeOpacity=".25" />
            <g transform={`rotate(${rwy.trueHdg})`}>
              <rect x="-2" y="-13" width="4" height="26" rx="1" fill="currentColor" fillOpacity=".35" />
            </g>
            <g transform={`rotate(${w.wind.dir})`}>
              <line x1="0" y1="-18" x2="0" y2="-8" stroke="var(--amber)" strokeWidth="1.6" />
              <path d="M0 -2 L4.5 -10 L0 -8 L-4.5 -10 Z" fill="var(--amber)" />
            </g>
          </svg>
          <div>
            <span className="v">
              {w.wind.spd < 3 ? 'CALM' : `${String(windMag).padStart(3, '0')}°/${w.wind.spd}`}
              {w.wind.gust ? <small>G{w.wind.gust}</small> : null}
            </span>
            <span className="k">
              {head >= 0 ? 'HW' : 'TW'} {Math.abs(head)} · XW {Math.abs(cross)}
            </span>
          </div>
        </div>
        <div className="wx-item">
          <span className="k">{isFaa() ? 'ALT' : 'QNH'}</span>
          <span className="v">{isFaa() ? (altimeterFrom(w) / 100).toFixed(2) : w.qnh}</span>
        </div>
        </div>
        <div className="wx-item metar" title={w.raw}>
          <span className="k">{w.live ? 'METAR · LIVE' : 'METAR · OFFLINE'}</span>
          <span className="v mono">{w.raw.replace(/^METAR\s+/, '')}</span>
        </div>
      </div>

      <div className="score">
        <div className={`tx ${transmitting ? 'on' : ''}`} title="Frequency activity">
          <span className="tx-dot" />
          {transmitting ? `TX · ${transmitting}` : 'RX · quiet'}
        </div>
        <div className="score-item">
          <span className="k">Score</span>
          <span className={`v ${s.points < 0 ? 'neg' : ''}`}>{s.points}</span>
        </div>
        <div className="score-mini" title="Landed · departed · separation losses">
          <span>
            <span className="k">LDG</span>
            <b>{s.landed}</b>
          </span>
          <span>
            <span className="k">DEP</span>
            <b>{s.departed}</b>
          </span>
          <span className={s.separationLosses ? 'neg' : ''}>
            <span className="k">LOS</span>
            <b>{s.separationLosses}</b>
          </span>
        </div>
        <div className="icon-btns">
          {onBay && (
            <span className="bay-btns">
              <button className={`icon-btn log-btn ${bay === 'arr' ? 'on' : ''}`} onClick={() => onBay('arr')} aria-pressed={bay === 'arr'} title="Inbound strips">
                IN {sim.aircraft.filter((a) => a.kind === 'arr' && a.owner === 'player').length}
              </button>
              <button className={`icon-btn log-btn ${bay === 'dep' ? 'on' : ''}`} onClick={() => onBay('dep')} aria-pressed={bay === 'dep'} title="Outbound strips">
                OUT {sim.aircraft.filter((a) => a.kind === 'dep' && a.owner === 'player').length}
              </button>
            </span>
          )}
          {closed && (
            <span className="rwy-closed" title="Runway closed for inspection">
              RWY {closed[0]} CLOSED {Math.floor((closed[1] - sim.time) / 60)}:{String(Math.floor((closed[1] - sim.time) % 60)).padStart(2, '0')}
            </span>
          )}
          {onEnd && (
            <button className="icon-btn log-btn wide-only" onClick={onEnd} title="End the shift and see your summary">
              END
            </button>
          )}
          <button className={`icon-btn log-btn wide-only ${logOpen ? 'on' : ''}`} onClick={onToggleLog} title="Radio log (F6)" aria-pressed={logOpen}>
            LOG
          </button>
          <button className="icon-btn wide-only" onClick={onSettings} title="Settings">
            ⚙
          </button>
          <button className="icon-btn wide-only" onClick={onHelp} title="Help (F1)">
            ?
          </button>
          {/* Narrow screens: log, settings, help and end shift fold into one menu. */}
          <span className="more-wrap narrow-only">
            <button className={`icon-btn ${more ? 'on' : ''}`} onClick={() => setMore((m) => !m)} aria-expanded={more} aria-haspopup="menu" title="More">
              ⋯
            </button>
            {more && (
              <>
                <div className="more-backdrop" onClick={() => setMore(false)} />
                <div className="more-menu" role="menu">
                  <button role="menuitem" onClick={pick(onToggleLog)}>
                    Radio log <kbd>F6</kbd>
                  </button>
                  <button role="menuitem" onClick={pick(onSettings)}>
                    Settings
                  </button>
                  <button role="menuitem" onClick={pick(onHelp)}>
                    Help <kbd>F1</kbd>
                  </button>
                  {onEnd && (
                    <>
                      <hr />
                      <button role="menuitem" className="end" onClick={pick(onEnd)}>
                        End shift
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </span>
        </div>
      </div>
    </header>
  );
}

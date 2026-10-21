import { useState } from 'react';
import { APT, ROLE } from '../data/airport';
import { commandHelp } from '../sim/commands';
import type { ScopeOptions } from '../scope/ScopeRenderer';
import type { RadioAudio, VoiceMode } from '../audio/radio';
import { VoicePanel } from './VoicePanel';
import type { Sim } from '../sim/sim';

export function Help({ onClose }: { onClose: () => void }) {
  // Instructions come from the command list itself (sim/commands.ts and the plug-ins).
  const rows: [string, string][] = [
    ...commandHelp(),
    ['EXP', 'With an instruction: expedite it; on its own: expedite what it is doing, or vacate the runway'],
    ['TRA5123 L240 D30', 'Prefix a callsign (or its last digits) to address another aircraft'],
    ['Click chips, then ↵', 'Buttons in the aircraft card build one transmission; Enter or TRANSMIT sends it'],
  ];
  const mouse: [string, string][] = [
    ['Left-click target / tag / strip', 'Select aircraft'],
    ['Right-drag from the selected aircraft', 'Vector it: heading toward the cursor; near a waypoint it snaps to "direct" (Alt: plain heading, Shift: add to the transmission)'],
    ['Shift-drag', 'Range and bearing line (with time to go when started on an aircraft); click to clear'],
    ['Touch', 'Tap to select · drag from the selected aircraft to vector · pinch and drag the map'],
    ['Right-drag elsewhere', 'Pan the scope'],
    ['Right-click a fix', 'Direct-to that fix'],
    ['Drag a label', 'Move the data tag'],
    ['Scroll / left-drag', 'Zoom / pan the scope'],
    ['Hover a target', 'Preview its filed route, constraints and level-off'],
    ['Tab · Esc · ↑', 'Next aircraft · deselect · command history'],
    ['⌘K (Ctrl+K)', 'Command palette: every view, panel, speed and voice option; pauses the game while open'],
  ];
  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel help" onClick={(e) => e.stopPropagation()}>
        <div className="panel-kicker">{APT.callsigns.approach} · F1</div>
        <h2>Controller's quick reference</h2>
        <p className="lead">
          {ROLE === 'arrival' ? (
            <>
              You are {APT.callsigns.approach}. Arrivals call in on their STARs towards the stacks at {Object.keys(APT.holdings).filter((h) => h !== 'NARSO').join(', ')}.
              Build a sequence onto the landing runways in use: descend, vector and speed-control them onto the localizer (ILS, or ILS18C to
              pick a runway), then transfer them to Tower (HO) once established. Tower clears them to land. Departures are worked by
              {APT.aiDeparture ?? 'Schiphol Departure'} (AI, dim green). Keep 3 NM or 1000 ft, and 2.5 NM in trail on the same final; parallel finals are
              independent.
            </>
          ) : (
            <>
              You are {APT.callsigns.approach} and Tower combined. Arrivals call in on their STARs. Bring them down, vector or clear them
              for the ILS, then clear them to land. Departures first call Delivery from the stand for their IFR clearance (CLR), then wait
              at the holding point: line them up, clear them for take-off, climb them on their SID and hand them off before they leave the
              sector. Keep 3 NM or 1000 ft between everyone.
            </>
          )}
        </p>
        <div className="help-cols">
          <table>
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k}>
                  <td className="mono">{k}</td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table>
            <tbody>
              {mouse.map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="legend">
          <span>
            <i className="sym arr" /> arrival
          </span>
          <span>
            <i className="sym dep" /> departure
          </span>
          <span>
            <i className="sym pend" /> not yet on frequency
          </span>
          <span>
            <i className="sym stca" /> STCA conflict predicted
          </span>
          <span>
            <i className="sym los" /> separation lost
          </span>
        </div>
        <p className="note">
          Separation: 3 NM or 1000 ft; 2.5 NM in trail on the same final. Behind a heavy: 4 NM (heavy), 5 NM (medium), 6 NM (light);
          behind an A380 up to 8 NM. Departures wait 2 minutes behind a heavier one. The dashed figures between arrivals on final
          show their spacing against what they need. {APT.mva ? 'Faint brown numbers are the minimum vectoring altitudes (hundreds of feet).' : ''}
        </p>
        <details className="credits">
          <summary>Credits and data sources</summary>
          <p>
            {APT.icao.startsWith('K')
              ? 'Procedures, airspace and minimum vectoring altitudes: FAA CIFP and MVA charts (public domain).'
              : APT.icao.startsWith('EG')
                ? 'Procedures and airspace: UK eAIP © NATS Limited.'
                : `Procedures and airspace: LVNL eAIP Netherlands.${APT.ga?.hems ? ' A13 corridor and helipads © OpenStreetMap contributors (ODbL).' : ''}`}{' '}
            Weather: aviationweather.gov. Live traffic © adsb.lol contributors (ODbL 1.0); routes: VRS standing data (CC0) and adsbdb.
            Map © Mapbox © OpenStreetMap. Airline artwork: soaring-symbols (MIT); airline names and logos are trademarks of their
            owners, no affiliation implied. Voices: Kokoro-82M (Apache-2.0) with eSpeak NG (GPL-3.0). Fonts: Inter and JetBrains Mono
            (OFL). Not for real-world navigation. Full list: THIRD_PARTY_NOTICES.md.
          </p>
        </details>
        <button className="start small" onClick={onClose}>
          Back to the scope
        </button>
      </div>
    </div>
  );
}

interface SettingsProps {
  sim: Sim;
  opts: ScopeOptions;
  setOpts: (o: ScopeOptions) => void;
  mapOpacity: number;
  setMapOpacity: (v: number) => void;
  voiceMode: VoiceMode;
  setVoiceMode: (m: VoiceMode) => void;
  volume: number;
  setVolume: (v: number) => void;
  ttsRemaining: number | null;
  radio: RadioAudio;
  onClose: () => void;
}

export function Settings(p: SettingsProps) {
  const toggle = (k: keyof ScopeOptions) => p.setOpts({ ...p.opts, [k]: !p.opts[k] });
  return (
    <div className="overlay" onClick={p.onClose}>
      <div className="panel settings" onClick={(e) => e.stopPropagation()}>
        <div className="panel-kicker">Console</div>
        <h2>Settings</h2>
        <div className="set-group">
          <div className="card-k">Scope</div>
          {(
            [
              ['showStars', 'STAR routes'],
              ['showSids', 'SID routes'],
              ['showFixes', 'Fixes'],
              ['showAirspace', 'Airspace'],
              ...(APT.mva ? ([['showMva', 'Minimum vectoring altitudes (MVA)']] as [keyof ScopeOptions, string][]) : []),
              ['showLive', 'Live ADS-B traffic (adsb.lol)'],
            ] as [keyof ScopeOptions, string][]
          ).map(([k, label]) => (
            <label key={k} className="check-row">
              <input type="checkbox" checked={!!p.opts[k]} onChange={() => toggle(k)} />
              {label}
            </label>
          ))}
          <label className="slider">
            <span>Map brightness</span>
            <input type="range" min={0} max={1} step={0.05} value={p.mapOpacity} onChange={(e) => p.setMapOpacity(+e.target.value)} />
            <b>{Math.round(p.mapOpacity * 100)}%</b>
          </label>
        </div>
        <div className="set-group">
          <div className="card-k">Traffic</div>
          <TrafficSliders sim={p.sim} />
        </div>
        <div className="set-group">
          <div className="card-k">Radio</div>
          <VoicePanel radio={p.radio} mode={p.voiceMode} setMode={p.setVoiceMode} />
          <label className="slider">
            <span>Volume</span>
            <input type="range" min={0} max={1} step={0.05} value={p.volume} onChange={(e) => p.setVolume(+e.target.value)} />
            <b>{Math.round(p.volume * 100)}%</b>
          </label>

        </div>
        <button className="start small" onClick={p.onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

/** Traffic rates during the shift: the same sliders as the briefing, with their values. */
function TrafficSliders({ sim }: { sim: Sim }) {
  const [arr, setArr] = useState(sim.settings.arrivalsPerHour);
  const [dep, setDep] = useState(sim.settings.departuresPerHour);
  const [vfr, setVfr] = useState(sim.ga.rate);
  return (
    <>
      <label className="slider">
        <span>Arrivals / hour</span>
        <input type="range" min={0} max={ROLE === 'arrival' ? 50 : 30} value={arr} onChange={(e) => setArr((sim.settings.arrivalsPerHour = +e.target.value))} />
        <b>{arr}</b>
      </label>
      {APT.ga && (
        <label className="slider">
          <span>VFR / hour</span>
          <input type="range" min={0} max={16} value={vfr} onChange={(e) => setVfr((sim.ga.rate = +e.target.value))} />
          <b>{vfr}</b>
        </label>
      )}
      <label className="slider">
        <span>{ROLE === 'arrival' ? 'Departures (AI)' : 'Departures / hour'}</span>
        <input type="range" min={0} max={30} value={dep} onChange={(e) => setDep((sim.settings.departuresPerHour = +e.target.value))} />
        <b>{dep}</b>
      </label>
    </>
  );
}

import { useEffect, useRef, useState } from 'react';
import { DEMO, demoNow, hooks as demoHooks } from '../demo/demo';
import mapboxgl from 'mapbox-gl';
import type { FeatureCollection } from 'geojson';
import { APT, ROLE, altimeterFrom, isFaa } from '../data/airport';
import type { Sim } from '../sim/sim';
import type { RadioAudio, VoiceMode } from '../audio/radio';
import { VoicePanel } from './VoicePanel';
import { trueToMag } from '../sim/geo';
import { useLogos } from './hooks';
import { AIRPORTS } from '../data/registry';
import type { Difficulty } from '../sim/sim';
import type { EventRate } from '../sim/events';
import { DIFFICULTY, bestFor } from './progress';

const TOKEN = import.meta.env.MAPBOX_API_KEY as string | undefined;

interface Props {
  sim: Sim;
  wxState: 'loading' | 'live' | 'offline';
  voiceMode: VoiceMode;
  setVoiceMode: (m: VoiceMode) => void;
  ttsRemaining: number | null;
  radio: RadioAudio;
  onStart: () => void;
}

function runwayGeo(arr: string[]): FeatureCollection {
  const strips = APT.strips.map(([a]) => {
    const r = APT.runways[a];
    return { type: 'Feature' as const, properties: { k: 'rwy' }, geometry: { type: 'LineString' as const, coordinates: [[r.thr[1], r.thr[0]], [r.end[1], r.end[0]]] } };
  });
  const finals = arr.map((id) => {
    const r = APT.runways[id];
    const back = ((r.trueHdg + 180) * Math.PI) / 180;
    const far = [r.thr[1] + (Math.sin(back) * 10) / 60 / Math.cos((r.thr[0] * Math.PI) / 180), r.thr[0] + (Math.cos(back) * 10) / 60];
    return { type: 'Feature' as const, properties: { k: 'app' }, geometry: { type: 'LineString' as const, coordinates: [[r.thr[1], r.thr[0]], far] } };
  });
  return { type: 'FeatureCollection', features: [...strips, ...finals] };
}

const split = (s: string) => {
  const [v, sub] = s.split('|');
  return { v, sub };
};
const fmtLatLon = ([lat, lon]: [number, number]) => {
  const d = (x: number, w: number) => `${String(Math.floor(Math.abs(x))).padStart(w, '0')}°${String(Math.round((Math.abs(x) % 1) * 60)).padStart(2, '0')}′`;
  return `${d(lat, 2)}${lat >= 0 ? 'N' : 'S'} ${d(lon, 3)}${lon >= 0 ? 'E' : 'W'}`;
};

export function LoadScreen({ sim, wxState, voiceMode, setVoiceMode, radio, onStart }: Props) {
  const mapEl = useRef<HTMLDivElement>(null);
  const [mapReady, setMapReady] = useState(!TOKEN);
  const [arr, setArr] = useState(sim.settings.arrivalsPerHour);
  const [dep, setDep] = useState(sim.settings.departuresPerHour);
  const [diff, setDiff] = useState<Difficulty>(sim.difficulty);
  const [vfr, setVfr] = useState(sim.ga.rate);
  const [evRate, setEvRate] = useState<EventRate>(sim.events.rate);
  const best = bestFor(APT.icao, diff);
  const pickDiff = (d: Difficulty) => {
    setDiff(d);
    setArr(Math.round(APT.defaultRates.arrivals * DIFFICULTY[d].rate));
    setDep(Math.round(APT.defaultRates.departures * DIFFICULTY[d].rate));
    setEvRate(DIFFICULTY[d].events);
  };
  const logos = useLogos();

  const runwayRef = useRef(sim.runway);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  runwayRef.current = sim.runway;
  const arrKey = sim.config.arr.join(',');

  useEffect(() => {
    if (!TOKEN || !mapEl.current) return;
    mapboxgl.accessToken = TOKEN;
    const rwy = APT.runways[runwayRef.current];
    const map = new mapboxgl.Map({
      container: mapEl.current,
      style: 'mapbox://styles/mapbox/satellite-v9',
      center: [APT.arp[1], APT.arp[0]],
      zoom: APT.view.flyoverZoom,
      pitch: 64,
      bearing: rwy.trueHdg - 20,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
    });
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
    // Frame the airport in the open area right of the briefing column.
    map.setPadding({ left: Math.round(window.innerWidth * 0.32), right: Math.round(window.innerWidth * 0.12), top: 0, bottom: 0 });
    let raf = 0;
    map.on('style.load', () => {
      setMapReady(true);
      try {
        map.setFog({ range: [1, 12], color: '#16243a', 'horizon-blend': 0.12, 'high-color': '#0d1a2e', 'space-color': '#04070c', 'star-intensity': 0.15 });
      } catch {
        /* fog unsupported */
      }
      // Runway and extended centreline glow.
      map.addSource('rwy', { type: 'geojson', data: runwayGeo(sim.config.arr) });
      map.addLayer({ id: 'app-glow', type: 'line', source: 'rwy', filter: ['==', 'k', 'app'], paint: { 'line-color': '#ffc24d', 'line-width': 2, 'line-opacity': 0.8, 'line-dasharray': [2, 2] } });
      map.addLayer({ id: 'rwy-glow', type: 'line', source: 'rwy', filter: ['==', 'k', 'rwy'], paint: { 'line-color': '#5fd4ff', 'line-width': 16, 'line-blur': 12, 'line-opacity': 0.55 } });
      map.addLayer({ id: 'rwy-core', type: 'line', source: 'rwy', filter: ['==', 'k', 'rwy'], paint: { 'line-color': '#bff0ff', 'line-width': 2, 'line-opacity': 0.9 } });
      const t0 = demoNow();
      const spin = () => {
        map.setBearing(APT.runways[runwayRef.current].trueHdg - 20 + ((demoNow() - t0) / 1000) * 1.6);
        raf = requestAnimationFrame(spin);
      };
      raf = requestAnimationFrame(spin);
    });
    mapRef.current = map;
    if (DEMO) demoHooks.map = map;
    return () => {
      cancelAnimationFrame(raf);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const src = mapRef.current?.getSource('rwy') as mapboxgl.GeoJSONSource | undefined;
    src?.setData(runwayGeo(sim.config.arr));
  }, [arrKey, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const w = sim.weather;
  const rwy = APT.runways[sim.runway];
  const cfg = sim.config;
  const single = cfg.arr.length === 1 && cfg.dep.length === 1 && cfg.arr[0] === cfg.dep[0];
  const ops = [...new Map(APT.operators.map((o) => [o.icao, o])).values()];
  const f = APT.facts;
  const windMag = Math.round(trueToMag(w.wind.dir) / 10) * 10 || 360;
  const checks: [string, boolean][] = [
    ['Aeronautical data · AIRAC 10/2026', true],
    [`Weather · ${wxState === 'live' ? 'live METAR' : wxState === 'offline' ? 'offline (default)' : 'fetching…'}`, wxState !== 'loading'],
    ['Base map', mapReady],
  ];
  const ready = checks.every((c) => c[1]);
  // Start the shift with the briefing's settings (button or Enter).
  const begin = () => {
    if (!ready) return;
    sim.settings.arrivalsPerHour = arr;
    sim.settings.departuresPerHour = dep;
    sim.difficulty = diff;
    sim.ga.rate = vfr;
    onStart();
    sim.events.setRate(evRate);
  };
  const beginRef = useRef(begin);
  beginRef.current = begin;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === 'Enter' && !(t && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName))) beginRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="load">
      <div ref={mapEl} className="load-map" />
      <div className="load-shade" />
      <div className="load-grid">
        <div className="load-left">
          <nav className="apt-switch" aria-label="Airport">
            {AIRPORTS.map((a) => (
              <a key={a.icao} href={`?apt=${a.icao}`} className={a.icao === APT.icao ? 'on' : ''}>
                <b>{a.icao}</b>
                <span>{a.city}</span>
                <em>{a.roles[0] === 'arrival' ? 'Arrival' : 'Approach + Tower'}</em>
              </a>
            ))}
          </nav>
          <div className="load-kicker">{ROLE === 'arrival' ? `${APT.callsigns.approach} · Shift briefing` : 'Approach & Tower · Shift briefing'}</div>
          <h1 className="load-title">
            <span className="icao">{APT.icao}</span>
            <span className="iata">{APT.iata}</span>
          </h1>
          <div className="load-name">{APT.name}</div>
          <div className="load-city">
            {APT.region} · {fmtLatLon(APT.arp)} · elevation {APT.elevation} ft
          </div>

          <div className="facts">
            {(
              [
                ['Runways', f.runways],
                ['Airspace', f.airspace],
                ['Procedures', f.procedures],
                ['Frequencies', f.frequencies],
              ] as const
            ).map(([k, val]) => (
              <div className="fact" key={k}>
                <span className="k">{k}</span>
                <span className="v">{split(val).v}</span>
                <span className="s">{split(val).sub}</span>
              </div>
            ))}
          </div>

          <div className="ops">
            <span className="k">Operators</span>
            <div className="op-logos">
              {ops.map((o) => (
                <div key={o.icao} className="op" title={o.name}>
                  {logos[o.icao]?.logo ? <img src={logos[o.icao]!.logo} alt={o.name} /> : <span>{o.name}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="load-right">
          <div className="load-cards">
          <div className="card wx-card">
            <div className="card-k">
              Current weather <span className={`pill ${w.live ? 'live' : ''}`}>{w.live ? 'LIVE' : 'DEFAULT'}</span>
            </div>
            <div className="wx-big">
              <div>
                <span className="v">{w.wind.spd < 3 ? 'CALM' : `${String(windMag).padStart(3, '0')}° / ${w.wind.spd} kt`}</span>
                <span className="k">wind{w.wind.gust ? ` · gusting ${w.wind.gust}` : ''}</span>
              </div>
              <div>
                <span className="v">{isFaa() ? (altimeterFrom(w) / 100).toFixed(2) : w.qnh}</span>
                <span className="k">{isFaa() ? 'altimeter inHg' : 'QNH hPa'}</span>
              </div>
              <div>
                <span className="v">{w.visibility >= 9999 ? '10 km+' : `${w.visibility} m`}</span>
                <span className="k">visibility</span>
              </div>
              <div>
                <span className="v">{w.ceiling ? `${w.ceiling} ft` : '—'}</span>
                <span className="k">ceiling</span>
              </div>
            </div>
            <div className="metar-raw mono">{w.raw}</div>
          </div>

          <div className="card rwy-card">
            <div className="card-k">{single ? 'Runway in use' : `Runway configuration · ${cfg.name} flow`}</div>
            <div className="rwy-row">
              <div className={`rwy-num ${cfg.arr.length > 1 ? 'multi' : ''}`}>{cfg.arr.join(' ')}</div>
              <div className="rwy-detail">
                {!single && <div>Landing {cfg.arr.join(' + ')} · departing {cfg.dep.join(' + ')}</div>}
                <div>
                  {rwy.ils ? `${rwy.locOnly ? 'LOC' : 'ILS'} ${rwy.ils.ident} ${rwy.ils.freq}` : 'RNP'} · course {String(rwy.magHdg).padStart(3, '0')}°
                </div>
                {rwy.fap && (
                  <div>
                    FAP {rwy.fap.fix} at {rwy.fap.alt} ft{rwy.circuit ? ` · circuit ${rwy.circuit === 'L' ? 'left' : 'right'}-hand` : ''}
                  </div>
                )}
                <div>ATIS information {sim.atis}</div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-k">Shift</div>
            <div className="seg diff" role="radiogroup" aria-label="Difficulty">
              {(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => (
                <button key={d} type="button" role="radio" aria-checked={diff === d} className={diff === d ? 'on' : ''} onClick={() => pickDiff(d)} title={DIFFICULTY[d].note}>
                  {DIFFICULTY[d].label}
                </button>
              ))}
            </div>
            <div className="seg diff" role="radiogroup" aria-label="Events">
              <span className="seg-k">Events</span>
              {(['off', 'occasional', 'frequent'] as EventRate[]).map((r) => (
                <button key={r} type="button" role="radio" aria-checked={evRate === r} className={evRate === r ? 'on' : ''} onClick={() => setEvRate(r)}>
                  {r === 'off' ? 'Off' : r === 'occasional' ? 'Occasional' : 'Frequent'}
                </button>
              ))}
            </div>
            <div className="note">
              {best ? `Best ${DIFFICULTY[diff].label.toLowerCase()} shift here: ${best.points} pts (${best.landed} landed, ${best.departed} departed, ${best.minutes} min, ${best.date})` : 'No shift recorded here yet at this level.'} Emergencies, closures and wind shifts can also be triggered from ⌘K.
            </div>
            <div className="card-k" style={{ marginTop: 10 }}>
              Traffic
            </div>
            <label className="slider">
              <span>Arrivals / hour</span>
              <input type="range" min={0} max={ROLE === 'arrival' ? 50 : 30} value={arr} onChange={(e) => setArr(+e.target.value)} />
              <b>{arr}</b>
            </label>
            {APT.ga && (
              <label className="slider">
                <span>VFR / hour</span>
                <input type="range" min={0} max={16} value={vfr} onChange={(e) => setVfr(+e.target.value)} />
                <b>{vfr}</b>
              </label>
            )}
            <label className="slider">
              <span>{ROLE === 'arrival' ? 'Departures (AI)' : 'Departures / hour'}</span>
              <input type="range" min={0} max={30} value={dep} onChange={(e) => setDep(+e.target.value)} />
              <b>{dep}</b>
            </label>
            <div className="note">
              Plus live: real {APT.icao} {ROLE === 'arrival' ? 'arrivals' : 'flights'} on ADS-B are adopted as they appear. Synthetic traffic fills
              the rates above.
            </div>
            <div className="card-k" style={{ marginTop: 10 }}>
              Pilot voices
            </div>
            <VoicePanel radio={radio} mode={voiceMode} setMode={setVoiceMode} compact />
          </div>

          </div>
          <div className="checks">
            {checks.map(([label, ok]) => (
              <div key={label} className={`check ${ok ? 'ok' : ''}`}>
                <span className="dot" />
                {label}
              </div>
            ))}
          </div>
          <button
            className="start"
            disabled={!ready}
            onClick={begin}
          >
            <span className="start-chk" aria-hidden>
              {checks.map(([label, ok]) => (
                <i key={label} className={ok ? 'ok' : ''} title={label} />
              ))}
            </span>
            {ready ? 'Take the frequency' : <>Preparing<em className="start-wait"> · {checks.find((c) => !c[1])?.[0].split(' · ')[0].toLowerCase()}</em>…</>}
            <span>↵</span>
          </button>
        </div>
      </div>
    </div>
  );
}

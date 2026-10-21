import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sim } from './sim/sim';
import { fetchMetar } from './weather/metar';
import { cachedRoute, fetchLive, lookupRoute } from './live/adsb';
import { RadioAudio, VOICE_MODES, type VoiceMode } from './audio/radio';
import { ScopeRenderer, type ScopeOptions } from './scope/ScopeRenderer';
import { Scope } from './scope/Scope';
import { TopBar } from './ui/TopBar';
import { StripBay } from './ui/StripBay';
import { RadioLog, RadioTicker } from './ui/RadioLog';
import { CommandBar } from './ui/CommandBar';
import { LoadScreen } from './ui/LoadScreen';
import { Help, Settings } from './ui/Overlays';
import { CommandPalette, type PaletteAction } from './ui/CommandPalette';
import { ShiftSummary } from './ui/ShiftSummary';
import { EVENTS } from './sim/events';
import { AIRPORTS } from './data/registry';
import { useSimTick } from './ui/hooks';
import { DEMO, hooks as demoHooks, prepareDemo } from './demo/demo';
import { SCENES } from './demo/scenes';
import { APT } from './data/airport';

const loadPref = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};
const savePref = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
};

export default function App() {
  // Demo captures run on a fixed seed and clock, so every take plays out the same way.
  const sim = useMemo(() => (DEMO ? new Sim({ seed: 7, startTime: 1792411200 }) : new Sim()), []);
  const radio = useMemo(() => new RadioAudio(), []);
  const renderer = useMemo(() => new ScopeRenderer(sim), [sim]);
  const [screen, setScreen] = useState<'load' | 'scope'>('load');
  const [wxState, setWxState] = useState<'loading' | 'live' | 'offline'>('loading');
  const [voiceMode, setVoiceModeState] = useState<VoiceMode>(() => {
    // A saved cloud engine isn't available in a shipped build: fall back to the system voice.
    const v = loadPref<VoiceMode>('voiceMode', 'browser');
    return VOICE_MODES.some((m) => m.mode === v) ? v : 'browser';
  });
  const [volume, setVolumeState] = useState(loadPref('volume', 0.8));
  const [mapOpacity, setMapOpacity] = useState(loadPref('mapOpacity', 0.85));
  const [opts, setOptsState] = useState<ScopeOptions>(renderer.opts);
  const [ttsRemaining, setTtsRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [settings, setSettings] = useState(false);
  const [tx, setTx] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [summary, setSummary] = useState(false);
  // Narrow screens: the strip bays become drawers over the scope.
  const [bay, setBay] = useState<'arr' | 'dep' | null>(null);
  const endShift = () => {
    sim.paused = true;
    setSummary(true);
  };
  const wasPaused = useRef(false);
  const [logOpen, setLogOpen] = useState<boolean>(loadPref('radioLogOpen', false));
  const toggleLog = () =>
    setLogOpen((o) => {
      savePref('radioLogOpen', !o);
      return !o;
    });
  const errTimer = useRef<number>();

  useSimTick(sim, DEMO ? 16 : 200);

  // Demo mode (video capture): fixed weather, no live data, the scene's own traffic.
  useEffect(() => {
    if (!DEMO) return;
    const def = SCENES[DEMO];
    if (!def) return;
    demoHooks.sim = sim;
    demoHooks.showSummary = () => setSummary(true);
    radio.mode = 'off';
    sim.setWeather(DEMO_WX());
    setWxState('live');
    sim.settings.arrivalsPerHour = 0;
    sim.settings.departuresPerHour = 0;
    sim.ga.rate = 0;
    sim.events.setRate('off');
    prepareDemo(def);
    if (!def.briefing) {
      sim.start();
      sim.aircraft = [];
      setScreen('scope');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Dev-only handle for debugging from the console.
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __atc: unknown }).__atc = { sim, renderer, radio };
  }, [sim, renderer, radio]);

  // Live weather: on load, then every 10 minutes.
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      if (DEMO) return;
      const w = await fetchMetar(APT.icao);
      if (!alive) return;
      if (w) {
        sim.setWeather(w);
        setWxState('live');
      } else setWxState((s) => (s === 'loading' ? 'offline' : s));
    };
    pull();
    const id = setInterval(pull, 10 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [sim]);

  // Live ADS-B background traffic while on the scope.
  useEffect(() => {
    if (screen !== 'scope' || DEMO) return;
    let alive = true;
    const pull = async () => {
      if (!renderer.opts.showLive) return;
      const t = await fetchLive();
      if (!alive || !t) return;
      sim.setLive(t);
      // Real flights to/from this airport: look up routes (cached) and adopt them.
      let lookups = 0;
      for (const target of t) {
        if (sim.adopted.has(target.hex)) continue;
        const d = Math.hypot(target.pos.x, target.pos.y);
        // Only ask about plausible arrivals (VRS first; adsbdb fallback is rate limited).
        const candidate = target.onGround || (d < APT.spawnDistance[1] && target.alt < 15000 && target.vs < -200);
        if (!candidate) continue;
        let route = cachedRoute(target.callsign);
        if (route === undefined) {
          if (lookups >= 6) continue;
          lookups++;
          route = await lookupRoute(target.callsign);
        }
        if (route) sim.adoptLive(target, route);
      }
    };
    pull();
    const id = setInterval(pull, 10000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [screen, sim, renderer]);

  // Radio audio wiring
  useEffect(() => {
    radio.mode = DEMO ? 'off' : voiceMode;
    radio.setVolume(volume);
    radio.onStatus = () => setTtsRemaining(radio.status.remaining);
    radio.onTransmit = setTx;
    radio.onNotice = (text) => {
      sim.say('system', text, undefined, undefined, 'warn');
      setVoiceModeState(radio.mode);
    };
    sim.onAlert = (k) => radio.alert(k);
    radio.refreshStatus();
    const off = sim.onRadio((m) => {
      if (m.from !== 'pilot' || !m.speech || !m.callsign) return;
      const ac = sim.aircraft.find((x) => x.callsign === m.callsign);
      radio.enqueue(m.callsign, m.speech, ac?.type.icao ?? '', m.callsign === sim.selectedId);
    });
    return () => {
      off();
    };
  }, [sim, radio]); // eslint-disable-line react-hooks/exhaustive-deps

  const setVoiceMode = (m: VoiceMode) => {
    setVoiceModeState(m);
    radio.mode = m;
    savePref('voiceMode', m);
    if (m === 'eleven') radio.refreshStatus();
  };
  const setVolume = (v: number) => {
    setVolumeState(v);
    radio.setVolume(v);
    savePref('volume', v);
  };
  const setOpts = (o: ScopeOptions) => {
    setOptsState(o);
    renderer.opts = o;
  };

  const onResult = useCallback((err?: string) => {
    setError(err ?? null);
    window.clearTimeout(errTimer.current);
    if (err) errTimer.current = window.setTimeout(() => setError(null), 4000);
  }, []);

  // Global keys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The briefing handles Enter itself, so its settings are applied however the shift starts.
      if (screen !== 'scope') return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (paletteOpen) closePalette();
        else openPalette();
        return;
      }
      if (paletteOpen) return;
      if (e.key === 'F1') {
        e.preventDefault();
        setHelp((h) => !h);
      } else if (e.key === 'F2') {
        e.preventDefault();
        setOpts({ ...renderer.opts, showStars: !renderer.opts.showStars });
      } else if (e.key === 'F3') {
        e.preventDefault();
        setOpts({ ...renderer.opts, showSids: !renderer.opts.showSids });
      } else if (e.key === 'F6') {
        e.preventDefault();
        toggleLog();
      } else if (e.key === 'F4' || e.key === 'Pause') {
        e.preventDefault();
        sim.paused = !sim.paused;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ⌘K command palette: pauses the simulation while open.
  const openPalette = () => {
    wasPaused.current = sim.paused;
    sim.paused = true;
    setPaletteOpen(true);
  };
  const closePalette = () => {
    setPaletteOpen(false);
    if (!wasPaused.current) sim.paused = false;
  };
  const paletteActions = (): PaletteAction[] => {
    const o = renderer.opts;
    const toggle = (k: keyof ScopeOptions, label: string, hint?: string): PaletteAction => ({
      id: `opt-${k}`,
      group: 'Scope',
      label: `${o[k] ? 'Hide' : 'Show'} ${label}`,
      hint,
      run: () => setOpts({ ...renderer.opts, [k]: !renderer.opts[k] }),
    });
    const aircraft: PaletteAction[] = sim.aircraft
      .filter((a) => a.owner === 'player')
      .map((a) => ({
        id: `ac-${a.id}`,
        group: 'Aircraft',
        label: `${a.callsign} · ${a.type.icao} · ${a.kind === 'arr' ? `from ${a.origin}` : `to ${a.dest}`}`,
        keywords: `${a.spoken} ${a.operator.name} select`,
        run: () => (sim.selectedId = a.id),
      }));
    return [
      ...aircraft,
      { id: 'pause', group: 'Simulation', label: wasPaused.current ? 'Resume simulation' : 'Pause simulation', hint: 'F4', run: () => (wasPaused.current = !wasPaused.current) },
      ...[1, 2, 4, 8].map((x) => ({ id: `speed-${x}`, group: 'Simulation', label: `Speed ${x}×`, keywords: 'time faster slower', run: () => ((sim.speed = x), (wasPaused.current = false)) })),
      { id: 'log', group: 'Panels', label: logOpen ? 'Close radio log' : 'Open radio log', hint: 'F6', keywords: 'frequency transmissions', run: toggleLog },
      { id: 'help', group: 'Panels', label: 'Controller’s quick reference', hint: 'F1', keywords: 'help commands keys', run: () => setHelp(true) },
      { id: 'settings', group: 'Panels', label: 'Settings', keywords: 'options volume traffic', run: () => setSettings(true) },
      { id: 'end', group: 'Simulation', label: 'End shift and see the summary', keywords: 'score finish stop results', run: endShift },
      ...EVENTS.map((e) => ({
        id: `ev-${e.kind}`,
        group: 'Events',
        label: `Event: ${e.label}`,
        hint: e.detail,
        keywords: 'emergency trigger scenario',
        run: () => {
          wasPaused.current = false;
          const why = sim.events.trigger(e.kind);
          if (why) onResult(why);
        },
      })),
      ...(APT.ga?.hems
        ? [
            {
              id: 'hems',
              group: 'Events',
              label: `Event: ${APT.ga.hems.spoken.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())} mission`,
              hint: 'HEMS helicopter calls from its pad',
              keywords: 'helicopter hems trauma lifeliner ambulance',
              run: () => {
                wasPaused.current = false;
                if (!sim.hems.spawn()) onResult('The helicopter is already flying');
              },
            },
            { id: 'vfr-arr', group: 'Events', label: 'Event: VFR arrival', keywords: 'general aviation cessna', run: () => ((wasPaused.current = false), sim.ga.spawnVfrArrival()) },
          ]
        : []),
      ...(['off', 'occasional', 'frequent'] as const).map((r) => ({
        id: `evrate-${r}`,
        group: 'Events',
        label: `Random events: ${r}${sim.events.rate === r ? ' ✓' : ''}`,
        keywords: 'emergency frequency',
        run: () => sim.events.setRate(r),
      })),
      toggle('showStars', 'STAR routes', 'F2'),
      toggle('showSids', 'SID routes', 'F3'),
      toggle('showFixes', 'fixes'),
      toggle('showAirspace', 'airspace'),
      toggle('showLive', 'live ADS-B traffic'),
      { id: 'map-up', group: 'Scope', label: 'Brighter base map', keywords: 'map brightness', run: () => setMapOpacity((v) => Math.min(1, v + 0.15)) },
      { id: 'map-down', group: 'Scope', label: 'Darker base map', keywords: 'map brightness dim', run: () => setMapOpacity((v) => Math.max(0, v - 0.15)) },
      ...VOICE_MODES.map(({ mode: m, label }) => ({
        id: `voice-${m}`,
        group: 'Radio',
        label: `Pilot voices: ${label}${voiceMode === m ? ' ✓' : ''}`,
        keywords: 'voice audio tts sound',
        run: () => setVoiceMode(m),
      })),
      ...AIRPORTS.filter((a) => a.icao !== APT.icao).map((a) => ({
        id: `apt-${a.icao}`,
        group: 'Airport',
        label: `Switch to ${a.icao} ${a.city} (${a.roles[0] === 'arrival' ? 'Arrival' : 'Approach + Tower'})`,
        keywords: 'airport change load',
        run: () => (window.location.href = `?apt=${a.icao}`),
      })),
    ];
  };

  const start = async () => {
    await radio.unlock().catch(() => undefined);
    sim.start();
    setScreen('scope');
    savePref('mapOpacity', mapOpacity);
  };

  if (screen === 'load') {
    return (
      <LoadScreen sim={sim} wxState={wxState} voiceMode={voiceMode} setVoiceMode={setVoiceMode} ttsRemaining={ttsRemaining} radio={radio} onStart={start} />
    );
  }

  return (
    <div className="app">
      <TopBar sim={sim} onHelp={() => setHelp(true)} onSettings={() => setSettings(true)} onEnd={endShift} bay={bay} onBay={(b) => setBay((cur) => (cur === b ? null : b))} transmitting={tx} logOpen={logOpen} onToggleLog={toggleLog} />
      <div className={`main ${bay ? `bay-${bay}` : ''}`}>
        <StripBay sim={sim} onResult={onResult} side="arr" />
        <div className="scope-wrap">
          <Scope sim={sim} renderer={renderer} mapOpacity={mapOpacity} onCommandResult={onResult} />
          <div className="scope-vignette" />
          <div className="scope-legend">
            <button type="button" className="legend-k" onClick={openPalette}>
              <kbd>⌘K</kbd> commands
            </button>
            <span>right-drag: vector / pan</span>
            <span>rings 10 NM</span>
            {opts.showLive && <span>live traffic © adsb.lol (ODbL)</span>}
          </div>
          {sim.paused && !paletteOpen && <div className="paused">PAUSED</div>}
          {!logOpen && <RadioTicker sim={sim} />}
          <CommandBar sim={sim} error={error} onResult={onResult} />
          <RadioLog sim={sim} open={logOpen} onClose={toggleLog} />
        </div>
        <StripBay sim={sim} onResult={onResult} side="dep" />
      </div>
      <CommandPalette open={paletteOpen} actions={paletteActions()} onClose={closePalette} />
      {help && <Help onClose={() => setHelp(false)} />}
      {summary && (
        <ShiftSummary
          sim={sim}
          onResume={() => {
            setSummary(false);
            sim.paused = false;
          }}
        />
      )}
      {settings && (
        <Settings
          sim={sim}
          opts={opts}
          setOpts={setOpts}
          mapOpacity={mapOpacity}
          setMapOpacity={(v) => {
            setMapOpacity(v);
            savePref('mapOpacity', v);
          }}
          voiceMode={voiceMode}
          setVoiceMode={setVoiceMode}
          volume={volume}
          setVolume={setVolume}
          ttsRemaining={ttsRemaining}
          radio={radio}
          onClose={() => setSettings(false)}
        />
      )}
    </div>
  );
}

/** Demo weather: a north-easterly breeze, so runway 06 is in use. */
function DEMO_WX() {
  return {
    raw: `METAR ${APT.icao} 201025Z 06012KT 9999 FEW032 15/08 Q1021 NOSIG`,
    wind: { dir: 60, spd: 12 },
    qnh: 1021,
    visibility: 9999,
    ceiling: null,
    temp: 15,
    dew: 8,
    live: true,
    fetchedAt: Date.now(),
  };
}

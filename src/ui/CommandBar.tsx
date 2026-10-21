import { useEffect, useRef, useState } from 'react';
import type { Sim } from '../sim/sim';
import type { Aircraft } from '../sim/types';
import { APT, ROLE } from '../data/airport';
import { execute } from '../sim/commands';
import { trueToMag } from '../sim/geo';
import { suggestFixes } from '../sim/suggest';
import { fmtLevel } from '../sim/phraseology';
import { hideOnError, logoFor, useLogos } from './hooks';
import { draft, useDraft } from './draft';
import { FlightInfo } from './FlightInfo';

interface Props {
  sim: Sim;
  error: string | null;
  onResult: (err?: string) => void;
}

const ALTS = [2000, 3000, 4000, 5000, 6000];
const SPEEDS = [160, 180, 210, 250];

export function CommandBar({ sim, error, onResult }: Props) {
  const value = useDraft();
  const setValue = draft.set;
  const [sugIdx, setSugIdx] = useState(0);
  const hist = useRef<string[]>([]);
  const hIdx = useRef(-1);
  const input = useRef<HTMLInputElement>(null);
  const logos = useLogos();
  const ac = sim.selected;

  // Keep the command line focused: typing anywhere goes to it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
      if (document.querySelector('.palette, .overlay')) return; // a dialog owns the keyboard
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) input.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const run = (cmd: string) => {
    const res = execute(sim, cmd);
    onResult(res.error);
    return res.ok;
  };

  // A new target starts a new transmission.
  const selId = ac?.id;
  useEffect(() => {
    draft.clear();
  }, [selId]);

  const transmit = () => {
    const v = value.trim();
    if (!v) return;
    hist.current.unshift(v);
    hIdx.current = -1;
    if (run(v)) draft.clear();
  };

  /** Click a chip: add it to the transmission being composed (same kind replaces). */
  const stage = (tok: string) => {
    draft.stage(tok);
    input.current?.focus();
  };
  const staged = (tok: string) => (draft.has(tok) ? 'staged' : '');

  const sugs = suggestions(value, sim);
  const accept = (s: string) => {
    const words = value.replace(/\s+$/, '').split(/\s+/);
    const last = words[words.length - 1] ?? '';
    // "DKAK" (direct shorthand) keeps its D; "DCT KAK" and callsigns are replaced whole.
    const shorthand = !/^(DCT|HOLD)$/i.test(words[words.length - 2] ?? '') && /^D[A-Z]{1,4}$/i.test(last) && !!APT.fixes[s];
    words[words.length - 1] = shorthand ? `D${s}` : s;
    setValue(words.join(' ') + ' ');
    setSugIdx(0);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (sugs.length && (e.key === 'Tab' || (e.key === 'ArrowRight' && e.currentTarget.selectionStart === value.length))) {
      e.preventDefault();
      accept(sugs[Math.min(sugIdx, sugs.length - 1)]);
      return;
    }
    if (sugs.length && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      setSugIdx((i) => (i + (e.key === 'ArrowDown' ? 1 : sugs.length - 1)) % sugs.length);
      return;
    }
    if (e.key === 'Enter') {
      transmit();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      hIdx.current = Math.min(hist.current.length - 1, hIdx.current + 1);
      setValue(hist.current[hIdx.current] ?? '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      hIdx.current = Math.max(-1, hIdx.current - 1);
      setValue(hIdx.current < 0 ? '' : hist.current[hIdx.current]);
    } else if (e.key === 'Escape') {
      if (value) setValue('');
      else sim.selectedId = null;
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const list = sim.aircraft.filter((a) => a.phase !== 'taxi' && (a.phase !== 'stand' || a.onFrequency));
      if (!list.length) return;
      const i = list.findIndex((a) => a.id === sim.selectedId);
      sim.selectedId = list[(i + (e.shiftKey ? list.length - 1 : 1)) % list.length].id;
    }
  };

  const logo = ac ? logoFor(logos, ac.operator.icao) : undefined;
  const fixes = ac ? suggestFixes(ac, sim) : [];

  return (
    <>
    <div className="ac-float">
      {ac && (
        <div className="ac-card" style={{ ['--brand' as string]: logo?.color ?? '#5f7a99' }}>
          <div className="ac-head">
            {logo?.icon ? (
              <img src={logo.icon} alt="" className="ac-logo" onError={hideOnError} />
            ) : (
              <span className="ac-logo mono" aria-hidden>
                {ac.category === 'heli' ? 'H' : ac.category === 'ga' ? 'GA' : ac.operator.iata || ac.operator.icao}
              </span>
            )}
            <div className="ac-id">
              <div className="ac-cs">
                {ac.callsign} <span>{ac.spoken}</span>
              </div>
              <FlightInfo ac={ac} />
            </div>
            <div className="ac-state">
              {stateTiles(ac).map(([k, v]) => (
                <div key={k}>
                  <span className="k">{k}</span>
                  <span className="v">{v}</span>
                </div>
              ))}
            </div>
          </div>
          {ac.category === 'heli' && ac.phase === 'ready' && (
            <div className="quick flow-panel">
              <div className="gact">
                <span className="qk">HEMS</span>
                {ac.onFrequency && (
                  <button className="go" onClick={() => run('CTO')} title="Cleared to lift: corridor to the hospital, not above circuit height">
                    CLEARED TO LIFT <kbd>CTO</kbd>
                  </button>
                )}
              </div>
              <div className={`gstatus ${ac.onFrequency ? 'warn' : 'idle'}`}>
                {ac.onFrequency ? `On the pad · priority flight to ${placeName(ac.dest)}` : 'On the pad · crew getting ready'}
              </div>
            </div>
          )}
          {ac.kind === 'dep' && ac.phase !== 'airborne' && ac.category !== 'heli' && <GroundPanel ac={ac} sim={sim} run={run} />}
          {(ac.category === 'ga' || ac.category === 'heli') && ac.phase === 'airborne' && (
            <div className="quick">
              {ac.category === 'ga' && ac.kind === 'arr' && (
                <div className="qgroup" role="radiogroup" aria-label="Join">
                  <span className="qk">JOIN</span>
                  <button className={`accent ${ac.flags.joined === 'DW' ? 'on' : ''}`} onClick={() => run('JOIN')} title="Join downwind">
                    DOWNWIND
                  </button>
                  <button className={ac.flags.joined === 'BASE' ? 'on' : ''} onClick={() => run('JB')} title="Join base">
                    BASE
                  </button>
                  <button className={ac.flags.joined === 'FINAL' ? 'on' : ''} onClick={() => run('STR')} title="Straight-in approach">
                    STRAIGHT-IN
                  </button>
                </div>
              )}
              <div className="qgroup">
                <span className="qk">HOLD</span>
                <button onClick={() => run('ORB')} title="Orbit right at present position (hold it clear of traffic)">
                  ORBIT
                </button>
                <button onClick={() => run('RES')} title="Continue on route">
                  CONTINUE
                </button>
              </div>
              {ac.category === 'ga' && ac.kind === 'arr' ? (
                <div className="qgroup">
                  <span className="qk">RWY</span>
                  <button className="go" onClick={() => run('CL')}>
                    CLEARED TO LAND
                  </button>
                </div>
              ) : (
                <div className="qgroup">
                  <span className="qk">XFR</span>
                  <button className="accent" onClick={() => run('HO')} title="Leaving the zone: frequency change approved">
                    FREQ CHANGE
                  </button>
                </div>
              )}
            </div>
          )}
          {ac.phase === 'airborne' && ac.category === 'airline' && (
            <div className="quick">
              <div className="qgroup">
                <span className="qk">ALT</span>
                {[...ALTS, ac.kind === 'dep' || ROLE === 'arrival' ? 7000 : null, ac.kind === 'dep' ? 9000 : ROLE === 'arrival' ? 8000 : null].filter(Boolean).map((a) => (
                  <button key={a} className={`${ac.cfl === a ? 'on' : ''} ${staged(`A${a! / 100}`)}`} onClick={() => stage(`A${a! / 100}`)}>
                    {a! > APT.transitionAltitude ? `FL${a! / 100}` : a}
                  </button>
                ))}
                <button className={`exp ${staged('EXP')}`} onClick={() => stage('EXP')} title="Expedite the climb or descent in this transmission">
                  EXP
                </button>
              </div>
              <div className="qgroup">
                <span className="qk">SPD</span>
                {SPEEDS.map((s) => (
                  <button key={s} className={`${ac.spd === s ? 'on' : ''} ${staged(`S${s}`)}`} onClick={() => stage(`S${s}`)}>
                    {s}
                  </button>
                ))}
                <button className={staged('SR')} onClick={() => stage('SR')}>STD</button>
              </div>
              <div className="qgroup">
                <span className="qk">DCT</span>
                {fixes.map((f) => (
                  <button key={f} className={staged(`DCT ${f}`)} onClick={() => stage(`DCT ${f}`)}>
                    {f}
                  </button>
                ))}
                <button className={staged('RES')} onClick={() => stage('RES')} title="Resume own navigation on the filed route">
                  OWN NAV
                </button>
                {ac.kind === 'arr' && (
                  <button className={staged('HOLD')} onClick={() => stage('HOLD')} title="Hold at the published holding fix">
                    HOLD
                  </button>
                )}
              </div>
              {ac.kind === 'arr' ? (
                <div className="qgroup">
                  <span className="qk">APP</span>
                  {sim.config.arr.map((r) => (
                    <button key={r} className={`accent ${ac.approachCleared && ac.runway === r ? 'on' : ''} ${staged(`ILS${r}`)}`} onClick={() => stage(`ILS${r}`)}>
                      {APT.runways[r]?.locOnly ? 'LOC' : 'ILS'} {r}
                    </button>
                  ))}
                  {ROLE === 'arrival' ? (
                    <button className={`go ${staged('HO')}`} onClick={() => stage('HO')} title="Transfer to Tower once established">
                      TOWER
                    </button>
                  ) : (
                    <button className={`go ${staged('CL')}`} onClick={() => stage('CL')}>
                      CLEARED TO LAND
                    </button>
                  )}
                </div>
              ) : (
                <div className="qgroup">
                  <span className="qk">XFR</span>
                  <button className={`accent ${staged('HO')}`} onClick={() => stage('HO')} title="Hand off to the next sector">
                    HAND OFF
                  </button>
                </div>
              )}
              <div className={`qgroup compose ${value.trim() ? '' : 'empty'}`}>
                <span className="qk">TX</span>
                <span className="compose-text">{value.trim() ? value.trim().toUpperCase() : 'nothing staged: click chips or type'}</span>
                <button className="go" disabled={!value.trim()} onClick={transmit} title="Transmit (Enter)">
                  TRANSMIT ↵
                </button>
                {value.trim() && (
                  <button onClick={() => draft.clear()} title="Discard (Esc)">
                    ✕
                  </button>
                )}
              </div>
            </div>
          )}
          {ac.kind === 'arr' && ac.phase === 'rollout' && (
            <div className="quick">
              <div className="qgroup">
                <span className="qk">RWY</span>
                <button className="go" disabled={!!ac.flags.expedite} onClick={() => run('EXP')} title="Expedite vacating: brake firmly and take the first high-speed exit">
                  EXPEDITE VACATING
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
    <div className="cmd-wrap">
      {sugs.length > 0 && (
        <div className="cmd-sugs" role="listbox" aria-label="Suggestions">
          {sugs.map((s, i) => (
            <button key={s} role="option" aria-selected={i === sugIdx} className={i === sugIdx ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); accept(s); }}>
              {s}
              {APT.fixes[s] && <em>{sim.selected?.route.some((l) => l.t === 'FIX' && l.fix === s) ? 'on route' : 'fix'}</em>}
            </button>
          ))}
          <span className="cmd-sugs-hint">Tab to complete</span>
        </div>
      )}
      <div className={`cmd ${error ? 'err' : ''}`}>
        <span className={`prompt ${ac ? '' : 'idle'}`}>{ac ? ac.callsign : '›'}</span>
        <input
          ref={input}
          value={value}
          spellCheck={false}
          autoComplete="off"
          placeholder={ac ? 'L240 · S180 · DCT KAK · ILS · CL  (Enter sends)' : 'Click a target or type a callsign…'}
          onChange={(e) => {
            setValue(e.target.value);
            setSugIdx(0);
          }}
          onKeyDown={onKeyDown}
        />
        <span className="cmd-key" aria-hidden>
          ↵
        </span>
        {error && <span className="cmd-error">{error}</span>}
      </div>
    </div>
    </>
  );
}

const STEPS = [
  { phase: 'stand', label: 'Clearance' },
  { phase: 'taxi', label: 'Taxi' },
  { phase: 'ready', label: 'Holding point' },
  { phase: 'lineup', label: 'Line up' },
  { phase: 'takeoff', label: 'Take-off' },
] as const;

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Header numbers that matter in this phase: stand, runway and squawk on the ground. */
function stateTiles(ac: Aircraft): [string, string | number][] {
  if (ac.category === 'heli' && ac.phase === 'ready') return [['PAD', 'BASE'], ['SQK', ac.squawk]];
  if (ac.phase === 'stand' || ac.phase === 'taxi') return [['STAND', ac.flags.stand ?? '—'], ['RWY', ac.runway], ['SQK', ac.squawk]];
  if (ac.phase === 'ready') return [['RWY', ac.runway], ['CFL', ac.cfl], ['SQK', ac.squawk]];
  if (ac.phase === 'lineup' || ac.phase === 'takeoff') return [['RWY', ac.runway], ['HDG', String(Math.round(trueToMag(ac.hdg))).padStart(3, '0')], ['SQK', ac.squawk]];
  return [
    ['ALT', Math.round(ac.alt / 100) * 100],
    ['CFL', ac.cfl > APT.transitionAltitude ? fmtLevel(ac.cfl) : ac.cfl],
    ['HDG', String(Math.round(trueToMag(ac.hdg))).padStart(3, '0')],
    ['IAS', Math.round(ac.ias)],
  ];
}

/** Helipad or city name for a destination code. */
function placeName(code: string) {
  const pad = APT.ga?.hems && [APT.ga.hems.base, ...APT.ga.hems.pads].find((p) => p.id === code);
  return pad ? pad.name : code === 'SCENE' ? 'the scene' : code;
}

/**
 * Departure on the ground: a progress rail, only the clearances that apply now, and a status
 * line with the taxi or wake countdown.
 */
function GroundPanel({ ac, sim, run }: { ac: Aircraft; sim: Sim; run: (c: string) => boolean }) {
  const idx = STEPS.findIndex((s) => s.phase === ac.phase);
  const busy = sim.runwayBusy(ac, ac.runway);
  const wake = ac.phase === 'ready' || ac.phase === 'lineup' ? sim.departureWakeWait(ac) : null;
  const finalTraffic = sim.aircraft.find((a) => a.kind === 'arr' && a.locCaptured && sim.sameStrip(a.runway, ac.runway) && sim.distToThreshold(a) > 0 && sim.distToThreshold(a) < 4);
  let note: string;
  let tone: '' | 'warn' | 'idle' = '';
  let timer: string | null = null;
  let progress: number | null = null;
  if (ac.phase === 'stand') {
    note = ac.onFrequency ? `Requesting start-up · ${ac.sid?.name ?? ''} · squawk ${ac.squawk}` : 'Boarding · will call for start-up';
    tone = ac.onFrequency ? 'warn' : 'idle';
  } else if (ac.phase === 'taxi') {
    note = `Taxiing to holding point ${ac.runway}`;
    tone = 'idle';
    const t0 = ac.flags.taxiStart ?? sim.time;
    const t1 = ac.flags.taxiEnd ?? sim.time;
    timer = mmss(Math.max(0, t1 - sim.time));
    progress = t1 > t0 ? Math.min(1, Math.max(0, (sim.time - t0) / (t1 - t0))) : null;
  } else if (ac.phase === 'takeoff') {
    note = 'Rolling';
  } else if (busy) {
    note = 'Runway occupied';
    tone = 'warn';
  } else if (wake) {
    note = `Wake: wait behind ${wake.leader.callsign}`;
    tone = 'warn';
    timer = mmss(wake.left);
    progress = Math.min(1, Math.max(0, 1 - wake.left / wake.need));
  } else if (finalTraffic) {
    note = `${finalTraffic.callsign} on short final (${sim.distToThreshold(finalTraffic).toFixed(1)} NM)`;
    tone = 'warn';
  } else {
    note = `Runway ${ac.runway} clear`;
  }
  const actions: [string, string, string?][] =
    ac.phase === 'stand' && ac.onFrequency
      ? [['CLR', 'CLEARANCE & START-UP', 'go']]
      : ac.phase === 'ready'
        ? [['LU', 'LINE UP & WAIT'], ['CTO', 'CLEARED FOR TAKE-OFF', 'go'], ['CTO EXP', 'IMMEDIATE', 'exp']]
        : ac.phase === 'lineup'
          ? [['CTO', 'CLEARED FOR TAKE-OFF', 'go'], ['CTO EXP', 'IMMEDIATE', 'exp']]
          : [];
  return (
    <div className="quick flow-panel">
      <ol className="flow">
        {STEPS.map((s, i) => (
          <li key={s.phase} className={i < idx ? 'done' : i === idx ? 'now' : ''}>
            <span>{s.label}</span>
          </li>
        ))}
      </ol>
      {actions.length > 0 && (
        <div className="gact">
          {actions.map(([cmd, label, cls]) => (
            <button key={cmd} className={cls ?? ''} onClick={() => run(cmd)}>
              {label} <kbd>{cmd}</kbd>
            </button>
          ))}
        </div>
      )}
      <div className={`gstatus ${tone}`}>
        <span>{note}</span>
        {timer && <b>{timer}</b>}
      </div>
      {progress !== null && (
        <div className="gprog">
          <i style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

/** Completions for the word being typed: fixes after DCT/HOLD or as "D…" shorthand, else callsigns. */
function suggestions(value: string, sim: Sim): string[] {
  if (!value || /\s$/.test(value)) return [];
  const words = value.toUpperCase().split(/\s+/);
  const last = words[words.length - 1];
  const prev = words[words.length - 2];
  // Nothing selected yet: the first word is a callsign.
  if (words.length === 1 && !sim.selected && /^[A-Z]{2,3}\d*$/.test(last) && last.length >= 2) {
    return sim.aircraft.filter((a) => a.callsign.startsWith(last) && a.callsign !== last && (a.phase !== 'stand' || a.onFrequency)).map((a) => a.callsign).slice(0, 6);
  }
  let prefix: string | null = null;
  if (prev === 'DCT' || prev === 'HOLD') prefix = last;
  else if (/^D[A-Z]{1,4}$/.test(last)) prefix = last.slice(1);
  if (prefix !== null && prefix.length >= 1) {
    const route = sim.selected?.route.filter((l) => l.t === 'FIX').map((l) => (l as { fix: string }).fix) ?? [];
    const ranked = [...new Set([...route, ...APT.scopeFixes, ...Object.keys(APT.fixes)])].filter((f) => !f.startsWith('THR'));
    const hits = ranked.filter((f) => f.startsWith(prefix!));
    // Exact match typed already: nothing to suggest.
    return hits.length === 1 && hits[0] === prefix ? [] : hits.slice(0, 6);
  }
  if (words.length === 1 && /^[A-Z]{2,3}\d*$/.test(last) && last.length >= 2) {
    const cs = sim.aircraft.filter((a) => a.callsign.startsWith(last) && a.callsign !== last && (a.phase !== 'stand' || a.onFrequency)).map((a) => a.callsign);
    return cs.slice(0, 6);
  }
  return [];
}

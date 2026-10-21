import { useEffect, useState } from 'react';
import { APT } from '../data/airport';
import { VOICE_MODES, type RadioAudio, type VoiceMode } from '../audio/radio';
import { keyFor, maskKey, saveKey, type KeyProvider } from '../audio/keys';
import { initialContact } from '../sim/pilotTalk';
import { personaFor } from '../audio/personas';

const PROVIDER: Partial<Record<VoiceMode, KeyProvider>> = { eleven: 'elevenlabs', openai: 'openai', gemini: 'gemini', mistral: 'mistral' };
const KEY_HELP: Record<KeyProvider, { label: string; where: string }> = {
  elevenlabs: { label: 'ElevenLabs API key', where: 'elevenlabs.io → Developers → API keys (tip: give it a credit limit)' },
  openai: { label: 'OpenAI API key', where: 'platform.openai.com → API keys' },
  gemini: { label: 'Gemini API key', where: 'aistudio.google.com → Get API key' },
  mistral: { label: 'Mistral API key', where: 'console.mistral.ai → API keys' },
};
const SAMPLE_CALLSIGNS = ['KLM1234', 'DLH992', 'BAW420', 'AFR1205', 'THY1957', 'LOT282'];

interface Props {
  radio: RadioAudio;
  mode: VoiceMode;
  setMode: (m: VoiceMode) => void;
  compact?: boolean;
}

/** Pick the pilot-voice engine and manage your own API keys for it. */
export function VoicePanel({ radio, mode, setMode, compact }: Props) {
  const [draft, setDraft] = useState('');
  const [, bump] = useState(0);
  const [testing, setTesting] = useState<string | null>(null);
  // Re-render while the Kokoro model downloads, to show progress.
  useEffect(() => {
    if (mode !== 'kokoro') return;
    const t = setInterval(() => bump((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [mode]);
  const prov = PROVIDER[mode];
  const own = prov ? keyFor(prov) : undefined;
  const st = prov ? radio.providers[prov] : undefined;

  const left = (n: number) => (n < 10000 ? `${n.toLocaleString()} chars left` : `${(n / 1000).toFixed(1)}k left`);
  const source = (m: VoiceMode): { ok: boolean | null; text: string } | null => {
    // The full panel has the description underneath; only the compact one needs these.
    if (m === 'off') return compact ? { ok: null, text: 'no pilot audio' } : null;
    if (m === 'browser') return compact ? { ok: true, text: 'free · built in' } : null;
    if (m === 'kokoro') {
      const pr = radio.kokoroProgress;
      return { ok: true, text: pr !== null ? `downloading ${pr}%` : 'free · local' };
    }
    const p = PROVIDER[m];
    if (!p) return null;
    if (keyFor(p)) return { ok: true, text: 'your key' };
    const s = radio.providers[p];
    if (s?.serverKey) return { ok: (s.remaining ?? 1e9) > 1500, text: s.remaining !== null ? left(s.remaining) : 'server key' };
    return { ok: false, text: 'needs a key' };
  };

  const test = async () => {
    await radio.unlock();
    const cs = SAMPLE_CALLSIGNS[Math.floor(Math.random() * SAMPLE_CALLSIGNS.length)];
    const tel: Record<string, string> = { KLM: 'KLM', DLH: 'LUFTHANSA', BAW: 'SPEEDBIRD', AFR: 'AIRFRANS', THY: 'TURKISH', LOT: 'POLLOT' };
    const line = initialContact({ unit: APT.callsigns.approach, spoken: `${tel[cs.slice(0, 3)]} ${cs.slice(3)}`, callsign: cs, alt: 9400, cfl: 6000, star: 'RKN 3R', atis: 'K' });
    setTesting(`${personaFor(cs).label}: “${line.text}”`);
    radio.mode = mode;
    radio.enqueue(cs, line.speech, cs.startsWith('LOT') ? 'DH8D' : 'B738', true);
  };

  return (
    <div className={`voice-panel ${compact ? 'compact' : ''}`}>
      <div className="voice-list" role="radiogroup" aria-label="Pilot voice engine">
        {VOICE_MODES.map((v) => {
          const src = source(v.mode);
          return (
            <button
              key={v.mode}
              type="button"
              role="radio"
              aria-checked={mode === v.mode}
              className={`voice-opt ${mode === v.mode ? 'on' : ''}`}
              onClick={() => {
                setMode(v.mode);
                setDraft('');
                if (v.mode === 'kokoro') radio.warmKokoro();
              }}
            >
              <span className="vo-name">{v.label}</span>
              {src && (
                <span className={`vo-src ${src.ok === null ? '' : src.ok ? 'ok' : 'warn'}`} title={src.text}>
                  {src.text}
                </span>
              )}
              {!compact && <span className="vo-note">{v.note}</span>}
            </button>
          );
        })}
      </div>
      {prov && (
        <div className="key-row">
          <label htmlFor={`key-${prov}`}>{KEY_HELP[prov].label}</label>
          <div className="key-input">
            <input
              id={`key-${prov}`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={own ? `saved: ${maskKey(own)}` : st?.serverKey ? 'optional: using the server key' : 'paste your key'}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button
              type="button"
              disabled={!draft.trim()}
              onClick={() => {
                saveKey(prov, draft);
                setDraft('');
                bump((n) => n + 1);
              }}
            >
              Save
            </button>
            {own && (
              <button
                type="button"
                onClick={() => {
                  saveKey(prov, '');
                  bump((n) => n + 1);
                }}
              >
                Remove
              </button>
            )}
          </div>
          <div className="note">
            Stored only in this browser and sent to the provider through your local game server. Get one at {KEY_HELP[prov].where}.
          </div>
        </div>
      )}
      {mode !== 'off' && (
        <div className="test-row">
          <button type="button" className="btn-test" onClick={test}>
            ▶ Test voice
          </button>
          {testing && <span className="note">{testing}</span>}
        </div>
      )}
    </div>
  );
}

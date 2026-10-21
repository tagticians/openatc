// Radio audio: pilot transmissions through a VHF-style chain, one at a time.
//
//   voice ─▶ band-pass 380–2900 Hz ─▶ presence peak ─┐
//   cockpit bed ─▶ band-pass 150–3200 Hz ────────────┼─▶ saturation ─▶ compressor ─▶ AM fade ─▶ out
//   hiss ────────────────────────────────────────────┘
//
// Key-down is a dull carrier thump; key-up is the squelch tail (a short burst of band-limited
// static that slams shut). Voices come from a cloud engine through the local proxy (budgeted,
// cached, one persona per callsign), from Kokoro running in the browser, or from the browser's
// system voices (curated: no novelty voices).
import { isProp, usableSystemVoices } from './cast';
import { personaFor, styleInstruction } from './personas';
import { keyFor, type KeyProvider } from './keys';

/** Speech engine for pilot voices. 'browser' = system voices, 'eleven' = ElevenLabs. */
export type VoiceMode = 'off' | 'browser' | 'kokoro' | 'eleven' | 'openai' | 'gemini' | 'mistral';

const PROVIDER: Partial<Record<VoiceMode, KeyProvider>> = { eleven: 'elevenlabs', openai: 'openai', gemini: 'gemini', mistral: 'mistral' };
/**
 * Cloud engines are for local testing only (they need the dev server's proxy and someone's API
 * key); a shipped build offers the system voice and Kokoro. VITE_CLOUD_VOICES=1 forces them on.
 */
// Never in demo captures (?demo=…): the video shows what a player would get.
export const CLOUD_VOICES = (import.meta.env.DEV && !new URLSearchParams(window.location.search).has('demo')) || import.meta.env.VITE_CLOUD_VOICES === '1';
const ALL_VOICE_MODES: { mode: VoiceMode; label: string; note: string }[] = [
  { mode: 'off', label: 'Off', note: 'No pilot audio' },
  { mode: 'browser', label: 'System voice', note: 'Free, built into your browser; robotic, few accents' },
  { mode: 'kokoro', label: 'Kokoro (local)', note: 'Free and offline, runs in your browser; natural US/UK voices, no accents; ~90 MB download once' },
  { mode: 'eleven', label: 'ElevenLabs', note: 'Most natural; real accents from voice-library pilots; Flash v2.5' },
  { mode: 'gemini', label: 'Gemini', note: 'Gemini 3.8 Flash TTS; regional and native-language voices' },
  { mode: 'mistral', label: 'Mistral', note: 'Voxtral TTS; each pilot cloned from their own reference clip' },
  { mode: 'openai', label: 'OpenAI', note: 'gpt-4o-mini-tts; accent set by instruction' },
];
export const VOICE_MODES = ALL_VOICE_MODES.filter((v) => CLOUD_VOICES || v.mode === 'off' || v.mode === 'browser' || v.mode === 'kokoro');

interface Job {
  callsign: string;
  text: string;
  type: string;
  queuedAt: number;
  /** Readbacks of the controller's last instruction matter more than unprompted chatter. */
  priority: boolean;
}

/** Natural-sounding Flash settings from the Pilot Voice Lab, round 2. */
const VOICE_SETTINGS = { stability: 0.35, similarity_boost: 0.8, style: 0.3, speed: 1.05 };
const MAX_AGE_MS = 12000;

/**
 * Jet cockpit bed, synthesised (no recorded or generated audio to license): airflow roar as
 * filtered noise with a slow swell, plus the faint fan hum and compressor whine.
 */
function synthJetBed(c: AudioContext, seconds = 8): AudioBuffer {
  const rate = c.sampleRate;
  const n = rate * seconds;
  const buf = c.createBuffer(1, n, rate);
  const d = buf.getChannelData(0);
  let brown = 0;
  let lp = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1;
    brown = (brown + 0.02 * white) / 1.02; // ~ -6 dB/oct rumble
    lp += 0.18 * (white - lp); // airflow hiss, rolled off above a few kHz
    const t = i / rate;
    const swell = 0.85 + 0.15 * Math.sin(2 * Math.PI * (t / seconds) * 3); // whole cycles: seamless loop
    const hum = 0.05 * Math.sin(2 * Math.PI * 147 * t) + 0.03 * Math.sin(2 * Math.PI * 294 * t);
    const whine = 0.008 * Math.sin(2 * Math.PI * 1830 * t);
    d[i] = (brown * 3.2 + lp * 0.35) * swell + hum + whine;
    peak = Math.max(peak, Math.abs(d[i]));
  }
  // Cross-fade the tail into the head and drop the tail: the loop point is then seamless.
  const fade = Math.floor(rate * 0.25);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    d[i] = d[i] * k + d[n - fade + i] * (1 - k);
  }
  const out = c.createBuffer(1, n - fade, rate);
  const o = out.getChannelData(0);
  for (let i = 0; i < n - fade; i++) o[i] = d[i] * (0.6 / peak);
  return out;
}

export class RadioAudio {
  mode: VoiceMode = 'browser';
  volume = 0.8;
  status = { used: 0, budget: 20000, remaining: 20000, enabled: false };
  providers: Record<string, { serverKey: boolean; used: number; budget: number | null; remaining: number | null }> = {};
  onStatus?: () => void;
  onTransmit?: (callsign: string | null) => void;
  /** Tells the game when the radio changes voice source on its own (budget running out). */
  onNotice?: (text: string) => void;

  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private voiceIn!: GainNode;
  private ambIn!: GainNode;
  private post!: GainNode;
  private noiseBuf!: AudioBuffer;
  private jetBed: AudioBuffer | null = null;
  private queue: Job[] = [];
  private busy = false;
  private systemVoices: SpeechSynthesisVoice[] = [];

  /** Must be called from a user gesture (browser autoplay policy). */
  async unlock() {
    if (!this.ctx) this.build();
    // resume() only resolves after a user gesture; never let it block the game starting.
    if (this.ctx!.state === 'suspended') await Promise.race([this.ctx!.resume(), new Promise((r) => setTimeout(r, 500))]);
    this.refreshStatus();
    if ('speechSynthesis' in window) {
      const load = () => (this.systemVoices = usableSystemVoices(speechSynthesis.getVoices()));
      load();
      speechSynthesis.onvoiceschanged = load;
    }
    if (!this.jetBed) this.jetBed = synthJetBed(this.ctx!);
  }

  private build() {
    const c = (this.ctx = new AudioContext());
    this.master = c.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(c.destination);
    const shaper = c.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2);
    }
    shaper.curve = curve;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -24;
    comp.ratio.value = 6;
    const fade = c.createGain();
    fade.gain.value = 0.92;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.7;
    const lfoDepth = c.createGain();
    lfoDepth.gain.value = 0.06;
    lfo.connect(lfoDepth).connect(fade.gain);
    lfo.start();
    this.post = c.createGain();
    this.post.connect(shaper).connect(comp).connect(fade).connect(this.master);

    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 380;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2900;
    const peak = c.createBiquadFilter();
    peak.type = 'peaking';
    peak.frequency.value = 1700;
    peak.gain.value = 5;
    this.voiceIn = c.createGain();
    this.voiceIn.connect(hp).connect(lp).connect(peak).connect(this.post);

    const ahp = c.createBiquadFilter();
    ahp.type = 'highpass';
    ahp.frequency.value = 150;
    const alp = c.createBiquadFilter();
    alp.type = 'lowpass';
    alp.frequency.value = 3200;
    this.ambIn = c.createGain();
    this.ambIn.connect(ahp).connect(alp).connect(this.post);

    this.noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  async refreshStatus() {
    try {
      const r = await fetch('/api/tts/status');
      const j = await r.json();
      this.status = { used: j.used, budget: j.budget, remaining: j.remaining, enabled: j.enabled };
      this.providers = { elevenlabs: j.elevenlabs, openai: j.openai, gemini: j.gemini, mistral: j.mistral };
      this.onStatus?.();
    } catch {
      /* offline */
    }
  }

  /** Console alert tones, synthesised (no API cost). Bypasses the radio chain. */
  alert(kind: 'stca' | 'los') {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const notes = kind === 'stca' ? [880, 660] : [988, 740, 988, 740];
    const len = kind === 'stca' ? 0.16 : 0.12;
    notes.forEach((f, i) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = kind === 'stca' ? 'sine' : 'square';
      o.frequency.value = f;
      const t0 = c.currentTime + i * (len + 0.04);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.12 * this.volume, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + len);
      o.connect(g).connect(c.destination);
      o.start(t0);
      o.stop(t0 + len + 0.02);
    });
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  enqueue(callsign: string, text: string, type = '', priority = false) {
    if (this.mode === 'off' || !this.ctx) return;
    // A congested frequency drops chatter, never the readback you are waiting for.
    while (this.queue.length >= 3) {
      const i = this.queue.findIndex((j) => !j.priority);
      this.queue.splice(i >= 0 ? i : 0, 1);
    }
    this.queue.push({ callsign, text, type, queuedAt: performance.now(), priority });
    if (!this.busy) void this.next();
  }

  private async next() {
    let job = this.queue.shift();
    // Stale transmissions describe a situation that has moved on: skip them.
    while (job && performance.now() - job.queuedAt > MAX_AGE_MS) job = this.queue.shift();
    if (!job) {
      this.busy = false;
      this.onTransmit?.(null);
      return;
    }
    this.busy = true;
    // Pilot reaction time before keying the mic.
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 600));
    try {
      // Switch sources once for the whole session, never line by line: a crew must keep one voice.
      const prov = PROVIDER[this.mode];
      const st = prov && this.providers[prov];
      if (prov && !keyFor(prov) && st && (!st.serverKey || (st.remaining !== null && st.remaining < 1500))) {
        const why = !st.serverKey ? 'no API key' : `server budget nearly used (${st.remaining} characters left)`;
        this.mode = 'browser';
        this.onNotice?.(`${prov}: ${why}. Pilot voices switched to the system voice for this session; add your own key in Settings → Voices.`);
      }
      if (PROVIDER[this.mode]) await this.playRemote(job);
      else if (this.mode === 'kokoro') await this.playKokoro(job);
      else if (this.mode !== 'off') await this.playSystem(job);
    } catch (e) {
      console.warn('radio', e);
    }
    // A short gap between transmissions, as on a real frequency.
    await new Promise((r) => setTimeout(r, 250));
    void this.next();
  }

  // ---------------------------------------------------------------- effects
  private noiseBurst(at: number, dur: number, gain: number, lo: number, hi: number, dest: AudioNode, attack = 0.003, release = 0.01) {
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f1 = c.createBiquadFilter();
    f1.type = 'highpass';
    f1.frequency.value = lo;
    const f2 = c.createBiquadFilter();
    f2.type = 'lowpass';
    f2.frequency.value = hi;
    const g = c.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + attack);
    g.gain.setValueAtTime(gain * 0.85, at + Math.max(attack, dur - release));
    g.gain.linearRampToValueAtTime(0, at + dur);
    s.connect(f1).connect(f2).connect(g).connect(dest);
    s.start(at);
    s.stop(at + dur + 0.02);
  }

  /** Key-down: dull carrier thump plus a few ms of crackle. */
  private keyDown(at: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(140, at);
    o.frequency.exponentialRampToValueAtTime(60, at + 0.06);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.5, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
    o.connect(g).connect(this.post);
    o.start(at);
    o.stop(at + 0.08);
    this.noiseBurst(at, 0.035, 0.18, 800, 5000, this.post);
  }

  /** Key-up: the receiver's squelch opening on bare static for a moment, then closing hard. */
  private squelchTail(at: number) {
    const dur = 0.12 + Math.random() * 0.1;
    this.noiseBurst(at, dur, 0.55 * this.volume, 600, 4500, this.ctx!.destination, 0.003, 0.008);
    this.noiseBurst(at + dur, 0.006, 0.3 * this.volume, 2000, 7000, this.ctx!.destination, 0.001, 0.004);
  }

  /** Cockpit bed for the transmission: jet loop, or a twin-prop beat inside the radio band. */
  private cockpitBed(type: string, at: number): AudioScheduledSourceNode[] {
    const c = this.ctx!;
    const nodes: AudioScheduledSourceNode[] = [];
    if (isProp(type)) {
      const sum = c.createGain();
      sum.gain.value = 0.5;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      const pk = c.createBiquadFilter();
      pk.type = 'peaking';
      pk.frequency.value = 520;
      pk.gain.value = 6;
      sum.connect(lp).connect(pk).connect(this.ambIn);
      for (const f of [86, 87.3]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        const g = c.createGain();
        g.gain.value = 0.18;
        o.connect(g).connect(sum);
        o.start(at);
        nodes.push(o);
      }
      return nodes;
    }
    if (this.jetBed) {
      const s = c.createBufferSource();
      s.buffer = this.jetBed;
      s.loop = true;
      s.loopStart = Math.random() * 4;
      const g = c.createGain();
      g.gain.value = 0.45;
      s.connect(g).connect(this.ambIn);
      s.start(at, Math.random() * 4);
      nodes.push(s);
    }
    return nodes;
  }

  private hiss(at: number) {
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    const g = c.createGain();
    g.gain.value = 0.03;
    s.connect(g).connect(this.post);
    s.start(at);
    return s;
  }

  /** Open the transmitter: key-down, hiss and cockpit bed. Returns a function that closes it. */
  private openCarrier(job: Job, at: number) {
    this.onTransmit?.(job.callsign);
    this.keyDown(at);
    const beds = [this.hiss(at), ...this.cockpitBed(job.type, at)];
    return () => {
      const t = this.ctx!.currentTime;
      beds.forEach((n) => {
        try {
          n.stop(t + 0.02);
        } catch {
          /* already stopped */
        }
      });
      this.squelchTail(t + 0.02);
      this.onTransmit?.(null);
    };
  }

  // ---------------------------------------------------------------- voices
  /** Request body for the current provider: the persona's voice on that engine. */
  private speechRequest(job: Job) {
    const p = personaFor(job.callsign);
    switch (this.mode) {
      case 'openai':
        return { provider: 'openai', text: job.text, voice: { voice: p.openai.voice, instructions: styleInstruction(p) }, settings: { speed: 1.05 } };
      case 'gemini':
        return { provider: 'gemini', text: job.text, voice: { voice: p.gemini.voice, style: 'airline pilot on a VHF radio, speaking English, calm, brisk and professional' } };
      case 'mistral':
        return { provider: 'mistral', text: job.text, voice: { ref: p.mistral.ref } };
      default:
        return { provider: 'elevenlabs', text: job.text, voice: { id: p.eleven.id }, settings: { ...VOICE_SETTINGS, speed: p.eleven.speed ?? VOICE_SETTINGS.speed } };
    }
  }

  private async playRemote(job: Job) {
    const prov = PROVIDER[this.mode]!;
    const key = keyFor(prov);
    const r = await fetch('/api/tts/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { 'x-tts-key': key } : {}) },
      body: JSON.stringify(this.speechRequest(job)),
    });
    if (!r.ok) {
      const msg = await r.json().catch(() => ({ error: r.statusText }));
      // Auth, quota or budget problems won't fix themselves mid-session: switch once.
      if ([401, 402, 403, 429].includes(r.status)) {
        this.mode = 'browser';
        this.onNotice?.(`${prov}: ${msg.error ?? r.status}. Pilot voices switched to the system voice for this session.`);
      }
      await this.playSystem(job);
      return;
    }
    if (r.headers.get('x-tts-cache') === 'miss') this.refreshStatus();
    await this.transmit(job, await this.ctx!.decodeAudioData(await r.arrayBuffer()));
  }

  // ---------------------------------------------------------------- Kokoro (in-browser)
  private kokoro: Worker | null = null;
  private kokoroJobs = new Map<number, (b: AudioBuffer | null) => void>();
  private kokoroSeq = 0;
  private kokoroCache = new Map<string, AudioBuffer>();
  /** Download progress of the Kokoro model, 0–100; null once ready. */
  kokoroProgress: number | null = null;

  private kokoroWorker() {
    if (this.kokoro) return this.kokoro;
    const w = (this.kokoro = new Worker(new URL('./kokoroWorker.ts', import.meta.url), { type: 'module' }));
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') {
        this.kokoroProgress = Math.round(m.progress);
        this.onStatus?.();
      } else if (m.type === 'ready') {
        this.kokoroProgress = null;
        this.onStatus?.();
      } else if (m.type === 'audio' || m.type === 'error') {
        this.kokoroProgress = null;
        const done = this.kokoroJobs.get(m.id);
        this.kokoroJobs.delete(m.id);
        if (m.type === 'error') console.warn('kokoro', m.error);
        if (!done) return;
        if (m.type === 'error' || !this.ctx) return done(null);
        const b = this.ctx.createBuffer(1, m.samples.length, m.rate);
        b.copyToChannel(m.samples, 0);
        done(b);
      }
    };
    return w;
  }

  /** Start the model download early (from the voice picker), so the first call isn't slow. */
  warmKokoro() {
    this.kokoroWorker().postMessage({ type: 'warm' });
  }

  private async playKokoro(job: Job) {
    const voice = personaFor(job.callsign).kokoro.voice;
    const key = `${voice}|${job.text}`;
    let buf = this.kokoroCache.get(key) ?? null;
    if (!buf) {
      const id = ++this.kokoroSeq;
      buf = await new Promise<AudioBuffer | null>((resolve) => {
        this.kokoroJobs.set(id, resolve);
        this.kokoroWorker().postMessage({ id, text: job.text, voice, speed: 1.1 });
      });
      if (!buf) return this.playSystem(job);
      if (this.kokoroCache.size > 200) this.kokoroCache.clear();
      this.kokoroCache.set(key, buf);
    }
    await this.transmit(job, buf);
  }

  /** One transmission of a synthesised buffer through the radio chain. */
  private async transmit(job: Job, buf: AudioBuffer) {
    const c = this.ctx!;
    await new Promise<void>((resolve) => {
      const at = c.currentTime + 0.03;
      const close = this.openCarrier(job, at);
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(this.voiceIn);
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        close();
        resolve();
      };
      src.onended = done;
      setTimeout(done, buf.duration * 1000 + 1500); // safety net if the context stalls
      src.start(at + 0.07);
    });
  }

  /** System voice for a crew, from the persona's preferred locales; never a novelty voice. */
  private systemVoiceFor(callsign: string): SpeechSynthesisVoice | null {
    const vs = this.systemVoices;
    if (!vs.length) return null;
    const want = personaFor(callsign).system;
    const norm = (l: string) => l.replace('_', '-');
    let pool: SpeechSynthesisVoice[] = [];
    for (const loc of want) {
      pool = vs.filter((v) => norm(v.lang) === loc);
      if (pool.length) break;
    }
    if (!pool.length) pool = vs;
    let h = 2166136261;
    for (let i = 0; i < callsign.length; i++) h = Math.imul(h ^ callsign.charCodeAt(i), 16777619);
    return pool[(h >>> 0) % pool.length];
  }

  private playSystem(job: Job) {
    return new Promise<void>((resolve) => {
      if (!('speechSynthesis' in window)) return resolve();
      speechSynthesis.cancel(); // never stack utterances inside the browser's own queue
      const u = new SpeechSynthesisUtterance(job.text);
      const v = this.systemVoiceFor(job.callsign);
      if (v) {
        u.voice = v;
        u.lang = v.lang;
      }
      u.rate = 1.08;
      u.pitch = 1;
      u.volume = this.volume;
      let close: (() => void) | null = null;
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        close?.();
        resolve();
      };
      u.onstart = () => {
        close = this.openCarrier(job, this.ctx!.currentTime);
      };
      u.onend = done;
      u.onerror = done;
      speechSynthesis.speak(u);
      // Safety net sized to the line (some browsers never fire onend).
      setTimeout(() => {
        if (!finished) speechSynthesis.cancel();
        done();
      }, (job.text.length / 13) * 1000 + 4000);
    });
  }
}

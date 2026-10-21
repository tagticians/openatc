// Dev-server middleware: text-to-speech for pilot voices, provider-agnostic.
//
//   POST /api/tts/speak   { provider, text, voice, settings }  → audio
//   GET  /api/tts/status                                         → per-provider key + usage
//   GET  /api/tts/voices?provider=elevenlabs                     → voice list (ElevenLabs)
//
// Keys: a player's own key arrives per request in `x-tts-key` (bring your own key: kept in
// their browser, never stored here). Without one, the server falls back to a key from
// .env.local; those server keys are budget-capped (characters, persisted in .tts-usage.json).
// Every synthesised phrase is cached on disk (.tts-cache/), so a repeat costs nothing.
import type { Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Persona reference clips for voice cloning (dev/voice-refs/<id>.mp3; local testing only, not shipped). */
const REF_DIR = join(process.cwd(), 'dev', 'voice-refs');
const refAudio = (id: unknown) => {
  if (typeof id !== 'string' || !/^[a-z]+-[a-z]\d$/.test(id)) return undefined;
  const f = join(REF_DIR, `${id}.mp3`);
  return existsSync(f) ? readFileSync(f).toString('base64') : undefined;
};

export type ProviderId = 'elevenlabs' | 'openai' | 'gemini' | 'mistral';

interface Synth {
  audio: Buffer;
  type: string;
}

/** Cost weight per character against the budget (relative to ElevenLabs Flash). */
const ELEVEN_MODELS: Record<string, number> = { eleven_flash_v2_5: 1, eleven_turbo_v2_5: 1, eleven_multilingual_v2: 2, eleven_v3: 2 };

/** 16-bit mono PCM → WAV container (Gemini returns raw PCM). */
function wav(pcm: Buffer, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function fail(r: Response, who: string): Promise<never> {
  const body = (await r.text()).slice(0, 300);
  const err = new Error(`${who} ${r.status}: ${body}`) as Error & { status: number };
  err.status = r.status;
  throw err;
}

type Voice = Record<string, string | number | undefined>;

const PROVIDERS: Record<ProviderId, (key: string, text: string, voice: Voice, settings: Record<string, number>) => Promise<Synth>> = {
  async elevenlabs(key, text, voice, settings) {
    const model = typeof voice.model === 'string' && ELEVEN_MODELS[voice.model] ? voice.model : 'eleven_flash_v2_5';
    const vs = { stability: 0.35, similarity_boost: 0.8, style: 0.3, speed: 1.05, ...settings };
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice.id}?output_format=mp3_22050_32`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: model, voice_settings: model === 'eleven_v3' ? { stability: 0.5, similarity_boost: vs.similarity_boost } : vs }),
    });
    if (!r.ok) await fail(r, 'ElevenLabs');
    return { audio: Buffer.from(await r.arrayBuffer()), type: 'audio/mpeg' };
  },

  async openai(key, text, voice, settings) {
    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: voice.model ?? 'gpt-4o-mini-tts',
        voice: voice.voice ?? 'ash',
        input: text,
        instructions: voice.instructions,
        response_format: 'mp3',
        speed: settings.speed ?? 1.05,
      }),
    });
    if (!r.ok) await fail(r, 'OpenAI');
    return { audio: Buffer.from(await r.arrayBuffer()), type: 'audio/mpeg' };
  },


  async gemini(key, text, voice) {
    // Interactions API: the accent comes from the voice itself (regional and native-language
    // voices), the delivery from a speech_metadata style annotation.
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: voice.model ?? 'gemini-3.8-flash-tts',
        input: [{ type: 'user_input', content: [{ type: 'text', text, annotations: voice.style ? [{ type: 'speech_metadata', style: voice.style }] : [] }] }],
        response_format: { type: 'audio' },
        generation_config: { speech_config: [{ voice: voice.voice ?? 'charon' }] },
      }),
    });
    if (!r.ok) await fail(r, 'Gemini TTS');
    const j = (await r.json()) as { steps?: { content?: { data?: string; mime_type?: string }[] }[] };
    const part = j.steps?.flatMap((s) => s.content ?? []).find((c) => c.data);
    if (!part?.data) throw new Error('Gemini TTS returned no audio');
    const audio = Buffer.from(part.data, 'base64');
    return { audio: audio.subarray(0, 4).toString() === 'RIFF' ? audio : wav(audio), type: 'audio/wav' };
  },

  async mistral(key, text, voice) {
    // Voxtral: a preset voice id, or a persona reference clip cloned on the fly (that is
    // where the accent comes from).
    const ref = refAudio(voice.ref);
    const r = await fetch('https://api.mistral.ai/v1/audio/speech', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: voice.model ?? 'voxtral-mini-tts-2603',
        input: text,
        response_format: 'mp3',
        ...(ref ? { ref_audio: ref } : { voice_id: voice.id ?? 'e3596645-b1af-469e-b857-f18ddedc7652' }),
      }),
    });
    if (!r.ok) await fail(r, 'Mistral TTS');
    const j = (await r.json()) as { audio_data?: string };
    if (!j.audio_data) throw new Error('Mistral TTS returned no audio');
    return { audio: Buffer.from(j.audio_data, 'base64'), type: 'audio/mpeg' };
  },
};

export interface TtsEnv {
  keys: Partial<Record<ProviderId, string>>;
  /** Character budgets for the server's own keys (BYOK keys are the player's business). */
  budgets: Partial<Record<ProviderId, number>>;
}

export function ttsPlugin(env: TtsEnv): Plugin {
  const root = process.cwd();
  const cacheDir = join(root, '.tts-cache');
  const usageFile = join(root, '.tts-usage.json');
  if (!existsSync(cacheDir)) mkdirSync(cacheDir);
  type Usage = Record<string, { used: number; requests: number }>;
  const readUsage = (): Usage => {
    if (!existsSync(usageFile)) return {};
    const raw = JSON.parse(readFileSync(usageFile, 'utf8'));
    // Older single-provider format: { used, requests } was ElevenLabs.
    return typeof raw.used === 'number' ? { elevenlabs: { used: raw.used, requests: raw.requests } } : raw;
  };
  const budgetOf = (p: ProviderId) => env.budgets[p] ?? Infinity;
  let voicesCache: unknown = null;

  return {
    name: 'pilot-tts',
    configureServer(server) {
      server.middlewares.use('/api/tts', async (req, res) => {
        const send = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        };
        try {
          const url = new URL(req.url ?? '/', 'http://x');
          const byok = (req.headers['x-tts-key'] as string | undefined)?.trim() || undefined;

          if (req.method === 'GET' && url.pathname.startsWith('/status')) {
            const u = readUsage();
            const out: Record<string, unknown> = {};
            for (const p of Object.keys(PROVIDERS) as ProviderId[]) {
              const used = u[p]?.used ?? 0;
              const budget = budgetOf(p);
              out[p] = { serverKey: !!env.keys[p], used, budget: Number.isFinite(budget) ? budget : null, remaining: Number.isFinite(budget) ? Math.max(0, budget - used) : null };
            }
            // Back-compat fields for the ElevenLabs-only client.
            const e = out.elevenlabs as { serverKey: boolean; used: number; budget: number | null; remaining: number | null };
            return send(200, { ...out, enabled: e.serverKey, used: e.used, budget: e.budget, remaining: e.remaining ?? 0 });
          }

          if (req.method === 'GET' && url.pathname.startsWith('/voices')) {
            const key = byok ?? env.keys.elevenlabs;
            if (!key) return send(503, { error: 'no ElevenLabs key' });
            if (!voicesCache || byok) {
              const r = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } });
              const j = (await r.json()) as { voices?: { voice_id: string; name: string; labels?: Record<string, string>; category?: string }[] };
              const list = (j.voices ?? []).map((v) => ({ id: v.voice_id, name: v.name, labels: v.labels ?? {}, category: v.category }));
              if (!byok) voicesCache = list;
              return send(200, list);
            }
            return send(200, voicesCache);
          }

          if (req.method === 'POST' && url.pathname.startsWith('/speak')) {
            const chunks: Buffer[] = [];
            for await (const c of req) chunks.push(c as Buffer);
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              provider?: ProviderId;
              text: string;
              voice?: Voice;
              voiceId?: string; // legacy ElevenLabs field
              model?: string;
              settings?: Record<string, number>;
            };
            const provider: ProviderId = body.provider && body.provider in PROVIDERS ? body.provider : 'elevenlabs';
            const voice: Voice = body.voice ?? { id: body.voiceId, model: body.model };
            const text = body.text;
            if (!text || text.length > 500) return send(400, { error: 'bad request' });
            const settings = body.settings ?? {};

            const keyId = createHash('sha1').update(`${provider}|${JSON.stringify(voice)}|${JSON.stringify(settings)}|${text}`).digest('hex');
            // Phrases cached before the multi-provider proxy (ElevenLabs only) stay reusable.
            const legacy =
              provider === 'elevenlabs'
                ? createHash('sha1')
                    .update(`${voice.model ?? 'eleven_flash_v2_5'}|${voice.id}|${text}${body.settings ? JSON.stringify({ stability: 0.45, similarity_boost: 0.7, style: 0.15, speed: 1.12, ...settings }) : ''}`)
                    .digest('hex')
                : null;
            for (const name of [keyId, legacy].filter(Boolean).flatMap((k) => [`${k}.mp3`, `${k}.wav`])) {
              const f = join(cacheDir, name);
              const ext = name.endsWith('.wav') ? 'wav' : 'mp3';
              if (existsSync(f)) {
                res.setHeader('content-type', ext === 'mp3' ? 'audio/mpeg' : 'audio/wav');
                res.setHeader('x-tts-cache', 'hit');
                return res.end(readFileSync(f));
              }
            }

            const key = byok ?? env.keys[provider];
            if (!key) return send(401, { error: `No ${provider} key: add one in Settings → Voices` });
            const weight = provider === 'elevenlabs' && typeof voice.model === 'string' ? (ELEVEN_MODELS[voice.model] ?? 1) : 1;
            const cost = text.length * weight;
            const u = readUsage();
            const cur = u[provider] ?? { used: 0, requests: 0 };
            if (!byok && cur.used + cost > budgetOf(provider)) {
              return send(402, { error: `${provider} budget for the server key is used up`, used: cur.used, budget: budgetOf(provider) });
            }
            const out = await PROVIDERS[provider](key, text, voice, settings);
            writeFileSync(join(cacheDir, `${keyId}.${out.type === 'audio/wav' ? 'wav' : 'mp3'}`), out.audio);
            u[provider] = { used: cur.used + cost, requests: cur.requests + 1 };
            writeFileSync(usageFile, JSON.stringify(u));
            res.setHeader('content-type', out.type);
            res.setHeader('x-tts-cache', 'miss');
            res.setHeader('x-tts-key-source', byok ? 'player' : 'server');
            return res.end(out.audio);
          }
          send(404, { error: 'not found' });
        } catch (e) {
          const status = (e as { status?: number }).status;
          send(status && status >= 400 && status < 600 ? status : 500, { error: String((e as Error).message ?? e) });
        }
      });
    },
  };
}

// Kokoro-82M (Apache-2.0) speech, entirely in the browser: no key, no cost, works offline once
// the model (~90 MB, cached by the browser) has downloaded. Runs in a worker so synthesis never
// stalls the radar.
import { KokoroTTS } from 'kokoro-js';

type Req = { id: number; text: string; voice: string; speed: number };

let tts: Promise<KokoroTTS> | null = null;
const load = () =>
  (tts ??= (async () => {
    const webgpu = 'gpu' in navigator && !!(await (navigator as Navigator & { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null));
    return KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
      dtype: webgpu ? 'fp32' : 'q8',
      device: webgpu ? 'webgpu' : 'wasm',
      progress_callback: (p: { status: string; progress?: number }) => {
        if (p.status === 'progress' && typeof p.progress === 'number') self.postMessage({ type: 'progress', progress: p.progress });
      },
    });
  })());

self.onmessage = async (e: MessageEvent<Req | { type: 'warm' }>) => {
  const m = e.data;
  if ('type' in m) {
    load()
      .then(() => self.postMessage({ type: 'ready' }))
      .catch((err) => self.postMessage({ type: 'error', error: String(err) }));
    return;
  }
  try {
    const t = await load();
    const audio = await t.generate(m.text, { voice: m.voice as never, speed: m.speed });
    const samples = audio.audio as Float32Array;
    self.postMessage({ type: 'audio', id: m.id, samples, rate: audio.sampling_rate }, { transfer: [samples.buffer] });
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, error: String(err) });
  }
};

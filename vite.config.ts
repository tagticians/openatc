import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { ttsPlugin } from './server/ttsPlugin';
import { schedulePlugin } from './server/schedulePlugin';

export default defineConfig(({ mode }) => {
  // Secrets (ElevenLabs) are read here, in Node, and only used by server middleware.
  // Only MAPBOX_* (a public pk. token) is exposed to the browser.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      react(),
      ttsPlugin({
        keys: {
          elevenlabs: env.ELEVENLABS_API_KEY,
          openai: env.OPENAI_API_KEY ?? env.OPENAI_API,
          gemini: env.GEMINI_API_KEY ?? env.GEMINI_API,
          mistral: env.MISTRAL_API_KEY ?? env.MISTRAL_API,
        },
        budgets: {
          elevenlabs: Number(env.TTS_BUDGET ?? env.TTS_BUDGET_ELEVENLABS ?? 20000),
          openai: Number(env.TTS_BUDGET_OPENAI ?? 100000),
          gemini: Number(env.TTS_BUDGET_GEMINI ?? 100000),
          mistral: Number(env.TTS_BUDGET_MISTRAL ?? 100000),
        },
      }),
      schedulePlugin(env.AERODATABOX_API_KEY),
    ],
    envPrefix: ['VITE_', 'MAPBOX_'],
    server: {
      port: 5173,
      proxy: {
        '^/api/adsb/': {
          target: 'https://api.adsb.lol',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/adsb/, '/v2'),
        },
        '/api/adsbdb': {
          target: 'https://api.adsbdb.com',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/adsbdb/, '/v0'),
        },
        '/api/awc': {
          target: 'https://aviationweather.gov',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/awc/, '/api/data'),
        },
      },
    },
  };
});

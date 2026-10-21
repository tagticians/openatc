// Bring your own key: API keys for speech providers, kept only in this browser (localStorage).
// They are sent per request to the local dev server, which forwards them to the provider and
// never stores them.
export type KeyProvider = 'elevenlabs' | 'openai' | 'gemini' | 'mistral';

const STORE = 'atc.ttsKeys';

export function loadKeys(): Partial<Record<KeyProvider, string>> {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}');
  } catch {
    return {};
  }
}

export function saveKey(p: KeyProvider, key: string) {
  const k = loadKeys();
  if (key.trim()) k[p] = key.trim();
  else delete k[p];
  try {
    localStorage.setItem(STORE, JSON.stringify(k));
  } catch {
    /* storage unavailable: key lives for this session only */
  }
}

export const keyFor = (p: KeyProvider) => loadKeys()[p];

/** Show a key without revealing it: "sk-…a1b2". */
export const maskKey = (k?: string) => (k ? `${k.slice(0, 4)}…${k.slice(-4)}` : '');

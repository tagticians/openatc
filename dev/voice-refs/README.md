# Pilot reference clips (local testing only)

One ~12 s clip per pilot persona (`src/audio/personas.ts`), used by voice-cloning engines
(Mistral Voxtral today, a local cloner such as Chatterbox later) to give each pilot an accent.
Non-English personas speak their own language: the accent carries over when the clone speaks English.

- Source: synthetic voices from Gemini TTS (`gemini-3.8-flash-tts`). No real person's voice is used.
- Regenerate: `node --env-file=.env.local scripts/make-voice-refs.mjs [personaId…]`
- Not part of the game build: only the dev server reads them, for the cloud-voice experiments.
  Before ever shipping cloud voices, replace these with clips from an Apache/MIT model or consenting volunteers.

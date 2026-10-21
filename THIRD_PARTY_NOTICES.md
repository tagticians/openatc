# Third-party notices

The game's own code is MIT-licensed (see `LICENSE`). Everything below is someone else's work and
keeps its own terms. Only components, data and services the game actually uses are listed.

**Not for real-world navigation or air traffic control.** All aeronautical data is used for a game.

## Software shipped in the build

| Component | Version | License | Notes |
|---|---|---|---|
| [React](https://github.com/facebook/react), React DOM, scheduler | 18.3 | MIT | UI |
| [PixiJS](https://github.com/pixijs/pixijs) | 8.x | MIT | Radar scope rendering |
| [Mapbox GL JS](https://github.com/mapbox/mapbox-gl-js) | 3.x | Mapbox Web SDK Terms of Service (proprietary, not open source) | Base map. Each deployment needs its own Mapbox access token; keep the Mapbox and OpenStreetMap attribution visible (the map shows it). |
| [Inter](https://github.com/rsms/inter) via @fontsource/inter | 5.x | SIL Open Font License 1.1 | UI typeface |
| [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) via @fontsource/jetbrains-mono | 5.x | SIL Open Font License 1.1 | Scope and strip typeface |
| [kokoro-js](https://github.com/hexgrad/kokoro) | 1.2 | Apache-2.0 | Optional in-browser pilot voices (separate worker chunk) |
| [Transformers.js](https://github.com/huggingface/transformers.js) (@huggingface/transformers) | 3.x | Apache-2.0 | Used by kokoro-js |
| [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) | 1.2x | MIT | Used by Transformers.js |
| [phonemizer.js](https://github.com/xenova/phonemizer.js) | 1.2 | Apache-2.0 for its own code | Used by kokoro-js |
| [eSpeak NG](https://github.com/espeak-ng/espeak-ng) (compiled to WebAssembly inside phonemizer.js) | — | **GPL-3.0-or-later** | Turns text into phonemes for Kokoro. Because it is bundled, the Kokoro worker chunk (`kokoroWorker-*.js`) as distributed is covered by the GPL: the build ships the GPL text and source pointers in `public/licenses/`. The rest of the game does not include it. |

Build tools (not shipped): Vite (MIT), TypeScript (Apache-2.0), @vitejs/plugin-react (MIT), esbuild (MIT).

## Models downloaded at runtime

| Model | License | Notes |
|---|---|---|
| [Kokoro-82M v1.0 (ONNX)](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) and its voice packs | Apache-2.0 | Downloaded by the player's browser from Hugging Face the first time Kokoro is chosen; not stored in this repository. |

## Data

| Data | Source | License / terms | Notes |
|---|---|---|---|
| San Diego (KSAN), Norfolk (KORF) and Washington National (KDCA) procedures, fixes, runways, Class B/C airspace, prohibited/restricted areas (P-56) | FAA Coded Instrument Flight Procedures (CIFP), cycle 2610 | US Government work, public domain | `src/data/airports/KSAN.json`, `KORF.json`, `KDCA.json`, built by `scripts/cifp/build_airport.py`. FAA disclaimer: not for navigation. |
| San Diego, Norfolk and Washington minimum vectoring altitudes | FAA MVA charts SCT FUS3 (2025 v1), ORF FUS3 and PCT FUS3, AIXM | US Government work, public domain | `src/data/airports/KSAN.mva.json`, `KORF.mva.json`, `KDCA.mva.json`, built by `scripts/cifp/mva.py`. Stamped "NOT FOR NAVIGATION". |
| Rotterdam (EHRD) and Amsterdam (EHAM) procedures, fixes, airspace | LVNL eAIP Netherlands (AIRAC AMDT 10-2026) | © LVNL; reproduction terms per the AIP | `src/data/ehrd.ts`, `src/data/ehrdFixes.ts`, `src/data/airports/EHAM.json`. Included in this repository at the project owner's decision for a non-commercial game; they remain © LVNL. Rights holders who want them removed: please open an issue. The builder (`scripts/eaip/`) can regenerate them from an eAIP download. |
| London City (EGLC) procedures, holds, ILS, CTR/ATZ | UK eAIP, AIRAC 2026-10-01 (NATS) | © NATS Limited 2026 | `src/data/airports/EGLC.json`, transcribed from the AD 2 page and chart coding tables. Five points are computed (IF09, FAP09/27, MA09/27). Included at the project owner's decision for a non-commercial game; it remains © NATS. Rights holders who want it removed: please open an issue. |
| A13 motorway track and hospital helipads (Rotterdam HEMS corridor) | OpenStreetMap | Open Database License (ODbL) 1.0 | Seven points along the A13 and three helipads in `src/data/ehrd.ts`. Attribution: "© OpenStreetMap contributors". |
| Stand and runway holding positions (all airports) | OpenStreetMap (`aeroway=parking_position`, `aeroway=holding_position`) | Open Database License (ODbL) 1.0 | `src/data/airports/*.stands.json`, fetched by `scripts/osm/stands.mjs`. Attribution: "© OpenStreetMap contributors". |
| Taxiway network (all airports) | OpenStreetMap (`aeroway=taxiway`, `aeroway=taxilane`) | Open Database License (ODbL) 1.0 | `src/data/airports/*.taxi.json`, fetched by `scripts/osm/taxiways.mjs`. Attribution: "© OpenStreetMap contributors". |
| Live weather (METAR) | [aviationweather.gov](https://aviationweather.gov) (NOAA / NWS) | US Government work, public domain | Fetched at runtime. |
| Live aircraft positions | [adsb.lol](https://adsb.lol) | Open Database License (ODbL) 1.0 | Fetched at runtime. Attribution: "Live traffic © adsb.lol contributors, ODbL". |
| Flight routes | [VRS standing data](https://github.com/vradarserver/standing-data) (via adsb.lol) | CC0 1.0 | Fetched at runtime. |
| Flight routes (fallback) | [adsbdb](https://www.adsbdb.com) | Free public API | Fetched at runtime, credited. |
| Base map tiles | Mapbox, © OpenStreetMap contributors | Mapbox Terms of Service; OpenStreetMap data ODbL | Attribution shown on the map. |

## Artwork and trademarks

| Item | Source | License | Notes |
|---|---|---|---|
| Airline logos (`public/logos/*.svg`) | [soaring-symbols](https://github.com/soaring-symbols/soaring-symbols) | MIT for the files | Airline names and logos are trademarks of their owners. This project is not affiliated with or endorsed by any airline, airport, air navigation service provider or the FAA. Airlines without soaring-symbols artwork appear as text badges. |
| Radio and cockpit sounds | Synthesised in code (`src/audio/radio.ts`) | Project license | No recorded or AI-generated audio is shipped. |

## Local testing only (not part of the build)

The cloud voice engines (ElevenLabs, OpenAI, Gemini, Mistral) are available only on the
dev server, with the tester's own API keys, and are hidden in production builds. Their reference
clips (`dev/voice-refs/`, kept locally, not in this repository) are AI-generated with Gemini and are not shipped. Voice IDs in
`src/audio/personas.ts` refer to the providers' own voices and include no audio.

## Demo video tooling (`video/`, kept locally: not in this repository or the game build)

| Component | License | Notes |
|---|---|---|
| [Remotion](https://www.remotion.dev) (remotion, @remotion/cli, @remotion/google-fonts, @remotion/media-utils) | Remotion License: free for individuals and companies with up to 3 employees; larger companies need a company licence | Edits the demo video. |
| [Playwright](https://playwright.dev) | Apache-2.0 | Films the game's demo mode frame by frame. |
| [FFmpeg](https://ffmpeg.org) (system install, not bundled) | LGPL/GPL | Encoding and the VHF radio filter. |
| Voices in the rendered video | ElevenLabs output, under the account holder's plan | Generated by `video/voices.ts`; the clips themselves are not in the repository. |
| Speech-to-text check (`video/qa.mjs`) | OpenAI API terms | Optional; with the tester's own key. |

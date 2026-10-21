# Demo video

A short demo of the game at Rotterdam (EHRD), made from real gameplay. It comes in two cuts:

- `out/rotterdam-approach.mp4`: with a voiceover (ElevenLabs "Brian", a middle-aged American voice).
- `out/rotterdam-approach-radio.mp4`: no voiceover. Callouts on screen, and the pilots and
  controller on the radio do the demoing.

## How it is made

1. **Capture** (`capture.mjs`). The game has a demo mode (`?demo=<scene>`, dev server only,
   `src/demo/`). In that mode a scripted director runs each scene on fixed traffic and weather,
   frame by frame, and moves an on-screen cursor through the real UI. Playwright steps it at
   30 fps and screenshots every frame once the map tiles are in. Each take becomes
   `public/clips/<take>.mp4`, plus a log of every radio call with its frame number.
2. **Voices** (`voices.ts`). Every pilot and controller line from the logs is spoken by
   ElevenLabs in the game's persona voices, then given a VHF radio sound with ffmpeg. The
   voiceover lines come from `vo.json`. Everything is cached in `.voice-cache/`.
3. **Edit** (`src/`, [Remotion](https://www.remotion.dev)). The takes are cross-faded, with
   callouts, a time-lapse badge, the radio calls queued one at a time as on a real frequency,
   and (in one cut) the voiceover, with the radio ducked underneath it.

```sh
# in the project root
npm run dev

# in video/
node capture.mjs            # all takes (about 15 minutes), or name some: node capture.mjs taxi
npm run voices              # ElevenLabs: only new lines cost characters
npm run studio              # preview and tweak in the browser
npm run render              # both cuts into out/
```

The scenes are in `src/demo/scenes.ts` (project root), and the edit (order, callouts) in
`video/src/timeline.ts`.

## Licences

- Remotion is free for individuals and companies with up to three employees. Larger companies
  need a Remotion company licence (see remotion.dev/license).
- The map is Mapbox with OpenStreetMap data: keep the on-screen attribution.
- The voices are ElevenLabs output, under your ElevenLabs plan's terms.

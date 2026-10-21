import { Composition } from 'remotion';
import { Demo, timeline } from './Demo';
import { FPS } from './timeline';

/** Two cuts: with the voiceover, and radio-only (the pilots do the demoing). */
export function Root() {
  return (
    <>
      <Composition id="Demo" component={Demo} durationInFrames={timeline.total} fps={FPS} width={1920} height={1080} defaultProps={{ voiceover: true }} />
      <Composition id="DemoRadio" component={Demo} durationInFrames={timeline.total} fps={FPS} width={1920} height={1080} defaultProps={{ voiceover: false }} />
    </>
  );
}

// The demo video: captured takes, cross-faded, with callouts, a time-lapse badge, the radio
// and (in one version) a voiceover.
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';
import { AbsoluteFill, Audio, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { buildTimeline, FADE, FPS, INTRO, OUTRO, speedAt, type Callout, type PlacedAudio, type PlacedTake } from './timeline';

const { fontFamily: SANS } = loadInter();
const { fontFamily: MONO } = loadMono();

const C = {
  bg: '#04080e',
  text: '#e6f0fb',
  dim: '#8ea5c0',
  arr: '#5fd4ff',
  dep: '#6dffa8',
  amber: '#ffc24d',
};

export type DemoProps = {
  voiceover: boolean;
};

export const timeline = buildTimeline();

export function Demo({ voiceover }: DemoProps) {
  const { takes, radio, vo, outroFrom } = timeline;
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Sequence durationInFrames={INTRO + FADE}>
        <TitleCard />
      </Sequence>
      {takes.map((t) => (
        <Sequence key={t.id} from={t.from} durationInFrames={t.frames}>
          <Take take={t} />
        </Sequence>
      ))}
      <Sequence from={outroFrom} durationInFrames={OUTRO}>
        <EndCard />
      </Sequence>
      {radio.map((a, i) => (
        <Sequence key={`r${i}`} from={a.from} durationInFrames={a.frames + 4}>
          <Audio src={staticFile(a.file)} volume={(f) => (voiceover && underVo(a.from + f, vo) ? 0.38 : 0.9)} />
        </Sequence>
      ))}
      {voiceover &&
        vo.map((a, i) => (
          <Sequence key={`v${i}`} from={a.from} durationInFrames={a.frames + 4}>
            <Audio src={staticFile(a.file)} volume={1} />
          </Sequence>
        ))}
    </AbsoluteFill>
  );
}

const underVo = (f: number, vo: PlacedAudio[]) => vo.some((v) => f >= v.from - 6 && f <= v.from + v.frames + 6);

function Take({ take }: { take: PlacedTake }) {
  const f = useCurrentFrame();
  const opacity = interpolate(f, [0, FADE, take.frames - FADE, take.frames], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const speed = speedAt(take, f);
  return (
    <AbsoluteFill style={{ opacity }}>
      <OffthreadVideo src={staticFile(`clips/${take.id}.mp4`)} startFrom={take.trim ?? 0} muted />
      {take.callouts.map((c, i) => (
        <CalloutCard key={i} c={c} />
      ))}
      {speed > 1.5 && <SpeedBadge speed={speed} />}
    </AbsoluteFill>
  );
}

function CalloutCard({ c }: { c: Callout }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const start = Math.round(c.at * fps);
  const len = Math.round((c.dur ?? 3.8) * fps);
  if (f < start || f > start + len) return null;
  const local = f - start;
  const inS = spring({ frame: local, fps, config: { damping: 18, stiffness: 140 } });
  const out = interpolate(local, [len - 10, len], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div
      style={{
        position: 'absolute',
        left: 360,
        bottom: 150,
        opacity: inS * out,
        transform: `translateY(${(1 - inS) * 18}px)`,
        padding: '18px 26px 18px 22px',
        borderLeft: `3px solid ${C.amber}`,
        background: 'linear-gradient(90deg, rgba(4,8,14,0.92), rgba(4,8,14,0.72))',
        borderRadius: '0 12px 12px 0',
        boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
        maxWidth: 820,
      }}
    >
      <div style={{ fontFamily: SANS, fontSize: 40, fontWeight: 700, color: C.text, letterSpacing: '-0.01em' }}>{c.title}</div>
      {c.sub && <div style={{ fontFamily: MONO, fontSize: 21, color: C.amber, marginTop: 6, letterSpacing: '0.02em' }}>{c.sub}</div>}
    </div>
  );
}

function SpeedBadge({ speed }: { speed: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        right: 340,
        top: 96,
        fontFamily: MONO,
        fontSize: 26,
        fontWeight: 700,
        color: C.amber,
        padding: '8px 14px',
        border: `1px solid rgba(255,194,77,0.6)`,
        borderRadius: 8,
        background: 'rgba(4,8,14,0.82)',
      }}
    >
      ▶▶ {Math.round(speed)}×
    </div>
  );
}

function Radar({ size = 220 }: { size?: number }) {
  const f = useCurrentFrame();
  const a = (f / FPS) * 120;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={{ color: C.arr, filter: 'drop-shadow(0 0 18px rgba(95,212,255,0.5))' }}>
      <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeOpacity=".35" strokeWidth="0.6" />
      <circle cx="16" cy="16" r="8" fill="none" stroke="currentColor" strokeOpacity=".5" strokeWidth="0.6" />
      <g transform={`rotate(${a} 16 16)`}>
        <path d="M16 16 L16 2 A14 14 0 0 1 29 11 Z" fill="currentColor" fillOpacity=".35" />
      </g>
      <circle cx="22" cy="9" r="1.2" fill="currentColor" />
    </svg>
  );
}

function TitleCard() {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f, fps, config: { damping: 20 } });
  const out = interpolate(f, [INTRO - 8, INTRO + FADE], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: out, background: 'radial-gradient(ellipse at center, #0b1628 0%, #04080e 70%)' }}>
      <div style={{ transform: `scale(${0.9 + s * 0.1})`, opacity: s, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28 }}>
        <Radar />
        <div style={{ fontFamily: SANS, fontSize: 92, fontWeight: 800, color: C.text, letterSpacing: '-0.02em' }}>Rotterdam Approach</div>
        <div style={{ fontFamily: MONO, fontSize: 26, color: C.dim, letterSpacing: '0.24em', textTransform: 'uppercase' }}>EHRD · APP 122.990 · TWR 118.205</div>
      </div>
    </AbsoluteFill>
  );
}

function EndCard() {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f, fps, config: { damping: 20 } });
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: s, background: 'radial-gradient(ellipse at center, #0b1628 0%, #04080e 70%)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26 }}>
        <Radar size={160} />
        <div style={{ fontFamily: SANS, fontSize: 80, fontWeight: 800, color: C.text, letterSpacing: '-0.02em' }}>Rotterdam Approach</div>
        <div style={{ fontFamily: MONO, fontSize: 26, color: C.amber, letterSpacing: '0.08em' }}>Six airports · real procedures · live weather</div>
        <div style={{ fontFamily: SANS, fontSize: 24, color: C.dim, marginTop: 10 }}>The frequency is yours.</div>
      </div>
    </AbsoluteFill>
  );
}

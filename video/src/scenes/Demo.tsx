import { Freeze, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion'
import { colorOf } from '../../../app/src/shared/constants'
import { BG, Page } from '../common'

/**
 * IMG_4968 (3840 × 2160) cropped to x 0, y 240, 3413 × 1920 (1.125×: keeps faces out without hiding where the hand lands) and scaled
 * to 1080p with a keyframe every 10 frames, so frames extract quickly at any point:
 * ffmpeg -i IMG_4968.mp4 -vf "crop=3413:1920:0:240,scale=1920:1080:flags=lanczos" -c:v libx264 -crf 14 -g 10 -c:a copy IMG_4968-1080.mp4
 */
const FOOTAGE = 'footage/IMG_4968-1080.mp4'
/**
 * Footage frames (30 fps) used, end exclusive. The knock at frame 161 changed nothing on the PC screen and was tapped again at 313,
 * so the clip skips from before that hand moves (132) to before the retry starts (284).
 */
const SEGMENTS = [{ from: 15, to: 132 }, { from: 284, to: 582 }] as const
/** Frames of the dip to the background between the segments, and of the hold on the last frame so the last app can be seen opening. */
const DIP = 8, HOLD = 30
export const DEMO_FRAMES = SEGMENTS.reduce((sum, s) => sum + s.to - s.from, 0) + DIP + HOLD
/**
 * Knocks after which the PC screen changed: the frame of the knock's sound peak, and where the hand lands on the 1920 × 1080 screen.
 * Found from the audio track (the only loud sounds in the clip) and the frames at those moments.
 */
const KNOCKS = [
  { at: 44, x: 1665, y: 270 },
  { at: 313, x: 364, y: 660 },
  { at: 428, x: 1010, y: 690 },
  { at: 517, x: 1390, y: 80 }
]
const RING_FRAMES = 22
const TAP = colorOf('cyan')[1]

function Ring({ age }: { age: number }) {
  if (age < -2 || age >= RING_FRAMES) return null
  const t = interpolate(age, [-2, RING_FRAMES], [0, 1], { easing: t => 1 - (1 - t) ** 2 })
  // Cyan is the app's color for "tap here"; white would vanish on the white desk.
  return <span style={{ position: 'absolute', width: 260, height: 260, margin: -130, borderRadius: '50%', border: `10px solid ${TAP}`, transform: `scale(${0.2 + 0.8 * t})`, opacity: 1 - t }} />
}

/** One continuous stretch of the footage, with rings on the knocks inside it. */
function Segment({ from, to, last }: { from: number; to: number; last: boolean }) {
  const frame = useCurrentFrame()
  return <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
    <Freeze frame={to - from - 1} active={last && frame >= to - from}>
      <OffthreadVideo src={staticFile(FOOTAGE)} trimBefore={from} trimAfter={to} style={{ position: 'absolute', inset: 0, width: 1920, height: 1080 }} />
    </Freeze>
    {KNOCKS.filter(k => k.at >= from && k.at < to).map(k => <div key={k.at} style={{ position: 'absolute', left: k.x, top: k.y }}>
      <Ring age={frame - (k.at - from)} />
    </div>)}
  </div>
}

export function Demo() {
  const frame = useCurrentFrame()
  const [a, b] = SEGMENTS
  const first = a.to - a.from, startB = first + DIP
  // Fade the first segment out and the second in, so the skipped part reads as a cut.
  const opacity = frame < startB
    ? interpolate(frame, [first - DIP / 2, first], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    : interpolate(frame, [startB, startB + DIP / 2], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return <Page logo={false}>
    <div style={{ position: 'absolute', inset: 0, opacity }}>
      <Sequence durationInFrames={first}><Segment from={a.from} to={a.to} last={false} /></Sequence>
      <Sequence from={startB}><Segment from={b.from} to={b.to} last /></Sequence>
    </div>
    <div style={{ position: 'absolute', top: 40, left: 40, background: BG, borderRadius: 16, padding: '14px 28px', fontSize: 40, fontWeight: 800 }}>机をたたくデモ</div>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 930 - 40, display: 'flex', justifyContent: 'center' }}>
      <span style={{ background: BG, borderRadius: 16, padding: '12px 28px', fontSize: 40, lineHeight: '56px' }}>机を叩くと、割り当てたアプリが開く</span>
    </div>
  </Page>
}

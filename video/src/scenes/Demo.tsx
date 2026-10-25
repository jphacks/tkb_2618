import { Freeze, OffthreadVideo, interpolate, staticFile, useCurrentFrame } from 'remotion'
import { colorOf } from '../../../app/src/shared/constants'
import { BG, Page } from '../common'

/** Part of IMG_4968 (3840 × 2160) shown full screen: 1.125× and no more, which keeps faces out without hiding where the hand lands. */
export const FOOTAGE_CROP = { x: 0, y: 240, width: 3413, height: 1920, sourceWidth: 3840, sourceHeight: 2160 } as const
/** Footage frames (30 fps) used: 0.5 s to 19.4 s. */
export const FOOTAGE_START = 15, FOOTAGE_END = 582
/**
 * Knocks in the footage: the frame of each knock's sound peak, and where the hand lands on the 1920 × 1080 screen.
 * Found from the audio track (the only loud sounds in the clip) and the frames at those moments.
 */
const KNOCKS = [
  { at: 44, x: 1665, y: 270 },
  { at: 161, x: 360, y: 660 },
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

export function Demo() {
  const frame = useCurrentFrame()
  const length = FOOTAGE_END - FOOTAGE_START
  const scale = 1080 / FOOTAGE_CROP.height
  return <Page logo={false}>
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <Freeze frame={length - 1} active={frame >= length}>
        <OffthreadVideo src={staticFile('footage/IMG_4968.mp4')} trimBefore={FOOTAGE_START} trimAfter={FOOTAGE_END}
          style={{ position: 'absolute', width: FOOTAGE_CROP.sourceWidth * scale, height: FOOTAGE_CROP.sourceHeight * scale, left: -FOOTAGE_CROP.x * scale, top: -FOOTAGE_CROP.y * scale }} />
      </Freeze>
      {KNOCKS.map(k => <div key={k.at} style={{ position: 'absolute', left: k.x, top: k.y }}>
        <Ring age={frame - (k.at - FOOTAGE_START)} />
      </div>)}
    </div>
    <div style={{ position: 'absolute', top: 40, left: 40, background: BG, borderRadius: 16, padding: '14px 28px', fontSize: 40, fontWeight: 800 }}>机をたたくデモ</div>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 930 - 40, display: 'flex', justifyContent: 'center' }}>
      <span style={{ background: BG, borderRadius: 16, padding: '12px 28px', fontSize: 40, lineHeight: '56px' }}>机を叩くと、割り当てたアプリが開く</span>
    </div>
  </Page>
}

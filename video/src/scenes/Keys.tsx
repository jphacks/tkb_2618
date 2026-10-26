import { interpolate, useCurrentFrame } from 'remotion'
import { DEFAULT_CONFIG, REGIONS, colorOf } from '../../../app/src/shared/constants'
import { BG, Enter, Page, SURFACE } from '../common'
import { DESK_MAP_SIZE, DeskMap } from '../app-ui/DeskMap'

/** Knocks on the desk, in frames. The second tap of a double comes TAP_GAP later; the key fires FIRE_DELAY after the last tap. */
export const KNOCKS = [{ region: 0, count: 1, at: 18 }, { region: 3, count: 2, at: 54 }, { region: 1, count: 1, at: 90 }, { region: 2, count: 2, at: 126 }]
const TAP_GAP = 8, FIRE_DELAY = 6, RING_FRAMES = 15
const DESK = { x: 500, y: 470, width: 720, height: 480, divider: 16 }
const MAP = { x: 1400, y: 470, scale: 1.4 }
const keyColor = (index: number) => {
  const value = DEFAULT_CONFIG.profiles[0].keys[index]
  return value ? colorOf(value.color)[1] : '#EDEDED'
}

function Knock({ age, color }: { age: number; color: string }) {
  if (age < 0) return null
  const progress = Math.min(1, age / RING_FRAMES), t = 1 - (1 - progress) ** 2
  const dot = interpolate(age, [0, 4, 24, 32], [0, 1, 1, 0], { extrapolateRight: 'clamp' })
  return <>
    <span style={{ position: 'absolute', left: '50%', top: '50%', width: 28, height: 28, margin: -14, borderRadius: '50%', background: color, opacity: dot }} />
    {progress < 1 && <span style={{ position: 'absolute', left: '50%', top: '50%', width: 240, height: 240, margin: -120, borderRadius: '50%', border: `4px solid ${color}`, transform: `scale(${0.12 + 0.88 * t})`, opacity: 1 - progress }} />}
  </>
}

export function Keys({ still = false }: { still?: boolean }) {
  const current = useCurrentFrame()
  const frame = still ? 98 : current
  const fired: Record<number, number> = {}
  for (const k of KNOCKS) {
    const fireAt = k.at + (k.count - 1) * TAP_GAP + FIRE_DELAY
    if (frame >= fireAt) fired[k.region * 2 + k.count - 1] = frame - fireAt
  }
  const half = (DESK.width - DESK.divider) / 2, halfHeight = (DESK.height - DESK.divider) / 2
  return <Page>
    <Enter frame={frame} style={{ position: 'absolute', left: DESK.x - DESK.width / 2, top: DESK.y - DESK.height / 2 }}>
      <div aria-label="机" style={{ width: DESK.width, height: DESK.height, borderRadius: 40, overflow: 'hidden', background: BG, display: 'grid', gridTemplateColumns: `${half}px ${half}px`, gridTemplateRows: `${halfHeight}px ${halfHeight}px`, gap: DESK.divider }}>
        {REGIONS.map((name, r) => <div key={name} style={{ position: 'relative', background: SURFACE }}>
          <span style={{ position: 'absolute', left: 28, top: 20, fontSize: 28, color: '#4A4A4A' }}>{name}</span>
          {KNOCKS.filter(k => k.region === r).flatMap(k => Array.from({ length: k.count }, (_, i) =>
            <Knock key={i} age={frame - k.at - i * TAP_GAP} color={keyColor(r * 2 + k.count - 1)} />))}
        </div>)}
      </div>
    </Enter>
    <Enter at={6} frame={frame} style={{ position: 'absolute', left: MAP.x - DESK_MAP_SIZE.width * MAP.scale / 2, top: MAP.y - DESK_MAP_SIZE.height * MAP.scale / 2 }}>
      <div style={{ transform: `scale(${MAP.scale})`, transformOrigin: 'top left' }}><DeskMap fired={fired} /></div>
    </Enter>
    <h1 style={{ position: 'absolute', left: 0, right: 0, top: 900 - 40, textAlign: 'center', fontSize: 56, fontWeight: 800 }}>4 か所 × 1 回 / 2 回 = 8 つの操作</h1>
  </Page>
}

import { interpolate, useCurrentFrame } from 'remotion'
import { REGIONS, colorOf } from '../../../app/src/shared/constants'
import { BG, Caption, FG, Icon, Page, SURFACE } from '../common'

/** The calibration screen (Calibration.tsx, styles.css) at 1.5×: each region is tapped 3 times, then shows a check. */
const SCALE = 1.5
const TILE = { width: 240 * SCALE, height: 190 * SCALE, gap: 16 * SCALE }
const GRID = { width: 2 * TILE.width + TILE.gap, height: 2 * TILE.height + TILE.gap, centerY: 480 }
const CAPTION = 'いろんな机に対応できる', SUB = '最初に 4 か所を 3 回ずつ叩くと、その机用の判定の値が自動で決まる'
export const CALIBRATION_TEXT = `${CAPTION} ${SUB}`
const STEP_FRAMES = 36, HIT_FRAMES = [8, 17, 26], TAPS = 3

export function Calibration() {
  const frame = useCurrentFrame()
  const step = Math.min(REGIONS.length, Math.floor(frame / STEP_FRAMES))
  const inStep = frame - step * STEP_FRAMES
  const hits = HIT_FRAMES.filter(at => inStep >= at).length
  const lastHit = hits ? inStep - HIT_FRAMES[hits - 1] : -1
  const active = colorOf('cyan')[1]
  const left = (1920 - GRID.width) / 2, top = GRID.centerY - GRID.height / 2
  return <Page>
    <div style={{ position: 'absolute', left, width: GRID.width, top: top - 70, display: 'flex', gap: 6 * SCALE }}>
      {REGIONS.map((name, i) => <span key={name} style={{ flex: 1, height: 4 * SCALE, borderRadius: 2 * SCALE, background: i < step ? FG : i === step ? active : '#2A2A2A' }} />)}
    </div>
    <div style={{ position: 'absolute', left, top, display: 'grid', gridTemplateColumns: `repeat(2, ${TILE.width}px)`, gridTemplateRows: `repeat(2, ${TILE.height}px)`, gap: TILE.gap }}>
      {REGIONS.map((name, i) => {
        const current = i === step
        return <div key={name} aria-label={name} style={{ position: 'relative', borderRadius: 36 * SCALE, background: current ? active : SURFACE, color: BG, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18 * SCALE }}>
          {i < step && <span style={{ color: '#13D66A' }}><Icon name="check" size={36 * SCALE} /></span>}
          {current && <>
            <span style={{ fontSize: 18 * SCALE, fontWeight: 700 }}>叩く</span>
            <span style={{ display: 'flex', gap: 8 * SCALE }}>
              {Array.from({ length: TAPS }, (_, n) => <i key={n} style={{ width: 10 * SCALE, height: 10 * SCALE, borderRadius: '50%', border: `${2 * SCALE}px solid ${BG}`, background: n < hits ? BG : 'transparent' }} />)}
            </span>
            {lastHit >= 0 && lastHit < 15 && <span style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', border: `${4 * SCALE}px solid #FFFFFF`, transform: `scale(${1 + 0.18 * lastHit / 15})`, opacity: interpolate(lastHit, [0, 15], [0.9, 0]) }} />}
          </>}
        </div>
      })}
    </div>
    <Caption sub={SUB}>{CAPTION}</Caption>
  </Page>
}

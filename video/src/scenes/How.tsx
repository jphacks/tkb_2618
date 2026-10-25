import type { ReactNode } from 'react'
import { interpolate, useCurrentFrame } from 'remotion'
import { COLORS, DEFAULT_CONFIG } from '../../../app/src/shared/constants'
import { Caption, Enter, FG, FIELD, Icon, Key, Page, Ripple, SURFACE } from '../common'

const CAPTIONS = ['机の裏の 4 か所に貼ったピエゾが、叩いた振動を拾う', 'マイコンは、4 ch の波形をそのまま PC に送る', 'アプリが 4 ch の振れ方から、叩いた場所と回数を見分ける']
const CAPTION_FRAMES = 90
const BOX = { width: 300, height: 200, gap: 120, top: 200 }
const LEFT = (1920 - 4 * BOX.width - 3 * BOX.gap) / 2
const WAVE = { top: 520, height: 240, speed: 12 }
/** Knocks on the top-left region; how strongly each piezo (one per region) feels it. */
const KNOCKS = [40, 185]
const FEEL = [1, 0.5, 0.36, 0.22]
/** The app has decided "top left, once" this long after the second knock; the key fires a little later. */
const DECIDED = KNOCKS[1] + 12, FIRED = DECIDED + 10
const CHIP = 'M6 6h12v12H6z M9 9v6h6V9z M8 2h2v3H8z M11 2h2v3h-2z M14 2h2v3h-2z M8 19h2v3H8z M11 19h2v3h-2z M14 19h2v3h-2z M2 8h3v2H2z M2 11h3v2H2z M2 14h3v2H2z M19 8h3v2h-3z M19 11h3v2h-3z M19 14h3v2h-3z'

function signal(channel: number, t: number): number {
  let v = 0.035 * Math.sin(t * 0.9 + channel * 2.1) + 0.025 * Math.sin(t * 2.3 + channel)
  for (const at of KNOCKS) {
    const age = t - at
    if (age >= 0) v += FEEL[channel] * Math.exp(-age / 3.2) * Math.sin(age * 4.2)
  }
  return v
}

function Waves({ frame }: { frame: number }) {
  const width = 4 * BOX.width + 3 * BOX.gap, lane = WAVE.height / 4
  return <svg width={width} height={WAVE.height} viewBox={`0 0 ${width} ${WAVE.height}`} style={{ position: 'absolute', left: LEFT, top: WAVE.top, overflow: 'visible' }}>
    {COLORS.slice(0, 4).map(([id, color], ch) => {
      const points = Array.from({ length: width / 3 + 1 }, (_, i) => {
        const x = i * 3
        const y = lane * (ch + 0.5) - signal(ch, frame - (width - x) / WAVE.speed) * lane * 0.9
        return `${i ? 'L' : 'M'}${x},${y.toFixed(1)}`
      })
      return <path key={id} d={points.join(' ')} fill="none" stroke={color} strokeWidth={3} strokeLinejoin="round" />
    })}
  </svg>
}

function Box({ index, name, frame, pulse, children }: { index: number; name: string; frame: number; pulse: number; children: ReactNode }) {
  return <div style={{ position: 'absolute', left: LEFT + index * (BOX.width + BOX.gap), top: BOX.top }}>
    <Enter at={index * 8} frame={frame}>
      <div style={{ position: 'relative', width: BOX.width, height: BOX.height, borderRadius: 24, background: SURFACE, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22 }}>
        <div style={{ height: 88, display: 'flex', alignItems: 'center' }}>{children}</div>
        <span style={{ fontSize: 32 }}>{name}</span>
        <Ripple age={pulse} />
      </div>
    </Enter>
  </div>
}

/** Arrow between box `index` and the next, with data dots streaming along it while `flowing`. */
function Arrow({ index, frame, flowing }: { index: number; frame: number; flowing: boolean }) {
  const x = LEFT + index * (BOX.width + BOX.gap) + BOX.width, y = BOX.top + BOX.height / 2
  return <svg width={BOX.gap} height={40} viewBox={`0 0 ${BOX.gap} 40`} style={{ position: 'absolute', left: x, top: y - 20 }}>
    <path d={`M20 20H${BOX.gap - 26}`} stroke="#5A5A5A" strokeWidth={4} strokeLinecap="round" />
    <path d={`M${BOX.gap - 34} 10L${BOX.gap - 20} 20L${BOX.gap - 34} 30`} fill="none" stroke="#5A5A5A" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
    {flowing && [0, 1, 2].map(i => <circle key={i} cx={20 + ((frame * 4 + i * 26) % 70)} cy={20} r={5} fill={FG} />)}
  </svg>
}

export function How({ still = false }: { still?: boolean }) {
  const current = useCurrentFrame()
  const frame = still ? FIRED + 3 : current
  const ages = KNOCKS.map(at => frame - at).filter(age => age >= 0)
  const sinceKnock = ages.length ? Math.min(...ages) : -1
  const chip = interpolate(frame, [DECIDED, DECIDED + 6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return <Page>
    <Box index={0} name="ピエゾ × 4" frame={frame} pulse={sinceKnock}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 26px)', gap: 18 }}>
        {COLORS.slice(0, 4).map(([id, color]) => <span key={id} style={{ width: 26, height: 26, borderRadius: '50%', background: color }} />)}
      </div>
    </Box>
    <Box index={1} name="XIAO ESP32S3" frame={frame} pulse={-1}>
      <svg width={72} height={72} viewBox="0 0 24 24"><path d={CHIP} fill={FG} fillRule="evenodd" /></svg>
    </Box>
    <Box index={2} name="PC アプリ" frame={frame} pulse={frame - DECIDED}>
      <Icon name="app" size={72} />
    </Box>
    <Box index={3} name="操作" frame={frame} pulse={-1}>
      <Key value={DEFAULT_CONFIG.profiles[0].keys[0]} size={88} age={frame - FIRED} />
    </Box>
    <Arrow index={0} frame={frame} flowing />
    <Arrow index={1} frame={frame} flowing />
    <Arrow index={2} frame={frame} flowing={frame >= DECIDED && frame < FIRED} />
    <div style={{ position: 'absolute', left: LEFT + 2 * (BOX.width + BOX.gap), width: BOX.width, top: BOX.top - 76, display: 'flex', justifyContent: 'center', opacity: chip }}>
      <span style={{ background: FIELD, borderRadius: 16, padding: '10px 22px', fontSize: 28 }}>左上 · 1 回</span>
    </div>
    <Waves frame={frame} />
    {!still && <Caption>{CAPTIONS[Math.min(CAPTIONS.length - 1, Math.floor(frame / CAPTION_FRAMES))]}</Caption>}
  </Page>
}

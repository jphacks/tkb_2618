import { useCurrentFrame } from 'remotion'
import type { DeskKey } from '../../../app/src/shared/types'
import { Enter, Key, Logo, MUTED, Page, key } from '../common'

/** The key wall from the first and last slides, row by row; the right column runs off the screen. */
const WALL: (DeskKey | null)[] = [
  key('mic', 'orange', true), key('capture', 'cyan'), key('playpause', 'red'), key('next', 'red'),
  key('code', 'indigo'), null, key('volume', 'red'), key('bubble', 'yellow'),
  key('terminal', 'indigo'), key('hammer', 'yellow'), key('broadcast', 'orange'), key('lock', 'indigo'),
  key('bubble', 'yellow'), null, key('send', 'cyan'), null
]
const TILE = 200, GAP = 28
/** The tile that taps itself once the wall is up, and when. */
const TAPPED = 2, TAP_AT = 75

export function TileWall({ frame }: { frame: number }) {
  return <div style={{ position: 'absolute', left: 1130, top: (1080 - 4 * TILE - 3 * GAP) / 2, display: 'grid', gridTemplateColumns: `repeat(4, ${TILE}px)`, gap: GAP }}>
    {WALL.map((value, i) => <Enter key={i} at={6 + (i % 4) * 3 + Math.floor(i / 4) * 4} frame={frame}>
      <Key value={value} size={TILE} age={i === TAPPED ? frame - TAP_AT : -1} />
    </Enter>)}
  </div>
}

export function Title({ still = false }: { still?: boolean }) {
  const current = useCurrentFrame()
  const frame = still ? 70 : current
  return <Page logo={false}>
    <div style={{ position: 'absolute', left: 120, top: 330 }}>
      <Enter frame={frame} style={{ transformOrigin: 'left center' }}>
        <h1 style={{ fontSize: 180, fontWeight: 800, lineHeight: 1, letterSpacing: -2 }}>DaaS</h1>
        <p style={{ fontSize: 40, marginTop: 36 }}>ふだんの机を入力デバイスに。</p>
      </Enter>
    </div>
    <Logo height={220} style={{ left: 100, bottom: 70 }} />
    <TileWall frame={frame} />
  </Page>
}

export function End() {
  const frame = useCurrentFrame()
  return <Page logo={false}>
    <div style={{ position: 'absolute', left: 110, top: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <Enter frame={frame} style={{ transformOrigin: 'left center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
          <Logo height={250} style={{ position: 'static' }} />
          <h1 style={{ fontSize: 150, fontWeight: 800, lineHeight: 1, letterSpacing: -2 }}>DaaS</h1>
        </div>
        <p style={{ fontSize: 32, color: MUTED, marginTop: 48 }}>github.com/jphacks/tkb_2618</p>
      </Enter>
    </div>
    <TileWall frame={frame} />
  </Page>
}

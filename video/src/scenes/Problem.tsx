import type { ReactNode } from 'react'
import { useCurrentFrame } from 'remotion'
import type { ColorId } from '../../../app/src/shared/types'
import { Enter, Key, Page, key } from '../common'

/** Icons the app does not have, drawn like `IC` (24 × 24, fill only). */
const PEN = 'M14.1 6.2l3.7 3.7L7.7 20H4v-3.7z M17.8 2.4a1.5 1.5 0 0 1 2.1 0l1.7 1.7a1.5 1.5 0 0 1 0 2.1l-1.9 1.9-3.8-3.8z'
const POT = 'M10 4h4v2h-4z M3 7.5h18v2H3z M5 11h14v6.5a3.5 3.5 0 0 1-3.5 3.5h-7A3.5 3.5 0 0 1 5 17.5z M1.5 12H5v2.5H1.5z M19 12h3.5v2.5H19z'
const IRON = 'M2.4 20.4l6.5-6.5 1.2 1.2-6.5 6.5z M8.3 13.9l2.6-2.6 2.5 2.5-2.6 2.6z M9.8 10.8l8-8a1.2 1.2 0 0 1 1.7 0l1.7 1.7a1.2 1.2 0 0 1 0 1.7l-8 8z'

type Scene = { title: string; lines: [string, string]; color: ColorId; icon: string; tile: { size: number; x: number; y: number; rotate: number }; text: { x: number; y: number } }
/** Same arrangement as the second slide; tile x / y are centers. */
const SCENES: Scene[] = [
  { title: '勉強', lines: ['ペンを持ったまま、', '参考資料をめくりたい'], color: 'cyan', icon: PEN, tile: { size: 270, x: 130, y: 430, rotate: -15 }, text: { x: 350, y: 330 } },
  { title: '料理中', lines: ['手が汚れたまま、', 'レシピの次を見たい'], color: 'yellow', icon: POT, tile: { size: 240, x: 1665, y: 585, rotate: 8 }, text: { x: 1085, y: 470 } },
  { title: '電子工作', lines: ['こてを持ったまま、', '回路図を参照したい'], color: 'orange', icon: IRON, tile: { size: 260, x: 380, y: 860, rotate: 3 }, text: { x: 560, y: 740 } }
]
const STAGGER = 24

function Tile({ x, y, size, rotate, at, frame, children }: { x: number; y: number; size: number; rotate: number; at: number; frame: number; children: ReactNode }) {
  return <div style={{ position: 'absolute', left: x - size / 2, top: y - size / 2, transform: `rotate(${rotate}deg)` }}>
    <Enter at={at} frame={frame}>{children}</Enter>
  </div>
}

export function Problem({ still = false }: { still?: boolean }) {
  const current = useCurrentFrame()
  const frame = still ? 150 : current
  return <Page>
    <Enter frame={frame} style={{ position: 'absolute', left: 120, top: 95, transformOrigin: 'left center' }}>
      <h1 style={{ fontSize: 56, fontWeight: 800 }}>手がふさがっている作業中でもデバイスを操作したい！</h1>
    </Enter>
    {SCENES.map((scene, i) => <div key={scene.title}>
      <Tile {...scene.tile} at={12 + i * STAGGER} frame={frame}>
        <Key value={key('lock', scene.color)} size={scene.tile.size} iconPath={scene.icon} />
      </Tile>
      <Enter at={16 + i * STAGGER} frame={frame} style={{ position: 'absolute', left: scene.text.x, top: scene.text.y, transformOrigin: 'left center' }}>
        <h2 style={{ fontSize: 110, fontWeight: 800, lineHeight: 1 }}>{scene.title}</h2>
        <p style={{ fontSize: 36, lineHeight: 1.6, marginTop: 24 }}>{scene.lines[0]}<br />{scene.lines[1]}</p>
      </Enter>
    </div>)}
    <Tile x={1735} y={955} size={125} rotate={6} at={12 + 3 * STAGGER} frame={frame}>
      <Key value={key('volume', 'red')} size={125} />
    </Tile>
  </Page>
}

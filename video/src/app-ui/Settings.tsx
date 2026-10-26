import { interpolate } from 'remotion'
import { ACTS, COLORS, DEFAULT_CONFIG, ICON_LIST, PATTERNS, REGIONS, colorOf } from '../../../app/src/shared/constants'
import type { DeskKey } from '../../../app/src/shared/types'
import { BG, FG, FIELD, Icon, Key, MUTED, SURFACE } from '../common'
import { DeskMap } from './DeskMap'

/**
 * The settings window as the app draws it (App.tsx, DeskMap.tsx, KeyEditor.tsx, styles.css), 1280 × 800,
 * playing one assignment: drag "Webhook" from the side panel onto the empty key, then tap keys.
 */
export const WINDOW = { width: 1280, height: 800 }
const TITLE_BAR = 32, MAIN_WIDTH = 940, PANEL_WIDTH = 340
/** Where the desk map sits in the window (centered in `.desk-section`). */
const MAP = { x: (MAIN_WIDTH - 484) / 2, y: 292 }
const SLOT = 7
const webhook = ACTS.find(a => a.type === 'http')!
const assignedKey: DeskKey = { icon: webhook.icon, color: webhook.color, action: webhook.action }
/** Window coordinates of the "Webhook" tile and of the empty key's center. */
const FROM = { x: 998, y: 290 }, TO = { x: MAP.x + 430, y: MAP.y + 246 }
/** Frames: cursor moves in, presses, drags, drops; then keys fire as if tapped on the desk. */
export const T = { enter: 18, press: 52, drop: 112, leave: 150 }

const ease = (frame: number, from: number, to: number) => interpolate(frame, [from, to], [0, 1], {
  extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: t => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
})

function cursorAt(frame: number) {
  const start = { x: 760, y: 700 }, end = { x: 1150, y: 760 }
  if (frame < T.press) {
    const t = ease(frame, T.enter, T.press - 6)
    return { x: start.x + (FROM.x - start.x) * t, y: start.y + (FROM.y - start.y) * t }
  }
  if (frame < T.drop) {
    const t = ease(frame, T.press + 4, T.drop - 4)
    return { x: FROM.x + (TO.x - FROM.x) * t, y: FROM.y + (TO.y - FROM.y) * t }
  }
  const t = ease(frame, T.drop + 8, T.leave)
  return { x: TO.x + (end.x - TO.x) * t, y: TO.y + (end.y - TO.y) * t }
}

function Cursor({ x, y, pressed }: { x: number; y: number; pressed: boolean }) {
  return <svg width={26} height={36} viewBox="0 0 26 36" style={{ position: 'absolute', left: x - 2, top: y - 2, transform: `scale(${pressed ? 0.9 : 1})`, transformOrigin: 'top left' }}>
    <path d="M2 2v28l7-7 5 11 5-2-5-11h10z" fill="#FFFFFF" stroke="#121212" strokeWidth={2} strokeLinejoin="round" />
  </svg>
}

function Header() {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 40 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {DEFAULT_CONFIG.profiles.map((p, i) => <span key={p.id} style={{ height: 36, padding: '0 16px', borderRadius: 18, fontSize: 14, display: 'flex', alignItems: 'center', background: i === 0 ? FG : 'transparent', color: i === 0 ? BG : MUTED }}>{p.name}</span>)}
      <span style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', color: '#BDBDBD' }}><Icon name="plus" /></span>
    </div>
    <div style={{ flex: 1 }} />
    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#13D66A', marginRight: 10 }} />
    {(['lock', 'calibrate', 'settings'] as const).map(icon => <span key={icon} style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', color: '#BDBDBD' }}><Icon name={icon} /></span>)}
  </div>
}

function Panel({ value, dragging }: { value: DeskKey | null; dragging: boolean }) {
  const region = Math.floor(SLOT / 2), pattern = SLOT % 2
  const [, bg, fg] = value ? colorOf(value.color) : [null, FG, BG]
  const tile = (on: boolean) => ({ background: on ? bg : FIELD, color: on ? fg : '#BDBDBD' })
  return <div style={{ width: PANEL_WIDTH, background: SURFACE, padding: '28px 24px 32px', display: 'flex', flexDirection: 'column', gap: 24 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      <div style={{ transform: 'scale(1.0833)', transformOrigin: 'top left', width: 104, height: 104 }}><Key value={value} /></div>
      <div aria-label={`${REGIONS[region]} ${PATTERNS[pattern]}`} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 14px)', gap: 3 }}>
          {REGIONS.map((_, r) => <i key={r} style={{ width: 14, height: 14, borderRadius: 4, background: r === region ? FG : '#2E2E2E' }} />)}
        </span>
        <span style={{ display: 'flex', gap: 4, height: 12, alignItems: 'center' }}>
          {Array.from({ length: pattern + 1 }, (_, i) => <i key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: FG }} />)}
        </span>
      </div>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
      {ACTS.map(a => <div key={a.type} style={{ height: 64, borderRadius: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, ...tile(value?.action.type === a.type), opacity: dragging && a.type === 'http' ? 0.35 : 1 }}>
        <Icon name={a.icon} size={20} /><span style={{ fontSize: 11, lineHeight: 1 }}>{a.name}</span>
      </div>)}
    </div>
    {value && <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 52, padding: '0 16px 0 8px', borderRadius: 14, background: FIELD, fontFamily: 'Consolas, monospace', fontSize: 13, color: '#BDBDBD' }}>
        <span style={{ display: 'flex', height: 34, alignItems: 'center', padding: '0 10px', borderRadius: 9, background: bg, color: fg }}>POST</span>
        <span>https://[YOUR WEBHOOK URL]</span>
      </div>
      <div style={{ height: 1, background: FIELD }} />
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        {COLORS.map(([id, color]) => <span key={id} style={{ position: 'relative', width: 28, height: 28, borderRadius: '50%', background: color }}>
          {value.color === id && <span style={{ position: 'absolute', inset: -5, border: `2px solid ${FG}`, borderRadius: '50%' }} />}
        </span>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 6 }}>
        {ICON_LIST.map(([id]) => <div key={id} style={{ aspectRatio: 1, borderRadius: 12, display: 'grid', placeItems: 'center', ...tile(value.icon === id) }}><Icon name={id} /></div>)}
        <div style={{ borderRadius: 12, border: '2px dashed #333', color: MUTED, display: 'grid', placeItems: 'center' }}><Icon name="image" /></div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, height: 52, borderRadius: 26, background: FG, color: BG, display: 'grid', placeItems: 'center' }}><Icon name="play" size={20} /></div>
        <div style={{ width: 52, height: 52, borderRadius: 26, background: FIELD, color: '#BDBDBD', display: 'grid', placeItems: 'center' }}><Icon name="trash" /></div>
      </div>
    </div>}
  </div>
}

function WindowControls() {
  const stroke = { stroke: FG, strokeWidth: 1, fill: 'none' }
  return <div style={{ position: 'absolute', top: 0, right: 0, height: TITLE_BAR, display: 'flex' }}>
    {[<path key="min" d="M0 5.5h10" {...stroke} />, <rect key="max" x={0.5} y={0.5} width={9} height={9} {...stroke} />, <path key="close" d="M0 0l10 10M10 0L0 10" {...stroke} />].map((glyph, i) =>
      <span key={i} style={{ width: 46, display: 'grid', placeItems: 'center' }}><svg width={10} height={10} viewBox="0 0 10 10" style={{ overflow: 'visible' }}>{glyph}</svg></span>)}
  </div>
}

export function Settings({ frame }: { frame: number }) {
  const assigned = frame >= T.drop
  const dragging = frame >= T.press && frame < T.drop
  const keys = DEFAULT_CONFIG.profiles[0].keys.map((k, i) => i === SLOT ? (assigned ? assignedKey : null) : k)
  const cursor = cursorAt(frame)
  const over = dragging && Math.hypot(cursor.x - TO.x, cursor.y - TO.y) < 48
  return <div style={{ position: 'relative', width: WINDOW.width, height: WINDOW.height, background: BG, borderRadius: 10, overflow: 'hidden', outline: '1px solid #2E2E2E' }}>
    <WindowControls />
    <div style={{ position: 'absolute', top: TITLE_BAR, left: 0, right: 0, bottom: 0, display: 'flex' }}>
      <div style={{ width: MAIN_WIDTH, position: 'relative', padding: '20px 40px 40px' }}>
        <Header />
      </div>
      <Panel value={assigned ? assignedKey : null} dragging={dragging} />
    </div>
    <div style={{ position: 'absolute', left: MAP.x, top: MAP.y }}>
      <DeskMap keys={keys} selected={SLOT} />
      {over && <span style={{ position: 'absolute', left: 6 + 376 - 6, top: 6 + 198 - 6, width: 108, height: 108, borderRadius: 30, outline: `2px dashed ${FG}` }} />}
    </div>
    {dragging && <div style={{ position: 'absolute', left: cursor.x - 48, top: cursor.y - 48 }}><Key value={assignedKey} /></div>}
    {frame >= T.enter - 6 && frame < T.leave + 6 && <div style={{ opacity: ease(frame, T.enter - 6, T.enter) - ease(frame, T.leave, T.leave + 6) }}>
      <Cursor {...cursor} pressed={dragging} />
    </div>}
  </div>
}

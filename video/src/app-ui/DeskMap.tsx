import { DEFAULT_CONFIG, PATTERNS } from '../../../app/src/shared/constants'
import type { DeskKey } from '../../../app/src/shared/types'
import { Key } from '../common'

/** Outer size of the app's `.desk-grid` (columns 96 96 40 96 96, rows 20 96 40 96, gap 12, padding 6). */
export const DESK_MAP_SIZE = { width: 484, height: 300 }

/**
 * The app's desk map: two keys (1 tap / 2 taps) per region, laid out like the desk.
 * `fired[i]` is the frame age since key i fired.
 */
export function DeskMap({ keys = DEFAULT_CONFIG.profiles[0].keys, selected = -1, fired = {} }: { keys?: readonly (DeskKey | null)[]; selected?: number; fired?: Record<number, number> }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '96px 96px 40px 96px 96px', gridTemplateRows: '20px 96px 40px 96px', gap: 12, padding: 6 }}>
    {[1, 2, 4, 5].map((column, i) => <div key={column} aria-label={PATTERNS[i % 2]} style={{ gridColumn: column, gridRow: 1, display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'center' }}>
      {Array.from({ length: i % 2 + 1 }, (_, j) => <i key={j} style={{ width: 7, height: 7, borderRadius: '50%', background: '#5A5A5A' }} />)}
    </div>)}
    {keys.map((value, i) => {
      const region = Math.floor(i / 2)
      return <div key={i} style={{ gridColumn: (region % 2 === 0 ? 1 : 4) + i % 2, gridRow: region < 2 ? 2 : 4 }}>
        <Key value={value} selected={selected === i} age={fired[i] ?? -1} />
      </div>
    })}
  </div>
}

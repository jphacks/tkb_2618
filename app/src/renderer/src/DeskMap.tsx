import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { CSSProperties } from 'react'
import { colorOf, PATTERNS, REGIONS } from '../../shared/constants'
import type { DeskKey } from '../../shared/types'
import { Icon } from './Icon'

export function KeyFace({ value, preview = false }: { value: DeskKey | null; preview?: boolean }) {
  return <>
    {value && <><span className="bracket top" /><span className="bracket bottom" /></>}
    {value?.image ? <img className="key-image" src={value.image} alt="" draggable={false} />
      : <Icon name={value?.icon ?? 'plus'} size={value ? preview ? 50 : 44 : preview ? 24 : 22} slash={value?.slash} bg={value ? colorOf(value.color)[1] : 'transparent'} />}
  </>
}
export function keyStyle(value: DeskKey | null): CSSProperties {
  return { background: value ? colorOf(value.color)[1] : 'transparent', color: value ? colorOf(value.color)[2] : '#3A3A3A', border: value ? '0' : '2px dashed #2E2E2E' }
}
function MapKey({ index, value, selected, fire, pick }: { index: number; value: DeskKey | null; selected: boolean; fire: number | undefined; pick: () => void }) {
  const drag = useDraggable({ id: `key-${index}`, data: { type: 'key', index }, disabled: !value })
  const drop = useDroppable({ id: `slot-${index}`, data: { index } })
  const r = Math.floor(index / 2), p = index % 2
  return <button ref={node => { drag.setNodeRef(node); drop.setNodeRef(node) }}
    {...drag.listeners} {...(value ? drag.attributes : {})} type="button" className={`dk-key ${selected ? 'selected' : ''} ${drop.isOver ? 'over' : ''}`}
    style={{ ...keyStyle(value), gridColumn: (r % 2 === 0 ? 1 : 4) + p, gridRow: r < 2 ? 2 : 4, opacity: drag.isDragging ? 0.35 : 1, animation: fire !== undefined ? 'dk-bump .32s ease-out' : undefined }}
    aria-label={`${REGIONS[r]} ${PATTERNS[p]}`} aria-pressed={selected} onClick={pick}>
    {fire !== undefined && <span key={fire} className="key-fire"><span className="ripple" style={{ borderColor: value ? colorOf(value.color)[1] : '#EDEDED' }} /></span>}
    <span className="key-face"><KeyFace value={value} /></span>
  </button>
}
export function DeskMap({ keys, selected, fired, locked, pick }: { keys: (DeskKey | null)[]; selected: number; fired: Record<number, number>; locked: boolean; pick: (index: number) => void }) {
  return <section aria-label="机" className="desk-section"><div className="desk-grid" style={{ opacity: locked ? 0.25 : 1 }}>
    {[1, 2, 4, 5].map((column, i) => <span key={`col-${column}`} role="img" aria-label={PATTERNS[i % 2]} className="grid-dots" style={{ gridColumn: column, gridRow: 1 }}>{Array.from({ length: i % 2 + 1 }, (_, j) => <i key={j} />)}</span>)}
    {keys.map((value, index) => <MapKey key={index} index={index} value={value} selected={selected === index} fire={fired[index]} pick={() => pick(index)} />)}
  </div></section>
}

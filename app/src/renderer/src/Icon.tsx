import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { IC } from '../../shared/constants'

export type SymbolId = keyof typeof IC | keyof typeof UI
const UI = {
  calibrate: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20z M12 4.2a7.8 7.8 0 1 1 0 15.6a7.8 7.8 0 1 1 0-15.6z M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z',
  settings: 'M10.3 2h3.4l.5 2.7 1.6.7 2.3-1.6 2.4 2.4-1.6 2.3.7 1.6 2.7.5v3.4l-2.7.5-.7 1.6 1.6 2.3-2.4 2.4-2.3-1.6-1.6.7-.5 2.7h-3.4l-.5-2.7-1.6-.7-2.3 1.6-2.4-2.4 1.6-2.3-.7-1.6L2 13.7v-3.4l2.7-.5.7-1.6-1.6-2.3 2.4-2.4 2.3 1.6 1.6-.7z M12 8.6a3.4 3.4 0 1 0 0 6.8a3.4 3.4 0 1 0 0-6.8z',
  folder: 'M2 5a1 1 0 0 1 1-1h6l2 2.5h10a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z',
  image: 'M3 5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z M5 17h14l-4.5-6-3.5 4.5-2.5-3z M8 6.5a1.8 1.8 0 1 0 0 3.6a1.8 1.8 0 1 0 0-3.6z',
  play: 'M6 4l15 8-15 8z',
  trash: 'M9 2h6v2h5v2H4V4h5z M5.5 8h13l-1 13a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z',
  close: 'M5.6 4.2L12 10.6l6.4-6.4 1.4 1.4-6.4 6.4 6.4 6.4-1.4 1.4-6.4-6.4-6.4 6.4-1.4-1.4 6.4-6.4-6.4-6.4z',
  check: 'M9.2 16.6L4.6 12l-1.4 1.4 6 6L21 7.6l-1.4-1.4z',
  undo: 'M9 4L3 10l6 6v-4.5h6a4 4 0 0 1 0 8h-3V22h3a6.5 6.5 0 0 0 0-13H9z',
  plug: 'M8 2h2v5h4V2h2v5h2v4a6 6 0 0 1-5 5.9V22h-2v-5.1A6 6 0 0 1 6 11V7h2z',
  restart: 'M12 4a8 8 0 1 0 8 8h-2.2A5.8 5.8 0 1 1 12 6.2V9l4.5-4L12 1z',
  ctrl: 'M3 14l5-7 5 7h-2.5L8 10.5 5.5 14z M14 14l4-7 4 7h-2.3L18 10.7 16.3 14z',
  alt: 'M3 5h6l7 14h5v2h-6L8 7H3z M13 5h8v2h-8z'
} as const
export function Icon({ name, size = 19, slash = false, bg = '#121212' }: { name: SymbolId; size?: number; slash?: boolean; bg?: string }): ReactNode {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d={name in IC ? IC[name as keyof typeof IC] : UI[name as keyof typeof UI]} fill="currentColor" fillRule="evenodd" />
    {slash && <><line x1="3.5" y1="3.5" x2="20.5" y2="20.5" stroke={bg} strokeWidth="4.6" strokeLinecap="round" /><line x1="3.5" y1="3.5" x2="20.5" y2="20.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></>}
  </svg>
}
export function IconButton({ label, icon, children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon?: SymbolId }): ReactNode {
  return <button type="button" aria-label={label} title={label} className={`icon-button dk-ghost ${className}`} {...props}>{icon ? <Icon name={icon} /> : children}</button>
}

import type { Config } from './types'

const LEGACY_KEYS: Record<string, string> = {
  Control: 'Ctrl', Meta: 'Win', Esc: 'Escape', ' ': 'Space',
  Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight',
  ';': 'Semicolon', ':': 'Semicolon', '=': 'Equal', '+': 'Equal',
  ',': 'Comma', '<': 'Comma', '-': 'Minus', '_': 'Minus',
  '.': 'Period', '>': 'Period', '/': 'Slash', '?': 'Slash',
  '`': 'Backquote', '~': 'Backquote', '[': 'BracketLeft', '{': 'BracketLeft',
  '\\': 'Backslash', '|': 'Backslash', ']': 'BracketRight', '}': 'BracketRight',
  "'": 'Quote', '"': 'Quote', '@': 'BracketLeft', '^': 'Equal', '¥': 'IntlYen',
  '!': 'Digit1', '#': 'Digit3', '$': 'Digit4', '%': 'Digit5',
  '&': 'Digit7', '*': 'Digit8', '(': 'Digit9', ')': 'Digit0',
  Hankaku: 'Backquote', Zenkaku: 'Backquote', ZenkakuHankaku: 'Backquote'
}
/** Legacy character records lack layout information; preserve the old US mapping when ambiguous. */
export function normalizeHotkeyKey(key: string): string {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`
  if (/^[0-9]$/.test(key)) return `Digit${key}`
  return Object.hasOwn(LEGACY_KEYS, key) ? LEGACY_KEYS[key] : key
}
export function migrateHotkeys(config: Config): Config {
  const result = structuredClone(config)
  for (const profile of result.profiles) {
    for (const key of profile.keys) {
      if (key?.action.type === 'hotkey') key.action.keys = key.action.keys.map(normalizeHotkeyKey)
    }
  }
  return result
}
const LABELS: Record<string, string> = {
  Space: 'Space', Semicolon: ';', Equal: '=', Comma: ',', Minus: '-', Period: '.',
  Slash: '/', Backquote: '`', BracketLeft: '[', Backslash: '\\', BracketRight: ']',
  Quote: "'", IntlYen: '¥', IntlRo: '\\', Convert: '変換', NonConvert: '無変換', KanaMode: 'かな'
}
export function hotkeyLabel(code: string, layout?: ReadonlyMap<string, string>): string {
  const label = layout?.get(code)
  if (label && label.trim()) return label
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  return Object.hasOwn(LABELS, code) ? LABELS[code] : code
}

import { COLORS, ICON_LIST, MEDIA_OPS } from './constants'
import type { Action, Calibration, Config, DeskKey } from './types'

const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === 'string')
function isAction(v: unknown): v is Action {
  if (!object(v)) return false
  switch (v.type) {
    case 'hotkey': return strings(v.keys)
    case 'launch': return typeof v.file === 'string' && (v.args === undefined || typeof v.args === 'string')
    case 'media': return MEDIA_OPS.some(m => m[0] === v.op)
    case 'command': return typeof v.cmd === 'string'
    case 'http': return typeof v.url === 'string'
    case 'profile': return typeof v.to === 'string'
    case 'lock': return true
    default: return false
  }
}
function isDeskKey(v: unknown): v is DeskKey | null {
  return v === null || (object(v) && ICON_LIST.some(i => i[0] === v.icon) && COLORS.some(c => c[0] === v.color)
    && (v.slash === undefined || typeof v.slash === 'boolean')
    && (v.image === undefined || (typeof v.image === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(v.image) && v.image.length <= 1_000_000))
    && isAction(v.action))
}
export function isConfig(v: unknown): v is Config {
  if (!object(v) || v.version !== 1 || !Array.isArray(v.profiles) || v.profiles.length === 0
    || !['locked', 'notify', 'autostart'].every(k => typeof v[k] === 'boolean') || typeof v.port !== 'string') return false
  const ids = new Set<string>()
  for (const p of v.profiles) {
    if (!object(p) || typeof p.id !== 'string' || !p.id || ids.has(p.id) || typeof p.name !== 'string' || !p.name.trim()
      || !Array.isArray(p.keys) || p.keys.length !== 16 || !p.keys.every(isDeskKey)) return false
    ids.add(p.id)
  }
  return typeof v.activeProfileId === 'string' && ids.has(v.activeProfileId)
}
export function isCalibration(v: unknown): v is Calibration {
  return object(v) && ['threshold', 'strongMin'].every(k => Array.isArray(v[k]) && v[k].length === 4
    && v[k].every((n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 4095))
    && v.doubleWindowMs === 320 && v.refractoryMs === 70
}

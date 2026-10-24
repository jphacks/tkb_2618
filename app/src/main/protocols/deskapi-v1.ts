import type { DeviceEvent } from '../../shared/types'
import type { DeviceProtocol } from './types'
function valid(value: unknown): value is DeviceEvent {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  const number = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0
  const channels = (a: unknown): boolean => Array.isArray(a) && a.length === 4 && a.every(n => number(n) && n <= 4095)
  switch (v.t) {
    case 'hello': return (v.fw === undefined || typeof v.fw === 'string') && (v.cal === undefined || typeof v.cal === 'boolean')
    case 'tap': return (v.sat === undefined || v.sat === true) && Number.isInteger(v.region) && number(v.region) && v.region <= 3 && (v.count === 1 || v.count === 2) && (v.strength === 'weak' || v.strength === 'strong') && number(v.confidence) && v.confidence <= 1
    case 'hit': return channels(v.peaks) && number(v.ms) && number(v.ring) && v.ring <= 1000 && (v.sat === undefined || v.sat === true)
    case 'raw': return channels(v.min) && channels(v.max)
    case 'noise': return channels(v.peak) && channels(v.rms)
    case 'ack': return (v.of === 'mode' || v.of === 'set_cal') && typeof v.ok === 'boolean' && (v.err === undefined || typeof v.err === 'string')
    default: return false
  }
}
export const deskapiV1: DeviceProtocol = {
  id: 'deskapi-v1', serial: { baudRate: 115200 },
  capabilities: { calibration: true, raw: true },
  handshake: () => ({ send: '{"t":"ping"}\n', isHello: event => event.t === 'hello', timeoutMs: 2000 }),
  parseLine(line) {
    try { const value: unknown = JSON.parse(line); return valid(value) ? value : null }
    catch { return null }
  },
  encode(command) { return JSON.stringify(command) + '\n' }
}

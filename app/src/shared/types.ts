export type ColorId = 'red' | 'orange' | 'yellow' | 'cyan' | 'indigo'
export type IconId = 'mic' | 'capture' | 'code' | 'app' | 'playpause' | 'next' | 'volume' | 'music' | 'terminal'
  | 'hammer' | 'bubble' | 'lock' | 'keyboard' | 'send' | 'layers' | 'broadcast' | 'star' | 'bolt'
export type MediaOp = 'prev' | 'playpause' | 'next' | 'volDown' | 'volUp' | 'mic'
export type Action =
  | { type: 'hotkey'; keys: string[] }
  | { type: 'launch'; file: string; args?: string }
  | { type: 'media'; op: MediaOp }
  | { type: 'command'; cmd: string }
  | { type: 'http'; url: string }
  | { type: 'profile'; to: string }
  | { type: 'lock' }
export type DeskKey = { icon: IconId; slash?: boolean; image?: string; color: ColorId; action: Action }
export type Profile = { id: string; name: string; keys: (DeskKey | null)[] }
export type Config = {
  version: 2; profiles: Profile[]; activeProfileId: string; locked: boolean
  notify: boolean; autostart: boolean; port: string | 'auto'; protocol: string; calibration?: Calibration
}
export type Region = 0 | 1 | 2 | 3
export type TapEvent = { t: 'tap'; region: Region; count: 1 | 2; confidence: number; sat?: true }
export type DeviceCapabilities = { calibration: boolean; raw: boolean }
/** Why the last connection attempt failed: no serial port, port held by another app, or no data from the port. */
export type DisconnectReason = 'no-port' | 'busy' | 'no-response'
export type DeviceStatus =
  | { state: 'disconnected'; reason?: DisconnectReason }
  | { state: 'connecting' }
  | { state: 'connected'; port: string; fw?: string; cal?: boolean; capabilities: DeviceCapabilities }
export type Channels = [number, number, number, number]
export type Noise = { t: 'noise'; peak: Channels; rms: Channels }
export type CalHit = { t: 'hit'; peaks: Channels; ms: number; ring: number; sat?: true }
export type Calibration = { threshold: Channels; doubleWindowMs: number; refractoryMs: number; templates?: [Channels, Channels, Channels, Channels] }
export type Hello = { t: 'hello'; fw?: string; cal?: boolean }
export type Ack = { t: 'ack'; of: 'set_cal' | 'mode'; ok: boolean; err?: string }
export type Raw = { t: 'raw'; min: Channels; max: Channels }
export type DeviceEvent = Hello | TapEvent | Noise | CalHit | Ack | Raw
export type DeviceCommand = { t: 'ping' } | { t: 'mode'; mode: 'run' | 'calibrate' | 'raw' }
  | { t: 'measure_noise'; ms: number } | { t: 'set_cal'; cal: Calibration }
/** 8 keys: each region's single then double tap. */
export const KEY_COUNT = 8
export const keyIndexOf = (tap: Pick<TapEvent, 'region' | 'count'>): number => tap.region * 2 + tap.count - 1

export type ColorId = 'red' | 'yellow' | 'green' | 'blue' | 'indigo'
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
  version: 1; profiles: Profile[]; activeProfileId: string; locked: boolean
  notify: boolean; autostart: boolean; port: string | 'auto'
}
export type Region = 0 | 1 | 2 | 3
export type Strength = 'weak' | 'strong'
export type TapEvent = { t: 'tap'; region: Region; count: 1 | 2; strength: Strength; confidence: number; sat?: true }
export type DeviceStatus =
  | { state: 'disconnected' | 'connecting' }
  | { state: 'connected'; port: string; fw: string; cal: boolean }
export type Channels = [number, number, number, number]
export type Noise = { t: 'noise'; peak: Channels; rms: Channels }
export type CalHit = { t: 'hit'; peaks: Channels; ms: number; ring: number; sat?: true }
export type Calibration = { threshold: Channels; strongMin: Channels; doubleWindowMs: number; refractoryMs: number; templates?: [Channels, Channels, Channels, Channels] }
export type Hello = { t: 'hello'; fw: string; cal: boolean }
export type Ack = { t: 'ack'; of: 'set_cal' | 'mode'; ok: boolean; err?: string }
export type DeviceMessage = Hello | TapEvent | Noise | CalHit | Ack
export type HostMessage = { t: 'ping' } | { t: 'mode'; mode: 'run' | 'calibrate' }
  | { t: 'measure_noise'; ms: number } | { t: 'set_cal'; cal: Calibration }
export const keyIndexOf = (tap: TapEvent): number => tap.region * 4 + (tap.count - 1) * 2 + (tap.strength === 'strong' ? 1 : 0)

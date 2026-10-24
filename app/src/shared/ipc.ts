import type { CalHit, Calibration, Config, DeviceStatus, Noise, Region, Strength, TapEvent } from './types'

export const IPC = {
  getConfig: 'config:get', saveConfig: 'config:save', configChanged: 'config:changed',
  getDeviceStatus: 'device:status', deviceStatus: 'device:changed', tap: 'device:tap',
  runKey: 'action:run', pickFile: 'dialog:file', pickImage: 'dialog:image', listPorts: 'device:ports',
  calStart: 'cal:start', calMeasureNoise: 'cal:noise', calHit: 'cal:hit',
  calSave: 'cal:save', calCancel: 'cal:cancel', calMockHit: 'cal:mock-hit'
} as const
export type Unsubscribe = () => void
export interface DeskApi {
  readonly isMock: boolean
  getConfig(): Promise<Config>
  saveConfig(config: Config): Promise<void>
  onConfigChanged(callback: (config: Config) => void): Unsubscribe
  getDeviceStatus(): Promise<DeviceStatus>
  onDeviceStatus(callback: (status: DeviceStatus) => void): Unsubscribe
  onTap(callback: (tap: TapEvent) => void): Unsubscribe
  runKey(index: number): Promise<void>
  pickFile(): Promise<string | null>
  /** Original image bytes as a data URL; renderer crops using a sandboxed canvas. */
  pickImage(): Promise<string | null>
  listPorts(): Promise<string[]>
  calStart(): Promise<void>
  calMeasureNoise(): Promise<Noise>
  onCalHit(callback: (hit: CalHit) => void): Unsubscribe
  calSave(calibration: Calibration): Promise<void>
  calCancel(): Promise<void>
  calMockHit?: (region: Region, strength: Strength) => Promise<void>
}
declare global { interface Window { deskapi: DeskApi } }

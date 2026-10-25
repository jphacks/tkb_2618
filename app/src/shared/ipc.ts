import type { Samples } from './calibration'
import type { CalHit, Config, DeviceStatus, Noise, Region, TapEvent } from './types'

export const IPC = {
  getConfig: 'config:get', saveConfig: 'config:save', configChanged: 'config:changed',
  getDeviceStatus: 'device:status', deviceStatus: 'device:changed', tap: 'device:tap',
  runKey: 'action:run', pickFile: 'dialog:file', pickImage: 'dialog:image', listPorts: 'device:ports',
  calStart: 'cal:start', calMeasureNoise: 'cal:noise', calRecord: 'cal:record', calCue: 'cal:cue', calHit: 'cal:hit',
  calAbort: 'cal:abort', calSave: 'cal:save', calCancel: 'cal:cancel', calMockHit: 'cal:mock-hit'
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
  /** The still trial: BASELINE_MS for the baseline, then REST_MS of the untouched table (tools/tap-collect の静止). */
  calMeasureNoise(): Promise<Noise>
  /** 1 s still for the baseline, then the cue, then a 5 s tap window. Resolves with one hit per mountain. */
  calRecord(): Promise<CalHit[]>
  /** Stops the step being recorded; its calRecord rejects. */
  calAbort(): Promise<void>
  onCalCue(callback: () => void): Unsubscribe
  /** Each mountain as it closes inside the tap window. */
  onCalHit(callback: (hit: CalHit) => void): Unsubscribe
  calSave(samples: Samples): Promise<void>
  calCancel(): Promise<void>
  calMockHit?: (region: Region) => Promise<void>
}
declare global { interface Window { deskapi: DeskApi } }

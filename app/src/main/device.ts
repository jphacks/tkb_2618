import type { CalHit, Calibration, DeviceStatus, Noise, Region, Strength, TapEvent } from '../shared/types'
import type { Unsubscribe } from '../shared/ipc'

export interface Device {
  readonly status: DeviceStatus
  onStatus(callback: (status: DeviceStatus) => void): Unsubscribe
  onTap(callback: (tap: TapEvent) => void): Unsubscribe
  onCalHit(callback: (hit: CalHit) => void): Unsubscribe
  start(): void
  stop(): void
  listPorts(): Promise<string[]>
  setMode(mode: 'run' | 'calibrate'): Promise<void>
  measureNoise(): Promise<Noise>
  saveCalibration(calibration: Calibration): Promise<void>
}
class Signal<T> {
  private listeners = new Set<(value: T) => void>()
  on = (callback: (value: T) => void): Unsubscribe => { this.listeners.add(callback); return () => { this.listeners.delete(callback) } }
  emit(value: T): void { this.listeners.forEach(callback => callback(value)) }
}
export class DisconnectedDevice implements Device {
  readonly status: DeviceStatus = { state: 'disconnected' }
  protected statuses = new Signal<DeviceStatus>()
  protected taps = new Signal<TapEvent>()
  protected hits = new Signal<CalHit>()
  onStatus = this.statuses.on
  onTap = this.taps.on
  onCalHit = this.hits.on
  start(): void {}
  stop(): void {}
  async listPorts(): Promise<string[]> { return [] }
  async setMode(_mode: 'run' | 'calibrate'): Promise<void> { throw new Error('デバイスが未接続です') }
  async measureNoise(): Promise<Noise> { throw new Error('デバイスが未接続です') }
  async saveCalibration(_calibration: Calibration): Promise<void> { throw new Error('デバイスが未接続です') }
}
export class MockDevice extends DisconnectedDevice {
  override readonly status: DeviceStatus = { state: 'connected', port: 'MOCK', fw: '0.1.0-mock', cal: false }
  private timer?: ReturnType<typeof setInterval>
  private mode: 'run' | 'calibrate' = 'run'
  constructor(private readonly candidates: () => number[] = () => Array.from({ length: 16 }, (_, index) => index)) { super() }
  override start(): void {
    this.stop()
    this.timer = setInterval(() => {
      if (this.mode === 'run') {
        // Prefer assigned keys so the scaffold demonstrates a pulse every four seconds.
        const candidates = this.candidates()
        const index = candidates[Math.floor(Math.random() * candidates.length)] ?? Math.floor(Math.random() * 16)
        this.taps.emit({ t: 'tap', region: Math.floor(index / 4) as Region,
          count: index % 4 < 2 ? 1 : 2, strength: index % 2 === 0 ? 'weak' : 'strong', confidence: 0.9 })
      }
    }, 4000)
  }
  override stop(): void { clearInterval(this.timer) }
  override async listPorts(): Promise<string[]> { return ['MOCK'] }
  override async setMode(mode: 'run' | 'calibrate'): Promise<void> { this.mode = mode }
  override async measureNoise(): Promise<Noise> {
    await new Promise(resolve => setTimeout(resolve, 2000))
    return { t: 'noise', peak: [41, 38, 52, 40], rms: [9, 8, 11, 9] }
  }
  override async saveCalibration(_calibration: Calibration): Promise<void> {
    // Equivalent to receiving the set_cal acknowledgement. Never talks to hardware.
    if (this.status.state === 'connected') this.status.cal = true
    this.statuses.emit(this.status)
  }
  mockHit(region: Region, strength: Strength): void {
    if (this.mode !== 'calibrate') return
    const peaks: CalHit['peaks'] = [35, 32, 40, 38]
    peaks[region] = (strength === 'weak' ? 230 : 900) + Math.floor(Math.random() * 60)
    this.hits.emit({ t: 'hit', peaks, ms: 18 })
  }
}

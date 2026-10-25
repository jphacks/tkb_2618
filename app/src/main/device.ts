import { KEY_COUNT, type CalHit, type Calibration, type Channels, type DeviceStatus, type Noise, type Region, type TapEvent } from '../shared/types'
import type { Unsubscribe } from '../shared/ipc'

export interface Device {
  readonly status: DeviceStatus
  onStatus(callback: (status: DeviceStatus) => void): Unsubscribe
  onTap(callback: (tap: TapEvent) => void): Unsubscribe
  onCalHit(callback: (hit: CalHit) => void): Unsubscribe
  /** Raw ADC rows from a streaming firmware. `values` is reused; copy it to keep it. */
  onSample(callback: (values: Channels, rate: number) => void): Unsubscribe
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
  // A plain set, not a Signal: this runs 4000 times a second and usually has no listener.
  protected sampleListeners = new Set<(values: Channels, rate: number) => void>()
  onSample = (callback: (values: Channels, rate: number) => void): Unsubscribe => {
    this.sampleListeners.add(callback)
    return () => { this.sampleListeners.delete(callback) }
  }
  protected emitSample(values: Channels, rate: number): void { if (this.sampleListeners.size) this.sampleListeners.forEach(callback => callback(values, rate)) }
  start(): void {}
  stop(): void {}
  async listPorts(): Promise<string[]> { return [] }
  async setMode(_mode: 'run' | 'calibrate'): Promise<void> { throw new Error('デバイスが未接続です') }
  async measureNoise(): Promise<Noise> { throw new Error('デバイスが未接続です') }
  async saveCalibration(_calibration: Calibration): Promise<void> { throw new Error('デバイスが未接続です') }
}
export class MockDevice extends DisconnectedDevice {
  override readonly status: DeviceStatus = { state: 'connected', port: 'MOCK', fw: '0.1.0-mock', cal: false, capabilities: { calibration: true, raw: true } }
  private timer?: ReturnType<typeof setInterval>
  private stream?: ReturnType<typeof setInterval>
  private mode: 'run' | 'calibrate' = 'run'
  private waves: { region: Region; amp: number; age: number }[] = []
  private seed = 1
  constructor(private readonly candidates: () => number[] = () => Array.from({ length: KEY_COUNT }, (_, index) => index)) { super() }
  override start(): void {
    this.stop()
    this.timer = setInterval(() => {
      if (this.mode === 'run') {
        // Prefer assigned keys so the scaffold demonstrates a pulse every four seconds.
        const candidates = this.candidates()
        const index = candidates[Math.floor(Math.random() * candidates.length)] ?? Math.floor(Math.random() * KEY_COUNT)
        this.taps.emit({ t: 'tap', region: Math.floor(index / 2) as Region,
          count: index % 2 === 0 ? 1 : 2, confidence: 0.9, ...(Math.random() < 0.15 ? { sat: true as const } : {}) })
      }
    }, 4000)
  }
  override stop(): void { clearInterval(this.timer); clearInterval(this.stream) }
  override async listPorts(): Promise<string[]> { return ['MOCK'] }
  override async setMode(mode: 'run' | 'calibrate'): Promise<void> {
    this.mode = mode
    clearInterval(this.stream)
    // Calibration records raw values, so stream a 4000 Hz still table with ±3 noise and any mock taps.
    if (mode === 'calibrate') this.stream = setInterval(() => {
      const row: Channels = [0, 0, 0, 0]
      for (let n = 0; n < 200; n++) {
        for (let ch = 0; ch < 4; ch++) {
          this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0
          let value = 1920 + ch * 10 + (this.seed % 7) - 3
          for (const w of this.waves) value += w.amp * (ch === w.region ? 1 : w.region === 0 && ch === 1 ? 1.3 : 0.08) * Math.exp(-w.age / 22) * Math.cos(w.age * 0.8)
          row[ch] = Math.max(0, Math.min(4095, Math.round(value)))
        }
        for (const w of this.waves) w.age++
        this.waves = this.waves.filter(w => w.age < 400)
        this.emitSample(row, 4000)
      }
    }, 50)
  }
  override async measureNoise(): Promise<Noise> {
    await new Promise(resolve => setTimeout(resolve, 2000))
    return { t: 'noise', peak: [41, 38, 52, 40], rms: [9, 8, 11, 9] }
  }
  override async saveCalibration(_calibration: Calibration): Promise<void> {
    // Equivalent to receiving the set_cal acknowledgement. Never talks to hardware.
    if (this.status.state === 'connected') this.status.cal = true
    this.statuses.emit(this.status)
  }
  mockHit(region: Region): void {
    if (this.mode !== 'calibrate') return
    // Region zero models a metal table: the adjacent channel is stronger.
    this.waves.push({ region, amp: 400 + Math.floor(Math.random() * 300), age: 0 })
  }
}

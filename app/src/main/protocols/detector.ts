import type { Calibration, CalHit, Channels, DeviceEvent, Region, TapEvent } from '../../shared/types'
import { isCalibration } from '../../shared/validation'

export const defaultCalibration = (): Calibration => ({ threshold: [150, 150, 150, 150], strongMin: [700, 700, 700, 700], doubleWindowMs: 320, refractoryMs: 70 })
export const validCalibration = isCalibration
const channels = (): Channels => [0, 0, 0, 0]
const copy = (a: Channels): Channels => [...a]
const f = Math.fround

/** Port of DeskApiCore/Detector. Time is sample time in microseconds, never wall time. */
export class Detector {
  private cal = defaultCalibration()
  private mode: 'run' | 'calibrate' | 'raw' = 'run'
  private initialized = false
  private dc = channels()
  private magnitudes = channels()
  private rawActive = false
  private rawStartUs = 0
  private rawMin = channels()
  private rawMax = channels()
  private saturated = false
  private ringActive = false
  private quietActive = false
  private ringDone = false
  private ringMs = 0
  private quietStartUs = 0
  private ringEvent?: CalHit
  private collecting = false
  private hitStartUs = 0
  private refractoryUntilUs = 0
  private peaks = channels()
  private pendingStartUs = 0
  private pending?: TapEvent
  private measuring = false
  private noiseEndUs = 0
  private noiseSamples = 0
  private noisePeaks = channels()
  private noiseSquares = channels()
  constructor(private readonly emit: (event: DeviceEvent) => void) {}
  calibration(): Calibration { return structuredClone(this.cal) }
  private resetHits(): void {
    this.collecting = this.ringActive = this.quietActive = false
    this.pending = undefined
    this.refractoryUntilUs = 0
    this.peaks.fill(0)
  }
  setCalibration(cal: Calibration): boolean {
    if (!validCalibration(cal)) return false
    this.cal = structuredClone(cal)
    for (let i = 0; i < 4; i++) {
      this.cal.threshold[i] = f(this.cal.threshold[i])
      this.cal.strongMin[i] = f(this.cal.strongMin[i])
    }
    if (this.cal.templates) for (const row of this.cal.templates) {
      for (let i = 0; i < 4; i++) row[i] = f(row[i])
      const norm = Math.hypot(...row)
      for (let i = 0; i < 4; i++) row[i] = f(row[i] / norm)
    }
    this.resetHits()
    return true
  }
  setMode(mode: 'run' | 'calibrate' | 'raw'): void {
    this.mode = mode
    this.rawActive = false
    this.resetHits()
  }
  measureNoise(durationMs: number, nowUs: number): boolean {
    if (durationMs <= 0 || this.measuring) return false
    this.measuring = true
    this.noiseEndUs = nowUs + durationMs * 1000
    this.noiseSamples = 0
    this.noisePeaks.fill(0)
    this.noiseSquares.fill(0)
    return true
  }
  private emitPending(): void {
    const event = this.pending!
    this.pending = undefined
    this.emit(event)
  }
  private finishHit(nowUs: number): void {
    this.collecting = false
    this.refractoryUntilUs = nowUs + this.cal.refractoryMs * 1000
    const sat = this.saturated ? { sat: true as const } : {}
    if (this.mode === 'calibrate') {
      this.ringEvent = { t: 'hit', peaks: copy(this.peaks), ms: Math.floor((nowUs - this.hitStartUs) / 1000), ring: 0, ...sat }
      return
    }
    let region = 0, second = 0
    for (let i = 1; i < 4; i++) if (this.peaks[i] > this.peaks[region]) region = i
    for (let i = 0; i < 4; i++) if (i !== region) second = Math.max(second, this.peaks[i])
    const amp = Math.max(...this.peaks)
    let confidence = this.peaks[region] === 0 ? 0 : f(1 - f(second / this.peaks[region]))
    if (this.cal.templates) {
      const norm = Math.hypot(...this.peaks)
      let best = -2, runner = -2
      for (let r = 0; r < 4; r++) {
        let score = 0
        for (let ch = 0; ch < 4; ch++) score = f(score + f(this.cal.templates[r][ch] * this.peaks[ch]) / norm)
        if (score > best) { runner = best; best = score; region = r }
        else runner = Math.max(runner, score)
      }
      confidence = runner >= 1 ? 0 : Math.max(0, Math.min(1, f(f(best - runner) / f(1 - runner))))
    }
    const event: TapEvent = { t: 'tap', region: region as Region, count: 1, strength: amp >= this.cal.strongMin[region] ? 'strong' : 'weak', confidence, ...sat }
    if (this.pending) {
      if (event.region === this.pending.region && this.hitStartUs - this.pendingStartUs <= this.cal.doubleWindowMs * 1000) {
        this.pending.count = 2
        if (event.sat) this.pending.sat = true
        if (event.strength === 'strong') this.pending.strength = 'strong'
        this.pending.confidence = Math.min(this.pending.confidence, event.confidence)
        this.emitPending()
        return
      }
      this.emitPending()
    }
    this.pending = event
    this.pendingStartUs = this.hitStartUs
  }
  sample(raw: Channels, nowUs: number): void {
    if (!this.initialized) {
      for (let i = 0; i < 4; i++) this.dc[i] = raw[i]
      this.initialized = true
    }
    if (this.mode === 'raw') {
      if (this.rawActive && nowUs - this.rawStartUs >= 10000) {
        this.emit({ t: 'raw', min: copy(this.rawMin), max: copy(this.rawMax) })
        this.rawActive = false
      }
      if (!this.rawActive) {
        this.rawStartUs = nowUs
        for (let i = 0; i < 4; i++) this.rawMin[i] = this.rawMax[i] = raw[i]
        this.rawActive = true
      } else for (let i = 0; i < 4; i++) {
        this.rawMin[i] = Math.min(this.rawMin[i], raw[i])
        this.rawMax[i] = Math.max(this.rawMax[i], raw[i])
      }
    }
    let sampleSaturated = false, triggered = false, aboveQuiet = false
    for (let i = 0; i < 4; i++) {
      const delta = f(raw[i] - this.dc[i]), magnitude = Math.abs(delta)
      sampleSaturated ||= magnitude >= 1800
      this.magnitudes[i] = Math.round(magnitude)
      triggered ||= magnitude > this.cal.threshold[i]
      aboveQuiet ||= magnitude >= this.cal.threshold[i]
      if (!this.collecting && nowUs >= this.refractoryUntilUs && magnitude <= this.cal.threshold[i]) this.dc[i] = f(this.dc[i] + f(delta / 2048))
    }
    if (this.measuring && nowUs >= this.noiseEndUs) {
      const rms = channels()
      for (let i = 0; i < 4; i++) rms[i] = this.noiseSamples === 0 ? 0 : f(Math.sqrt(this.noiseSquares[i] / this.noiseSamples))
      this.measuring = false
      this.emit({ t: 'noise', peak: copy(this.noisePeaks), rms })
    }
    if (this.measuring) {
      this.noiseSamples++
      for (let i = 0; i < 4; i++) {
        this.noisePeaks[i] = Math.max(this.noisePeaks[i], this.magnitudes[i])
        this.noiseSquares[i] += this.magnitudes[i] * this.magnitudes[i]
      }
    }
    if (this.mode === 'raw') return
    if (this.collecting && nowUs - this.hitStartUs >= 15000) this.finishHit(nowUs)
    if (this.ringActive) {
      if (!this.ringDone) {
        if (aboveQuiet) this.quietActive = false
        else if (!this.quietActive) { this.quietActive = true; this.quietStartUs = nowUs }
        if ((this.quietActive && nowUs - this.quietStartUs >= 10000) || nowUs - this.hitStartUs >= 1000000) {
          const end = this.quietActive && nowUs - this.quietStartUs >= 10000 ? this.quietStartUs + 10000 : nowUs
          this.ringMs = Math.floor(Math.min(1000, (end - this.hitStartUs) / 1000))
          this.ringDone = true
        }
      }
      if (this.ringDone && !this.collecting) {
        this.ringEvent!.ring = this.ringMs
        this.emit(this.ringEvent!)
        this.ringActive = false
      }
    }
    if (!this.collecting && !(this.mode === 'calibrate' && this.ringActive) && nowUs >= this.refractoryUntilUs && triggered) {
      this.collecting = true
      this.hitStartUs = nowUs
      this.ringActive = this.mode === 'calibrate'
      this.ringDone = this.quietActive = this.saturated = false
      this.peaks.fill(0)
    }
    if (this.collecting) {
      this.saturated ||= sampleSaturated
      for (let i = 0; i < 4; i++) this.peaks[i] = Math.max(this.peaks[i], this.magnitudes[i])
    }
    if (this.pending && nowUs - this.pendingStartUs >= this.cal.doubleWindowMs * 1000 && !(this.collecting && this.hitStartUs - this.pendingStartUs <= this.cal.doubleWindowMs * 1000)) this.emitPending()
  }
}

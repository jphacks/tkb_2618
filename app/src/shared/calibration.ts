import { STEPS, TAPS_PER_STEP } from './tap-procedure'
import { isCalibration } from './validation'
import type { CalHit, Calibration, Channels, Noise } from './types'

/** A second tap on the same region within this counts as a double. Fixed; calibration does not tune it. */
export const DOUBLE_WINDOW_MS = 320
export const DEFAULT_CALIBRATION: Calibration = {
  threshold: [150, 150, 150, 150], doubleWindowMs: DOUBLE_WINDOW_MS, refractoryMs: 70
}
/** Three hits per region, in STEPS order. */
export type Samples = CalHit[][]
export class CalibrationError extends Error {
  constructor(public readonly regions: number[]) { super('領域が分かれません') }
}
const normalize = (p: number[]): Channels => {
  const length = Math.hypot(...p)
  if (!length) throw new Error('打撃の値が正しくありません')
  return p.map(v => v / length) as Channels
}
const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length
const template = (hits: CalHit[]): Channels => {
  const normalized = hits.map(h => normalize(h.peaks))
  return normalize([0, 1, 2, 3].map(ch => mean(normalized.map(p => p[ch]))))
}
export function calculateCalibration(noise: Noise, samples: Samples): Calibration {
  if (noise.peak.length !== 4 || noise.peak.some(v => !Number.isFinite(v) || v < 0 || v > 4095)) throw new Error('ノイズ測定値が正しくありません')
  if (samples.length !== STEPS.length || samples.some(s => s.length !== TAPS_PER_STEP || s.some(h => !h || h.sat !== undefined || !Array.isArray(h.peaks) || h.peaks.length !== 4 || h.peaks.some(v => !Number.isFinite(v) || v < 0 || v > 4095) || !Number.isFinite(h.ring) || h.ring < 0 || h.ring > 1000))) throw new Error('キャリブレーションの打数が足りません')
  const templates = samples.map(template) as NonNullable<Calibration['templates']>
  const errors = new Set<number>()
  // Sensors differ in gain and need not sit under the region with their index, so each channel's threshold comes from
  // its own noise and the taps that were loudest on it (relative to that noise): 2 × still peak, raised to half the softest.
  const loudest = (h: CalHit): number => { const z = h.peaks.map((p, c) => p / Math.max(1, noise.peak[c])); return z.indexOf(Math.max(...z)) }
  const threshold = [0, 1, 2, 3].map(c => {
    const own = samples.flat().filter(h => loudest(h) === c).map(h => h.peaks[c])
    return Math.max(noise.peak[c] * 2, own.length ? Math.min(...own) * 0.5 : 0)
  }) as Channels
  for (let r = 0; r < 4; r++) {
    for (let i = 0; i < samples[r].length; i++) {
      const p = normalize(samples[r][i].peaks)
      const candidates = templates.map((t, region) => region === r ? template(samples[r].filter((_, j) => j !== i)) : t)
      const scores = candidates.map(t => t.reduce((sum, v, ch) => sum + v * p[ch], 0))
      if (scores.indexOf(Math.max(...scores)) !== r) errors.add(r)
    }
  }
  if (errors.size) throw new CalibrationError([...errors].sort((a, b) => a - b))
  const refractoryMs = Math.round(Math.max(40, Math.min(250, Math.max(...samples.flat().map(h => h.ring)) * 1.2)))
  const cal = { threshold, templates, refractoryMs, doubleWindowMs: DOUBLE_WINDOW_MS }
  if (!isCalibration(cal)) throw new Error('ノイズが大きすぎます')
  return cal
}

/** errorRegion: the red tile being redone because it looked like another region. */
export type CalibrationProgress = { phase: 'noise' | 'tap' | 'done' | 'error'; step: number; samples: Samples; errorRegion: number | null; retryRegions: number[]; fire: number }
export const initialCalibrationProgress = (): CalibrationProgress => ({ phase: 'noise', step: 0, samples: STEPS.map(() => []), errorRegion: null, retryRegions: [], fire: 0 })

export function advanceCalibration(previous: CalibrationProgress, hit: CalHit, noise: Noise | null): CalibrationProgress {
  if (hit.sat || previous.phase !== 'tap') return previous
  const { step } = previous
  const samples = previous.samples.map(s => [...s])
  samples[step].push(hit)
  if (samples[step].length < TAPS_PER_STEP) return { ...previous, samples, fire: previous.fire + 1 }
  if (samples.every(s => s.length === TAPS_PER_STEP) && noise) {
    try { calculateCalibration(noise, samples) } catch (e) {
      if (e instanceof CalibrationError) {
        for (const r of e.regions) samples[r] = []
        return { ...previous, samples, step: e.regions[0], errorRegion: e.regions[0], retryRegions: e.regions, fire: 0 }
      }
      return { ...previous, phase: 'error' }
    }
  }
  const next = samples.findIndex(s => s.length < TAPS_PER_STEP)
  return { ...previous, samples, step: next < 0 ? STEPS.length : next, phase: next < 0 ? 'done' : 'tap',
    errorRegion: previous.retryRegions.includes(next) ? next : null, fire: 0 }
}

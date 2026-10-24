import { isCalibration } from './validation'
import type { CalHit, Calibration, Channels, Noise } from './types'

export const DEFAULT_CALIBRATION: Calibration = {
  threshold: [150, 150, 150, 150], strongMin: [700, 700, 700, 700], doubleWindowMs: 320, refractoryMs: 70
}
export type Samples = CalHit[][]
export class CalibrationError extends Error {
  constructor(public readonly regions: number[]) { super('強弱または領域が分かれません') }
}
const normalize = (p: number[]): Channels => {
  const length = Math.hypot(...p)
  if (!length) throw new Error('打撃の値が正しくありません')
  return p.map(v => v / length) as Channels
}
const amp = (h: CalHit): number => Math.max(...h.peaks)
const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length
const template = (hits: CalHit[]): Channels => {
  const normalized = hits.map(h => normalize(h.peaks))
  return normalize([0, 1, 2, 3].map(ch => mean(normalized.map(p => p[ch]))))
}
export function calculateCalibration(noise: Noise, samples: Samples): Calibration {
  if (noise.peak.length !== 4 || noise.peak.some(v => !Number.isFinite(v) || v < 0 || v > 4095)) throw new Error('ノイズ測定値が正しくありません')
  if (samples.length !== 8 || samples.some(s => s.length !== 3 || s.some(h => !h || h.sat !== undefined || !Array.isArray(h.peaks) || h.peaks.length !== 4 || h.peaks.some(v => !Number.isFinite(v) || v < 0 || v > 4095) || !Number.isFinite(h.ring) || h.ring < 0 || h.ring > 1000))) throw new Error('キャリブレーションの打数が足りません')
  const hits = [0, 1, 2, 3].map(r => [...samples[r * 2], ...samples[r * 2 + 1]])
  const templates = hits.map(template) as NonNullable<Calibration['templates']>
  const errors = new Set<number>()
  const threshold: Channels = [0, 0, 0, 0], strongMin: Channels = [0, 0, 0, 0]
  for (let r = 0; r < 4; r++) {
    const weak = samples[r * 2], strong = samples[r * 2 + 1]
    if (Math.max(...weak.map(amp)) >= Math.min(...strong.map(amp))) errors.add(r)
    threshold[r] = Math.max(noise.peak[r] * 2, Math.min(...weak.map(h => h.peaks[r])) * 0.5)
    strongMin[r] = Math.sqrt(mean(weak.map(amp)) * mean(strong.map(amp)))
    for (let i = 0; i < 6; i++) {
      const p = normalize(hits[r][i].peaks)
      const candidates = templates.map((t, region) => region === r ? template(hits[r].filter((_, j) => j !== i)) : t)
      const scores = candidates.map(t => t.reduce((sum, v, ch) => sum + v * p[ch], 0))
      if (scores.indexOf(Math.max(...scores)) !== r) errors.add(r)
    }
  }
  if (errors.size) throw new CalibrationError([...errors].sort((a, b) => a - b))
  const refractoryMs = Math.round(Math.max(40, Math.min(250, Math.max(...samples.flat().map(h => h.ring)) * 1.2)))
  const cal = { threshold, strongMin, templates, refractoryMs, doubleWindowMs: Math.max(320, refractoryMs + 120) }
  if (!isCalibration(cal)) throw new Error('ノイズが大きすぎます')
  return cal
}

export type CalibrationProgress = { phase: 'noise' | 'tap' | 'done' | 'error'; step: number; samples: Samples; errorRegion: number | null; retryRegions: number[]; fire: number }
export const initialCalibrationProgress = (): CalibrationProgress => ({ phase: 'noise', step: 0, samples: Array.from({ length: 8 }, () => []), errorRegion: null, retryRegions: [], fire: 0 })

export function advanceCalibration(previous: CalibrationProgress, hit: CalHit, noise: Noise | null): CalibrationProgress {
  if (hit.sat || previous.phase !== 'tap') return previous
  const { step } = previous, region = Math.floor(step / 2)
  const samples = previous.samples.map(s => [...s])
  samples[step].push(hit)
  if (samples[step].length < 3) return { ...previous, samples, errorRegion: null, fire: previous.fire + 1 }
  if (step % 2 === 1 && Math.max(...samples[step - 1].map(h => Math.max(...h.peaks))) >= Math.min(...samples[step].map(h => Math.max(...h.peaks)))) {
    samples[step - 1] = []; samples[step] = []
    return { ...previous, step: step - 1, samples, errorRegion: region, fire: previous.fire + 1 }
  }
  if (samples.every(s => s.length === 3) && noise) {
    try { calculateCalibration(noise, samples) } catch (e) {
      if (e instanceof CalibrationError) {
        for (const r of e.regions) { samples[r * 2] = []; samples[r * 2 + 1] = [] }
        return { ...previous, samples, step: e.regions[0] * 2, errorRegion: e.regions[0], retryRegions: e.regions, fire: 0 }
      }
      return { ...previous, phase: 'error' }
    }
  }
  const next = samples.findIndex(s => s.length < 3)
  // A new region has not been hit yet; do not carry the previous tile's ripple over.
  return { ...previous, samples, step: next < 0 ? 8 : next, phase: next < 0 ? 'done' : 'tap', errorRegion: previous.retryRegions.includes(Math.floor(next / 2)) ? Math.floor(next / 2) : null, fire: step % 2 === 1 ? 0 : previous.fire + 1 }
}

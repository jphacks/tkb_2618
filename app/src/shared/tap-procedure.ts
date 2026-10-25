import type { CalHit, Channels, Noise } from './types'

// The settings screen's calibration, following tools/tap-collect (collect.mjs is the reference).
// tap-collect's collection and score.mjs use this same code, so a
// change tuned there and adopted here is what production runs.

/** Still table at the start. */
export const REST_MS = 3000
/** From the instruction to the cue. Its last BASELINE_MS is kept still and gives the step's baseline. */
export const PREPARE_MS = 2000
export const BASELINE_MS = 1000
/** The tap window after the cue. */
export const WINDOW_MS = 5000
export const TAPS_PER_STEP = 3
/** A mountain is an excursion from the baseline beyond the still peak × this. */
export const MOUNTAIN_FACTOR = 1.5
/** Quiet longer than this ends a mountain, so ringing stays one tap. */
export const MOUNTAIN_GAP_MS = 50
/** Steps in order, one per region. Index = region. */
export const STEPS = [0, 1, 2, 3].map(region => ({ region }))

export type Rest = Noise & { baseline: Channels }

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2)
  return sorted.length ? (sorted[mid] + sorted[Math.ceil(sorted.length / 2) - 1]) / 2 : 0
}
export const baselineOf = (rows: Channels[]): Channels => [0, 1, 2, 3].map(ch => median(rows.map(row => row[ch]))) as Channels

/** Largest distance from the baseline over the rows (collect's `peak` of a trial). */
export function peakFrom(rows: Channels[], baseline: Channels): Channels {
  const peak: Channels = [0, 0, 0, 0]
  for (const row of rows) for (let ch = 0; ch < 4; ch++) peak[ch] = Math.max(peak[ch], Math.abs(row[ch] - baseline[ch]))
  return peak
}
/**
 * The still trial as collect records it: baseline is the median of the BASELINE_MS before the cue, peak spans both parts.
 * With one argument the baseline is the median of all rows.
 */
export function restFrom(before: Channels[], after: Channels[] = []): Rest {
  const baseline = baselineOf(before), rows = [...before, ...after], squares: Channels = [0, 0, 0, 0]
  for (const row of rows) for (let ch = 0; ch < 4; ch++) squares[ch] += (row[ch] - baseline[ch]) ** 2
  return { t: 'noise', baseline, peak: peakFrom(rows, baseline), rms: squares.map(s => rows.length ? Math.sqrt(s / rows.length) : 0) as Channels }
}
export const mountainThreshold = (restPeak: Channels): Channels => restPeak.map(p => Math.max(1, p * MOUNTAIN_FACTOR)) as Channels

/** Turns rows after the cue into hits, one per mountain. */
export class MountainCounter {
  /** Row index (from the cue) where the current or last closed mountain started. */
  start = 0
  private open = false
  private last = -Infinity
  private i = 0
  private peaks: Channels = [0, 0, 0, 0]
  private saturated = false
  private readonly threshold: Channels
  private readonly baseline: Channels
  private readonly rate: number
  private readonly onHit: (hit: CalHit) => void
  constructor(baseline: Channels, restPeak: Channels, rate: number, onHit: (hit: CalHit) => void) {
    this.baseline = baseline; this.threshold = mountainThreshold(restPeak); this.rate = rate; this.onHit = onHit
  }
  push(values: Channels): void {
    const i = this.i++
    if (this.open && i - this.last > this.rate * MOUNTAIN_GAP_MS / 1000) this.close()
    let above = false
    for (let ch = 0; ch < 4; ch++) above ||= Math.abs(values[ch] - this.baseline[ch]) > this.threshold[ch]
    if (!above) return
    if (!this.open) { this.open = true; this.start = i; this.peaks = [0, 0, 0, 0]; this.saturated = false }
    this.last = i
    for (let ch = 0; ch < 4; ch++) {
      this.peaks[ch] = Math.max(this.peaks[ch], Math.abs(values[ch] - this.baseline[ch]))
      this.saturated ||= values[ch] <= 5 || values[ch] >= 4090
    }
  }
  finish(): void { if (this.open) this.close() }
  private close(): void {
    this.open = false
    const ms = Math.min(1000, Math.round((this.last - this.start + 1) * 1000 / this.rate))
    this.onHit({ t: 'hit', peaks: this.peaks.map(p => Math.min(4095, Math.round(p))) as Channels, ms, ring: ms, ...(this.saturated ? { sat: true as const } : {}) })
  }
}

/** All mountains in a recorded step: baseline from the rows before the cue, hits from the rows after it. */
export function stepHits(before: Channels[], after: Channels[], restPeak: Channels, rate: number): CalHit[] {
  const hits: CalHit[] = []
  const counter = new MountainCounter(baselineOf(before), restPeak, rate, hit => hits.push(hit))
  for (const row of after) counter.push(row)
  counter.finish()
  return hits
}

/** The step's samples: the largest unsaturated mountains, or null when there are too few.
 * Defaults to TAPS_PER_STEP; scoring can fill remaining slots from multiple recorded trials. */
export function pickHits(hits: CalHit[], count = TAPS_PER_STEP): CalHit[] | null {
  const usable = hits.filter(h => !h.sat).sort((a, b) => Math.max(...b.peaks) - Math.max(...a.peaks)).slice(0, count)
  return usable.length < count ? null : usable
}

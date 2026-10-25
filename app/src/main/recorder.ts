import { BASELINE_MS, baselineOf, MountainCounter, WINDOW_MS, type Rest } from '../shared/tap-procedure'
import type { CalHit, Channels } from '../shared/types'

// Live recording for the settings screen. The procedure and how mountains are counted live in
// shared/tap-procedure.ts, which tools/tap-collect loads too.
export { BASELINE_MS, MOUNTAIN_FACTOR, MOUNTAIN_GAP_MS, MountainCounter, median, REST_MS, restFrom, WINDOW_MS, type Rest } from '../shared/tap-procedure'

/** No sample for this long means the firmware does not stream raw values. */
const SILENCE_MS = 1000

export type SampleSource = (callback: (values: Channels, rate: number) => void) => () => void

/** Collects rows for a span of sample time. Rejects when the device goes quiet or the signal aborts. */
export function record(source: SampleSource, ms: number, onRow?: (values: Channels, rate: number) => void, signal?: AbortSignal): Promise<{ rows: Channels[]; rate: number }> {
  return new Promise((resolve, reject) => {
    const rows: Channels[] = []
    let rate = 0, timer: ReturnType<typeof setTimeout>
    const done = (error?: Error): void => {
      clearTimeout(timer); unsubscribe(); signal?.removeEventListener('abort', aborted)
      if (error) reject(error); else resolve({ rows, rate })
    }
    const watch = (): void => { clearTimeout(timer); timer = setTimeout(() => done(new Error('デバイスから生値が届きません')), SILENCE_MS) }
    const aborted = (): void => done(new Error('記録を中止しました'))
    const unsubscribe = source((values, r) => {
      rate = r
      rows.push([...values] as Channels)
      onRow?.(values, r)
      watch()
      if (rows.length >= Math.round(r * ms / 1000)) done()
    })
    if (signal?.aborted) { aborted(); return }
    signal?.addEventListener('abort', aborted)
    watch()
  })
}

/** One prompted step: BASELINE_MS of stillness, the cue, then the tap window. Hits stream out as mountains close. */
export async function recordStep(source: SampleSource, rest: Rest, cue: () => void, onHit: (hit: CalHit) => void, signal?: AbortSignal): Promise<CalHit[]> {
  const before = await record(source, BASELINE_MS, undefined, signal)
  const hits: CalHit[] = []
  const counter = new MountainCounter(baselineOf(before.rows), rest.peak, before.rate, hit => { hits.push(hit); onHit(hit) })
  cue()
  await record(source, WINDOW_MS, values => counter.push(values), signal)
  counter.finish()
  return hits
}

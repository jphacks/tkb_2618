import type { Calibration, Channels, Noise } from './types'

export const DEFAULT_CALIBRATION: Calibration = {
  threshold: [150, 150, 150, 150], strongMin: [700, 700, 700, 700], doubleWindowMs: 320, refractoryMs: 70
}
export type Samples = number[][]
export function calculateCalibration(noise: Noise, samples: Samples): Calibration {
  if (samples.length !== 8 || samples.some(s => s.length !== 3 || s.some(v => !Number.isFinite(v) || v < 0))) {
    throw new Error('キャリブレーションの打数が足りません')
  }
  const threshold: Channels = [0, 0, 0, 0]
  const strongMin: Channels = [0, 0, 0, 0]
  for (let r = 0; r < 4; r++) {
    const weak = samples[r * 2], strong = samples[r * 2 + 1]
    if (Math.max(...weak) >= Math.min(...strong)) throw new Error('強弱が分かれません')
    threshold[r] = Math.max(noise.peak[r] * 2, Math.min(...weak) * 0.5)
    strongMin[r] = Math.sqrt((weak.reduce((a, b) => a + b, 0) / 3) * (strong.reduce((a, b) => a + b, 0) / 3))
  }
  return { ...DEFAULT_CALIBRATION, threshold, strongMin }
}

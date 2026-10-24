import { useEffect, useRef, useState } from 'react'
import { calculateCalibration, type Samples } from '../../shared/calibration'
import { REGIONS } from '../../shared/constants'
import type { Noise, Region } from '../../shared/types'
import { Icon, IconButton } from './Icon'

type Progress = { phase: 'noise' | 'tap' | 'done' | 'error'; step: number; samples: Samples; errorRegion: number | null; fire: number }
const initial = (): Progress => ({ phase: 'noise', step: 0, samples: Array.from({ length: 8 }, () => []), errorRegion: null, fire: 0 })
export function Calibration({ close, guard }: { close: () => void; guard: (work: Promise<unknown>) => void }) {
  const [progress, setProgress] = useState<Progress>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const noise = useRef<Noise | null>(null)
  const generation = useRef(0)
  const startNoise = async (): Promise<void> => {
    const run = ++generation.current
    noise.current = null
    setError(null); setProgress(initial())
    try {
      await window.deskapi.calStart()
      const measured = await window.deskapi.calMeasureNoise()
      if (generation.current !== run) return
      noise.current = measured
      setProgress(previous => ({ ...previous, phase: 'tap' }))
    } catch (e) {
      if (generation.current !== run) return
      setError(e instanceof Error ? e.message : String(e))
      setProgress(previous => ({ ...previous, phase: 'error' }))
    }
  }
  useEffect(() => {
    const unsubscribe = window.deskapi.onCalHit(hit => setProgress(previous => {
      if (previous.phase !== 'tap') return previous
      const { step } = previous, region = Math.floor(step / 2)
      if (hit.peaks.indexOf(Math.max(...hit.peaks)) !== region) return previous
      const samples = previous.samples.map(s => [...s])
      samples[step].push(hit.peaks[region])
      if (samples[step].length < 3) return { ...previous, samples, errorRegion: null, fire: previous.fire + 1 }
      if (step % 2 === 1 && Math.max(...samples[step - 1]) >= Math.min(...samples[step])) {
        samples[step - 1] = []; samples[step] = []
        return { ...previous, step: step - 1, samples, errorRegion: region, fire: previous.fire + 1 }
      }
      return { ...previous, samples, step: step + 1, phase: step === 7 ? 'done' : 'tap', errorRegion: null, fire: previous.fire + 1 }
    }))
    void startNoise()
    return () => { generation.current++; unsubscribe(); guard(window.deskapi.calCancel()) }
  }, [])
  const { phase, step, samples, errorRegion, fire } = progress
  const hits = samples[step]?.length ?? 0
  const cancel = async (): Promise<void> => {
    setBusy(true)
    try { generation.current++; await window.deskapi.calCancel(); close() } finally { setBusy(false) }
  }
  const save = async (): Promise<void> => {
    if (!noise.current) return
    setBusy(true)
    try { await window.deskapi.calSave(calculateCalibration(noise.current, samples)); close() } finally { setBusy(false) }
  }
  return <div className="calibration-page" title={error ?? undefined}>
    <div className="calibration-header"><div className="progress-segments" role="progressbar" aria-label="進み具合" aria-valuemin={0} aria-valuemax={8} aria-valuenow={step}>
      {Array.from({ length: 8 }, (_, i) => <span key={i} style={{ background: phase === 'done' || i < step ? '#EDEDED' : phase === 'tap' && i === step ? '#2214D6' : '#2A2A2A' }} />)}
    </div><IconButton label="閉じる" icon="close" disabled={busy} onClick={() => guard(cancel())} /></div>
    <section aria-label="机" className="calibration-section"><div className="calibration-map-wrap">
      <div className="calibration-grid" style={{ opacity: phase === 'noise' ? 0.15 : 1 }}>{REGIONS.map((name, r) => {
        const current = phase === 'tap' && Math.floor(step / 2) === r, done = phase === 'done' || step > r * 2 + 1, strong = step % 2 === 1
        return <button type="button" key={r} className="calibration-tile" disabled={!current || busy} aria-label={current ? `${name}を${strong ? '強く' : '弱く'}叩く（${hits}/3）` : name}
          style={{ background: errorRegion === r ? '#D62413' : current ? '#2214D6' : '#1A1A1A', cursor: current && window.deskapi.isMock ? 'pointer' : 'default' }}
          onClick={() => { if (window.deskapi.calMockHit) guard(window.deskapi.calMockHit(r as Region, strong ? 'strong' : 'weak')) }}>
          {current && <><span className="cal-breathe" />{fire > 0 && <span key={fire} className="cal-ripple" />}<span className="cal-verb"><i style={{ width: strong ? 26 : 12, height: strong ? 26 : 12 }} /><span>{strong ? '強く' : '弱く'}</span></span>
            <span className="cal-pips">{Array.from({ length: 3 }, (_, i) => <i key={i} style={{ background: i < hits ? '#FFFFFF' : 'transparent' }} />)}</span></>}
          {done && <span style={{ color: '#13D66A' }}><Icon name="check" size={36} /></span>}
        </button>
      })}</div>
      {phase === 'noise' && <div className="noise-overlay"><svg width="110" height="110" viewBox="0 0 110 110" aria-hidden="true">
        <circle cx="55" cy="55" r="48" fill="none" stroke="#2A2A2A" strokeWidth="6" /><circle cx="55" cy="55" r="48" fill="none" stroke="#EDEDED" strokeWidth="6" strokeLinecap="round" strokeDasharray="302" strokeDashoffset="302" transform="rotate(-90 55 55)" className="noise-ring" />
        <path d="M45 62V40a3 3 0 0 1 6 0v14V36a3 3 0 0 1 6 0v18V38a3 3 0 0 1 6 0v18-10a3 3 0 0 1 6 0v14a14 14 0 0 1-14 14h-1a12 12 0 0 1-9.6-4.8L37 58a3 3 0 0 1 4.6-3.8z" fill="#EDEDED" fillOpacity="0.9" /><path d="M30 30l50 50" stroke="#121212" strokeWidth="7" strokeLinecap="round" /><path d="M30 30l50 50" stroke="#EDEDED" strokeWidth="3" strokeLinecap="round" />
      </svg><span>机に触れずに待つ</span></div>}
    </div><div className="calibration-buttons">
      {phase === 'tap' && <IconButton label="1回戻す" icon="undo" className="cal-round" onClick={() => setProgress(previous => {
        const samples = previous.samples.map(s => [...s])
        let step = previous.step
        if (samples[step].length === 0) { if (step === 0) return previous; step-- }
        samples[step].pop()
        for (let i = step + 1; i < 8; i++) samples[i] = []
        return { ...previous, samples, step, errorRegion: null, fire: 0 }
      })} />}
      {(phase === 'done' || phase === 'error') && <IconButton label="やり直す" icon="restart" className="cal-round" disabled={busy} onClick={() => guard(startNoise())} />}
      {phase === 'done' && <IconButton label="保存" icon="check" className="cal-save" disabled={busy} onClick={() => guard(save())} />}
    </div></section>
  </div>
}

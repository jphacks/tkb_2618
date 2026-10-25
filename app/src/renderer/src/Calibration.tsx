import { useEffect, useRef, useState } from 'react'
import { advanceCalibration, type CalibrationProgress, initialCalibrationProgress } from '../../shared/calibration'
import { REGIONS } from '../../shared/constants'
import { BASELINE_MS, pickHits, PREPARE_MS, REST_MS, STEPS, TAPS_PER_STEP, WINDOW_MS } from '../../shared/tap-procedure'
import type { CalHit, DeviceStatus, Noise, Region } from '../../shared/types'
import { Icon, IconButton } from './Icon'

const RETRY = 'ほかの場所と区別できません。センサーの近くを叩く'
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

// The procedure in shared/tap-procedure.ts, shared with tools/tap-collect: still, then per step an
// instruction, a still baseline, the cue and the tap window. Only mountains inside the window count.
export function Calibration({ status, close, guard }: { status: DeviceStatus; close: () => void; guard: (work: Promise<unknown>) => void }) {
  const [progress, setProgress] = useState(initialCalibrationProgress)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The ring fills only while the device is really recording the still table.
  const [measuring, setMeasuring] = useState(false)
  // 'wait': keep still for the baseline. 'go': the 5 s window after the cue.
  const [stage, setStage] = useState<'wait' | 'go' | null>(null)
  const [live, setLive] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const current = useRef(progress)
  const noise = useRef<Noise | null>(null)
  const generation = useRef(0)
  const connected = status.state === 'connected'
  const commit = (next: CalibrationProgress): void => { current.current = next; setProgress(next) }
  const fail = (message: string): void => {
    generation.current++
    setMeasuring(false); setStage(null); setError(message)
    commit({ ...current.current, phase: 'error' })
  }
  const runSteps = async (run: number): Promise<void> => {
    while (generation.current === run && current.current.phase === 'tap') {
      setStage('wait'); setLive(0)
      await sleep(PREPARE_MS - BASELINE_MS)
      if (generation.current !== run) return
      let hits: CalHit[]
      try { hits = await window.deskapi.calRecord() } catch (e) {
        if (generation.current === run) fail(e instanceof Error ? e.message : String(e))
        return
      }
      if (generation.current !== run) return
      setStage(null)
      const usable = pickHits(hits)
      if (!usable) {
        setNotice(hits.length >= TAPS_PER_STEP ? '振り切れた打があります。少し弱く叩く' : `${hits.length} 回しか拾えませんでした。合図のあとに ${TAPS_PER_STEP} 回叩く`)
        continue
      }
      setNotice(null)
      let next = current.current
      try {
        for (const hit of usable) next = advanceCalibration(next, hit, noise.current)
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e))
        return
      }
      commit(next)
      await sleep(400)
    }
  }
  const startNoise = async (): Promise<void> => {
    const run = ++generation.current
    noise.current = null
    setError(null); setNotice(null); setStage(null); setMeasuring(false); commit(initialCalibrationProgress())
    try {
      await window.deskapi.calStart()
      await sleep(PREPARE_MS - BASELINE_MS)
      if (generation.current !== run) return
      setMeasuring(true)
      const measured = await window.deskapi.calMeasureNoise()
      if (generation.current !== run) return
      setMeasuring(false)
      noise.current = measured
      commit({ ...current.current, phase: 'tap' })
      await runSteps(run)
    } catch (e) {
      if (generation.current !== run) return
      fail(e instanceof Error ? e.message : String(e))
    }
  }
  useEffect(() => {
    const stopCue = window.deskapi.onCalCue(() => setStage('go'))
    const stopHit = window.deskapi.onCalHit(() => setLive(n => n + 1))
    void startNoise()
    return () => { generation.current++; stopCue(); stopHit(); guard(window.deskapi.calCancel()) }
  }, [])
  useEffect(() => { if (!connected && current.current.phase !== 'error') fail('デバイスとの接続が切れました') }, [connected])
  const { phase, step, errorRegion } = progress
  const hits = stage === 'go' ? Math.min(TAPS_PER_STEP, live) : 0
  const cancel = async (): Promise<void> => {
    setBusy(true)
    try { generation.current++; await window.deskapi.calCancel(); close() } finally { setBusy(false) }
  }
  const save = async (): Promise<void> => {
    if (!noise.current) return
    setBusy(true)
    try { await window.deskapi.calSave(current.current.samples); close() } finally { setBusy(false) }
  }
  // Redo the previous step (or this one at the start): the window being recorded is thrown away.
  const undo = (): void => {
    const run = ++generation.current
    guard(window.deskapi.calAbort())
    const previous = current.current, back = Math.max(0, previous.step - 1)
    const samples = previous.samples.map((s, i) => i >= back ? [] : [...s])
    setNotice(null); setStage(null)
    commit({ ...previous, samples, step: back, errorRegion: null, fire: 0 })
    void runSteps(run)
  }
  return <div className="calibration-page">
    <div className="calibration-header"><div className="progress-segments" role="progressbar" aria-label="進み具合" aria-valuemin={0} aria-valuemax={STEPS.length} aria-valuenow={step}>
      {STEPS.map((_, i) => <span key={i} style={{ background: phase === 'done' || i < step ? '#EDEDED' : phase === 'tap' && i === step ? '#03AED2' : '#2A2A2A' }} />)}
    </div><IconButton label="閉じる" icon="close" disabled={busy} onClick={() => guard(cancel())} /></div>
    <section aria-label="机" className="calibration-section"><div className="calibration-map-wrap">
      <div className="calibration-grid" style={{ opacity: phase === 'noise' || phase === 'error' ? 0.15 : 1 }}>{REGIONS.map((name, r) => {
        const active = phase === 'tap' && step === r, done = phase === 'done' || step > r, go = active && stage === 'go'
        return <button type="button" key={r} className="calibration-tile" disabled={!go || busy} aria-label={active ? `${name}を叩く（${hits}/${TAPS_PER_STEP}）` : name}
          style={{ background: errorRegion === r ? '#D12052' : active ? '#03AED2' : '#1A1A1A', opacity: active && !go ? 0.45 : 1, cursor: go && window.deskapi.isMock ? 'pointer' : 'default' }}
          onClick={() => { if (window.deskapi.calMockHit) guard(window.deskapi.calMockHit(r as Region)) }}>
          {active && <>{go && <span className="cal-breathe" />}{go && live > 0 && <span key={live} className="cal-ripple" />}<span className="cal-verb"><span>叩く</span></span>
            <span className="cal-pips">{Array.from({ length: TAPS_PER_STEP }, (_, i) => <i key={i} style={{ background: i < hits ? '#121212' : 'transparent' }} />)}</span>
            {go && <span className="cal-window" style={{ animationDuration: `${WINDOW_MS}ms` }} />}</>}
          {done && <span style={{ color: '#13D66A' }}><Icon name="check" size={36} /></span>}
        </button>
      })}</div>
      {phase === 'noise' && <div className="noise-overlay"><svg width="110" height="110" viewBox="0 0 110 110" aria-hidden="true">
        <circle cx="55" cy="55" r="48" fill="none" stroke="#2A2A2A" strokeWidth="6" /><circle cx="55" cy="55" r="48" fill="none" stroke="#EDEDED" strokeWidth="6" strokeLinecap="round" strokeDasharray="302" strokeDashoffset="302" transform="rotate(-90 55 55)" className={measuring ? 'noise-ring' : undefined} style={{ animationDuration: `${BASELINE_MS + REST_MS}ms` }} />
        <path d="M45 62V40a3 3 0 0 1 6 0v14V36a3 3 0 0 1 6 0v18V38a3 3 0 0 1 6 0v18-10a3 3 0 0 1 6 0v14a14 14 0 0 1-14 14h-1a12 12 0 0 1-9.6-4.8L37 58a3 3 0 0 1 4.6-3.8z" fill="#EDEDED" fillOpacity="0.9" /><path d="M30 30l50 50" stroke="#121212" strokeWidth="7" strokeLinecap="round" /><path d="M30 30l50 50" stroke="#EDEDED" strokeWidth="3" strokeLinecap="round" />
      </svg><span>机に触れずに待つ</span></div>}
      {phase === 'error' && error && <div className="noise-overlay cal-error" role="alert"><span>{error}</span></div>}
    </div><p className="cal-hint" role="status">{phase !== 'tap' ? '' : notice ?? (errorRegion !== null ? RETRY : '')}</p><div className="calibration-buttons">
      {phase === 'tap' && <IconButton label="1回戻す" icon="undo" className="cal-round" onClick={undo} />}
      {(phase === 'done' || phase === 'error') && <IconButton label="やり直す" icon="restart" className="cal-round" disabled={busy || !connected} onClick={() => guard(startNoise())} />}
      {phase === 'done' && <IconButton label="保存" icon="check" className="cal-save" disabled={busy} onClick={() => guard(save())} />}
    </div></section>
  </div>
}

import { useEffect, useRef, useState } from 'react'
import type { Config, DeviceStatus } from '../../shared/types'

export function useConfig() {
  const [config, setConfig] = useState<Config | null>(null)
  const [status, setStatus] = useState<DeviceStatus>({ state: 'disconnected' })
  const [error, setError] = useState<string | null>(null)
  const current = useRef<Config | null>(null)
  const dirty = useRef(false)
  const pending = useRef(new Set<Config>())
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const fail = (e: unknown): void => { setError(e instanceof Error ? e.message : String(e)) }
  const guard = (work: Promise<unknown>): void => { void work.catch(fail) }
  const flush = (): Promise<void> => {
    clearTimeout(timer.current)
    if (dirty.current && current.current) {
      const snapshot = structuredClone(current.current)
      dirty.current = false
      pending.current.add(snapshot)
      queue.current = queue.current.catch(() => {}).then(() => window.deskapi.saveConfig(snapshot)).then(() => setError(null)).catch(e => {
        if (pending.current.size === 1) dirty.current = true
        fail(e)
        throw e
      }).finally(() => { pending.current.delete(snapshot) })
    }
    return queue.current
  }
  const edit = (change: (config: Config) => Config): void => {
    if (!current.current) return
    current.current = change(current.current)
    setConfig(current.current)
    dirty.current = true
    clearTimeout(timer.current)
    timer.current = setTimeout(() => guard(flush()), 300)
  }
  useEffect(() => {
    let alive = true
    const stopConfig = window.deskapi.onConfigChanged(next => {
      if (!alive) return
      // Preserve local edits until their saves settle, and rebase queued snapshots on tray changes.
      for (const snapshot of pending.current) {
        snapshot.activeProfileId = next.activeProfileId
        snapshot.locked = next.locked
      }
      if ((dirty.current || pending.current.size > 0) && current.current) next = { ...current.current, activeProfileId: next.activeProfileId, locked: next.locked }
      current.current = next
      setConfig(next)
    })
    const stopStatus = window.deskapi.onDeviceStatus(next => { if (alive) setStatus(next) })
    guard(Promise.all([window.deskapi.getConfig(), window.deskapi.getDeviceStatus()]).then(([initial, device]) => {
      if (!alive) return
      current.current = initial
      setConfig(initial)
      setStatus(device)
    }))
    const onBlur = (): void => guard(flush())
    window.addEventListener('blur', onBlur)
    return () => { alive = false; stopConfig(); stopStatus(); window.removeEventListener('blur', onBlur); guard(flush()) }
  }, [])
  return { config, status, error, edit, flush, guard }
}

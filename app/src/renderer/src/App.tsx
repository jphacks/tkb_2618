import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { useEffect, useState } from 'react'
import { freshKey } from '../../shared/constants'
import { KEY_COUNT, keyIndexOf, type Action, type Config, type DeskKey } from '../../shared/types'
import { useConfig } from './useConfig'
import { DeskMap, KeyFace, keyStyle } from './DeskMap'
import { KeyEditor } from './KeyEditor'
import { Calibration } from './Calibration'
import { IconButton } from './Icon'
import { DeviceAlert, useDeviceAlert } from './DeviceAlert'

function Settings({ config, edit, close, guard }: { config: Config; edit: (change: (config: Config) => Config) => void; close: () => void; guard: (work: Promise<unknown>) => void }) {
  const [ports, setPorts] = useState<string[]>([])
  useEffect(() => { guard(window.deskapi.listPorts().then(setPorts)) }, [])
  return <aside aria-label="設定" className="side-panel settings-panel"><div className="settings-close"><IconButton label="閉じる" icon="close" onClick={close} /></div>
    {(['notify', 'autostart'] as const).map((field, i) => <label className="setting-row" key={field}><span>{i === 0 ? '通知' : '自動起動'}</span><button type="button" role="switch" aria-label={i === 0 ? '通知' : '自動起動'} aria-checked={config[field]} className="toggle" onClick={() => edit(c => ({ ...c, [field]: !c[field] }))}><i /></button></label>)}
    <label className="setting-row"><span>ポート</span><select aria-label="ポート" value={config.port} onChange={e => edit(c => ({ ...c, port: e.target.value }))}><option value="auto">自動</option>{Array.from(new Set([...ports, ...(config.port !== 'auto' ? [config.port] : [])])).map(port => <option key={port} value={port}>{port}</option>)}</select></label>
  </aside>
}
export function App() {
  const { config, status, error, edit, flush, guard } = useConfig()
  const [selected, setSelected] = useState(2)
  const [settings, setSettings] = useState(false)
  const [calibrating, setCalibrating] = useState(false)
  const [fired, setFired] = useState<Record<number, number>>({})
  const [dragKey, setDragKey] = useState<DeskKey | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const alert = useDeviceAlert(status)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor))
  useEffect(() => {
    let sequence = 0
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const stop = window.deskapi.onTap(tap => {
      const index = keyIndexOf(tap), fire = ++sequence
      setFired(previous => ({ ...previous, [index]: fire }))
      const timer = setTimeout(() => {
        timers.delete(timer)
        setFired(previous => { if (previous[index] !== fire) return previous; const next = { ...previous }; delete next[index]; return next })
      }, 650)
      timers.add(timer)
    })
    return () => { stop(); timers.forEach(clearTimeout) }
  }, [])
  useEffect(() => {
    if (!menu) return
    const dismiss = (): void => setMenu(null)
    const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') dismiss() }
    window.addEventListener('click', dismiss); window.addEventListener('keydown', key)
    return () => { window.removeEventListener('click', dismiss); window.removeEventListener('keydown', key) }
  }, [menu])
  if (!config) return <div className="app-loading" aria-busy="true" title={error ?? undefined} />
  const profile = config.profiles.find(p => p.id === config.activeProfileId)!
  const value = profile.keys[selected]
  const changeKey = (key: DeskKey | null): void => edit(c => ({ ...c, profiles: c.profiles.map(p => p.id === c.activeProfileId ? { ...p, keys: p.keys.map((k, i) => i === selected ? key : k) } : p) }))
  const onDragStart = ({ active }: DragStartEvent): void => {
    const data = active.data.current
    setDragKey(data?.type === 'key' ? profile.keys[data.index as number] : freshKey(data?.actionType as Action['type'], config.profiles[1]?.id ?? profile.id))
  }
  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    setDragKey(null)
    const data = active.data.current, index = over?.data.current?.index as number | undefined
    if (!data || index === undefined) return
    edit(c => ({ ...c, profiles: c.profiles.map(p => {
      if (p.id !== c.activeProfileId) return p
      const keys = [...p.keys]
      if (data.type === 'key') [keys[index], keys[data.index as number]] = [keys[data.index as number], keys[index]]
      else keys[index] = freshKey(data.actionType as Action['type'], c.profiles[1]?.id ?? p.id)
      return { ...p, keys }
    }) }))
    setSelected(index)
  }
  const finishRename = (): void => {
    if (renaming && draft.trim()) edit(c => ({ ...c, profiles: c.profiles.map(p => p.id === renaming ? { ...p, name: draft.trim() } : p) }))
    setRenaming(null)
  }
  const deleteProfile = (id: string): void => edit(c => {
    if (c.profiles.length <= 1) return c
    const remaining = c.profiles.filter(p => p.id !== id), fallback = remaining[0].id
    return { ...c, activeProfileId: c.activeProfileId === id ? fallback : c.activeProfileId,
      profiles: remaining.map(p => ({ ...p, keys: p.keys.map(k => k?.action.type === 'profile' && k.action.to === id ? { ...k, action: { type: 'profile', to: fallback } } : k) })) }
  })
  const statusLabel = error ?? (status.state === 'connected' ? `接続中 · ${status.port}` : status.state === 'connecting' ? '接続試行中' : '未接続')
  const deviceAlert = alert.open && <DeviceAlert reason={alert.reason} dismiss={alert.dismiss} choosePort={() => { setCalibrating(false); setSettings(true) }} />
  if (calibrating) return <><Calibration status={status} close={() => setCalibrating(false)} guard={guard} />{deviceAlert}</>
  return <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragKey(null)} accessibility={{ screenReaderInstructions: { draggable: 'スペースキーで持ち上げ、矢印キーで移動、もう一度スペースキーで割り当てます。Escで中止します。' }, announcements: {
    onDragStart: () => 'ドラッグを開始しました', onDragOver: ({ over }) => over ? '割り当て先を選択しています' : undefined,
    onDragEnd: ({ over }) => over ? 'キーに割り当てました' : 'ドラッグを中止しました', onDragCancel: () => 'ドラッグを中止しました'
  } }}>
    <div className="settings-page"><main className="map-main"><header className="map-header"><nav aria-label="プロファイル">
      {config.profiles.map(p => renaming === p.id ? <input key={p.id} autoFocus className="profile-name" aria-label="プロファイル名" value={draft} onChange={e => setDraft(e.target.value)} onBlur={finishRename} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null) }} />
        : <button type="button" key={p.id} className="profile-pill dk-ghost" aria-pressed={p.id === profile.id} style={{ background: p.id === profile.id ? '#EDEDED' : 'transparent', color: p.id === profile.id ? '#121212' : '#8A8A8A' }}
          onClick={() => edit(c => ({ ...c, activeProfileId: p.id }))} onDoubleClick={() => { setRenaming(p.id); setDraft(p.name) }} onContextMenu={e => { e.preventDefault(); setMenu({ id: p.id, x: Math.min(e.clientX, window.innerWidth - 60), y: e.clientY }) }}>{p.name}</button>)}
      <IconButton label="プロファイルを追加" icon="plus" className="add-profile" onClick={() => edit(c => {
        const id = crypto.randomUUID(), next = { id, name: `プロファイル ${c.profiles.length + 1}`, keys: Array<DeskKey | null>(KEY_COUNT).fill(null) }
        return { ...c, activeProfileId: id, profiles: [...c.profiles, next] }
      })} /></nav><div className="grow" />
      <span role="img" aria-label={statusLabel} title={statusLabel} className={`device-dot ${status.state === 'connecting' ? 'connecting' : ''}`} style={{ background: error ? '#D12052' : status.state === 'connected' ? '#13D66A' : '#5A5A5A' }} />
      <IconButton label="入力ロック" icon="lock" aria-pressed={config.locked} style={{ background: config.locked ? '#D12052' : 'transparent', color: config.locked ? '#FFFFFF' : '#BDBDBD' }} onClick={() => edit(c => ({ ...c, locked: !c.locked }))} />
      <span className="cal-control"><IconButton label="キャリブレーション" icon="calibrate" disabled={status.state !== 'connected' || !status.capabilities.calibration} onClick={() => guard(flush().then(() => setCalibrating(true)))} />
      {status.state === 'connected' && status.capabilities.calibration && status.cal === false && <span className="cal-needed" aria-hidden="true" />}</span>
      <IconButton label="設定" icon="settings" aria-pressed={settings} onClick={() => setSettings(!settings)} />
    </header><DeskMap keys={profile.keys} selected={selected} fired={fired} locked={config.locked} pick={setSelected} /></main>
    {settings ? <Settings config={config} edit={edit} close={() => setSettings(false)} guard={guard} />
      : <KeyEditor key={`${profile.id}-${selected}`} value={value} index={selected} profiles={config.profiles} change={changeKey} run={() => guard(flush().then(() => window.deskapi.runKey(selected)))} guard={guard} />}
    {menu && <div className="profile-menu" role="menu" style={{ left: menu.x, top: menu.y }}><IconButton label="プロファイルを削除" icon="trash" role="menuitem" disabled={config.profiles.length <= 1} onClick={() => { deleteProfile(menu.id); setMenu(null) }} /></div>}
    </div>{deviceAlert}<DragOverlay dropAnimation={null}>{dragKey && <div className="drag-key" style={keyStyle(dragKey)}><KeyFace value={dragKey} /></div>}</DragOverlay>
  </DndContext>
}

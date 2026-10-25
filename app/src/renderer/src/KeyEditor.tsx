import { useDraggable } from '@dnd-kit/core'
import { useEffect, useState } from 'react'
import { ACTS, COLORS, ICON_LIST, MEDIA_OPS, PATTERNS, REGIONS, colorOf, freshKey } from '../../shared/constants'
import { hotkeyLabel } from '../../shared/hotkeys'
import type { Action, DeskKey, Profile } from '../../shared/types'
import { Icon, IconButton, type SymbolId } from './Icon'
import { KeyFace, keyStyle } from './DeskMap'

function ActionTile({ type, name, icon, selected, bg, fg, pick }: { type: Action['type']; name: string; icon: SymbolId; selected: boolean; bg: string; fg: string; pick: () => void }) {
  const drag = useDraggable({ id: `action-${type}`, data: { type: 'action', actionType: type } })
  return <button ref={drag.setNodeRef} {...drag.listeners} {...drag.attributes} className="action-tile dk-tile" type="button" role="radio" aria-checked={selected}
    style={{ background: selected ? bg : '#262626', color: selected ? fg : '#BDBDBD', opacity: drag.isDragging ? 0.35 : 1 }} onClick={pick}>
    <Icon name={icon} size={20} /><span>{name}</span>
  </button>
}
const MODIFIERS = ['Ctrl', 'Shift', 'Alt', 'Win'] as const
const MOD_ICONS: Record<string, SymbolId> = { Ctrl: 'ctrl', Shift: 'shift', Alt: 'alt', Win: 'win' }
function HotkeyInput({ keys, update }: { keys: string[]; update: (keys: string[]) => void }) {
  const [layout, setLayout] = useState<ReadonlyMap<string, string>>()
  useEffect(() => {
    let active = true
    const keyboard = (navigator as Navigator & { keyboard?: { getLayoutMap(): Promise<ReadonlyMap<string, string>> } }).keyboard
    keyboard?.getLayoutMap().then(map => { if (active) setLayout(map) }).catch(() => {})
    return () => { active = false }
  }, [])
  const [recording, setRecording] = useState(false)
  const [modifiers, setModifiers] = useState<string[]>([])
  useEffect(() => {
    if (!recording) return
    const record = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (event.code === 'Escape') { setRecording(false); return }
      if (/^(Control|Shift|Alt|Meta)(Left|Right)$/.test(event.code)) return
      const mods = MODIFIERS.filter(m => modifiers.includes(m) || (m === 'Ctrl' && event.ctrlKey) || (m === 'Shift' && event.shiftKey) || (m === 'Alt' && event.altKey) || (m === 'Win' && event.metaKey))
      if (!event.code || event.code === 'Unidentified') return
      const main = event.code
      update([...mods, main]); setRecording(false)
    }
    window.addEventListener('keydown', record, true)
    return () => window.removeEventListener('keydown', record, true)
  }, [recording, modifiers, update])
  return <div className="hotkey-editor"><div className="hotkey-caps">
    {keys.map((key, index) => <span className="keycap" title={key} key={`${key}-${index}`}>{key === 'Shift' || key === 'Win' ? <Icon name={MOD_ICONS[key]} size={18} /> : hotkeyLabel(key, layout)}</span>)}
    <div className="grow" /><IconButton label={recording ? '記録を中止' : 'キーを記録'} aria-pressed={recording} className={`record-button ${recording ? 'recording' : ''}`} onClick={() => { setModifiers(keys.filter(k => MODIFIERS.some(m => m === k))); setRecording(!recording) }}><span className="record-dot" /></IconButton>
  </div>{recording && <div className="modifier-toggles">{MODIFIERS.map(mod => <IconButton key={mod} label={mod} icon={MOD_ICONS[mod]} aria-pressed={modifiers.includes(mod)} style={{ background: modifiers.includes(mod) ? '#EDEDED' : '#262626', color: modifiers.includes(mod) ? '#121212' : '#BDBDBD' }} onClick={() => setModifiers(previous => previous.includes(mod) ? previous.filter(m => m !== mod) : [...previous, mod])} />)}</div>}</div>
}
async function cropImage(data: string): Promise<string> {
  const image = new Image()
  image.src = data
  await image.decode()
  const side = Math.min(image.naturalWidth, image.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 192
  const context = canvas.getContext('2d')
  if (!context) throw new Error('画像を処理できません')
  context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 192, 192)
  return canvas.toDataURL('image/png')
}
export function KeyEditor({ value, index, profiles, change, run, guard }: { value: DeskKey | null; index: number; profiles: Profile[]; change: (key: DeskKey | null) => void; run: () => void; guard: (work: Promise<unknown>) => void }) {
  const region = Math.floor(index / 2), pattern = index % 2
  const [bg, fg] = value ? colorOf(value.color).slice(1, 3) : ['#EDEDED', '#121212']
  const tileStyle = (on: boolean) => ({ background: on ? bg : '#262626', color: on ? fg : '#BDBDBD' })
  const patch = (patch: Partial<DeskKey>): void => { if (value) change({ ...value, ...patch }) }
  const action = value?.action
  return <aside aria-label="キーの設定" className="side-panel">
    <div className="preview-row"><div className="key-preview" style={keyStyle(value)}><KeyFace value={value} preview /></div>
      <div className="trigger" role="img" aria-label={`${REGIONS[region]} ${PATTERNS[pattern]}`} title={`${REGIONS[region]} ${PATTERNS[pattern]}`}>
        <span className="region-mini">{REGIONS.map((_, r) => <i key={r} style={{ background: r === region ? '#EDEDED' : '#2E2E2E' }} />)}</span>
        <span className="trigger-dots">{Array.from({ length: pattern + 1 }, (_, i) => <i key={i} />)}</span>
      </div>
    </div>
    <div className="action-grid" role="radiogroup" aria-label="アクション">{ACTS.map(item => <ActionTile key={item.type} {...item} selected={action?.type === item.type} bg={bg} fg={fg} pick={() => {
      if (!value) change(freshKey(item.type, profiles[1]?.id ?? profiles[0].id))
      else if (action?.type !== item.type) patch({ action: freshKey(item.type, profiles[1]?.id ?? profiles[0].id).action })
    }} />)}</div>
    {value && <div className="editor-fields">
      {action?.type === 'hotkey' && <HotkeyInput keys={action.keys} update={keys => patch({ action: { type: 'hotkey', keys } })} />}
      {action?.type === 'launch' && <div className="text-field launch-field"><input aria-label="ファイルのパス" value={action.file} onChange={e => patch({ action: { ...action, file: e.target.value } })} spellCheck={false} /><IconButton label="ファイルを選ぶ" icon="folder" onClick={() => guard(window.deskapi.pickFile().then(file => { if (file) patch({ action: { ...action, file } }) }))} /></div>}
      {action?.type === 'media' && <div role="radiogroup" aria-label="操作" className="media-grid">{MEDIA_OPS.map(([op, name]) => <button type="button" className="dk-tile" role="radio" aria-checked={action.op === op} aria-label={name} title={name} key={op} style={tileStyle(action.op === op)} onClick={() => patch({ action: { type: 'media', op } })}><Icon name={op} size={20} /></button>)}</div>}
      {action?.type === 'command' && <div className="text-field"><span className="command-prefix">&gt;</span><input aria-label="コマンド" value={action.cmd} onChange={e => patch({ action: { ...action, cmd: e.target.value } })} spellCheck={false} /></div>}
      {action?.type === 'http' && <div className="text-field http-field"><span className="post-badge" style={{ background: bg, color: fg }}>POST</span><input aria-label="Webhook URL" value={action.url} onChange={e => patch({ action: { ...action, url: e.target.value } })} spellCheck={false} /></div>}
      {action?.type === 'profile' && <div role="radiogroup" aria-label="切り替え先" className="profile-targets">{profiles.map(profile => <button type="button" className="dk-tile profile-pill" role="radio" aria-checked={action.to === profile.id} key={profile.id} style={tileStyle(action.to === profile.id)} onClick={() => patch({ action: { type: 'profile', to: profile.id } })}>{profile.name}</button>)}</div>}
      <div className="divider" />
      <div className="color-swatches" role="radiogroup" aria-label="色">{COLORS.map(([id, background, , name]) => <button type="button" role="radio" aria-checked={value.color === id} aria-label={name} title={name} key={id} className={`swatch ${value.color === id ? 'selected' : ''}`} style={{ background }} onClick={() => patch({ color: id })} />)}</div>
      <div className="icon-grid" role="radiogroup" aria-label="アイコン">{ICON_LIST.map(([id, name]) => <button type="button" role="radio" aria-checked={value.icon === id && !value.image} aria-label={name} title={name} key={id} className="dk-tile" style={tileStyle(value.icon === id && !value.image)} onClick={() => patch({ icon: id, slash: false, image: undefined })}><Icon name={id} /></button>)}
        <IconButton label="画像を選ぶ" icon="image" className="image-picker" onClick={() => guard(window.deskapi.pickImage().then(async data => { if (data) patch({ image: await cropImage(data) }) }))} />
      </div>
      <div className="editor-buttons"><IconButton label="テスト実行" icon="play" className="test-button" onClick={run} /><IconButton label="割り当てを外す" icon="trash" className="clear-button dk-tile" onClick={() => change(null)} /></div>
    </div>}
  </aside>
}

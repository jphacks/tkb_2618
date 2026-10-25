import { useEffect, useRef, useState } from 'react'
import type { DeviceStatus, DisconnectReason } from '../../shared/types'
import { Icon, IconButton } from './Icon'

/** Startup tries every port with a 3 s handshake before giving up; do not cry wolf before that. */
const STARTUP_GRACE_MS = 7000
const HINT: Record<DisconnectReason | 'lost', string> = {
  lost: 'USB ケーブルが抜けたか、デバイスが止まりました。',
  'no-port': 'USB の機器が見つかりません。ケーブルを挿し直してください。充電専用のケーブルでは認識されません。',
  busy: 'ポートをほかのアプリが使っています。Arduino IDE のシリアルモニタなどを閉じてください。',
  'no-response': 'ポートは見つかりましたが、データが届きません。xiao-stream が書き込まれているか、ポートの設定を確かめてください。'
}

/** Opens when the device is missing after startup or drops out later. Closing it holds until the next drop. */
export function useDeviceAlert(status: DeviceStatus): { open: boolean; reason: DisconnectReason | 'lost'; dismiss: () => void } {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<DisconnectReason | 'lost'>('no-port')
  const connected = status.state === 'connected'
  const wasConnected = useRef(false)
  const dismissed = useRef(false)
  useEffect(() => {
    const timer = setTimeout(() => { if (!wasConnected.current && !dismissed.current) setOpen(true) }, STARTUP_GRACE_MS)
    return () => clearTimeout(timer)
  }, [])
  useEffect(() => {
    if (connected) { wasConnected.current = true; dismissed.current = false; setOpen(false); return }
    if (wasConnected.current) { wasConnected.current = false; setReason('lost'); setOpen(true) }
  }, [connected])
  useEffect(() => { if (status.state === 'disconnected' && status.reason) setReason(status.reason) }, [status])
  return { open, reason, dismiss: () => { dismissed.current = true; setOpen(false) } }
}

export function DeviceAlert({ reason, dismiss, choosePort }: { reason: DisconnectReason | 'lost'; dismiss: () => void; choosePort?: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') dismiss() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [dismiss])
  return <div className="device-dialog-backdrop" onClick={dismiss}>
    <div className="device-dialog" role="alertdialog" aria-modal="true" aria-labelledby="device-dialog-title" aria-describedby="device-dialog-body" onClick={e => e.stopPropagation()}>
      <IconButton label="閉じる" icon="close" onClick={dismiss} />
      <span className="device-dialog-icon"><Icon name="plug" size={28} /></span>
      <h2 id="device-dialog-title">デバイスにつながっていません</h2>
      <p id="device-dialog-body">このままでは机を叩いても動きません。<br />{HINT[reason]}<br />つながると自動で閉じます。</p>
      <div className="dialog-actions">
        {choosePort && <button type="button" className="dialog-primary" autoFocus onClick={() => { dismiss(); choosePort() }}>ポートを選ぶ</button>}
        <button type="button" className="dialog-secondary" autoFocus={!choosePort} onClick={dismiss}>閉じる</button>
      </div>
    </div>
  </div>
}

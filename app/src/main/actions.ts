import { spawn } from 'node:child_process'
import type { Action, Config, TapEvent } from '../shared/types'
import { WindowsActions } from './windows'
import { Microphone } from './microphone'

export interface ActionContext { index: number; profile: string; tap: TapEvent }
export class ActionRunner {
  private windows?: WindowsActions
  private microphone = new Microphone()
  constructor(private readonly update: (change: (config: Config) => Config) => Promise<void>) {}
  async run(action: Action, context: ActionContext): Promise<void> {
    if (action.type === 'lock') return this.update(c => ({ ...c, locked: !c.locked }))
    if (action.type === 'profile') return this.update(c => {
      if (!c.profiles.some(p => p.id === action.to)) throw new Error('プロファイルが見つかりません')
      return { ...c, activeProfileId: action.to }
    })
    if (action.type === 'http') {
      const response = await fetch(action.url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: context.index, region: context.tap.region, count: context.tap.count,
          profile: context.profile, at: new Date().toISOString() }), signal: AbortSignal.timeout(5000) })
      await response.body?.cancel()
      if (!response.ok) throw new Error(`Webhook に失敗しました: HTTP ${response.status}`)
      return
    }
    if (process.platform !== 'win32') { console.info('[Windows action skipped]', action); return }
    if (action.type === 'command') {
      await new Promise<void>((resolve, reject) => {
        const child = spawn('cmd.exe', ['/d', '/s', '/c', `"${action.cmd}"`], { windowsHide: true, windowsVerbatimArguments: true, stdio: 'ignore' })
        const timer = setTimeout(() => {
          if (child.pid) {
            const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
            killer.on('error', () => child.kill())
          } else child.kill()
          reject(new Error('コマンドがタイムアウトしました'))
        }, 30_000)
        child.once('error', error => { clearTimeout(timer); reject(error) })
        child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`コマンドに失敗しました: ${code}`)) })
      })
      return
    }
    if (action.type === 'media' && action.op === 'mic') return this.microphone.toggle()
    const windows = this.windows ??= new WindowsActions()
    if (action.type === 'hotkey') windows.send(action.keys)
    else if (action.type === 'launch') windows.launch(action.file, action.args)
    else if (action.type === 'media') windows.sendCodes([{ prev: 0xb1, playpause: 0xb3, next: 0xb0, volDown: 0xae, volUp: 0xaf }[action.op as Exclude<typeof action.op, 'mic'>]])
  }
  close(): void { this.microphone.close() }
}

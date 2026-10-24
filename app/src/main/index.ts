import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, Tray } from 'electron'
import { join } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { IPC } from '../shared/ipc'
import { ACTS, PATTERNS, REGIONS } from '../shared/constants'
import { isConfig } from '../shared/validation'
import { keyIndexOf, type Config, type Region, type TapEvent } from '../shared/types'
import { ConfigStore } from './config'
import { MockDevice, type Device } from './device'
import { getProtocol } from './protocols'
import { SerialDevice } from './serial-device'
import { calculateCalibration, type Samples } from '../shared/calibration'
import type { Noise } from '../shared/types'
import { ActionRunner } from './actions'

app.setName('DeskAPI')
if (process.platform === 'win32') app.setAppUserModelId('jp.deskapi.app')
const isMock = process.env.DESKAPI_MOCK === '1'
let window: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let store: ConfigStore
let device: Device
let runner: ActionRunner
let notification: Notification | undefined
let calibrating = false
let calibrationNoise: Noise | undefined
let calibrationQueue: Promise<unknown> = Promise.resolve()
function calibrationWork<T>(work: () => Promise<T>): Promise<T> {
  const result = calibrationQueue.then(work)
  calibrationQueue = result.catch(() => {})
  return result
}
function cancelCalibration(): Promise<void> {
  return calibrationWork(async () => {
    try { if (calibrating && device.status.state === 'connected') await device.setMode('run') }
    finally { calibrating = false; calibrationNoise = undefined }
  })
}

function notify(title: string, body: string): void {
  if (process.platform !== 'win32') { console.info('[Windows notification skipped]', title, body); return }
  if (!Notification.isSupported()) { console.error('[Notification unavailable]', title, body); return }
  notification?.close()
  notification = new Notification({ title, body, toastXml: `<toast><visual><binding template="ToastGeneric"><text>${escapeXml(title)}</text><text>${escapeXml(body)}</text></binding></visual></toast>` })
  notification.on('failed', (_event, error) => console.error('[Notification]', error))
  notification.show()
}
function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!)
}
function reportError(error: unknown): void {
  console.error(error)
  notify('DeskAPI', error instanceof Error ? error.message : String(error))
}
function autostart(): void {
  if (process.platform !== 'win32') { console.info('[Windows autostart skipped]', store.config.autostart); return }
  app.setLoginItemSettings({ openAtLogin: store.config.autostart, path: process.execPath })
}
function send(channel: string, value: unknown): void {
  if (window && !window.isDestroyed()) window.webContents.send(channel, value)
}
function showWindow(): void { if (window?.isMinimized()) window.restore(); window?.show(); window?.focus() }
async function save(config: Config): Promise<void> {
  const portChanged = config.port !== store.config.port || config.protocol !== store.config.protocol
  const changed = config.autostart !== store.config.autostart
  await store.save(config)
  if (changed) autostart()
  if (portChanged && device instanceof SerialDevice) {
    try { await cancelCalibration() } finally { device.reconnect() }
  }
  updateTray()
}
async function updateConfig(change: (config: Config) => Config): Promise<void> {
  await store.update(change)
  updateTray()
  send(IPC.configChanged, store.config)
}
function trayImage(): Electron.NativeImage {
  const state = store.config.locked ? 'lock' : device.status.state === 'connected' ? 'normal' : 'disconnected'
  const image = nativeImage.createFromPath(join(__dirname, `../../resources/tray-${state}-16.png`))
  image.addRepresentation({ scaleFactor: 2, buffer: readFileSync(join(__dirname, `../../resources/tray-${state}-32.png`)) })
  return image
}
function updateTray(): void {
  if (!tray) return
  const config = store.config
  tray.setImage(trayImage())
  tray.setToolTip(`DeskAPI${config.locked ? ' · ロック中' : ''}`)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '設定を開く', click: showWindow },
    { label: 'プロファイル', submenu: config.profiles.map(p => ({
      label: p.name, type: 'radio' as const, checked: p.id === config.activeProfileId,
      click: () => { void updateConfig(c => c.profiles.some(profile => profile.id === p.id) ? { ...c, activeProfileId: p.id } : c).catch(reportError) }
    })) },
    { label: 'ロック', type: 'checkbox', checked: config.locked,
      click: () => { void updateConfig(c => ({ ...c, locked: !c.locked })).catch(reportError) } },
    { type: 'separator' }, { label: '終了', click: () => { app.quit() } }
  ]))
}
async function runTap(tap: TapEvent): Promise<void> {
  if (tap.sat) return
  await store.flush()
  if (calibrating) return
  const index = keyIndexOf(tap), config = store.config
  const profile = config.profiles.find(p => p.id === config.activeProfileId)!
  const key = profile.keys[index]
  if (!key || (config.locked && key.action.type !== 'lock')) return
  await runner.run(key.action, { index, profile: profile.name, tap })
  if (window?.isVisible()) send(IPC.tap, tap)
  else if (config.notify) {
    notify(ACTS.find(a => a.type === key.action.type)!.name, `${REGIONS[tap.region]} · ${PATTERNS[index % 4]}`)
  }
}
function handlers(): void {
  // Only the app's top-level frame may use this narrow API.
  const handle = (channel: string, fn: (...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('許可されていない呼び出しです')
      return fn(...args)
    })
  }
  handle(IPC.getConfig, () => store.config)
  handle(IPC.saveConfig, async value => {
    if (!isConfig(value)) throw new Error('設定の形式が正しくありません')
    await save(value)
  })
  handle(IPC.getDeviceStatus, () => device.status)
  handle(IPC.listPorts, () => device.listPorts())
  handle(IPC.runKey, async value => {
    if (!Number.isInteger(value) || typeof value !== 'number' || value < 0 || value > 15) throw new Error('キー番号が正しくありません')
    try { await runTap({ t: 'tap', region: Math.floor(value / 4) as Region, count: value % 4 < 2 ? 1 : 2,
      strength: value % 2 === 0 ? 'weak' : 'strong', confidence: 1 }) } catch (error) { reportError(error); throw error }
  })
  handle(IPC.pickFile, async () => {
    const result = await dialog.showOpenDialog(window!, { properties: ['openFile'] })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  handle(IPC.pickImage, async () => {
    const result = await dialog.showOpenDialog(window!, { properties: ['openFile'], filters: [{ name: '画像', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }] })
    if (result.canceled || !result.filePaths[0]) return null
    const file = result.filePaths[0]
    if ((await stat(file)).size > 20_000_000) throw new Error('画像が大きすぎます')
    const image = nativeImage.createFromBuffer(await readFile(file))
    if (image.isEmpty()) throw new Error('画像を読み込めません')
    return image.toDataURL()
  })
  handle(IPC.calStart, () => calibrationWork(async () => {
    calibrating = true
    calibrationNoise = undefined
    try { await device.setMode('calibrate') } catch (error) { await device.setMode('run').catch(() => {}); calibrating = false; throw error }
  }))
  handle(IPC.calMeasureNoise, () => calibrationWork(async () => {
    if (!calibrating) throw new Error('キャリブレーションが開始されていません')
    calibrationNoise = await device.measureNoise()
    return calibrationNoise
  }))
  handle(IPC.calSave, value => calibrationWork(async () => {
    if (!calibrating || !calibrationNoise || !Array.isArray(value) || !value.every(Array.isArray)) throw new Error('キャリブレーション値が正しくありません')
    const cal = calculateCalibration(calibrationNoise, value as Samples)
    try { await device.saveCalibration(cal) }
    finally {
      try { if (device.status.state === 'connected') await device.setMode('run') }
      finally { calibrating = false; calibrationNoise = undefined }
    }
  }))
  handle(IPC.calCancel, cancelCalibration)
  if (isMock) handle(IPC.calMockHit, (region, strength) => {
    if (typeof region !== 'number' || ![0, 1, 2, 3].includes(region) || (strength !== 'weak' && strength !== 'strong')) throw new Error('打撃が正しくありません')
    ;(device as MockDevice).mockHit(region as Region, strength)
  })
}
async function createWindow(): Promise<void> {
  window = new BrowserWindow({ width: 1280, height: 860, minWidth: 960, minHeight: 640,
    title: 'DeskAPI', backgroundColor: '#121212', show: false, autoHideMenuBar: true,
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#121212', symbolColor: '#EDEDED', height: 32 },
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, additionalArguments: isMock ? ['--deskapi-mock'] : [] }
  })
  window.on('close', event => { if (!quitting) { event.preventDefault(); window?.hide(); void cancelCalibration().catch(reportError) } })
  window.webContents.on('render-process-gone', () => { void cancelCalibration().catch(reportError) })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => { event.preventDefault() })
  window.on('ready-to-show', () => { if (!app.isPackaged || process.argv.includes('--settings')) showWindow() })
  if (process.env.ELECTRON_RENDERER_URL && !app.isPackaged) await window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await window.loadFile(join(__dirname, '../renderer/index.html'))
}
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', showWindow)
  app.whenReady().then(async () => {
    store = new ConfigStore(app.getPath('userData'))
    await store.load()
    device = isMock ? new MockDevice(() => {
      const config = store.config
      return config.profiles.find(p => p.id === config.activeProfileId)!.keys.flatMap((key, index) => key ? [index] : [])
    }) : new SerialDevice(() => store.config.port, undefined, undefined, undefined, () => getProtocol(store.config.protocol))
    runner = new ActionRunner(updateConfig)
    autostart()
    handlers()
    device.onTap(tap => { void runTap(tap).catch(reportError) })
    device.onCalHit(hit => send(IPC.calHit, hit))
    device.onStatus(status => { if (status.state === 'disconnected') { calibrating = false; calibrationNoise = undefined }; send(IPC.deviceStatus, status); updateTray() })
    if (process.platform === 'win32') {
      tray = new Tray(trayImage())
      tray.on('click', showWindow)
    } else console.info('[Windows tray skipped]')
    updateTray()
    device.start()
    await createWindow()
  }).catch(error => { reportError(error); app.quit() })
  app.on('before-quit', event => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    const cleanup = device ? cancelCalibration().catch(reportError).finally(() => device.stop()) : Promise.resolve()
    runner?.close()
    notification?.close()
    void Promise.all([cleanup, store?.flush()]).finally(() => { tray?.destroy(); app.quit() })
  })
  app.on('window-all-closed', () => {})
}

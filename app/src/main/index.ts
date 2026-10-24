import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, Tray } from 'electron'
import { join } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { IPC } from '../shared/ipc'
import { ACTS, PATTERNS, REGIONS } from '../shared/constants'
import { isCalibration, isConfig } from '../shared/validation'
import { keyIndexOf, type Config, type Region, type TapEvent } from '../shared/types'
import { ConfigStore } from './config'
import { DisconnectedDevice, MockDevice, type Device } from './device'
import { LoggingActionRunner } from './actions'

app.setName('DeskAPI')
app.setAppUserModelId('jp.deskapi.app')
const isMock = process.env.DESKAPI_MOCK === '1'
let window: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let store: ConfigStore
let device: Device
let runner: LoggingActionRunner
let notification: Notification | undefined
let calibrating = false

function reportError(error: unknown): void {
  console.error(error)
  notification?.close()
  notification = new Notification({ title: 'DeskAPI', body: error instanceof Error ? error.message : String(error) })
  notification.show()
}
function send(channel: string, value: unknown): void {
  if (window && !window.isDestroyed()) window.webContents.send(channel, value)
}
function showWindow(): void { window?.show(); window?.focus() }
async function save(config: Config): Promise<void> {
  await store.save(config)
  updateTray()
}
async function updateConfig(change: (config: Config) => Config): Promise<void> {
  await store.update(change)
  updateTray()
  send(IPC.configChanged, store.config)
}
// A flat bitmap at both Windows tray sizes. The three states use distinct silhouettes.
function trayImage(): Electron.NativeImage {
  const result = nativeImage.createEmpty()
  const state = store.config.locked ? 'lock' : device.status.state === 'connected' ? 'normal' : 'disconnected'
  for (const size of [16, 32]) {
    const pixels = Buffer.alloc(size * size * 4)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x * 16 / size, v = y * 16 / size
      const filled = state === 'lock'
        ? (u >= 4 && u < 12 && v >= 7 && v < 14) || (u >= 5 && u < 11 && v >= 2 && v < 8 && (u < 7 || u >= 9 || v < 4))
        : u >= 2 && u < 14 && v >= 3 && v < 13 && !(u >= 7 && u < 9 || v >= 7 && v < 9)
      if (filled && !(state === 'disconnected' && Math.abs(u - v) < 1.4)) {
        const offset = (y * size + x) * 4
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 237
        pixels[offset + 3] = 255
      }
    }
    result.addRepresentation({ scaleFactor: size / 16, buffer: nativeImage.createFromBitmap(pixels, { width: size, height: size }).toPNG() })
  }
  return result
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
  await store.flush()
  if (calibrating) return
  const index = keyIndexOf(tap), config = store.config
  const profile = config.profiles.find(p => p.id === config.activeProfileId)!
  const key = profile.keys[index]
  if (!key || (config.locked && key.action.type !== 'lock')) return
  await runner.run(key.action, { index, profile: profile.name, tap })
  if (window?.isVisible()) send(IPC.tap, tap)
  else if (config.notify) {
    notification?.close()
    notification = new Notification({ title: ACTS.find(a => a.type === key.action.type)!.name,
      body: `${REGIONS[tap.region]} · ${PATTERNS[index % 4]}` })
    notification.show()
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
    await runTap({ t: 'tap', region: Math.floor(value / 4) as Region, count: value % 4 < 2 ? 1 : 2,
      strength: value % 2 === 0 ? 'weak' : 'strong', confidence: 1 })
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
  handle(IPC.calStart, async () => { await device.setMode('calibrate'); calibrating = true })
  handle(IPC.calMeasureNoise, () => {
    if (!calibrating) throw new Error('キャリブレーションが開始されていません')
    return device.measureNoise()
  })
  handle(IPC.calSave, async value => {
    if (!calibrating || !isCalibration(value)) throw new Error('キャリブレーション値が正しくありません')
    await device.saveCalibration(value)
    await device.setMode('run')
    calibrating = false
  })
  handle(IPC.calCancel, async () => {
    if (device.status.state === 'connected') await device.setMode('run')
    calibrating = false
  })
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
  window.on('close', event => { if (!quitting) { event.preventDefault(); window?.hide() } })
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
    }) : new DisconnectedDevice()
    runner = new LoggingActionRunner()
    handlers()
    device.onTap(tap => { void runTap(tap).catch(reportError) })
    device.onCalHit(hit => send(IPC.calHit, hit))
    device.onStatus(status => { send(IPC.deviceStatus, status); updateTray() })
    tray = new Tray(trayImage())
    tray.on('click', showWindow)
    updateTray()
    device.start()
    await createWindow()
  }).catch(error => { reportError(error); app.quit() })
  app.on('before-quit', event => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    device?.stop()
    void (store?.flush() ?? Promise.resolve()).finally(() => { tray?.destroy(); app.quit() })
  })
  app.on('window-all-closed', () => {})
}

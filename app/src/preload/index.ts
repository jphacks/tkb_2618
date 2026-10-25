import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type DeskApi } from '../shared/ipc'

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, value: T): void => callback(value)
  ipcRenderer.on(channel, listener)
  return () => { ipcRenderer.removeListener(channel, listener) }
}
const isMock = process.argv.includes('--deskapi-mock')
const api: DeskApi = {
  isMock,
  getConfig: () => ipcRenderer.invoke(IPC.getConfig),
  saveConfig: config => ipcRenderer.invoke(IPC.saveConfig, config),
  onConfigChanged: callback => subscribe(IPC.configChanged, callback),
  getDeviceStatus: () => ipcRenderer.invoke(IPC.getDeviceStatus),
  onDeviceStatus: callback => subscribe(IPC.deviceStatus, callback),
  onTap: callback => subscribe(IPC.tap, callback),
  runKey: index => ipcRenderer.invoke(IPC.runKey, index),
  pickFile: () => ipcRenderer.invoke(IPC.pickFile), pickImage: () => ipcRenderer.invoke(IPC.pickImage),
  listPorts: () => ipcRenderer.invoke(IPC.listPorts),
  calStart: () => ipcRenderer.invoke(IPC.calStart),
  calMeasureNoise: () => ipcRenderer.invoke(IPC.calMeasureNoise),
  calRecord: () => ipcRenderer.invoke(IPC.calRecord),
  calAbort: () => ipcRenderer.invoke(IPC.calAbort),
  onCalCue: callback => subscribe(IPC.calCue, callback),
  onCalHit: callback => subscribe(IPC.calHit, callback),
  calSave: calibration => ipcRenderer.invoke(IPC.calSave, calibration),
  calCancel: () => ipcRenderer.invoke(IPC.calCancel),
  ...(isMock ? { calMockHit: region => ipcRenderer.invoke(IPC.calMockHit, region) } : {})
}
contextBridge.exposeInMainWorld('deskapi', api)

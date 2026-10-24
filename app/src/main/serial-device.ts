import { getProtocol } from './protocols'
import type { DeviceProtocol } from './protocols/types'
import { SerialPort } from 'serialport'
import type { Duplex } from 'node:stream'
import { DisconnectedDevice } from './device'
import type { Calibration, DeviceEvent, DeviceStatus, DeviceCommand, Noise } from '../shared/types'

export interface SerialBackend {
  list(): Promise<{ path: string; vendorId?: string }[]>
  open(path: string, options: { baudRate: number }): Duplex
}
const backend: SerialBackend = {
  list: () => SerialPort.list(),
  open: (path, options) => new SerialPort({ path, ...options, dataBits: 8, stopBits: 1, parity: 'none' })
}
export class SerialDevice extends DisconnectedDevice {
  override status: DeviceStatus = { state: 'disconnected' }
  private protocol: DeviceProtocol = getProtocol('deskapi-v1')
  private stream?: Duplex
  private running = false
  private generation = 0
  private timer?: ReturnType<typeof setTimeout>
  private rejectPending?: (error: Error) => void
  private receive?: (message: DeviceEvent) => void
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly port: () => string, private readonly io: SerialBackend = backend,
    private readonly retryMs = 2000, private readonly timeoutMs?: number,
    private readonly selectProtocol: () => DeviceProtocol = () => getProtocol('deskapi-v1')) { super() }
  override async listPorts(): Promise<string[]> { return (await this.io.list()).map(p => p.path) }
  private statusChanged(status: DeviceStatus): void { this.status = status; this.statuses.emit(status) }
  override start(): void { if (this.running) return; this.running = true; void this.connect() }
  override stop(): void {
    this.running = false
    this.generation++
    clearTimeout(this.timer)
    this.disconnect()
  }
  reconnect(): void { this.stop(); this.start() }
  private disconnect(): void {
    this.rejectPending?.(new Error('デバイスが未接続です'))
    const stream = this.stream
    this.stream = undefined
    stream?.destroy()
    this.statusChanged({ state: 'disconnected' })
  }
  private async connect(): Promise<void> {
    const generation = this.generation
    try {
      this.protocol = this.selectProtocol()
      const selected = this.port()
      const ports = selected === 'auto' ? (await this.io.list()).sort((a, b) =>
        Number(/^(10c4|1a86|303a)$/i.test(b.vendorId ?? '')) - Number(/^(10c4|1a86|303a)$/i.test(a.vendorId ?? ''))) : [{ path: selected }]
      for (const port of ports) {
        if (!this.running || generation !== this.generation) return
        this.statusChanged({ state: 'connecting' })
        try {
          const stream = this.io.open(port.path, this.protocol.serial)
          this.stream = stream
          let line = '', discard = false
          stream.on('data', (chunk: Buffer) => {
            if (this.stream !== stream) return
            for (const ch of chunk.toString('utf8')) {
              if (ch === '\n') {
                if (!discard) {
                  try {
                    const message = this.protocol.parseLine(line)
                    if (message) this.message(message)
                  } catch { /* Boot logs and broken JSON are ignored. */ }
                }
                line = ''; discard = false
              } else if (!discard) {
                if (line.length === 512) { line = ''; discard = true } else line += ch
              }
            }
          })
          const lost = (): void => {
            if (this.stream !== stream) return
            const connected = this.status.state === 'connected'
            this.disconnect()
            if (connected) this.schedule()
          }
          stream.on('error', lost)
          stream.on('close', lost)
          const handshake = this.protocol.handshake()
          const hello = await this.request(handshake.send, handshake.isHello, this.timeoutMs ?? handshake.timeoutMs)
          if (!this.running || generation !== this.generation || this.stream !== stream || hello.t !== 'hello') return
          // A previous process may have exited during calibration.
          if (this.protocol.capabilities.calibration) await this.mode('run')
          this.statusChanged({ state: 'connected', port: port.path, capabilities: { ...this.protocol.capabilities }, fw: hello.fw, cal: hello.cal })
          return
        } catch { if (generation !== this.generation) return; this.disconnect() }
      }
    } catch { if (generation !== this.generation) return; this.disconnect() }
    if (generation === this.generation) this.schedule()
  }
  private schedule(): void {
    clearTimeout(this.timer)
    if (this.running) this.timer = setTimeout(() => { void this.connect() }, this.retryMs)
  }
  private message(message: DeviceEvent): void {
    this.receive?.(message)
    if (this.status.state !== 'connected') return
    if (message.t === 'tap') this.taps.emit(message)
    if (message.t === 'hit') this.hits.emit(message)
  }
  private request(command: DeviceCommand | string | undefined, matches: (message: DeviceEvent) => boolean, timeout = this.timeoutMs ?? 2000): Promise<DeviceEvent> {
    return new Promise((resolve, reject) => {
      const encoded = typeof command === 'object' ? this.protocol.encode(command) : command
      if (encoded === null) { reject(new Error('デバイスがこの操作に対応していません')); return }
      const stream = this.stream
      if (!stream) { reject(new Error('デバイスが未接続です')); return }
      const finish = (error?: Error, message?: DeviceEvent): void => {
        clearTimeout(timer); this.receive = undefined; this.rejectPending = undefined
        if (error) reject(error); else resolve(message!)
      }
      const timer = setTimeout(() => {
        const connected = this.status.state === 'connected'
        finish(new Error('デバイスの応答がありません'))
        if (this.stream === stream) { this.disconnect(); if (connected) this.schedule() }
      }, timeout)
      this.rejectPending = error => finish(error)
      this.receive = message => {
        if (!matches(message)) return
        finish(message.t === 'ack' && !message.ok ? new Error(`デバイスが操作を拒否しました: ${message.err ?? ''}`) : undefined, message)
      }
      if (encoded !== undefined) stream.write(encoded, error => { if (error && this.stream === stream) this.rejectPending?.(error) })
    })
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work)
    this.queue = result.catch(() => {})
    return result
  }
  private async mode(mode: 'run' | 'calibrate'): Promise<void> {
    this.requireCalibration()
    await this.request({ t: 'mode', mode }, m => m.t === 'ack' && m.of === 'mode')
  }
  override setMode(mode: 'run' | 'calibrate'): Promise<void> { return this.serial(() => this.mode(mode)) }
  private requireCalibration(): void {
    if (!this.protocol.capabilities.calibration) throw new Error('デバイスがキャリブレーションに対応していません')
  }
  override measureNoise(): Promise<Noise> {
    return this.serial(async () => { this.requireCalibration(); return await this.request({ t: 'measure_noise', ms: 2000 }, m => m.t === 'noise', 4000) as Noise })
  }
  override saveCalibration(cal: Calibration): Promise<void> {
    return this.serial(async () => {
      this.requireCalibration()
      await this.request({ t: 'set_cal', cal }, m => m.t === 'ack' && m.of === 'set_cal')
      if (this.status.state === 'connected') this.statusChanged({ ...this.status, cal: true })
    })
  }
}

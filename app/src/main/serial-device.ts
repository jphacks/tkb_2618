import { SerialPort } from 'serialport'
import type { Duplex } from 'node:stream'
import { DisconnectedDevice } from './device'
import type { Calibration, DeviceMessage, DeviceStatus, HostMessage, Noise } from '../shared/types'

export interface SerialBackend {
  list(): Promise<{ path: string; vendorId?: string }[]>
  open(path: string): Duplex
}
const backend: SerialBackend = {
  list: () => SerialPort.list(),
  open: path => new SerialPort({ path, baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none' })
}
function valid(value: unknown): value is DeviceMessage {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  const number = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0
  const channels = (a: unknown): boolean => Array.isArray(a) && a.length === 4 && a.every(n => number(n) && n <= 4095)
  switch (v.t) {
    case 'hello': return typeof v.fw === 'string' && typeof v.cal === 'boolean'
    case 'tap': return (v.sat === undefined || v.sat === true) && Number.isInteger(v.region) && number(v.region) && v.region <= 3 && (v.count === 1 || v.count === 2) && (v.strength === 'weak' || v.strength === 'strong') && number(v.confidence) && v.confidence <= 1
    case 'hit': return channels(v.peaks) && number(v.ms) && number(v.ring) && v.ring <= 1000 && (v.sat === undefined || v.sat === true)
    case 'noise': return channels(v.peak) && channels(v.rms)
    case 'ack': return (v.of === 'mode' || v.of === 'set_cal') && typeof v.ok === 'boolean' && (v.err === undefined || typeof v.err === 'string')
    default: return false
  }
}
export class SerialDevice extends DisconnectedDevice {
  override status: DeviceStatus = { state: 'disconnected' }
  private stream?: Duplex
  private running = false
  private generation = 0
  private timer?: ReturnType<typeof setTimeout>
  private rejectPending?: (error: Error) => void
  private receive?: (message: DeviceMessage) => void
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly port: () => string, private readonly io: SerialBackend = backend,
    private readonly retryMs = 2000, private readonly timeoutMs = 2000) { super() }
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
      const selected = this.port()
      const ports = selected === 'auto' ? (await this.io.list()).sort((a, b) =>
        Number(/^(10c4|1a86|303a)$/i.test(b.vendorId ?? '')) - Number(/^(10c4|1a86|303a)$/i.test(a.vendorId ?? ''))) : [{ path: selected }]
      for (const port of ports) {
        if (!this.running || generation !== this.generation) return
        this.statusChanged({ state: 'connecting' })
        try {
          const stream = this.io.open(port.path)
          this.stream = stream
          let line = '', discard = false
          stream.on('data', (chunk: Buffer) => {
            if (this.stream !== stream) return
            for (const ch of chunk.toString('utf8')) {
              if (ch === '\n') {
                if (!discard) {
                  try {
                    const message: unknown = JSON.parse(line)
                    if (valid(message)) this.message(message)
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
          const hello = await this.request({ t: 'ping' }, m => m.t === 'hello')
          if (!this.running || generation !== this.generation || this.stream !== stream || hello.t !== 'hello') return
          // A previous process may have exited during calibration.
          await this.mode('run')
          this.statusChanged({ state: 'connected', port: port.path, fw: hello.fw, cal: hello.cal })
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
  private message(message: DeviceMessage): void {
    this.receive?.(message)
    if (this.status.state !== 'connected') return
    if (message.t === 'tap') this.taps.emit(message)
    if (message.t === 'hit') this.hits.emit(message)
  }
  private request(command: HostMessage, matches: (message: DeviceMessage) => boolean, timeout = this.timeoutMs): Promise<DeviceMessage> {
    return new Promise((resolve, reject) => {
      const stream = this.stream
      if (!stream) { reject(new Error('デバイスが未接続です')); return }
      const finish = (error?: Error, message?: DeviceMessage): void => {
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
      stream.write(JSON.stringify(command) + '\n', error => { if (error && this.stream === stream) this.rejectPending?.(error) })
    })
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work)
    this.queue = result.catch(() => {})
    return result
  }
  private async mode(mode: 'run' | 'calibrate'): Promise<void> {
    await this.request({ t: 'mode', mode }, m => m.t === 'ack' && m.of === 'mode')
  }
  override setMode(mode: 'run' | 'calibrate'): Promise<void> { return this.serial(() => this.mode(mode)) }
  override measureNoise(): Promise<Noise> {
    return this.serial(async () => await this.request({ t: 'measure_noise', ms: 2000 }, m => m.t === 'noise', 4000) as Noise)
  }
  override saveCalibration(cal: Calibration): Promise<void> {
    return this.serial(async () => {
      await this.request({ t: 'set_cal', cal }, m => m.t === 'ack' && m.of === 'set_cal')
      if (this.status.state === 'connected') this.statusChanged({ ...this.status, cal: true })
    })
  }
}

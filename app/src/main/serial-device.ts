import { getProtocol } from './protocols'
import type { DeviceProtocol, ProtocolSession } from './protocols/types'
import { SerialPort } from 'serialport'
import type { Duplex } from 'node:stream'
import { DisconnectedDevice } from './device'
import type { Calibration, DeviceEvent, DeviceStatus, DeviceCommand, DisconnectReason, Noise } from '../shared/types'

export interface SerialBackend {
  list(): Promise<{ path: string; vendorId?: string }[]>
  open(path: string, options: { baudRate: number }): Duplex
}
const backend: SerialBackend = {
  list: () => SerialPort.list(),
  open: (path, options) => new SerialPort({ path, ...options, dataBits: 8, stopBits: 1, parity: 'none' })
}
type ClosablePort = Duplex & { isOpen?: boolean; close?: (callback?: (error?: Error | null) => void) => void }
/** serialport's stream has no _destroy, so destroy() alone leaves the COM handle open and the port "busy" until the app exits. */
function release(stream: Duplex): void {
  const port = stream as ClosablePort
  stream.removeAllListeners('data')
  stream.on('error', () => {})
  if (typeof port.close !== 'function') { stream.destroy(); return }
  const close = (): void => port.close!(() => stream.destroy())
  if (port.isOpen) close()
  else { stream.once('open', close); setTimeout(() => { stream.off('open', close); stream.destroy() }, 5000) }
}
export class SerialDevice extends DisconnectedDevice {
  override status: DeviceStatus = { state: 'disconnected' }
  private protocol: DeviceProtocol = getProtocol('auto')
  private session?: ProtocolSession
  private stream?: Duplex
  private running = false
  private generation = 0
  private timer?: ReturnType<typeof setTimeout>
  private watchdog?: ReturnType<typeof setInterval>
  private lastData = 0
  // Set per chunk and folded into lastData by the watchdog; a clock read per chunk costs too much at 4000 lines/s.
  private received = false
  private rejectPending?: (error: Error) => void
  private receive?: (message: DeviceEvent) => void
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly port: () => string, private readonly io: SerialBackend = backend,
    private readonly retryMs = 2000, private readonly timeoutMs?: number,
    private readonly selectProtocol: () => DeviceProtocol = () => getProtocol('auto'),
    private readonly calibration: () => Calibration | undefined = () => undefined) { super() }
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
  /** Closes the port without announcing it; a connection attempt reports once after trying every port. */
  private drop(): void {
    clearInterval(this.watchdog)
    this.rejectPending?.(new Error('デバイスが未接続です'))
    const stream = this.stream
    this.stream = undefined
    if (stream) release(stream)
  }
  private disconnect(reason?: DisconnectReason): void {
    this.drop()
    this.statusChanged(reason ? { state: 'disconnected', reason } : { state: 'disconnected' })
  }
  private async connect(): Promise<void> {
    const generation = this.generation
    // Report the most actionable failure: another app holding the port, then a silent port, then no port at all.
    let failure: DisconnectReason = 'no-port'
    const fail = (reason: DisconnectReason): void => {
      const rank: DisconnectReason[] = ['no-port', 'no-response', 'busy']
      if (rank.indexOf(reason) > rank.indexOf(failure)) failure = reason
    }
    try {
      this.protocol = this.selectProtocol()
      const selected = this.port()
      const ports = selected === 'auto' ? (await this.io.list()).sort((a, b) =>
        Number(/^(10c4|1a86|303a)$/i.test(b.vendorId ?? '')) - Number(/^(10c4|1a86|303a)$/i.test(a.vendorId ?? ''))) : [{ path: selected }]
      for (const port of ports) {
        if (!this.running || generation !== this.generation) return
        this.statusChanged({ state: 'connecting' })
        let openError: Error | undefined
        try {
          const stream = this.io.open(port.path, this.protocol.serial)
          this.stream = stream
          this.lastData = Date.now()
          this.session = this.protocol.open({
            write: data => stream.write(data, error => { if (error && this.stream === stream) this.rejectPending?.(error) }),
            emit: event => { if (this.stream === stream) this.message(event) },
            sample: (values, rate) => { if (this.stream === stream && this.status.state === 'connected') this.emitSample(values, rate) },
            calibration: this.calibration()
          })
          const session = this.session
          let line = '', discard = false
          stream.on('data', (chunk: Buffer) => {
            if (this.stream !== stream) return
            this.received = true
            const data = chunk.toString('utf8').replace(/\r/g, '')
            let start = 0, end: number
            while ((end = data.indexOf('\n', start)) !== -1) {
              if (!discard && line.length + end - start <= 512) {
                try { session.receive(line + data.slice(start, end)) } catch { /* Ignore malformed input. */ }
              }
              line = ''; discard = false; start = end + 1
            }
            if (!discard) {
              if (line.length + data.length - start > 512) { line = ''; discard = true }
              else line += data.slice(start)
            }
          })
          const lost = (): void => {
            if (this.stream !== stream) return
            // While connecting, the attempt loop reports the failure itself.
            if (this.status.state !== 'connected') { this.drop(); return }
            this.disconnect()
            this.schedule()
          }
          stream.on('error', (error: Error) => { if (this.status.state !== 'connected') openError ??= error; lost() })
          stream.on('close', lost)
          const handshake = session.handshake
          const hello = await this.request(handshake.send, handshake.isHello, this.timeoutMs ?? handshake.timeoutMs)
          if (!this.running || generation !== this.generation || this.stream !== stream || hello.t !== 'hello') return
          // A previous process may have exited during calibration.
          if (this.protocol.capabilities.calibration) await this.mode('run')
          this.statusChanged({ state: 'connected', port: port.path, capabilities: { ...this.protocol.capabilities }, fw: hello.fw, cal: hello.cal })
          this.watch(stream, session)
          return
        } catch {
          if (generation !== this.generation) return
          this.drop()
          const message = openError?.message ?? ''
          fail(/access denied|busy|in use|permission|eacces|ebusy|アクセス/i.test(message) ? 'busy' : openError && /not found|no such|enoent|cannot find|見つかりません/i.test(message) ? 'no-port' : 'no-response')
        }
      }
    } catch { if (generation !== this.generation) return; this.drop() }
    if (generation !== this.generation) return
    this.statusChanged({ state: 'disconnected', reason: failure })
    this.schedule()
  }
  private watch(stream: Duplex, session: ProtocolSession): void {
    clearInterval(this.watchdog)
    this.lastData = Date.now()
    this.watchdog = setInterval(() => {
      if (this.received) { this.received = false; this.lastData = Date.now() }
      const idle = session.idleTimeoutMs
      if (this.stream !== stream || idle === undefined || Date.now() - this.lastData <= idle) return
      this.disconnect('no-response')
      this.schedule()
    }, 250)
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
      const stream = this.stream
      if (!stream) { reject(new Error('デバイスが未接続です')); return }
      const finish = (error?: Error, message?: DeviceEvent): void => {
        clearTimeout(timer); this.receive = undefined; this.rejectPending = undefined
        if (error) reject(error); else resolve(message!)
      }
      const timer = setTimeout(() => {
        const connected = this.status.state === 'connected'
        finish(new Error('デバイスの応答がありません'))
        if (this.stream === stream && connected) { this.disconnect('no-response'); this.schedule() }
      }, timeout)
      this.rejectPending = error => finish(error)
      this.receive = message => {
        if (!matches(message)) return
        finish(message.t === 'ack' && !message.ok ? new Error(`デバイスが操作を拒否しました: ${message.err ?? ''}`) : undefined, message)
      }
      try {
        if (typeof command === 'object') {
          if (!this.session?.send(command)) finish(new Error('デバイスがこの操作に対応していません'))
        } else if (command !== undefined) stream.write(command, error => { if (error && this.stream === stream) this.rejectPending?.(error) })
      } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
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

import type { Channels, DeviceEvent } from '../../shared/types'
import { deskapiV1 } from './deskapi-v1'
import { xiaoStream, openXiaoStream } from './xiao-stream'
import type { DeviceProtocol, ProtocolSession } from './types'

export const auto: DeviceProtocol = {
  id: 'auto', serial: { baudRate: 115200 }, capabilities: { calibration: true, raw: true },
  open(io) {
    let selected: ProtocolSession | undefined
    // Probe sessions are private to this connection. Only the winning session emits.
    const candidates: ProtocolSession[] = []
    for (const protocol of [xiaoStream, deskapiV1]) {
      const index = candidates.length
      const sessionIO = { ...io, emit(event: DeviceEvent) {
        const session = candidates[index]
        if (!selected && event.t === 'hello') selected = session
        if (selected === session) io.emit(event)
      }, sample(values: Channels, rate: number) { if (selected === candidates[index]) io.sample?.(values, rate) } }
      candidates.push(protocol === xiaoStream ? openXiaoStream(sessionIO, false) : protocol.open(sessionIO))
    }
    return {
      handshake: { send: candidates.map(s => s.handshake.send ?? '').join(''), isHello: e => e.t === 'hello', timeoutMs: 3000 },
      get idleTimeoutMs() { return selected?.idleTimeoutMs },
      receive(line) {
        if (selected) selected.receive(line)
        else for (const session of candidates) { session.receive(line); if (selected) break }
      },
      send(command) { return selected?.send(command) ?? false }
    }
  }
}

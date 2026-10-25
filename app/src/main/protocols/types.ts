import type { Calibration, Channels, DeviceCapabilities, DeviceCommand, DeviceEvent } from '../../shared/types'
export interface DeviceProtocol {
  readonly id: string
  readonly serial: { baudRate: number }
  readonly capabilities: DeviceCapabilities
  open(io: ProtocolIO): ProtocolSession
}
export interface ProtocolIO {
  write(data: string): void
  emit(event: DeviceEvent): void
  /** Raw rows for a streaming firmware; `values` is reused by the caller. */
  sample?(values: Channels, rate: number): void
  calibration?: Calibration
}
export interface ProtocolSession {
  handshake: { send?: string; isHello(event: DeviceEvent): boolean; timeoutMs: number }
  /** A streaming firmware that goes silent this long after hello is treated as lost. */
  readonly idleTimeoutMs?: number
  receive(line: string): void
  send(command: DeviceCommand): boolean
}

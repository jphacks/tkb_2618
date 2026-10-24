import type { Calibration, DeviceCapabilities, DeviceCommand, DeviceEvent } from '../../shared/types'
export interface DeviceProtocol {
  readonly id: string
  readonly serial: { baudRate: number }
  readonly capabilities: DeviceCapabilities
  open(io: ProtocolIO): ProtocolSession
}
export interface ProtocolIO {
  write(data: string): void
  emit(event: DeviceEvent): void
  calibration?: Calibration
}
export interface ProtocolSession {
  handshake: { send?: string; isHello(event: DeviceEvent): boolean; timeoutMs: number }
  receive(line: string): void
  send(command: DeviceCommand): boolean
}

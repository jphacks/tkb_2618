import type { DeviceCapabilities, DeviceCommand, DeviceEvent } from '../../shared/types'
export interface DeviceProtocol {
  readonly id: string
  readonly serial: { baudRate: number }
  readonly capabilities: DeviceCapabilities
  handshake(): { send?: string; isHello(event: DeviceEvent): boolean; timeoutMs: number }
  parseLine(line: string): DeviceEvent | null
  encode(command: DeviceCommand): string | null
}

import { deskapiV1 } from './deskapi-v1'
import type { DeviceProtocol } from './types'
export const protocols: readonly DeviceProtocol[] = [deskapiV1]
export function getProtocol(id: string): DeviceProtocol {
  return protocols.find(protocol => protocol.id === id) ?? deskapiV1
}

import { auto } from './auto'
import { deskapiV1 } from './deskapi-v1'
import { xiaoStream } from './xiao-stream'
import type { DeviceProtocol } from './types'
export const protocols: readonly DeviceProtocol[] = [deskapiV1, xiaoStream, auto]
export function getProtocol(id: string): DeviceProtocol {
  return protocols.find(protocol => protocol.id === id) ?? auto
}

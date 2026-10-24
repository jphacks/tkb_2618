import { scanKey } from './virtual-keys'

export interface KeyboardInput { vk: number; scan: number; flags: number }
export function hotkeyInputs(keys: string[]): KeyboardInput[] {
  return keys.map(name => {
    const key = scanKey(name)
    return { vk: 0, scan: key.scan, flags: 0x0008 | (key.extended ? 0x0001 : 0) }
  })
}
/** Media actions retain VK input; these VKs have the extended-key flag. */
export function mediaInputs(codes: number[]): KeyboardInput[] {
  return codes.map(vk => ({ vk, scan: 0, flags: vk >= 0xa6 && vk <= 0xb7 ? 1 : 0 }))
}
export function keyboardInputBuffer(key: KeyboardInput, up: boolean, arch: string): Buffer {
  const x64 = arch !== 'ia32', size = x64 ? 40 : 28, offset = x64 ? 8 : 4
  const buffer = Buffer.alloc(size)
  buffer.writeUInt32LE(1, 0) // INPUT_KEYBOARD
  buffer.writeUInt16LE(key.vk, offset)
  buffer.writeUInt16LE(key.scan, offset + 2)
  buffer.writeUInt32LE(key.flags | (up ? 0x0002 : 0), offset + 4)
  return buffer
}

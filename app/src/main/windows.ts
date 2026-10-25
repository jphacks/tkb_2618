import koffi from 'koffi'
import { hotkeyInputs, mediaInputs, keyboardInputBuffer, type KeyboardInput } from './keyboard-input'

export class WindowsActions {
  private readonly user32 = koffi.load('user32.dll')
  private readonly sendInput = this.user32.func('uint32 __stdcall SendInput(uint32 count, const void *inputs, int size)')
  private readonly shell32 = koffi.load('shell32.dll')
  private readonly shellExecute = this.shell32.func('intptr_t __stdcall ShellExecuteW(void *hwnd, str16 operation, str16 file, str16 parameters, str16 directory, int show)')
  send(keys: string[]): void { this.sendInputs(hotkeyInputs(keys)) }
  sendCodes(codes: number[]): void { this.sendInputs(mediaInputs(codes)) }
  private sendInputs(codes: KeyboardInput[]): void {
    if (!codes.length) throw new Error('キーが指定されていません')
    const size = process.arch === 'ia32' ? 28 : 40
    const input = (key: KeyboardInput, up: boolean): Buffer => keyboardInputBuffer(key, up, process.arch)
    const events = [...codes.map(c => input(c, false)), ...codes.map(c => input(c, true)).reverse()]
    if (this.sendInput(events.length, Buffer.concat(events), size) !== events.length) {
      // Best effort release after a partial insertion (for example UIPI denial).
      this.sendInput(codes.length, Buffer.concat(codes.map(c => input(c, true)).reverse()), size)
      throw new Error('キー入力に失敗しました（対象アプリの権限を確認してください）')
    }
  }
  launch(file: string, args?: string): void {
    if (!file.trim()) throw new Error('起動するファイルが指定されていません')
    if (Number(this.shellExecute(null, 'open', file, args ?? null, null, 1)) <= 32) throw new Error(`起動に失敗しました: ${file}`)
  }
}

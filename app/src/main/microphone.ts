import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

// A single PowerShell process keeps the compiled COM bridge warm between taps.
const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class Enumerator {}
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IEnum {
 void EnumAudioEndpoints(int flow, int mask, out IntPtr devices);
 void GetDefaultAudioEndpoint(int flow, int role, out IDevice device);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDevice { void Activate(ref Guid iid, int context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object instance); }
[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IVolume {
 void RegisterControlChangeNotify(IntPtr p); void UnregisterControlChangeNotify(IntPtr p);
 void GetChannelCount(out uint count); void SetMasterVolumeLevel(float v, IntPtr ctx);
 void SetMasterVolumeLevelScalar(float v, IntPtr ctx); void GetMasterVolumeLevel(out float v);
 void GetMasterVolumeLevelScalar(out float v); void SetChannelVolumeLevel(uint c, float v, IntPtr ctx);
 void SetChannelVolumeLevelScalar(uint c, float v, IntPtr ctx); void GetChannelVolumeLevel(uint c, out float v);
 void GetChannelVolumeLevelScalar(uint c, out float v);
 void SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, IntPtr ctx);
 void GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}
public static class Mic {
 public static void Toggle() {
  object enumerator = new Enumerator(); IDevice device = null; object endpoint = null;
  try {
   ((IEnum)enumerator).GetDefaultAudioEndpoint(1, 0, out device);
   Guid iid = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
   device.Activate(ref iid, 23, IntPtr.Zero, out endpoint);
   bool muted; ((IVolume)endpoint).GetMute(out muted); ((IVolume)endpoint).SetMute(!muted, IntPtr.Zero);
  } finally {
   if(endpoint != null) Marshal.ReleaseComObject(endpoint);
   if(device != null) Marshal.ReleaseComObject(device);
   Marshal.ReleaseComObject(enumerator);
  }
 }
}
'@
while ($null -ne ($line = [Console]::ReadLine())) {
 try { [Mic]::Toggle(); [Console]::WriteLine('OK') }
 catch { [Console]::WriteLine('ERROR ' + $_.Exception.Message) }
}
`
export class Microphone {
  private child?: ChildProcessWithoutNullStreams
  private pending: { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }[] = []
  private start(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true })
    this.child = child
    createInterface({ input: child.stdout }).on('line', line => {
      if (line !== 'OK' && !line.startsWith('ERROR ')) return
      const request = this.pending.shift()
      if (!request) return
      clearTimeout(request.timer)
      if (line === 'OK') request.resolve()
      else request.reject(new Error(line.slice(6)))
    })
    child.stderr.on('data', data => console.error('[Microphone]', String(data)))
    const failed = (error: Error): void => {
      if (this.child !== child) return
      this.child = undefined
      for (const request of this.pending.splice(0)) { clearTimeout(request.timer); request.reject(error) }
    }
    child.on('error', failed)
    child.stdin.on('error', failed)
    child.on('exit', () => failed(new Error('マイク操作プロセスが終了しました')))
    return child
  }
  toggle(): Promise<void> {
    const child = this.start()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close(), 10_000)
      this.pending.push({ resolve, reject, timer })
      child.stdin.write('toggle\n')
    })
  }
  close(): void {
    const child = this.child
    this.child = undefined
    for (const request of this.pending.splice(0)) { clearTimeout(request.timer); request.reject(new Error('マイク操作が中断されました')) }
    child?.kill()
  }
}

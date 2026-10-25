import type { Channels } from '../../shared/types'
import { Detector } from './detector'
import type { DeviceProtocol, ProtocolIO, ProtocolSession } from './types'

export const xiaoStream: DeviceProtocol = {
  id: 'xiao-stream', serial: { baudRate: 115200 }, capabilities: { calibration: true, raw: true },
  open: io => openXiaoStream(io)
}

export function openXiaoStream(io: ProtocolIO, greetOnBoot = true): ProtocolSession {
  const detector = new Detector(io.emit)
  if (io.calibration) detector.setCalibration(io.calibration)
  const raw: Channels = [0, 0, 0, 0]
  let nowUs = 0, intervalUs = 250, consecutive = 0, greeted = false
  const hello = (): void => {
    if (greeted) return
    greeted = true
    io.emit({ t: 'hello', fw: 'xiao-stream', cal: io.calibration !== undefined })
  }
  return {
    handshake: { send: 'stream\n', isHello: e => e.t === 'hello', timeoutMs: 3000 },
    // 4000 lines per second; silence means the board reset, crashed or stopped streaming.
    idleTimeoutMs: 2000,
    receive(line) {
      if (line.startsWith('[desk] stream')) {
        const rate = /\brate=(\d+)\b/.exec(line)
        if (rate && Number(rate[1]) > 0) intervalUs = 1e6 / Number(rate[1])
        if (greetOnBoot) hello()
      }
      if (!/^\d{1,4},\d{1,4},\d{1,4},\d{1,4}$/.test(line)) { consecutive = 0; return }
      const values = line.split(',')
      for (let i = 0; i < 4; i++) {
        const value = Number(values[i])
        if (value > 4095) { consecutive = 0; return }
        raw[i] = value
      }
      nowUs += intervalUs
      if (++consecutive >= 8) hello()
      detector.sample(raw, nowUs)
      io.sample?.(raw, 1e6 / intervalUs)
    },
    send(command) {
      switch (command.t) {
        case 'ping': return true
        case 'mode':
          detector.setMode(command.mode)
          io.emit({ t: 'ack', of: 'mode', ok: true })
          return true
        case 'set_cal':
          io.emit({ t: 'ack', of: 'set_cal', ok: detector.setCalibration(command.cal) })
          return true
        case 'measure_noise': return detector.measureNoise(command.ms, nowUs)
      }
    }
  }
}

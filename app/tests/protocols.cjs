const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync, mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { Duplex } = require('node:stream')
const { setTimeout: delay } = require('node:timers/promises')
const root = process.env.DESKAPI_TEST_OUTPUT
const { protocols } = require(root + '/main/protocols/index.js')
const { SerialDevice } = require(root + '/main/serial-device.js')
const { ConfigStore } = require(root + '/main/config.js')
const { DEFAULT_CONFIG } = require(root + '/shared/constants.js')
// Add a protocol to the registry and a .log / .expected.json pair to replay it.
for (const protocol of protocols) test(`${protocol.id}: recorded serial events`, () => {
  const fixture = join(__dirname, 'fixtures', protocol.id)
  const actual = readFileSync(fixture + '.log', 'utf8').split(/\r?\n/).map(line => protocol.parseLine(line)).filter(event => event !== null)
  assert.deepEqual(actual, JSON.parse(readFileSync(fixture + '.expected.json', 'utf8')))
})
async function until(fn) {
  for (let i = 0; i < 200; i++) { if (fn()) return; await delay(5) }
  assert.fail('timed out')
}
test('CSV firmware without calibration, version or calibration state connects and emits taps', async t => {
  const writes = [], options = []
  let stream
  const protocol = {
    id: 'test-csv', serial: { baudRate: 9600 }, capabilities: { calibration: false, raw: false },
    handshake: () => ({ send: 'identify\n', isHello: e => e.t === 'hello', timeoutMs: 50 }),
    parseLine: line => line === 'ready' ? { t: 'hello' } : line === '0,2,strong' ? { t: 'tap', region: 0, count: 2, strength: 'strong', confidence: 1 } : null,
    encode: () => null
  }
  const device = new SerialDevice(() => 'COM5', {
    list: async () => [], open: (path, settings) => {
      options.push(settings)
      stream = new Duplex({ read() {}, write(chunk, enc, done) {
        writes.push(chunk.toString()); done(); queueMicrotask(() => stream.push('ready\n'))
      } })
      return stream
    }
  }, 10, undefined, () => protocol)
  t.after(() => device.stop())
  const taps = []; device.onTap(tap => taps.push(tap))
  device.start(); await until(() => device.status.state === 'connected')
  assert.deepEqual(device.status.capabilities, protocol.capabilities)
  assert.equal(device.status.fw, undefined); assert.equal(device.status.cal, undefined)
  assert.deepEqual(options, [{ baudRate: 9600 }])
  stream.push('0,2,strong\n'); await until(() => taps.length === 1)
  await assert.rejects(device.setMode('calibrate'), /対応/)
  await assert.rejects(device.measureNoise(), /対応/)
  await assert.rejects(device.saveCalibration({}), /対応/)
  assert.equal(device.status.state, 'connected')
  assert.deepEqual(writes, ['identify\n'])
})
test('v1 accepts optional hello fields and encodes all commands including raw mode', () => {
  const protocol = protocols[0]
  for (const hello of [{ t: 'hello' }, { t: 'hello', cal: false }, { t: 'hello', fw: 'v' }])
    assert.deepEqual(protocol.parseLine(JSON.stringify(hello)), hello)
  for (const command of [{ t: 'ping' }, { t: 'mode', mode: 'raw' }, { t: 'measure_noise', ms: 2000 }, { t: 'set_cal', cal: { threshold: [1,2,3,4] } }])
    assert.deepEqual(JSON.parse(protocol.encode(command)), command)
})
test('legacy config gets default protocol without losing settings', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'deskapi-legacy-'))
  try {
    const legacy = structuredClone(DEFAULT_CONFIG); delete legacy.protocol; legacy.notify = false
    writeFileSync(join(dir, 'config.json'), JSON.stringify(legacy))
    const config = await new ConfigStore(dir).load()
    assert.equal(config.protocol, 'deskapi-v1'); assert.equal(config.notify, false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
test('serial logger timestamps split lines and flushes remaining input on Ctrl+C', () => {
  const { EventEmitter } = require('node:events')
  const { runInNewContext } = require('node:vm')
  let port, settings, ended = false
  const saved = [], displayed = []
  const file = new EventEmitter(); file.write = text => saved.push(text); file.end = () => { ended = true }
  class FakePort extends EventEmitter {
    isOpen = true
    constructor(options) { super(); settings = options; port = this }
    close() { this.isOpen = false; this.emit('close') }
  }
  const proc = new EventEmitter()
  proc.argv = ['node', 'serial-log', 'COM5', '9600']; proc.stdout = { write: text => displayed.push(text) }
  runInNewContext(readFileSync(join(__dirname, '../scripts/serial-log.cjs'), 'utf8'), {
    require: name => name === 'serialport' ? { SerialPort: FakePort } : { createWriteStream: () => file },
    process: proc, console: { log() {}, error() {} }, Date
  })
  port.emit('data', Buffer.from('boot\r')); port.emit('data', Buffer.from('\nready\npartial'))
  proc.emit('SIGINT')
  assert.equal(ended, true); assert.equal(port.isOpen, false)
  assert.deepEqual(saved, displayed)
  assert.deepEqual(saved.map(line => line.replace(/^\[[^\]]+\] /, '')), ['boot\n', 'ready\n', 'partial\n'])
  assert.ok(saved.every(line => /^\[\d{4}-.*Z\] /.test(line)))
})

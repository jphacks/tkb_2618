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
  const actual = []
  const session = protocol.open({ write() {}, emit: e => actual.push(e) })
  for (const line of readFileSync(fixture + '.log', 'utf8').split(/\r?\n/)) session.receive(line)
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
    open(io) { return {
      handshake: { send: 'identify\n', isHello: e => e.t === 'hello', timeoutMs: 50 },
      receive(line) { if(line === 'ready') io.emit({t:'hello'}); if(line === '0,2,strong') io.emit({t:'tap', region:0,count:2,confidence:1}) },
      send: () => false
    } }
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
  const events = [], writes = []
  const protocol = protocols[0].open({emit:e=>events.push(e), write:s=>writes.push(s)})
  for (const hello of [{ t: 'hello' }, { t: 'hello', cal: false }, { t: 'hello', fw: 'v' }])
    { protocol.receive(JSON.stringify(hello)); assert.deepEqual(events.at(-1), hello) }
  for (const command of [{ t: 'ping' }, { t: 'mode', mode: 'raw' }, { t: 'measure_noise', ms: 2000 }, { t: 'set_cal', cal: { threshold: [1,2,3,4] } }])
    { assert.equal(protocol.send(command), true); assert.deepEqual(JSON.parse(writes.at(-1)), command.t === 'set_cal' ? { ...command, cal: { ...command.cal, strongMin: [4095,4095,4095,4095] } } : command) }
  // The firmware still reports strength; the app drops it.
  protocol.receive('{"t":"tap","region":1,"count":2,"strength":"strong","confidence":0.5}')
  assert.deepEqual(events.at(-1), { t: 'tap', region: 1, count: 2, confidence: 0.5 })
})
test('legacy config gets default protocol without losing settings', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'deskapi-legacy-'))
  try {
    const legacy = structuredClone(DEFAULT_CONFIG); delete legacy.protocol; legacy.notify = false
    writeFileSync(join(dir, 'config.json'), JSON.stringify(legacy))
    const config = await new ConfigStore(dir).load()
    assert.equal(config.protocol, 'auto'); assert.equal(config.notify, false)
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
    process: proc, console: { log() {}, error() {} }, Date, setInterval: () => 1, clearInterval() {}
  })
  port.emit('data', Buffer.from('boot\r')); port.emit('data', Buffer.from('\nready\npartial'))
  proc.emit('SIGINT')
  assert.equal(ended, true); assert.equal(port.isOpen, false)
  assert.equal(displayed.length, 2)
  assert.match(displayed[0], /受信 3 行/)
  assert.equal(displayed[1], saved.at(-1))
  assert.deepEqual(saved.map(line => line.replace(/^\[[^\]]+\] /, '')), ['boot\n', 'ready\n', 'partial\n'])
  assert.ok(saved.every(line => /^\[\d{4}-.*Z\] /.test(line)))
})

test('config validates optional calibration and migrates legacy or unknown protocol IDs', async () => {
  const {isConfig}=require(root + '/shared/validation.js')
  const {defaultCalibration}=require(root + '/main/protocols/detector.js')
  assert.equal(isConfig(DEFAULT_CONFIG),true)
  const cal=defaultCalibration()
  assert.equal(isConfig({...DEFAULT_CONFIG,calibration:cal}),true)
  for(const calibration of [{},null,{...cal,threshold:[1,2,3]},{...cal,templates:[[1,0,0,0]]},{...cal,templates:[[0,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]}])
    assert.equal(isConfig({...DEFAULT_CONFIG,calibration}),false)
  const dir=mkdtempSync(join(tmpdir(),'deskapi-migration-'))
  try {
    for(const protocol of ['deskapi-v1','missing','xiao-stream','auto']) {
      writeFileSync(join(dir,'config.json'),JSON.stringify({...DEFAULT_CONFIG,protocol,calibration:cal,notify:false}))
      const loaded=await new ConfigStore(dir).load()
      assert.equal(loaded.protocol,['deskapi-v1','missing'].includes(protocol)?'auto':protocol)
      assert.deepEqual(loaded.calibration,cal);assert.equal(loaded.notify,false)
    }
  } finally {rmSync(dir,{recursive:true,force:true})}
})

test('serial logger keeps every timestamped line, prints status immediately and aggregates data once per second', () => {
  const {EventEmitter}=require('node:events'),{runInNewContext}=require('node:vm')
  let port,tick,cleared=false
  const saved=[],displayed=[]
  const file=new EventEmitter();file.write=s=>saved.push(s);file.end=()=>{}
  class FakePort extends EventEmitter {isOpen=true;constructor(){super();port=this}close(){this.isOpen=false;this.emit('close')}}
  const proc=new EventEmitter();proc.argv=['node','serial-log','COM1'];proc.stdout={write:s=>displayed.push(s)}
  runInNewContext(readFileSync(join(__dirname,'../scripts/serial-log.cjs'),'utf8'),{
    require:name=>name==='serialport'?{SerialPort:FakePort}:{createWriteStream:()=>file},process:proc,console:{log(){},error(){}},Date,
    setInterval(fn,ms){assert.equal(ms,1000);tick=fn;return 1},clearInterval(){cleared=true}
  })
  port.emit('data',Buffer.from('[desk] stream boot=1\r\n'+'1900,1900,1900,1900\n'.repeat(4000)))
  assert.equal(saved.length,4001);assert.equal(displayed.length,1);assert.match(displayed[0],/\[desk\]/)
  tick();assert.equal(displayed.length,3);assert.match(displayed[1],/受信 4000 行/);assert.equal(displayed[2],saved.at(-1))
  tick();assert.equal(displayed.length,3)
  proc.emit('SIGINT');assert.equal(cleared,true)
})

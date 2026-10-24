const {test} = require('node:test')
const assert = require('node:assert/strict')
const {Duplex} = require('node:stream')
const {setTimeout:delay} = require('node:timers/promises')
const {SerialDevice} = require(process.env.DESKAPI_TEST_OUTPUT + '/main/serial-device.js')
const {getProtocol} = require(process.env.DESKAPI_TEST_OUTPUT + '/main/protocols/index.js')
const {defaultCalibration} = require(process.env.DESKAPI_TEST_OUTPUT + '/main/protocols/detector.js')
async function until(fn) { for(let i=0;i<200;i++) {if(fn()) return; await delay(5)}; assert.fail('timed out') }
async function rig(t, protocol='auto', calibration=()=>undefined) {
  let port
  const writes=[]
  const device = new SerialDevice(()=> 'COM1',{list:async()=>[],open:()=>{
    port = new Duplex({read(){},write(data,enc,done){writes.push(data.toString());done(); if(writes.length===1) queueMicrotask(()=>port.push('1900,1910,1920,1930\n'.repeat(8)))}})
    return port
  }},10,100,()=>getProtocol(protocol),calibration)
  t.after(()=>device.stop())
  device.start();await until(()=>device.status.state==='connected')
  return {device,port,writes}
}
// Fixed-seed bipolar damped waveform. DC differs by channel, noise is bounded ±2.
function waveform(seconds, hits) {
  let seed=0x12345678
  const lines=[]
  for(let n=0;n<seconds*4000;n++) {
    const raw=[]
    for(let ch=0;ch<4;ch++) {
      seed=(Math.imul(seed,1664525)+1013904223)>>>0
      let value=1900+ch*10+(seed%5)-2
      for(const hit of hits) {
        const age=n-hit.n
        if(age>=0 && age<200) value+=hit.amp*(ch===hit.region?1:.08)*Math.exp(-age/22)*Math.cos(age*.8)
      }
      raw.push(Math.round(value))
    }
    lines.push(raw.join(',')+'\n')
  }
  return Buffer.from(lines.join(''))
}
function feed(port,buffer,fragmented=true) {
  if(!fragmented) {port.emit('data',buffer); return}
  for(let i=0,size=2;i<buffer.length;i+=size,size=size===2?3:2) port.emit('data',buffer.subarray(i,i+size))
}
test('60 seconds / 240000 CSV samples in 2–3 byte chunks: 16 taps and saturation under one second',async t=>{
  const {device,port,writes}=await rig(t)
  assert.match(writes[0],/^stream\n/)
  assert.match(writes[0],/\{"t":"ping"\}\n/)
  const hits=[],expected=[]
  for(let region=0;region<4;region++) for(const count of [1,2]) for(const strength of ['weak','strong']) {
    const n=4000+expected.length*10000,amp=strength==='strong'?900:400
    hits.push({n,region,amp});if(count===2) hits.push({n:n+800,region,amp})
    expected.push({region,count,strength})
  }
  hits.push({n:200000,region:3,amp:1850})
  expected.push({region:3,count:1,strength:'strong'})
  const buffer=waveform(60,hits),taps=[]
  device.onTap(e=>taps.push(e))
  const start=performance.now();feed(port,buffer);const elapsed=performance.now()-start
  assert.deepEqual(taps.map(({region,count,strength})=>({region,count,strength})),expected)
  assert.equal(taps.at(-1).sat,true)
  assert.ok(taps.slice(0,-1).every(t=>t.sat===undefined))
  t.diagnostic(`240000 samples, ${buffer.length} bytes: ${elapsed.toFixed(1)} ms`)
  assert.ok(elapsed<1000,`${elapsed} ms >= 1000 ms`)
})
test('local calibration cycle, negative ACK, persisted calibration and changed decisions after reconnect',async t=>{
  const {mkdtempSync,rmSync} = require('node:fs'), {tmpdir}=require('node:os'),{join}=require('node:path')
  const {ConfigStore}=require(process.env.DESKAPI_TEST_OUTPUT + '/main/config.js')
  const dir=mkdtempSync(join(tmpdir(),'deskapi-stream-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
  const store=new ConfigStore(dir);await store.load()
  const {device,port,writes}=await rig(t,'xiao-stream',()=>store.config.calibration)
  const hits=[],taps=[];device.onCalHit(e=>hits.push(e));device.onTap(e=>taps.push(e))
  await device.setMode('calibrate')
  const noise=device.measureNoise();await delay(0)
  feed(port,waveform(2.1,[]),false)
  assert.ok((await noise).peak.every(n=>n<=5))
  feed(port,waveform(.5,[{n:100,region:0,amp:500}]),false)
  assert.equal(hits.length,1);assert.equal(hits[0].t,'hit');assert.ok(hits[0].ring>=10)
  await assert.rejects(device.saveCalibration({...defaultCalibration(),threshold:[-1,0,0,0]}),/拒否/)
  const cal={...defaultCalibration(),templates:[[0,1,0,0],[1,0,0,0],[0,0,1,0],[0,0,0,1]],strongMin:[300,300,300,300]}
  await device.saveCalibration(cal);await store.update(c=>({...c,calibration:cal}));await device.setMode('run')
  feed(port,waveform(.5,[{n:100,region:0,amp:500}]),false)
  assert.equal(taps.at(-1).region,1);assert.equal(taps.at(-1).strength,'strong')
  assert.deepEqual(writes,['stream\n'])
  const loaded=new ConfigStore(dir);await loaded.load();assert.deepEqual(loaded.config.calibration,cal)
  device.stop()
  const again=await rig(t,'auto',()=>loaded.config.calibration)
  assert.equal(again.device.status.cal,true)
  const restored=[];again.device.onTap(e=>restored.push(e))
  feed(again.port,waveform(.5,[{n:100,region:0,amp:500}]),false)
  assert.equal(restored[0].region,1);assert.equal(restored[0].strength,'strong')
})

test('session validation, consecutive hello, rate timing, local raw and isolated connection state',()=>{
  const events=[],other=[]
  const session=getProtocol('xiao-stream').open({write(){},emit:e=>events.push(e)})
  const second=getProtocol('xiao-stream').open({write(){},emit:e=>other.push(e)})
  const quiet='1900,1900,1900,1900'
  for(let i=0;i<7;i++) session.receive(quiet)
  for(const bad of ['4096,0,0,0','-1,0,0,0','1,2,3','1,2,3,4 ','[stat] rate=4000 dropped=0','bad']) {
    session.receive(bad)
    for(let i=0;i<7;i++) session.receive(quiet)
    assert.equal(events.length,0)
  }
  session.receive(quiet);assert.deepEqual(events,[{t:'hello',fw:'xiao-stream',cal:false}]);assert.deepEqual(other,[])
  second.receive('[desk] stream boot=1 ch=D0,D1,D3,D4 rate=1000')
  assert.equal(other.length,1)
  second.send({t:'mode',mode:'raw'})
  second.receive(quiet)
  for(let i=0;i<9;i++) {
    second.receive('2000,2100,2200,2300')
    second.receive('broken');second.receive('5000,0,0,0')
  }
  assert.equal(other.filter(e=>e.t==='raw').length,0)
  second.receive(quiet)
  assert.deepEqual(other.at(-1),{t:'raw',min:[1900,1900,1900,1900],max:[2000,2100,2200,2300]})
})
test('auto waits for eight consecutive samples, first recognized adapter wins and stays selected',()=>{
  const quiet='1900,1900,1900,1900'
  for(const winner of ['deskapi-v1','xiao-stream']) {
    const events=[],writes=[]
    const session=getProtocol('auto').open({write:s=>writes.push(s),emit:e=>events.push(e)})
    assert.equal(session.handshake.timeoutMs,3000)
    assert.equal(session.handshake.send,'stream\n{"t":"ping"}\n')
    session.receive('[desk] stream boot=1 rate=4000')
    for(let i=0;i<7;i++) session.receive(quiet)
    assert.equal(events.length,0)
    if(winner==='deskapi-v1') session.receive('{"t":"hello","fw":"v1"}')
    session.receive(quiet)
    session.receive('{"t":"hello","fw":"late"}')
    assert.equal(events[0].fw,winner==='xiao-stream'?'xiao-stream':'v1')
    session.send({t:'mode',mode:'run'})
    if(winner==='xiao-stream') {
      assert.equal(events.length,2);assert.equal(events.at(-1).of,'mode');assert.deepEqual(writes,[])
    } else assert.deepEqual(writes,['{"t":"mode","mode":"run"}\n'])
  }
})
test('SerialDevice bounds lines at 512, drops CR, recovers overflow across chunks',async t=>{
  const {port,device}=await rig(t)
  const taps=[];device.onTap(e=>taps.push(e))
  // Noise/overflow cannot add sample time or trigger a detector hit.
  feed(port,Buffer.from('x'.repeat(600)+'\r\n9999,0,0,0\n-1,0,0,0\n'))
  feed(port,waveform(.5,[{n:100,region:2,amp:900}]))
  assert.equal(taps.length,1);assert.equal(taps[0].region,2)
  await device.setMode('calibrate') // Local synchronous ACK still resolves after overflow.
})

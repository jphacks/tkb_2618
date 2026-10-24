const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Duplex } = require('node:stream')
const { setTimeout: delay } = require('node:timers/promises')
const { SerialDevice } = require(process.env.DESKAPI_TEST_OUTPUT + '/main/serial-device.js')
async function until(fn) { for(let i=0;i<200;i++) { if(fn()) return; await delay(5) }; assert.fail('timed out') }
class Port extends Duplex {
  commands=[]; refuse=false; silent=false
  _read() {}
  send(value) { this.push(JSON.stringify(value)+'\n') }
  _write(chunk,enc,done) {
    const text = chunk.toString().trim().replace(/^stream\n/, ''); if(text === 'stream') { done(); return }
    const command=JSON.parse(text); this.commands.push(command)
    done()
    queueMicrotask(() => {
      if(this.destroyed || this.silent) return
      if(command.t==='ping') { this.push('boot log\n{bad}\n'+ 'x'.repeat(600)+'\n{"t":"hel'); this.push('lo","fw":"0.1.0","cal":false}\r\n') }
      if(command.t==='mode' || command.t==='set_cal') this.send({t:'ack',of:command.t,ok:!this.refuse,err:this.refuse?'invalid_cal':undefined})
      if(command.t==='measure_noise') this.send({t:'noise',peak:[1,2,3,4],rms:[0,1,1,1]})
    })
  }
}
function setup(list = [{path:'other'},{path:'esp',vendorId:'10C4'}]) {
  const ports=[], paths=[]
  const device = new SerialDevice(()=> 'auto', {list:async()=>list,open:path=> { paths.push(path); const p=new Port();ports.push(p);return p }},10,40)
  return {device, ports, paths}
}
test('Duplex handshake, framing, tap, calibration, disconnect and reconnect', async t => {
  const {device,ports,paths}=setup();t.after(()=>device.stop())
  const taps=[],hits=[];device.onTap(x=>taps.push(x));device.onCalHit(x=>hits.push(x))
  device.start();await until(()=>device.status.state==='connected')
  assert.equal(paths[0],'esp'); assert.equal(device.status.fw,'0.1.0')
  const p=ports[0]
  p.send({t:'tap',region:9,count:1,strength:'weak',confidence:1})
  p.send({t:'tap',region:2,count:2,strength:'strong',confidence:.8})
  await until(()=>taps.length===1)
  await device.setMode('calibrate')
  assert.deepEqual((await device.measureNoise()).peak,[1,2,3,4])
  p.send({t:'hit',peaks:[10,900,10,10],ms:18,ring:64});await until(()=>hits.length===1)
  await device.saveCalibration({threshold:[100,100,100,100],strongMin:[500,500,500,500],doubleWindowMs:320,refractoryMs:70})
  assert.equal(device.status.cal,true)
  await device.setMode('run')
  p.destroy();await until(()=>ports.length===2 && device.status.state==='connected')
  assert.equal(ports[1].commands[1].mode,'run')
})
test('negative ACK rejects and missing ACK disconnects without hanging', async t => {
  const {device,ports}=setup();t.after(()=>device.stop());device.start();await until(()=>device.status.state==='connected')
  ports[0].refuse=true
  await assert.rejects(device.setMode('calibrate'), /拒否/)
  ports[0].silent=true
  await assert.rejects(device.setMode('run'), /応答/)
  await until(()=>ports.length>1 && device.status.state==='connected')
})
test('no ports, enumeration errors, and stop while waiting are safe', async () => {
  const {device}=setup([]);device.start();await delay(20);assert.equal(device.status.state,'disconnected');device.stop()
  const broken=new SerialDevice(()=> 'auto',{list:async()=>{throw Error('unavailable')},open:()=>{throw Error()}},10,20)
  broken.start();await delay(20);assert.equal(broken.status.state,'disconnected');broken.stop()
  let p
  const waiting=new SerialDevice(()=> 'COM1',{list:async()=>[],open:()=>{p=new Port();p.silent=true;return p}},10,20)
  waiting.start();waiting.stop();await delay(30);assert.equal(waiting.status.state,'disconnected')
})
test('hello timeout skips a non-DeskAPI port and opens the next candidate', async t => {
  const paths=[]
  const device=new SerialDevice(()=> 'auto', {
    list:async()=>[{path:'silent'},{path:'desk'}],
    open:path=>{paths.push(path);const p=new Port();p.silent=path==='silent';return p}
  },10,20)
  t.after(()=>device.stop());device.start()
  await until(()=>device.status.state==='connected')
  assert.deepEqual(paths,['silent','desk']);assert.equal(device.status.port,'desk')
})
test('real backend enumeration is safe with no WSL COM device', async () => {
  const device=new SerialDevice(()=> 'auto')
  device.start();await delay(100);device.stop()
  assert.equal(device.status.state,'disconnected')
})
test('stop rejects outstanding command and prevents reconnect', async () => {
  const {device,ports}=setup();device.start();await until(()=>device.status.state==='connected')
  ports[0].silent=true
  const pending=device.setMode('calibrate');await delay(1);device.stop()
  await assert.rejects(pending,/未接続/)
  await delay(60);assert.equal(ports.length,1)
})
test('v1.1 validates ring and sat, preserves saturation and sends templates',async t=>{
  const {device,ports}=setup();t.after(()=>device.stop());device.start();await until(()=>device.status.state==='connected')
  const hits=[],taps=[];device.onCalHit(h=>hits.push(h));device.onTap(h=>taps.push(h))
  const p=ports[0]
  const hit={t:'hit',peaks:[300,500,20,20],ms:15,ring:100}
  for(const invalid of [{...hit,ring:-1},{...hit,ring:1001},{...hit,sat:false},{...hit,ring:undefined}]) p.send(invalid)
  p.send({...hit,sat:true})
  p.send({t:'tap',region:0,count:1,strength:'weak',confidence:0.9,sat:false})
  p.send({t:'tap',region:0,count:1,strength:'weak',confidence:0.9,sat:true})
  await until(()=>hits.length===1 && taps.length===1)
  assert.equal(hits[0].sat,true);assert.equal(taps[0].sat,true)
  const cal={threshold:[100,100,100,100],strongMin:[500,500,500,500],doubleWindowMs:370,refractoryMs:250,templates:[[0.6,0.8,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]}
  await device.saveCalibration(cal)
  assert.deepEqual(p.commands.at(-1).cal,cal)
})

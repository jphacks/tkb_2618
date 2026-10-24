const { test } = require('node:test')
const assert = require('node:assert/strict')
const { calculateCalibration, CalibrationError } = require(process.env.DESKAPI_TEST_OUTPUT + '/shared/calibration.js')
const { isCalibration } = require(process.env.DESKAPI_TEST_OUTPUT + '/shared/validation.js')
const noise = { t: 'noise', peak: [41,38,52,40], rms: [9,8,11,9] }
const samples = (ring=64) => Array.from({length:8}, (_,i) => (i%2?[800,900,1000]:[200,240,280]).map(amp => {
  const peaks=[10,10,10,10];peaks[Math.floor(i/2)]=amp
  if(i<2) peaks[1]=amp*1.3
  return {t:'hit',peaks,ms:15,ring}
}))
test('metal table templates pass leave-one-out and use maximum amplitude', () => {
  const cal=calculateCalibration(noise,samples())
  assert.deepEqual(cal.threshold,[100,100,104,100])
  assert.equal(cal.strongMin[0],Math.sqrt(312*1170))
  assert.ok(cal.templates[0][1]>cal.templates[0][0])
  for(const t of cal.templates) assert.ok(Math.abs(Math.hypot(...t)-1)<1e-12)
  assert.equal(cal.refractoryMs,77);assert.equal(cal.doubleWindowMs,320)
})
test('timing rounds and clamps',()=>{
  for(const [ring,refractory,window] of [[0,40,320],[1000,250,370],[180,216,336],[64,77,320]]){
    const cal=calculateCalibration(noise,samples(ring));assert.equal(cal.refractoryMs,refractory);assert.equal(cal.doubleWindowMs,window)
  }
})
test('reports inseparable regions and overlapping strengths',()=>{
  const s=samples();s[2]=structuredClone(s[0]);s[3]=structuredClone(s[1])
  assert.throws(()=>calculateCalibration(noise,s),e=>e instanceof CalibrationError && e.regions.includes(1))
  const overlap=samples();overlap[1][0].peaks=[200,260,10,10]
  assert.throws(()=>calculateCalibration(noise,overlap),e=>e.regions.includes(0))
})
test('reject malformed, saturated samples and invalid templates; accept legacy calibration',()=>{
  for(const change of [s=>s.pop(),s=>s[0][0].ring=NaN,s=>s[0][0].peaks[0]=5000,s=>s[0][0].sat=true]){
    const s=samples();change(s);assert.throws(()=>calculateCalibration(noise,s))
  }
  const old={threshold:[150,150,150,150],strongMin:[700,700,700,700],doubleWindowMs:320,refractoryMs:70}
  assert.ok(isCalibration(old))
  for(const row of [[0,0,0,0],[NaN,1,0,0],[Infinity,0,0,0],[1,2]]) assert.equal(isCalibration({...old,templates:Array(4).fill(row)}),false)
})
test('mock metal hits including saturation can collect all 24 valid hits and save',async()=>{
  const { MockDevice }=require(process.env.DESKAPI_TEST_OUTPUT+'/main/device.js')
  const device=new MockDevice()
  await device.setMode('calibrate')
  const original=Math.random
  const s=Array.from({length:8},()=>[])
  let step=0, rejected=0, adjacent=0
  const unsubscribe=device.onCalHit(hit=>{
    if(hit.sat){rejected++;return}
    if(step<2 && hit.peaks[1]>hit.peaks[0]) adjacent++
    s[step].push(hit)
  })
  try{
    for(step=0;step<8;step++){
      // Deterministic saturated and valid emissions exercise both paths.
      Math.random=()=>0
      device.mockHit(Math.floor(step/2),step%2?'strong':'weak')
      Math.random=()=>0.5
      for(let i=0;i<3;i++) device.mockHit(Math.floor(step/2),step%2?'strong':'weak')
    }
    const cal=calculateCalibration(noise,s)
    assert.equal(rejected,8);assert.equal(adjacent,6)
    assert.ok(cal.templates[0][1]>cal.templates[0][0])
    await device.saveCalibration(cal);assert.equal(device.status.cal,true)
  }finally{Math.random=original;unsubscribe();device.stop()}
})
test('UI progress ignores saturation, counts adjacent maxima and finishes with mock hits',async()=>{
  const {advanceCalibration,initialCalibrationProgress}=require(process.env.DESKAPI_TEST_OUTPUT+'/shared/calibration.js')
  const {MockDevice}=require(process.env.DESKAPI_TEST_OUTPUT+'/main/device.js')
  const device=new MockDevice();await device.setMode('calibrate')
  let progress={...initialCalibrationProgress(),phase:'tap'}
  const unsubscribe=device.onCalHit(hit=>{progress=advanceCalibration(progress,hit,noise)})
  const original=Math.random
  try{
    for(let i=0;i<24;i++){
      const step=progress.step
      Math.random=()=>0
      device.mockHit(Math.floor(step/2),step%2?'strong':'weak')
      assert.equal(progress.step,step)
      Math.random=()=>0.5
      device.mockHit(Math.floor(step/2),step%2?'strong':'weak')
    }
    assert.equal(progress.phase,'done');assert.equal(progress.step,8)
    assert.ok(progress.samples[0][0].peaks[1]>progress.samples[0][0].peaks[0])
  }finally{Math.random=original;unsubscribe();device.stop()}
})
test('UI retries multiple confused regions in ascending order and keeps completed samples',()=>{
  const {advanceCalibration,initialCalibrationProgress}=require(process.env.DESKAPI_TEST_OUTPUT+'/shared/calibration.js')
  let progress={...initialCalibrationProgress(),phase:'tap'}
  const data=samples()
  for(let step=0;step<8;step++) for(let i=0;i<3;i++) {
    const hit=step<6 ? {...data[step][i],peaks:[0,Math.max(...data[step][i].peaks),0,0]} : data[step][i]
    progress=advanceCalibration(progress,hit,noise)
  }
  assert.equal(progress.step,2);assert.equal(progress.errorRegion,1)
  assert.deepEqual(progress.retryRegions,[1,2])
  assert.equal(progress.samples[0].length,3);assert.equal(progress.samples[6].length,3)
  for(let step=2;step<6;step++){
    if(step%2===0) assert.equal(progress.errorRegion,Math.floor(step/2))
    for(let i=0;i<3;i++) progress=advanceCalibration(progress,step<4 ? data[step%2][i] : data[step][i],noise)
  }
  assert.equal(progress.phase,'done')
})
test('UI overlapping strengths restart only that region from weak',()=>{
  const {advanceCalibration,initialCalibrationProgress}=require(process.env.DESKAPI_TEST_OUTPUT+'/shared/calibration.js')
  let progress={...initialCalibrationProgress(),phase:'tap'}
  const data=samples()
  for(let i=0;i<6;i++) progress=advanceCalibration(progress,data[0][i%3],noise)
  assert.equal(progress.step,0);assert.equal(progress.errorRegion,0)
  assert.equal(progress.samples[0].length,0);assert.equal(progress.samples[1].length,0)
})

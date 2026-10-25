const { test } = require('node:test')
const assert = require('node:assert/strict')
const { calculateCalibration, CalibrationError } = require(process.env.DESKAPI_TEST_OUTPUT + '/shared/calibration.js')
const { isCalibration } = require(process.env.DESKAPI_TEST_OUTPUT + '/shared/validation.js')
const noise = { t: 'noise', peak: [41,38,52,40], rms: [9,8,11,9] }
// One step per region, three taps each. Region 0 is on a metal table: the adjacent channel is louder.
const samples = (ring=64) => Array.from({length:4}, (_,r) => [400,450,500].map(amp => {
  const peaks=[10,10,10,10];peaks[r]=amp
  if(r===0) peaks[1]=amp*1.3
  return {t:'hit',peaks,ms:15,ring}
}))
test('metal table templates pass leave-one-out; thresholds per channel from the taps loudest on it', () => {
  const cal=calculateCalibration(noise,samples())
  // ch0 is never the loudest: 2 × still peak. ch1 is loudest for regions 0 and 1: half of the softest (400).
  assert.deepEqual(cal.threshold,[82,200,200,200])
  assert.equal('strongMin' in cal,false)
  assert.ok(cal.templates[0][1]>cal.templates[0][0])
  for(const t of cal.templates) assert.ok(Math.abs(Math.hypot(...t)-1)<1e-12)
  assert.equal(cal.refractoryMs,77);assert.equal(cal.doubleWindowMs,320)
})
test('sensors need not match region numbers and may differ in gain',()=>{
  // Region r is heard on channel (r+1)%4, and channel 3 is five times quieter than the rest.
  const gain=[1,1,1,0.2],s=Array.from({length:4},(_,r)=>[400,450,500].map(amp=>{
    const peaks=[5,5,5,5];peaks[(r+1)%4]=amp*gain[(r+1)%4];return {t:'hit',peaks,ms:15,ring:64}
  }))
  const quiet={t:'noise',peak:[30,30,30,8],rms:[6,6,6,2]}
  const cal=calculateCalibration(quiet,s)
  assert.deepEqual(cal.threshold,[200,200,200,40])
})
test('timing rounds and clamps',()=>{
  // The double window is fixed; only the refractory time follows the ringing.
  for(const [ring,refractory] of [[0,40],[1000,250],[180,216],[64,77]]){
    const cal=calculateCalibration(noise,samples(ring));assert.equal(cal.refractoryMs,refractory);assert.equal(cal.doubleWindowMs,320)
  }
})
test('reports inseparable regions',()=>{
  const s=samples();s[1]=structuredClone(s[0])
  assert.throws(()=>calculateCalibration(noise,s),e=>e instanceof CalibrationError && e.regions.includes(1))
})
test('version 1 settings: 16 keys become 8, weak first, strong when weak was empty; strongMin is dropped',()=>{
  const {upgradeConfig,isConfig}=require(process.env.DESKAPI_TEST_OUTPUT+'/shared/validation.js')
  const key=(icon,color='blue')=>({icon,color,action:{type:'lock'}})
  const keys=Array(16).fill(null);keys[0]=key('mic');keys[1]=key('lock');keys[3]=key('star','green');keys[13]=key('bolt')
  const v1={version:1,profiles:[{id:'a',name:'A',keys}],activeProfileId:'a',locked:false,notify:true,autostart:true,port:'auto',protocol:'auto',
    calibration:{threshold:[1,2,3,4],strongMin:[5,6,7,8],doubleWindowMs:320,refractoryMs:70}}
  const v2=upgradeConfig(v1)
  assert.ok(isConfig(v2));assert.equal(v2.version,2)
  assert.equal(v2.profiles[0].keys[0].color,'cyan');assert.equal(v2.profiles[0].keys[1].color,'orange')
  assert.deepEqual(v2.profiles[0].keys.map(k=>k?.icon??null),['mic','star',null,null,null,null,'bolt',null])
  assert.deepEqual(v2.calibration,{threshold:[1,2,3,4],doubleWindowMs:320,refractoryMs:70})
  assert.equal(isConfig(v1),false);assert.equal(upgradeConfig(v2),v2)
})
test('reject malformed, saturated samples and invalid templates; accept legacy calibration',()=>{
  for(const change of [s=>s.pop(),s=>s[0][0].ring=NaN,s=>s[0][0].peaks[0]=5000,s=>s[0][0].sat=true]){
    const s=samples();change(s);assert.throws(()=>calculateCalibration(noise,s))
  }
  // A calibration saved before strength was removed still carries strongMin; it stays usable.
  const old={threshold:[150,150,150,150],strongMin:[700,700,700,700],doubleWindowMs:320,refractoryMs:70}
  assert.ok(isCalibration(old))
  for(const row of [[0,0,0,0],[NaN,1,0,0],[Infinity,0,0,0],[1,2]]) assert.equal(isCalibration({...old,templates:Array(4).fill(row)}),false)
})
test('mountains: tap-collect yardstick, 50 ms gap merges ringing, saturation and duration',()=>{
  const {MountainCounter,restFrom,median}=require(process.env.DESKAPI_TEST_OUTPUT+'/shared/tap-procedure.js')
  assert.equal(median([3,1,2,4]),2.5);assert.equal(median([5,1,9]),5)
  // collect's still trial: median of the part before the cue, peak over both parts.
  const rest=restFrom([[100,200,300,400],[101,200,300,400],[99,200,300,400]],[[104,198,300,401],[96,202,300,399]])
  assert.deepEqual(rest.baseline,[100,200,300,400]);assert.deepEqual(rest.peak,[4,2,0,1])
  assert.deepEqual(restFrom([[100,0,0,0],[101,0,0,0]],[]).peak,[0.5,0,0,0])
  const hits=[],c=new MountainCounter([100,200,300,400],[4,2,0,1],4000,h=>hits.push(h))
  const flat=n=>{for(let i=0;i<n;i++) c.push([100,200,300,400])}
  // Exactly 1.5 × peak is not above; 7 is.
  c.push([106,200,300,400]);flat(10);assert.equal(hits.length,0)
  c.push([107,200,300,400]);flat(150)        // 150 quiet samples = 37.5 ms < 50 ms: same mountain
  c.push([100,260,300,400]);flat(201)        // > 50 ms of quiet closes it
  assert.equal(hits.length,1);assert.deepEqual(hits[0].peaks,[7,60,0,0]);assert.equal(hits[0].ms,38);assert.equal(hits[0].ring,38)
  c.push([100,200,300,4095]);c.finish()
  assert.equal(hits.length,2);assert.equal(hits[1].sat,true);assert.equal(hits[1].peaks[3],3695)
})
test('mock stream: record still, three prompted taps per step, and a calibration that saves',async t=>{
  const {MockDevice}=require(process.env.DESKAPI_TEST_OUTPUT+'/main/device.js')
  const {record,recordStep,restFrom}=require(process.env.DESKAPI_TEST_OUTPUT+'/main/recorder.js')
  const {pickHits}=require(process.env.DESKAPI_TEST_OUTPUT+'/shared/tap-procedure.js')
  const {advanceCalibration,initialCalibrationProgress}=require(process.env.DESKAPI_TEST_OUTPUT+'/shared/calibration.js')
  const device=new MockDevice();t.after(()=>device.stop())
  await device.setMode('calibrate')
  const rest=restFrom((await record(device.onSample,100)).rows,(await record(device.onSample,300)).rows)
  assert.ok(rest.peak.every(p=>p<=4),JSON.stringify(rest))
  // Nothing happens on its own: an untouched window has no mountains.
  const idle=await recordStep(device.onSample,rest,()=>{},()=>{})
  assert.equal(idle.length,0)
  let progress={...initialCalibrationProgress(),phase:'tap'}
  const noise={t:'noise',peak:rest.peak,rms:rest.rms}
  while(progress.phase==='tap'){
    const step=progress.step,live=[]
    const hits=await recordStep(device.onSample,rest,()=>{
      for(let k=0;k<3;k++) setTimeout(()=>device.mockHit(step),100+k*400)
    },h=>live.push(h))
    assert.equal(hits.length,3,`step ${step}: ${hits.length}`);assert.deepEqual(live,hits)
    for(const hit of pickHits(hits)) progress=advanceCalibration(progress,hit,noise)
  }
  assert.equal(progress.phase,'done')
  assert.ok(progress.samples[0][0].peaks[1]>progress.samples[0][0].peaks[0])
  const cal=calculateCalibration(noise,progress.samples)
  assert.ok(isCalibration(cal));assert.ok(cal.templates[0][1]>cal.templates[0][0])
  await device.saveCalibration(cal);assert.equal(device.status.cal,true)
})
test('pickHits keeps the three largest unsaturated mountains',()=>{
  const {pickHits}=require(process.env.DESKAPI_TEST_OUTPUT+'/shared/tap-procedure.js')
  const h=(a,sat)=>({t:'hit',peaks:[a,0,0,0],ms:5,ring:5,...(sat?{sat:true}:{})})
  assert.deepEqual(pickHits([h(5),h(90),h(40),h(4000,true),h(60)]).map(x=>x.peaks[0]),[90,60,40])
  assert.equal(pickHits([h(5),h(90),h(4000,true)]),null)
})
test('recording rejects when the firmware streams no raw values and when aborted',async()=>{
  const {record}=require(process.env.DESKAPI_TEST_OUTPUT+'/main/recorder.js')
  await assert.rejects(record(()=>()=>{},1000),/生値が届きません/)
  const controller=new AbortController(),pending=record(()=>()=>{},1000,undefined,controller.signal)
  controller.abort();await assert.rejects(pending,/中止/)
})
test('UI retries multiple confused regions in ascending order and keeps completed samples',()=>{
  const {advanceCalibration,initialCalibrationProgress}=require(process.env.DESKAPI_TEST_OUTPUT+'/shared/calibration.js')
  let progress={...initialCalibrationProgress(),phase:'tap'}
  const data=samples()
  // Regions 0–2 all sound the same; region 0 wins the tie, so 1 and 2 are redone.
  for(let step=0;step<4;step++) for(let i=0;i<3;i++) {
    const hit=step<3 ? {...data[step][i],peaks:[0,Math.max(...data[step][i].peaks),0,0]} : data[step][i]
    progress=advanceCalibration(progress,hit,noise)
  }
  assert.equal(progress.step,1);assert.equal(progress.errorRegion,1)
  assert.deepEqual(progress.retryRegions,[1,2])
  assert.equal(progress.samples[0].length,3);assert.equal(progress.samples[3].length,3)
  for(const step of [1,2]){
    assert.equal(progress.errorRegion,step)
    for(let i=0;i<3;i++) progress=advanceCalibration(progress,data[step][i],noise)
  }
  assert.equal(progress.phase,'done');assert.equal(progress.step,4)
})

test('calibration progress propagates calculation errors for the screen to display', () => {
  const { advanceCalibration, initialCalibrationProgress } = require(process.env.DESKAPI_TEST_OUTPUT + '/shared/calibration.js')
  let progress = { ...initialCalibrationProgress(), phase: 'tap' }
  const noisy = { ...noise, peak: [3000, 3000, 3000, 3000] }
  const data = samples()
  for (let step = 0; step < 4; step++) for (let i = 0; i < 3; i++) {
    if (step === 3 && i === 2) {
      assert.throws(() => advanceCalibration(progress, data[step][i], noisy), /ノイズが大きすぎます/)
    } else progress = advanceCalibration(progress, data[step][i], noisy)
  }
})

test('version 2 settings migrate both legacy colors in every profile and preserve key data',()=>{
  const {upgradeConfig,isConfig}=require(process.env.DESKAPI_TEST_OUTPUT+'/shared/validation.js')
  const {DEFAULT_CONFIG}=require(process.env.DESKAPI_TEST_OUTPUT+'/shared/constants.js')
  const original=structuredClone(DEFAULT_CONFIG)
  for(const profile of original.profiles){
    profile.keys[0]={icon:'mic',color:'green',slash:true,action:{type:'lock'}}
    profile.keys[1]={icon:'bolt',color:'blue',action:{type:'launch',file:'calc.exe'}}
  }
  assert.equal(isConfig(original),false)
  const upgraded=upgradeConfig(original)
  assert.ok(isConfig(upgraded));assert.equal(upgraded.version,2)
  for(const [i,profile] of upgraded.profiles.entries()){
    assert.deepEqual(profile.keys[0],{...original.profiles[i].keys[0],color:'orange'})
    assert.deepEqual(profile.keys[1],{...original.profiles[i].keys[1],color:'cyan'})
    assert.deepEqual(profile.keys.slice(2),original.profiles[i].keys.slice(2))
  }
  assert.equal(original.profiles[0].keys[0].color,'green')
  assert.equal(upgradeConfig(upgraded),upgraded)
})

// Detector cases ported from firmware/test/test_core/test_main.cpp.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Detector, defaultCalibration, validCalibration } = require(process.env.DESKAPI_TEST_OUTPUT + '/main/protocols/detector.js')
const within = (delta, expected, actual) => assert.ok(Math.abs(expected - actual) <= delta, `${actual} != ${expected} ± ${delta}`)
class Rig {
  events = []; nextUs = 500; quiet = [2048,2048,2048,2048]
  constructor() {
    this.detector = new Detector(e => this.events.push({...e, type:e.t, strong:e.strength === 'strong', saturated:!!e.sat, peaks:e.peaks ?? e.peak ?? [...this.detector.peaks], rawMin:e.min, rawMax:e.max}))
    this.detector.sample(this.quiet, 0)
  }
  idleTo(end) { while(this.nextUs <= end) { this.detector.sample(this.quiet,this.nextUs); this.nextUs += 500 } }
  at(us,raw) { this.idleTo(us-500); this.detector.sample(raw,us); this.nextUs=us+500 }
  hit(us,amps) { this.at(us,this.quiet.map((v,i)=>v+amps[i])); this.idleTo(us+15000) }
}

test('test_defaults_and_invalid_calibration', () => {

    const rig = new Rig();
    const defaults = rig.detector.calibration();
    assert.equal(320, defaults.doubleWindowMs);
    assert.equal(70, defaults.refractoryMs);
    for (let i = 0; i < 4; i++) {
        assert.equal(150, defaults.threshold[i]);
        assert.equal(700, defaults.strongMin[i]);
    }
    let invalid = defaultCalibration();
    invalid.threshold[2] = NaN;
    assert.equal(rig.detector.setCalibration(invalid), false);
    invalid = structuredClone(defaults);
    invalid.strongMin[1] = 4096;
    assert.equal(validCalibration(invalid), false);
    invalid = structuredClone(defaults);
    invalid.doubleWindowMs = 0;
    assert.equal(validCalibration(invalid), false);
    assert.equal(150, rig.detector.calibration().threshold[2]);
})

test('test_single_waits_until_onset_deadline', () => {

    const rig = new Rig();
    rig.hit(10000, [500, 100, 50, 0]);
    assert.ok(rig.events.length === 0);
    rig.idleTo(329500);
    assert.ok(rig.events.length === 0);
    rig.idleTo(330000);
    assert.equal(1, rig.events.length);
    assert.equal(0, rig.events[0].region);
    assert.equal(1, rig.events[0].count);
    assert.equal(rig.events[0].strong, false);
    within(0.001, 0.8, rig.events[0].confidence);
})

test('test_peak_window_uses_later_channel_maximum', () => {

    const rig = new Rig();
    rig.detector.setMode('calibrate');
    rig.at(10000, [2248, 2048, 2048, 2048]);
    rig.at(24000, [2048, 2908, 2048, 2188]);
    rig.idleTo(24500);
    assert.ok(rig.events.length === 0);
    rig.idleTo(34500);
    assert.equal(1, rig.events.length);
    assert.ok(rig.events[0].type == 'hit');
    assert.equal(200, rig.events[0].peaks[0]);
    assert.equal(860, rig.events[0].peaks[1]);
    assert.equal(15, rig.events[0].ms);
})

test('test_region_selected_by_maximum_not_first_trigger', () => {

    const rig = new Rig();
    rig.at(10000, [2248, 2048, 2048, 2048]);
    rig.at(24000, [2048, 2848, 2048, 2048]);
    rig.idleTo(330000);
    assert.equal(1, rig.events.length);
    assert.equal(1, rig.events[0].region);
    assert.ok(rig.events[0].strong);
    within(0.001, 0.75, rig.events[0].confidence);
})

test('test_peak_window_excludes_sample_at_end', () => {

    const rig = new Rig();
    rig.detector.setMode('calibrate');
    rig.at(10000, [2548, 2048, 2048, 2048]);
    rig.at(25000, [2048, 3048, 2048, 2048]);
    rig.idleTo(35500);
    assert.equal(1, rig.events.length);
    assert.equal(500, rig.events[0].peaks[0]);
    assert.equal(0, rig.events[0].peaks[1]);
    rig.idleTo(400000);
    assert.equal(1, rig.events.length);
})

test('test_dc_tracks_quiet_baseline_drift', () => {

    const rig = new Rig();
    
    rig.quiet.fill(2148);
    rig.idleTo(10000000);
    assert.ok(rig.events.length === 0);
    rig.detector.setMode('calibrate');
    rig.hit(10010000, [0, 0, 0, 800]);
    assert.equal(1, rig.events.length);
    within(1, 800, rig.events[0].peaks[3]);
    within(1, 0, rig.events[0].peaks[0]);
})

test('test_double_uses_stronger_hit_and_lower_confidence', () => {

    const rig = new Rig();
    rig.hit(10000, [0, 500, 100, 0]);
    rig.hit(200000, [0, 900, 450, 0]);
    assert.equal(1, rig.events.length);
    assert.equal(2, rig.events[0].count);
    assert.ok(rig.events[0].strong);
    within(0.001, 0.5, rig.events[0].confidence);
    rig.idleTo(600000);
    assert.equal(1, rig.events.length);
})

test('test_double_preserves_strong_first_hit', () => {

    const rig = new Rig();
    rig.hit(10000, [0, 0, 700, 0]);
    rig.hit(100000, [0, 0, 300, 0]);
    assert.equal(1, rig.events.length);
    assert.equal(2, rig.events[0].count);
    assert.ok(rig.events[0].strong);
})

test('test_double_at_exact_deadline_finishes_after_deadline', () => {

    const rig = new Rig();
    rig.hit(10000, [0, 0, 500, 0]);
    rig.at(330000, [2048, 2048, 2548, 2048]);
    assert.ok(rig.events.length === 0);
    rig.idleTo(344500);
    assert.ok(rig.events.length === 0);
    rig.idleTo(345000);
    assert.equal(1, rig.events.length);
    assert.equal(2, rig.events[0].count);
})

test('test_late_second_hit_is_two_singles', () => {

    const rig = new Rig();
    rig.hit(10000, [0, 0, 0, 500]);
    rig.hit(330500, [0, 0, 0, 500]);
    assert.equal(1, rig.events.length);
    rig.idleTo(650500);
    assert.equal(2, rig.events.length);
    assert.equal(1, rig.events[0].count);
    assert.equal(1, rig.events[1].count);
})

test('test_other_region_flushes_first_then_becomes_pending', () => {

    const rig = new Rig();
    rig.hit(10000, [500, 0, 0, 0]);
    rig.hit(100000, [0, 0, 0, 800]);
    assert.equal(1, rig.events.length);
    assert.equal(0, rig.events[0].region);
    rig.hit(200000, [0, 0, 0, 300]);
    assert.equal(2, rig.events.length);
    assert.equal(3, rig.events[1].region);
    assert.equal(2, rig.events[1].count);
})

test('test_refractory_suppresses_ringing_and_accepts_boundary', () => {

    const rig = new Rig();
    rig.detector.setMode('calibrate');
    rig.hit(10000, [500, 0, 0, 0]); 
    rig.at(94500, [2048, 3048, 2048, 2048]);
    assert.equal(1, rig.events.length);
    rig.hit(95000, [0, 800, 0, 0]);
    assert.equal(2, rig.events.length);
    assert.equal(800, rig.events[1].peaks[1]);
})

test('test_dc_offset_negative_signal_and_quiet_do_not_trigger', () => {

    const rig = new Rig();
    rig.idleTo(1000000);
    assert.ok(rig.events.length === 0);
    rig.at(1010000, [2048, 2048, 1248, 2048]);
    rig.idleTo(1330000);
    assert.equal(1, rig.events.length);
    assert.equal(2, rig.events[0].region);
    assert.ok(rig.events[0].strong);
})

test('test_biased_bipolar_input_all_channels_and_strengths', () => {

    for (let channel = 0; channel < 4; channel++) {
        for (const sign of [-1, 1]) {
            for (const amplitude of [151, 699, 700, 1200]) {
                const rig = new Rig();
                rig.idleTo(1000000);
                assert.ok(rig.events.length === 0);
                const raw = [...rig.quiet];
                raw[channel] = (2048 + sign * amplitude);
                rig.at(1010000, raw);
                raw[channel] = (2048 - sign * amplitude);
                rig.at(1010500, raw);
                rig.idleTo(1330000);
                assert.equal(1, rig.events.length);
                assert.equal(channel, rig.events[0].region);
                assert.equal(amplitude, rig.events[0].peaks[channel]);
                assert.equal(amplitude >= 700, rig.events[0].strong);
                assert.equal(1, rig.events[0].count);
            }
        }
    }
})

test('test_threshold_strict_and_per_channel_calibration_immediate', () => {

    const rig = new Rig();
    rig.at(10000, [2198, 2048, 2048, 2048]); 
    rig.idleTo(400000);
    assert.ok(rig.events.length === 0);
    let cal = defaultCalibration();
    cal.threshold = [1000, 1000, 90.5, 1000];
    cal.strongMin[2] = 200;
    cal.doubleWindowMs = 100;
    assert.ok(rig.detector.setCalibration(cal));
    rig.hit(500000, [500, 0, 200, 0]);
    rig.idleTo(600000);
    assert.equal(1, rig.events.length);
    
    assert.equal(0, rig.events[0].region);
    assert.equal(rig.events[0].strong, false);
})

test('test_equal_peaks_have_zero_confidence', () => {

    const rig = new Rig();
    rig.hit(10000, [500, 500, 500, 500]);
    rig.idleTo(330000);
    assert.equal(1, rig.events.length);
    assert.equal(0, rig.events[0].region);
    assert.equal(0, rig.events[0].confidence);
})

test('test_mode_and_calibration_changes_cancel_pending_and_active_hits', () => {

    const rig = new Rig();
    rig.hit(10000, [500, 0, 0, 0]);
    rig.detector.setMode('calibrate');
    rig.idleTo(400000);
    assert.ok(rig.events.length === 0);
    rig.at(410000, [2548, 2048, 2048, 2048]);
    rig.detector.setMode('run');
    rig.idleTo(800000);
    assert.ok(rig.events.length === 0);
    rig.hit(810000, [500, 0, 0, 0]);
    assert.ok(rig.detector.setCalibration(defaultCalibration()));
    rig.idleTo(1200000);
    assert.ok(rig.events.length === 0);
})

test('test_noise_peak_rms_duration_and_busy', () => {

    const rig = new Rig();
    assert.equal(rig.detector.measureNoise(0, 500), false);
    assert.ok(rig.detector.measureNoise(2, 500));
    assert.equal(rig.detector.measureNoise(2, 500), false);
    rig.at(500, [2058, 2068, 2078, 2088]);
    rig.at(1000, [2038, 2028, 2018, 2008]);
    rig.at(1500, [2058, 2068, 2078, 2088]);
    rig.at(2000, [2038, 2028, 2018, 2008]);
    assert.ok(rig.events.length === 0);
    rig.idleTo(2500);
    assert.equal(1, rig.events.length);
    assert.ok(rig.events[0].type == 'noise');
    for (let i = 0; i < 4; i++) {
        assert.equal(10 * (i + 1), rig.events[0].peaks[i]);
        within(0.01, 10.0 * (i + 1), rig.events[0].rms[i]);
    }
    assert.ok(rig.detector.measureNoise(1, 3000));
})

test('test_long_uptime_does_not_wrap_hit_timing', () => {

    const rig = new Rig();
    const start = 2 ** 32 + 204;
    rig.nextUs = start;
    rig.hit(start, [500, 0, 0, 0]);
    rig.hit(start + 200000, [500, 0, 0, 0]);
    assert.equal(1, rig.events.length);
    assert.equal(2, rig.events[0].count);
})

test('test_circuit_saturation', () => {

    for (const mode of ['run', 'calibrate']) {
        for (let ch = 0; ch < 4; ch++) {
            for (const sign of [-1, 1]) {
                for (const amp of [1799, 1800]) {
                    const rig = new Rig();
                    rig.detector.setMode(mode);
                    rig.at(10000, [2248, 2048, 2048, 2048]);
                    const raw = [...rig.quiet];
                    raw[ch] = 2048 + sign * amp;
                    rig.at(24500, raw);
                    rig.idleTo(330000);
                    assert.equal(1, rig.events.length);
                    assert.equal(amp == 1800, rig.events[0].saturated);
                    assert.equal(amp == 1800, Object.hasOwn(rig.events[0], 'sat'));
                }
            }
        }
    }
    for (const first of [false, true]) {
        const rig = new Rig();
        rig.hit(10000, [(first ? 1800 : 500), 0, 0, 0]);
        rig.hit(100000, [(first ? 500 : 1800), 0, 0, 0]);
        assert.equal(1, rig.events.length);
        assert.equal(2, rig.events[0].count);
        assert.ok(rig.events[0].saturated);
    }
})

test('test_circuit_raw', () => {
    const rig = new Rig();
    rig.hit(10000, [500, 0, 0, 0]);
    rig.detector.setMode('raw');
    rig.nextUs = 30000;
    rig.at(30000, [0, 1000, 2000, 4095]);
    rig.at(39500, [4095, 2000, 1000, 0]);
    assert.ok(rig.events.length === 0);
    rig.at(40000, [200, 300, 400, 500]);
    assert.equal(1, rig.events.length);
    const minimum = [0, 1000, 1000, 0], maximum = [4095, 2048, 2048, 4095];
    assert.ok(rig.events[0].type == 'raw');
    assert.deepEqual(minimum, rig.events[0].rawMin);
    assert.deepEqual(maximum, rig.events[0].rawMax);
    rig.idleTo(50000);
    assert.equal(2, rig.events.length);
    assert.equal(200, rig.events[1].rawMin[0]);
    rig.detector.setMode('run');
    rig.events.splice(0);
    rig.hit(60000, [500, 0, 0, 0]);
    rig.idleTo(380000);
    assert.equal(1, rig.events.length);
    assert.ok(rig.events[0].type == 'tap');
})

test('test_templates_metal_legacy_and_confidence', () => {

    let cal = defaultCalibration();
    cal.templates = [[2, 3, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
    cal.strongMin[0] = 650;
    const metal = new Rig();
    assert.ok(metal.detector.setCalibration(cal));
    metal.hit(10000, [500, 750, 0, 0]);
    metal.idleTo(330000);
    assert.equal(0, metal.events[0].region);
    assert.ok(metal.events[0].strong); 
    within(0.0001, 1, metal.events[0].confidence);
    const legacy = new Rig();
    legacy.hit(10000, [500, 750, 0, 0]);
    legacy.idleTo(330000);
    assert.equal(1, legacy.events[0].region);
    within(0.0001, 1.0 - 500.0 / 750, legacy.events[0].confidence);
    cal.templates[1] = cal.templates[0];
    const tied = new Rig();
    assert.ok(tied.detector.setCalibration(cal));
    tied.hit(10000, [500, 750, 0, 0]);
    tied.idleTo(330000);
    within(0.0001, 0, tied.events[0].confidence);
})

test('test_ring_quiet_reset_cap_and_peak_capture', () => {

    const rig = new Rig();
    rig.detector.setMode('calibrate');
    rig.hit(10000, [500, 0, 0, 0]);
    assert.equal(1, rig.events.length);
    assert.equal(10, rig.events[0].ring);
    assert.equal(15, rig.events[0].ms);
    const latePeak = new Rig();
    latePeak.detector.setMode('calibrate');
    latePeak.at(10000, [2548, 2048, 2048, 2048]);
    latePeak.at(24000, [2048, 2848, 2048, 2048]);
    latePeak.idleTo(25000);
    assert.equal(1, latePeak.events.length);
    assert.equal(10, latePeak.events[0].ring);
    assert.equal(800, latePeak.events[0].peaks[1]);
    const ringing = new Rig();
    ringing.detector.setMode('calibrate');
    ringing.at(10000, [2548, 2048, 2048, 2048]);
    ringing.at(19000, [2248, 2048, 2048, 2048]);
    ringing.at(28000, [2248, 2048, 2048, 2048]);
    ringing.idleTo(38000);
    assert.ok(ringing.events.length === 0);
    ringing.idleTo(38500);
    assert.equal(1, ringing.events.length);
    assert.equal(28, ringing.events[0].ring);
    assert.equal(500, ringing.events[0].peaks[0]);
    const endless = new Rig();
    endless.detector.setMode('calibrate');
    endless.quiet[0] = 2548;
    endless.idleTo(1000000);
    assert.ok(endless.events.length === 0);
    endless.idleTo(1000500);
    assert.equal(1, endless.events.length);
    assert.equal(1000, endless.events[0].ring);
})

test('test_templates_storage_and_invalid_rows', () => {
  const cal = {threshold:[90,85,100,88],strongMin:[520,480,600,500],doubleWindowMs:370,refractoryMs:250,templates:[[2,3,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]}
  const rig = new Rig()
  assert.equal(rig.detector.setCalibration(cal),true)
  within(0.00001,2 / Math.sqrt(13),rig.detector.calibration().templates[0][0])
  const restored = JSON.parse(JSON.stringify(rig.detector.calibration()))
  assert.equal(rig.detector.setCalibration(restored),true)
  within(0.00001,restored.templates[0][1],rig.detector.calibration().templates[0][1])
  assert.equal(rig.detector.setCalibration(defaultCalibration()),true)
  assert.equal(rig.detector.calibration().templates,undefined)
  for (const templates of [null, [], [[0,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]], [[1,2,3],[0,1,0,0],[0,0,1,0],[0,0,0,1]], [[1e100,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]]) {
    assert.equal(rig.detector.setCalibration({...cal,templates}),false)
  }
  for (const row of [[0,0,0,0],[Infinity,0,0,0]]) {
    const invalid = structuredClone(cal); invalid.templates[0] = row
    assert.equal(rig.detector.setCalibration(invalid),false)
  }
})

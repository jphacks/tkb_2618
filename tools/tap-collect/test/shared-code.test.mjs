import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Store, options, countMountains } from '../core.mjs';
import { create } from '../detectors/app.mjs';
import { loadSession } from '../scoring.mjs';

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tap-shared-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('合図前が空なら baseline は null、peak は 0 のまま保存する', t => {
  const store = new Store(options(['--mock', '--out', temporary(t)]));
  try {
    for (const cue of [true, false]) {
      store.start(store.session.patterns[0]);
      if (cue) {
        store.cue();
        store.receive({ type: 'sample', values: [0, 4095, 301, 401] });
      }
      const record = store.finish('aborted');
      assert.deepEqual(record.baseline, [null, null, null, null]);
      assert.deepEqual(record.peak, [0, 0, 0, 0]);
      assert.deepEqual(record.saturated, cue ? [1, 1, 0, 0] : [0, 0, 0, 0]);
    }
  } finally {
    store.close();
  }
});

test('山の境界は50msちょうどなら同じ山、超えたら別の山で、末尾の山も数える', () => {
  for (const rate of [1000, 4000]) {
    const values = Array.from({ length: rate }, () => [100, 200, 300, 400]);
    const gap = rate * 0.05;
    for (const i of [1, 1 + gap, 2 + gap * 2, rate - 1]) values[i] = [102, 200, 300, 400];
    assert.equal(countMountains({ values, cue: 1, from: 0, kind: 'cal_single' }, [0, 0, 0, 0], rate), 3);
  }
});

test('app採点の静止peakは保存値と一致し、旧ログの同じ領域の山をまとめて3打を選ぶ', async t => {
  const store = new Store(options(['--mock', '--out', temporary(t)]));
  const base = [100, 200, 300, 400];
  const receive = values => store.receive({ type: 'sample', values });
  let rest;
  try {
    store.session.rate = 1000;
    store.start(store.session.patterns[0]);
    receive(base);
    receive(base.map(v => v + 2));
    store.cue();
    for (let i = 0; i < 8; i++) receive(base.map(v => v + 11));
    rest = store.finish('ok');
    assert.deepEqual(rest.baseline, [101, 201, 301, 401]);
    assert.deepEqual(rest.peak, [10, 10, 10, 10]);
    let id = 1;
    const add = (region, strength, amplitudes) => {
      store.start({ id: id++, kind: 'cal_single', phase: 'calibration',
        zone: ['lt', 'rt', 'lb', 'rb'][region], strength,
        label: `cal_single_${['lt', 'rt', 'lb', 'rb'][region]}_${strength}` });
      receive(base);
      store.cue();
      for (const amp of amplitudes) {
        receive(base.map((v, ch) => v + (ch === region ? amp : amp / 5)));
        for (let i = 0; i < 60; i++) receive(base);
      }
      store.finish('ok');
    };
    add(0, 'weak', [80, 100]);
    add(0, 'weak', [120, 140, 160]);
    add(0, 'weak', [200, 220, 240]);
    add(0, 'strong', [300, 330, 360]);
    add(0, 'strong', [3995]); // Saturation must not displace clean hits.
    for (let region = 1; region < 4; region++) {
      add(region, 'weak', [100, 120]);
      add(region, 'strong', [300]); // Neither trial alone has the required three hits.
    }
  } finally {
    store.close();
  }
  const adapter = await create();
  try {
    const session = loadSession(store.dir);
    const model = await adapter.train([session], () => true, {});
    assert.deepEqual(model.noise.peak, rest.peak);
    assert.deepEqual(model.calibrationThresholds[0].peak, rest.peak);
    assert.deepEqual(model.calibrationThresholds[0].threshold, [15, 15, 15, 15]);
    assert.deepEqual(model.noise.rms, [Math.sqrt(80.2), Math.sqrt(80.2), Math.sqrt(80.2), Math.sqrt(80.2)]);
    assert.equal(model.hits.length, 4);
    assert.deepEqual(model.hits[0].map(h => h.peaks[0]), [360, 330, 300]);
    for (let region = 1; region < 4; region++) {
      assert.deepEqual(model.hits[region].map(h => h.peaks[region]), [300, 120, 100]);
    }
    assert.ok(!('strongMin' in model.calibration));
    await assert.rejects(adapter.train([session], () => true, { strongMin: 100 }), /不明な app params: strongMin/);
    await assert.rejects(adapter.train([session], t => t.zone !== 'rb', {}), error => {
      assert.match(error.message, /rb:0\/3/);
      assert.doesNotMatch(error.message, /weak|strong/);
      assert.ok(error.diagnostics);
      return true;
    });
    // The same definition works when an older log has no stored peak to fall back on.
    delete session.trials[0].peak;
    assert.deepEqual((await adapter.train([session], () => true, {})).noise.peak, rest.peak);
  } finally {
    adapter.close();
  }
});

test('コンパイルキャッシュは別プロセスでも再利用し、shared・protocolsの内容変更で更新する', async t => {
  const dir = temporary(t);
  const write = (file, text) => {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  };
  // A tiny app fixture runs the real app compiler and records each invocation.
  const tsc = fileURLToPath(new URL('../../../app/node_modules/typescript/bin/tsc', import.meta.url));
  write('app/node_modules/typescript/package.json', JSON.stringify({ cacheTest: dir }));
  write('app/node_modules/typescript/bin/tsc', `require('node:fs').appendFileSync(${JSON.stringify(path.join(dir, 'compiles'))}, ${JSON.stringify('tsc\n')}); require(${JSON.stringify(tsc)});`);
  write('app/src/shared/tap-procedure.ts', 'export const revision = 1');
  write('app/src/shared/calibration.ts', 'export const calculateCalibration = () => 0');
  write('app/src/main/protocols/detector.ts', 'export class Detector { static revision = 1 }');
  write('app/src/main/recorder.ts', "export { revision } from '../shared/tap-procedure'");
  const loader = path.join(dir, 'tools/tap-collect/app-code.mjs');
  fs.mkdirSync(path.dirname(loader), { recursive: true });
  fs.copyFileSync(fileURLToPath(new URL('../app-code.mjs', import.meta.url)), loader);
  const script = `import { loadAppCode } from ${JSON.stringify(pathToFileURL(loader).href)};
    const [a, b] = await Promise.all([loadAppCode(), loadAppCode()]);
    if (a !== b) throw Error('同一プロセスのキャッシュが共有されていません');
    console.log(JSON.stringify([a.procedure.revision, a.Detector.revision]));`;
  const run = async () => {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script]);
    assert.equal(stderr, '');
    return JSON.parse(stdout);
  };
  const compiles = () => fs.readFileSync(path.join(dir, 'compiles'), 'utf8').trim().split('\n').length;
  assert.deepEqual(await run(), [1, 1]);
  assert.equal(compiles(), 1);
  assert.deepEqual(await run(), [1, 1]);
  assert.equal(compiles(), 1);
  // Same-length changes must invalidate the cache too.
  write('app/src/shared/tap-procedure.ts', 'export const revision = 2');
  assert.deepEqual(await run(), [2, 1]);
  assert.equal(compiles(), 2);
  write('app/src/main/protocols/detector.ts', 'export class Detector { static revision = 2 }');
  assert.deepEqual(await run(), [2, 2]);
  assert.equal(compiles(), 3);
  write('app/src/shared/unused.ts', '// Also hash files outside the compiled import graph.');
  assert.deepEqual(await run(), [2, 2]);
  assert.equal(compiles(), 4);
});

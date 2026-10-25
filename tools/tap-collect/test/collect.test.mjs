import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { options, patterns, parseLine, Lines, Store, MockSource, run, mockValues, instruction, format } from '../core.mjs';
const jsonl = f => fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
function setup(t, args = []) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'tap-test-'));
  t.after(() => fs.rmSync(out, {
    recursive: true,
    force: true
  }));
  return options(['--mock', '--out', out, '--table', '机', '--sensors', '四隅', '--seed', '42', ...args]);
}
class FakeClock {
  constructor() {
    this.intervals = new Set();
  }
  setInterval(fn) {
    this.intervals.add(fn);
    return fn;
  }
  clearInterval(fn) {
    this.intervals.delete(fn);
  }
  async sleep(ms) {
    for (let i = 0; i < ms; i += 10) for (const fn of this.intervals) fn();
  }
}
async function execute(store, { keys = [], abortAt } = {}) {
  const timer = new FakeClock();
  const source = new MockSource(store, timer);
  let checks = 0;
  const ui = {
    stopped: false,
    say() {},
    result() {},
    async note() { return '少しずれた'; },
    poll() { return keys.shift(); },
    progress() {
      if (++checks === abortAt) this.stopped = true;
    }
  };
  source.start();
  const complete = await run(store, { ui, source, clock: timer });
  source.stop();
  return complete;
}
test('起動行・stat・view・サンプル・壊れた行・CRLF・1〜3 バイト分割', () => {
  const text = '[desk] stream boot=1 ch=D0,D1,D3,D4 rate=4000\r\n[desk] fmt=1 boot=2 ch=D0,D1,D3,D4 rate=2000\n[stat] rate=3990 dropped=10\n[view] 基準1920\n0,4095,2000,2200\r\n4096,2,3,4\n12,3\nno\n';
  const expected = text.trimEnd().split('\n').map(parseLine);
  for (const size of [1, 2, 3, 10000]) {
    const result = [];
    const lines = new Lines(e => result.push(e));
    const bytes = Buffer.from(text);
    for (let i = 0; i < bytes.length; i += size) lines.push(bytes.subarray(i, i + size));
    assert.deepEqual(result, expected);
  }
  assert.equal(expected[0].rate, 4000);
  assert.equal(expected[1].rate, 2000);
  assert.equal(expected[2].dropped, 10);
  assert.deepEqual(expected[4].values, [0, 4095, 2000, 2200]);
  assert.equal(expected[5].type, 'bad_line');
  const result = [];
  const lines = new Lines(e => result.push(e));
  lines.push('x'.repeat(5000));
  lines.push('x\n1,2,3,4\npartial');
  lines.end();
  assert.deepEqual(result.map(e => e.type), ['bad_line', 'sample', 'bad_line']);
});

test('ワンコマンド起動は単一ポートを自動検出し、明示指定・mock・resumeを尊重する', async () => {
  const { resolvePort } = await import('../collect.mjs');
  assert.equal(options(['--quick']).quick, true);
  assert.equal(await resolvePort({}, async () => [{ path: 'COM5', manufacturer: 'Microsoft' }]), 'COM5');
  const unused = () => { throw Error('ポート一覧を呼んではいけません'); };
  assert.equal(await resolvePort({ port: 'COM7' }, unused), 'COM7');
  assert.equal(await resolvePort({ mock: true }, unused), undefined);
  assert.equal(await resolvePort({ resume: 'saved-session' }, unused), undefined);
  await assert.rejects(resolvePort({}, async () => []), /ESP32 を USB で接続/);
  await assert.rejects(resolvePort({}, async () => [{ path: 'COM5' }, { path: 'COM9' }]), /COM5, COM9.*npm start -- --port/);
});
test('既定21、no-extra17、後半は全8種を1回ずつ、固定seed、拡張・不正オプション', () => {
  const o = options(['--seed', '123']);
  const a = patterns(o);
  assert.equal(a.length, 21);
  assert.equal(a.filter(p => p.kind === 'tap').length, 8);
  assert.deepEqual(a.filter(p => p.kind === 'tap').map(p => p.label).sort(),
    ['lt', 'rt', 'lb', 'rb'].flatMap(z => [1, 2].map(c => `${z}_${c}`)).sort());
  assert.ok(a.every(p => !('strength' in p)));
  assert.ok(!('strengths' in o));
  assert.ok(a.filter(p => p.kind === 'tap').every(p => p.seconds === 5));
  assert.equal(patterns(options(['--reps', '3'])).length, 37);
  assert.equal(a[0].kind, 'calibration');
  assert.deepEqual(patterns(o), a);
  assert.notDeepEqual(patterns({
    ...o,
    seed: 124
  }), a);
  assert.equal(patterns({
    ...o,
    extra: false
  }).length, 17);
  assert.equal(patterns(options(['--counts', '1,2,3'])).find(p => p.count === 3).seconds, 6);
  for (const args of [['--reps', '0'], ['--window', 'NaN'], ['--prepare', '0.5'], ['--prepare', 'NaN'], ['--counts', '4'], ['--zones', 'lt,lt'], ['--order', 'bad'], ['--port'], ['--wat'], ['--strengths', 'weak,strong']]) assert.throws(() => options(args));
});
test('校正と使用の指示・記録形式・ヘルプに強さを含めない', async () => {
  const all = patterns(options([]));
  for (const p of all) assert.doesNotMatch(instruction(p), /弱|中|強|undefined/);
  for (const [key, zone] of Object.entries({ lt: '左上', rt: '右上', lb: '左下', rb: '右下' })) {
    assert.equal(instruction(all.find(p => p.kind === 'cal_single' && p.zone === key)), `${zone} を 1 回ずつ、間をあけて 3 回叩く`);
    assert.equal(instruction(all.find(p => p.kind === 'cal_double' && p.zone === key)), `${zone} をダブルタップ（トントンと素早く 2 回）× 2 セット。セットの間はあける`);
    assert.equal(instruction({ kind: 'tap', zone: key, count: 1 }), `${zone} を 1 回叩く`);
    assert.equal(instruction({ kind: 'tap', zone: key, count: 2 }), `${zone} をダブルタップ（トントンと素早く 2 回）`);
  }
  assert.doesNotMatch(format, /strength|weak|strong|強弱/);
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { fileURLToPath } = await import('node:url');
  const { stdout, stderr } = await promisify(execFile)(process.execPath,
    [fileURLToPath(new URL('../collect.mjs', import.meta.url)), '--help']);
  assert.equal(stderr, '');
  assert.doesNotMatch(stdout, /strength|weak|strong/);
});

test('モック全パターン、全ファイル、境界・ピーク・飽和・イベント', async t => {
  const store = new Store(setup(t, ['--reps', '1']));
  const dir = store.dir;
  assert.equal(await execute(store), true);
  store.close(true);
  for (const f of ['README.md', 'session.json', 'raw.csv', 'events.jsonl', 'trials.jsonl', 'trials']) assert.ok(fs.existsSync(path.join(dir, f)));
  const session = JSON.parse(fs.readFileSync(path.join(dir, 'session.json')));
  assert.equal(session.mock, true);
  assert.ok(session.endedAt);
  assert.equal(session.bootLines.length, 1);
  const raw = fs.readFileSync(path.join(dir, 'raw.csv'), 'utf8').trim().split('\n');
  const records = jsonl(path.join(dir, 'trials.jsonl'));
  assert.equal(records.length, 21);
  for (let i = 1; i < raw.length; i++) assert.equal(Number(raw[i].split(',')[0]), i - 1);
  const events = jsonl(path.join(dir, 'events.jsonl'));
  for (const r of records) {
    assert.equal(r.cue - r.from, 4000);
    assert.equal(r.to - r.cue, r.seconds * 4000);
    const cut = fs.readFileSync(path.join(dir, 'trials', `${String(r.n).padStart(3, '0')}_${r.label}.csv`), 'utf8').trim().split('\n');
    assert.deepEqual(cut.slice(1), raw.slice(r.from + 1, r.to + 1));
    assert.ok(r.baseline.every(v => v >= 1897 && v <= 2203));
    if (r.kind === 'tap') assert.equal(r.peak.indexOf(Math.max(...r.peak)), ['lt', 'rt', 'lb', 'rb'].indexOf(r.zone));
    for (const [type, i] of [['start', r.from], ['cue', r.cue], ['end', r.to]]) assert.ok(events.some(e => e.type === type && e.i === i));
  }
  assert.ok(records.filter(r => r.kind === 'tap').every(r => r.saturated.every(v => v === 0)));
});

test('指示待ちを変更しても合図前1秒を確保し、旧セッションは待ち1.5秒を維持する', async t => {
  for (const prepare of [1, 3, undefined]) {
    const store = new Store(setup(t));
    store.session.options.prepare = prepare;
    store.session.patterns = [store.session.patterns[0]];
    assert.equal(await execute(store), true);
    assert.equal(store.records[0].from, ((prepare ?? 1.5) - 1) * 4000);
    assert.equal(store.records[0].cue - store.records[0].from, 4000);
    store.close(true);
  }
});
test('直前の redo・メモ、記録中 redo・一時停止・resume', async t => {
  const store = new Store(setup(t, ['--reps', '1', '--zones', 'rt', '--counts', '2', '--no-extra']));
  const timer = new FakeClock();
  const source = new MockSource(store, timer);
  const queue = [];
  let result = 0;
  let paused = false;
  let redone = false;
  const ui = {
    stopped: false,
    say() {},
    poll() { return queue.shift(); },
    async note() { return '少しずれた'; },
    result() {
      if (++result === 1) queue.push('n', 'r');
      if (result === 2) queue.push('q');
    },
    progress(a) {
      if (a?.cue !== null && a?.kind === 'calibration' && !redone) {
        redone = true;
        queue.push('r');
      } else if (a?.cue !== null && a?.kind === 'calibration' && !paused) {
        paused = true;
        queue.push(' ', ' ');
      }
    }
  };
  source.start();
  assert.equal(await run(store, { ui, source, clock: timer }), false);
  source.stop();
  assert.deepEqual(store.records.map(r => r.status), ['redo', 'aborted', 'redo', 'ok']);
  assert.equal(store.records[2].note, '少しずれた');
  const dir = store.dir;
  const lastI = store.i;
  store.close();
  const resumed = new Store(options(['--resume', dir]));
  assert.equal(resumed.i, lastI);
  assert.equal(resumed.remaining().length, 3);
  assert.equal(await execute(resumed), true);
  resumed.close(true);
  assert.equal(jsonl(path.join(dir, 'events.jsonl')).filter(e => e.type === 'resume').length, 1);
});
test('記録途中停止 aborted と途中行の復旧', async t => {
  const store = new Store(setup(t, ['--no-extra', '--reps', '1', '--zones', 'lt', '--counts', '1']));
  const dir = store.dir;
  assert.equal(await execute(store, {
    abortAt: 25
  }), false);
  assert.equal(store.records[0].status, 'aborted');
  assert.ok(store.records[0].to > store.records[0].cue);
  const index = store.i;
  store.close();
  for (const f of ['raw.csv', 'trials.jsonl', 'events.jsonl']) fs.appendFileSync(path.join(dir, f), 'broken');
  const resumed = new Store(options(['--resume', dir]));
  assert.equal(resumed.i, index);
  assert.equal(resumed.remaining().length, 3);
  assert.equal(await execute(resumed), true);
  resumed.close(true);
  assert.deepEqual(jsonl(path.join(dir, 'trials.jsonl')).map(r => r.status), ['aborted', 'ok', 'ok', 'ok']);
});
test('中央値・飽和・不正行・dropped', t => {
  const store = new Store(setup(t));
  store.start(store.session.patterns[0]);
  for (const values of [[100, 200, 300, 400], [102, 202, 302, 402]]) store.receive({
    type: 'sample',
    values
  });
  store.cue();
  store.receive(parseLine('[stat] rate=4000 dropped=7'));
  store.receive(parseLine('bad'));
  store.receive(parseLine('0,4095,301,401'));
  const r = store.finish('ok');
  assert.deepEqual(r.baseline, [101, 201, 301, 401]);
  assert.deepEqual(r.peak, [101, 3894, 1, 1]);
  assert.deepEqual(r.saturated, [1, 1, 0, 0]);
  assert.equal(r.dropped, 7);
  assert.equal(r.badLines, 1);
  store.close();
});
test('mock の3回・extra波形とseed・試行IDによる再現性', () => {
  const p = {
    kind: 'tap',
    zone: 'lt',
    count: 3
  };
  const thirdHit = Array.from({ length: 1201 }, (_, k) => {
    const i = 2080 + k;
    return mockValues(p, i / 4000, i, 42)[0] - mockValues({ ...p, count: 2 }, i / 4000, i, 42)[0];
  });
  assert.ok(Math.max(...thirdHit) > 100);
  assert.deepEqual(mockValues({
    ...p,
    id: 2
  }, 0.12, 480, 42), mockValues({
    ...p,
    id: 2
  }, 0.12, 480, 42));
  assert.notDeepEqual(mockValues({
    ...p,
    id: 2
  }, 0.12, 480, 42), mockValues({
    ...p,
    id: 3
  }, 0.12, 480, 42));
  assert.notDeepEqual(mockValues({
    ...p,
    id: 2
  }, 0.12, 480, 42), mockValues({
    ...p,
    id: 2
  }, 0.12, 480, 43));
  for (const kind of ['typing', 'place', 'lean']) assert.notDeepEqual(mockValues({
    kind
  }, 0.01, 40), mockValues(null, 0.01, 40));
});
test('切断時 aborted、再接続後は同じ試行を撮り直す', async t => {
  const store = new Store(setup(t, ['--reps', '1', '--no-extra', '--zones', 'lt', '--counts', '1']));
  const timer = new FakeClock();
  const source = new MockSource(store, timer);
  let ticks = 0;
  let connected = true;
  const sleep = timer.sleep.bind(timer);
  timer.sleep = async ms => {
    await sleep(ms);
    ticks++;
    if (ticks === 25) {
      connected = false;
      store.event('disconnect');
    }
    if (ticks === 28) {
      connected = true;
      store.event('connect');
    }
  };
  const ui = {
    stopped: false,
    say() {},
    result() {},
    async key() {
      return 'enter';
    }
  };
  source.start();
  assert.equal(await run(store, {
    ui,
    source,
    clock: timer,
    connected: () => connected
  }), true);
  source.stop();
  assert.deepEqual(store.records.map(r => r.status), ['aborted', 'ok', 'ok', 'ok']);
  assert.equal(store.records[0].id, store.records[1].id);
  store.close(true);
});
test('シリアル接続ごとに stream のみ 1 回送り、切断後 1 秒で再接続', async t => {
  const {
    EventEmitter
  } = await import('node:events');
  const {
    SerialSource
  } = await import('../collect.mjs');
  const ports = [];
  const scheduled = [];
  class Port extends EventEmitter {
    constructor(opts) {
      super();
      this.opts = opts;
      this.writes = [];
      ports.push(this);
    }
    open(cb) {
      this.isOpen = true;
      cb();
    }
    write(data, cb) {
      this.writes.push(data);
      cb();
    }
    close() {
      this.isOpen = false;
      this.emit('close');
    }
  }
  const store = new Store(setup(t));
  store.session.port = 'COM5';
  const serial = new SerialSource(store, {
    say() {}
  }, {
    Port,
    timer: {
      setTimeout(fn, ms) {
        scheduled.push({
          fn,
          ms
        });
        return fn;
      },
      clearTimeout() {}
    }
  });
  serial.start();
  assert.equal(serial.connected, true);
  assert.equal(ports[0].opts.baudRate, 115200);
  assert.deepEqual(ports[0].writes, ['stream\n']);
  ports[0].emit('data', Buffer.from('1,2,3,4\r\n'));
  assert.equal(store.i, 1);
  ports[0].close();
  assert.equal(serial.connected, false);
  assert.equal(scheduled.at(-1).ms, 1000);
  scheduled.at(-1).fn();
  assert.equal(serial.connected, true);
  assert.deepEqual(ports[1].writes, ['stream\n']);
  serial.stop();
  assert.equal(scheduled.filter(task => task.ms === 1000).length, 1);
  store.close();
});
test('起動場所によらずツールの git コミットを保存する', t => {
  const o = setup(t);
  const previous = process.cwd();
  let store;
  try {
    process.chdir(os.tmpdir());
    store = new Store(o);
    assert.match(store.session.git, /^[0-9a-f]{40,64}$/);
  } finally {
    process.chdir(previous);
    store?.close();
  }
});
test('合図は1回だけ出し、進捗に重ねず、別の出力の前に行を消す', async () => {
  const {
    EventEmitter
  } = await import('node:events');
  const {
    Terminal
  } = await import('../collect.mjs');
  const input = new EventEmitter();
  input.resume = input.pause = () => {};
  let text = '';
  const ui = new Terminal(input, {
    isTTY: true,
    write(s) {
      text += s;
    }
  });
  try {
    const a = {
      kind: 'tap',
      cue: 2000,
      from: 0,
      values: Array(3000),
      seconds: 2.5
    };
    ui.say('叩いて');
    ui.progress(a, 2000);
    ui.progress(a, 2000);
    assert.match(text, /0\.5 \/ 2\.5 秒/);
    assert.equal(text.match(/叩いて/g).length, 1);
    ui.progress({
      ...a,
      kind: 'typing'
    }, 2000);
    assert.doesNotMatch(text, /キーボードを普通に打つ/);
    ui.say('切断');
    assert.ok(text.endsWith('\r\x1b[K切断\n'));
  } finally {
    ui.close();
  }
});
test('接続後 3 秒の無サンプル警告と、受信後の解除・試行開始', async t => {
  const {
    EventEmitter
  } = await import('node:events');
  const {
    SerialSource
  } = await import('../collect.mjs');
  for (const invalid of [null, 'level:123 tap:0', 'TL:1 TR:2 BL:3 BR:4']) {
    const store = new Store(setup(t, ['--no-extra']));
    const tasks = new Map();
    const warnings = [];
    class Port extends EventEmitter {
      open(cb) {
        this.isOpen = true;
        cb();
      }
      write(data, cb) {
        cb();
      }
      close() {
        this.isOpen = false;
        this.emit('close');
      }
    }
    const ui = {
      stopped: false,
      say() {},
      warning(message) {
        warnings.push(message);
      }
    };
    const source = new SerialSource(store, ui, {
      Port,
      timer: {
        setTimeout(fn, ms) {
          tasks.set(fn, ms);
          return fn;
        },
        clearTimeout(fn) {
          tasks.delete(fn);
        }
      }
    });
    source.start();
    if (invalid) source.port.emit('data', Buffer.from(invalid + '\n'));
    assert.equal(source.ready, false);
    assert.deepEqual(warnings, []);
    const timeout = [...tasks].find(([, ms]) => ms === 3000)[0];
    timeout();
    assert.equal(warnings[0], invalid ? `xiao-stream / deskapi-raw 以外のファームのようです: ${invalid}` : 'データが届きません（ポート・ケーブル・ファームを確認）');
    let sleeps = 0;
    let prompts = 0;
    ui.poll = () => {
      prompts++;
      if (source.ready) { ui.stopped = true; return 'q'; }
    };
    await run(store, {
      ui,
      source,
      ready: () => source.ready,
      connected: () => source.connected,
      clock: {
        async sleep() {
          
          if (++sleeps === 3) source.port.emit('data', Buffer.from('1,2,3,4\n'));
        }
      }
    });
    assert.ok(prompts >= 1);
    assert.equal(source.ready, true);
    assert.equal(warnings.at(-1), null);
    assert.equal(store.records.length, 0);
    source.stop();
    store.close();
  }
});

test('mock の試行ごとの振幅・ch 重み・間隔と再現性', () => {
  const intervals = new Set();
  const amplitudes = new Set();
  const ratios = new Set();
  for (let id = 1; id <= 20; id++) {
    const p = { id, kind: 'tap', zone: 'lt', count: 2 };
    const first = mockValues(p, 0.12, 480, 42);
    const baseline = mockValues(null, 0.12, 480, 42);
    const peak = first[0] - baseline[0];
    assert.ok(peak >= 350 * 0.8 * 0.85 - 1);
    assert.ok(peak <= 350 * 1.2 * 1.15 + 1);
    amplitudes.add(peak);
    ratios.add(((first[1] - baseline[1]) / peak).toFixed(2));
    let maximum = -Infinity;
    let second = 0;
    for (let i = 1200; i < 2000; i++) {
      const values = mockValues(p, i / 4000, i, 42);
      assert.deepEqual(values, mockValues(p, i / 4000, i, 42));
      const delta = values[0] - mockValues(null, i / 4000, i, 42)[0];
      if (delta > maximum) { maximum = delta; second = i / 4000; }
    }
    assert.ok(second - 0.12 >= 0.2 && second - 0.12 <= 0.35025);
    intervals.add(second);
  }
  assert.ok(amplitudes.size > 1);
  assert.ok(ratios.size > 1);
  assert.ok(intervals.size > 1);
});

test('既定の固定校正順と時間、準備2秒・打撃5秒で21試行137秒', async t => {
  const o = setup(t);
  const a = patterns(o);
  assert.equal(a.length, 21);
  assert.deepEqual(a.slice(0, 9), patterns({ ...o, seed: 99 }).slice(0, 9));
  assert.deepEqual(a.slice(1, 5).map(p => [p.zone, p.label, p.sets]),
    ['lt', 'rt', 'lb', 'rb'].map(z => [z, `cal_single_${z}`, 3]));
  assert.ok(a.slice(5, 9).every(p => p.kind === 'cal_double' && p.sets === 2));
  const seconds = a.reduce((sum, p) => sum + o.prepare + p.seconds, 0);
  assert.equal(seconds, 137);
  const store = new Store(o);
  assert.equal(await execute(store), true);
  assert.equal(store.i, seconds * 4000);
  assert.ok(store.records.filter(r => ['cal_single', 'cal_double'].includes(r.kind)).every(r => Number.isInteger(r.mountains)));
  assert.ok(store.records.filter(r => r.kind === 'calibration' || r.phase === 'use').every(r => r.mountains === null));
  store.close(true);
});

test('山は校正の打撃記録だけ静止ピークの 1.5 倍で数え、使用の部では数えない', async () => {
  const { countMountains } = await import('../core.mjs');
  const values = Array.from({ length: 2000 }, () => [100, 200, 300, 400]);
  for (const i of [1100, 1105, 1300, 1500]) values[i] = [110, 200, 300, 400];
  const trial = { values, cue: 1000, from: 0, phase: 'calibration', kind: 'cal_single' };
  // These peaks were below the old 3x threshold; ringing 5 ms later is the same wave.
  assert.equal(countMountains(trial, [4, 4, 4, 4], 1000), 3);
  assert.equal(countMountains(trial, [7, 7, 7, 7], 1000), 0);
  assert.equal(countMountains(trial, null, 1000), null);
  assert.equal(countMountains({ ...trial, cue: null }, [4, 4, 4, 4], 1000), null);
  for (const kind of ['cal_single', 'cal_double']) {
    assert.equal(countMountains({ ...trial, kind }, [4, 4, 4, 4], 1000), 3);
    assert.equal(countMountains({ ...trial, kind, phase: undefined }, [4, 4, 4, 4], 1000), 3);
    assert.equal(countMountains({ ...trial, kind, phase: 'use' }, [4, 4, 4, 4], 1000), null);
  }
  assert.equal(countMountains({ ...trial, kind: 'calibration' }, [4, 4, 4, 4], 1000), null);
  for (const kind of ['tap', 'rest', 'typing', 'place', 'lean']) {
    assert.equal(countMountains({ ...trial, kind, phase: 'use' }, [4, 4, 4, 4], 1000), null);
  }
  values[1100] = values[1105] = values[1300] = values[1500] = [106, 200, 300, 400];
  assert.equal(countMountains(trial, [4, 4, 4, 4], 1000), 0);
  const subset = patterns(options(['--zones', 'rb,lt', '--counts', '3']));
  assert.deepEqual(subset.filter(p => p.kind === 'cal_single').map(p => p.zone), ['lt', 'rb']);
  assert.ok(!subset.some(p => p.kind === 'cal_double'));
});

test('校正の打撃記録では山0も表示し、静止の測定と使用の部では山を表示しない', async () => {
  const { EventEmitter } = await import('node:events');
  const { Terminal } = await import('../collect.mjs');
  const input = new EventEmitter();
  input.resume = input.pause = () => {};
  let output = '';
  const ui = new Terminal(input, { write(s) { output += s; } });
  const result = { values: [[100, 200, 300, 400]], cue: 1, from: 0, dropped: 0, badLines: 0 };
  try {
    ui.result({ ...result, mountains: null });
    assert.doesNotMatch(output, /山/);
    assert.match(output, /D0 0.*D1 0.*D3 0.*D4 0.*欠け 0.*不正行 0/);
    output = '';
    ui.result({ ...result, mountains: 0 });
    assert.match(output, /山 0/);
  } finally {
    ui.close();
  }
});

test('typing 記録中は入力を保存も操作もせず、終了後は操作が戻る', async t => {
  const { EventEmitter } = await import('node:events');
  const { Terminal } = await import('../collect.mjs');
  const store = new Store(setup(t));
  store.session.patterns = store.session.patterns.filter(p => p.kind === 'typing');
  const input = new EventEmitter();
  input.resume = input.pause = () => {};
  let output = '';
  const ui = new Terminal(input, { write(s) { output += s; } });
  const timer = new FakeClock();
  const source = new MockSource(store, timer);
  const sleep = timer.sleep.bind(timer);
  let beforeCue = 0;
  let afterCue = 0;
  timer.sleep = async ms => {
    if (store.active) {
      if (store.active.cue === null) beforeCue++;
      else afterCue++;
      // Several keys per poll must not leak into later trials.
      for (const str of ['q', 'r', ' ', 'n', '秘密', '\r', '\u001b[A'])
        input.emit('keypress', str, { name: str === '\r' ? 'return' : str });
    }
    await sleep(ms);
  };
  let results = 0;
  ui.result = () => {
    if (++results === 1) input.emit('keypress', 'r', { name: 'r' });
  };
  source.start();
  try {
    assert.equal(await run(store, { ui, source, clock: timer }), true);
    assert.equal(ui.stopped, false);
    assert.ok(beforeCue > 0 && afterCue > 0);
    assert.deepEqual(store.records.map(r => r.status), ['redo', 'ok']);
    assert.equal(ui.poll(), undefined);
    assert.match(output, /キーボードを普通に打つ（このウィンドウで打って大丈夫）/);
    store.flush();
    const events = jsonl(path.join(store.dir, 'events.jsonl'));
    assert.deepEqual(events.filter(e => e.type === 'key').map(e => e.key), ['r']);
    assert.ok(!fs.readFileSync(path.join(store.dir, 'events.jsonl'), 'utf8').includes('秘密'));
    for (const str of ['n', ' ', 'r']) input.emit('keypress', str, { name: str });
    assert.deepEqual([ui.poll(), ui.poll(), ui.poll()], ['n', ' ', 'r']);
    input.emit('keypress', 'q', { name: 'q' });
    assert.equal(ui.stopped, true);
  } finally {
    source.stop();
    ui.close();
    store.close();
  }
});

test('typing 記録中も Ctrl+C で中断して保存する', async t => {
  const { EventEmitter } = await import('node:events');
  const { Terminal } = await import('../collect.mjs');
  const store = new Store(setup(t));
  store.session.patterns = store.session.patterns.filter(p => p.kind === 'typing');
  const input = new EventEmitter();
  input.resume = input.pause = () => {};
  const ui = new Terminal(input, { write() {} });
  const timer = new FakeClock();
  const source = new MockSource(store, timer);
  const sleep = timer.sleep.bind(timer);
  timer.sleep = async ms => {
    await sleep(ms);
    if (store.active?.cue != null) input.emit('keypress', '\u0003', { name: 'c', ctrl: true });
  };
  source.start();
  try {
    assert.equal(await run(store, { ui, source, clock: timer }), false);
    assert.equal(ui.stopped, true);
    assert.deepEqual(store.records.map(r => r.status), ['aborted']);
    store.flush();
    assert.equal(jsonl(path.join(store.dir, 'events.jsonl')).filter(e => e.type === 'key').length, 0);
    assert.equal(store.remaining().length, 1);
  } finally {
    source.stop();
    ui.close();
    store.close();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assign, summarize, makeFolds, labels } from '../scoring.mjs';
import { score } from '../score.mjs';
import { fixture } from '../test-support/mock-session.mjs';
test('割り当て、境界、redo、成分一致、余計と試行外', () => {
  const trial = (id, kind, from, status = 'ok') => ({
    id,
    n: id,
    kind,
    from,
    cue: from,
    to: from + 10,
    status,
    zone: 'lt',
    count: 1,
    strength: 'weak'
  });
  const session = {
    dir: 'synthetic',
    meta: {
      rate: 10
    },
    trials: [
      trial(1, 'tap', 10),
      trial(2, 'tap', 30),
      trial(3, 'tap', 50),
      trial(4, 'typing', 70),
      trial(5, 'tap', 90, 'redo'),
      trial(6, 'rest', 110)
    ]
  };
  const tap = (i, extra = {}) => ({
    i,
    zone: 'lt',
    count: 1,
    strength: 'weak',
    ...extra
  });
  const m = summarize([assign(session, [tap(10), tap(30), tap(31), tap(70), tap(90), tap(95), tap(0), tap(125)], undefined, 140)]);
  assert.deepEqual(m.exact, {
    correct: 1,
    total: 3,
    rate: 1 / 3
  });
  assert.equal(m.detection.correct, 2);
  assert.equal(m.extra, 1);
  for (const k of ['zone', 'count']) assert.equal(m[k].rate, 1);
  assert.equal(m.outside.count, 2);
  assert.equal(m.nonTap.typing, 1);
  assert.equal(m.confusion.lt_1.none, 1);
  assert.equal(m.confusion.lt_1.multiple, 1);
  assert.equal(labels.length, 8);
  assert.deepEqual(Object.keys(m.confusion), labels);
  assert.ok(Object.values(m.confusion).every(row => Object.keys(row).length === 10));
  assert.equal(m.outside.seconds, 5);
  const partial = summarize([assign(session, [tap(10, {
    strength: 'strong'
  })], undefined, 140)]);
  assert.equal(partial.exact.correct, 1);
  assert.equal(partial.confusion.lt_1.lt_1, 1);
  assert.ok(!('withoutStrength' in partial));
  assert.ok(!('strength' in partial));
});
let shared;
function setup() {
  if (!shared) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tap-score-test-'));
    shared = {
      root,
      dir: fixture(root)
    };
  }
  return shared;
}
test.after(() => {
  if (shared) fs.rmSync(shared.root, {
    recursive: true,
    force: true
  });
});
test('phase で学習・採点を分離、旧形式と旧オプションを拒否', () => {
  const { dir, root } = setup();
  assert.throws(() => makeFolds({ cv: [dir] }), /廃止/);
  assert.throws(() => makeFolds({ session: [dir], test: [dir] }), /併用/);
  const folds = makeFolds({ session: [dir, dir] });
  assert.equal(folds.length, 2);
  for (const fold of folds) {
    assert.equal(fold.train[0].trials.filter(fold.training).length, 9);
    assert.equal(fold.test[0].trials.filter(fold.testing).length, 12);
    assert.ok(fold.train[0].trials.every(t => !(fold.training(t) && fold.testing(t))));
  }
  assert.equal(makeFolds({ calibrate: [dir], test: [dir] }).length, 1);
  const legacy = path.join(root, 'legacy');
  fs.mkdirSync(legacy);
  fs.copyFileSync(path.join(dir, 'session.json'), path.join(legacy, 'session.json'));
  fs.writeFileSync(path.join(legacy, 'trials.jsonl'), JSON.stringify({ id: 0, kind: 'calibration', status: 'ok' }) + '\n');
  assert.throws(() => makeFolds({ session: [legacy] }), /キャリブレーションの部がありません/);
});
for (const detector of ['app', 'takker']) test(`${detector}: ${detector === 'app' ? '既定 mockValues の 2 部構成' : '外部検出器用の旧ログ形式'}`, {
  skip: detector === 'takker' && !process.env.TAKKER_RUNTIME ? 'TAKKER_RUNTIME 未指定のため skip' : false
}, async () => {
  const {
    root,
    dir
  } = setup();
  const result = await score({
    detector,
    session: [detector === 'takker' ? fixture(root, { legacy: true }) : dir],
    takker: process.env.TAKKER_RUNTIME,
    out: path.join(root, detector)
  });
  assert.ok(result.report.metrics.exact.rate > 0, JSON.stringify(result.report.training.map(t => t.error)));
  assert.ok(result.report.training.every(t => !t.error));
  assert.equal(result.report.metrics.exact.total, detector === 'takker' ? 16 : 8);
  assert.doesNotMatch(fs.readFileSync(path.join(result.out, 'score.md'), 'utf8'), /withoutStrength|strongMin|強さ|強弱/);
  for (const f of ['score.md', 'score.json', 'predictions.jsonl']) assert.ok(fs.statSync(path.join(result.out, f)).size > 0);
});

test('診断の検出数・飽和・2 回叩き間隔と打数不足の警告', async () => {
  const { diagnose, diagnosticTable } = await import('../diagnostics.mjs');
  const trial = (n, kind, cue, strength) => ({
    n, label: kind, kind, cue, to: cue + 5000,
    zone: 'lt', strength, selected: true
  });
  const session = {
    dir: 'diagnostic', meta: { rate: 1000 },
    trials: [trial(1, 'cal_single', 0, 'weak'),
      trial(2, 'cal_single', 6000, 'strong'), trial(3, 'cal_double', 12000, null)]
  };
  const hits = [[400, 100], [1800, 200], [3200, 300],
    [6400, 250], [7800, 400], [9200, 500],
    [12400, 200], [12650, 200], [14600, 200], [15100, 200]]
    .map(([i, amplitude]) => ({ session: session.dir, i, amplitude }));
  hits[5].saturated = true;
  const d = diagnose([session], hits, 420, { threshold: 123 });
  assert.deepEqual(d.intervals.map(r => [r.detected, r.expected, r.saturated]),
    [[3, 3, 0], [3, 3, 1], [4, 4, 0]]);
  assert.ok(!('ranges' in d));
  assert.deepEqual(d.double, { min: 250, mean: 375, max: 500, waitMs: 420, warning: true });
  assert.doesNotMatch(diagnosticTable(d).join('\n'), /強弱|振幅/);
  const missing = diagnose([session], hits.slice(1), 420, {});
  assert.equal(missing.intervals[0].warning, true);
  assert.match(diagnosticTable(missing).join('\n'), /2 \/ 3 ⚠/);
});

test('app: 150未満の弱い打撃も静止ピークの1.5倍で抽出して校正できる', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tap-score-quiet-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = fixture(root, { gain: 0.1 });
  const result = await score({ detector: 'app', session: [dir], out: path.join(root, 'score') });
  assert.equal(result.report.training[0].error, null);
  const model = result.report.training[0].model;
  assert.ok(model.hits.every(hits => hits.length === 3));
  assert.ok(model.hits.flat().every(hit => Math.max(...hit.peaks) < 150));
  assert.ok(model.calibrationThresholds.every(t => t.threshold.every((v, ch) => v === t.peak[ch] * 1.5)));
  assert.ok(result.report.metrics.exact.rate > 0);
});

test('app: 旧ログの校正・使用ラベルを8キーとして最後まで採点する', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tap-score-legacy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = fixture(root, { legacy: true });
  const fold = makeFolds({ session: [dir] })[0];
  const singles = fold.train[0].trials.filter(t => fold.training(t) && t.kind === 'cal_single');
  assert.equal(singles.length, 8);
  assert.ok(singles.every(t => t.label === `cal_single_${t.zone}_${t.strength}`));
  const result = await score({ detector: 'app', session: [dir], out: path.join(root, 'score') });
  const { metrics, training } = result.report;
  assert.equal(training[0].error, null);
  assert.equal(training[0].model.hits.length, 4);
  assert.ok(training[0].model.hits.every(h => h.length === 3));
  assert.equal(metrics.exact.total, 16);
  assert.ok(metrics.exact.correct > 0);
  const predictions = fs.readFileSync(path.join(result.out, 'predictions.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(predictions.some(r => /_weak$/.test(r.truth.label) && r.taps.length === 1));
  assert.ok(predictions.some(r => /_strong$/.test(r.truth.label) && r.taps.length === 1));
  assert.deepEqual(Object.keys(metrics.confusion), labels);
  assert.equal(Object.values(metrics.confusion).flatMap(Object.values).reduce((a, b) => a + b, 0), 16);
  assert.ok(!('strength' in metrics));
  assert.doesNotMatch(fs.readFileSync(path.join(result.out, 'score.md'), 'utf8'), /強さ|強弱|withoutStrength|strongMin/);
});

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

export const zones = ['lt', 'rt', 'lb', 'rb'];

export const labels = zones.flatMap(z => [1, 2].map(c => `${z}_${c}`));

export const label = t => `${t.zone}_${t.count}`;

export function loadSession(dir) {
  dir = fs.realpathSync(dir);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'session.json')));
  if (!(meta.rate > 0)) throw Error(`${dir}: rate が不正です`);
  const records = fs.readFileSync(path.join(dir, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  const trials = [...new Map(records.map(t => [t.n ?? t.id, t])).values()];
  const last = new Map(trials.filter(t => t.status === 'ok').map(t => [t.id, t]));
  return {
    dir,
    meta,
    trials: trials.map(t => ({
      ...t,
      selected: last.get(t.id) === t
    }))
  };
}

export async function* samples(session) {
  const input = fs.createReadStream(path.join(session.dir, 'raw.csv'));
  const lines = readline.createInterface({
    input,
    crlfDelay: Infinity
  });
  let previous = -1;
  try {
    for await (const line of lines) {
      if (line === 'i,d0,d1,d3,d4') continue;
      const [i, ...values] = line.split(',').map(Number);
      if (!Number.isSafeInteger(i) || i <= previous || values.length !== 4 || values.some(v => !Number.isInteger(v) || v < 0 || v > 4095)) throw Error(`${session.dir}: raw.csv が不正です`);
      previous = i;
      yield {
        i,
        values
      };
    }
  } finally {
    lines.close();
    input.destroy();
  }
}

export function makeFolds(o) {
  const read = dirs => dirs.map(loadSession);
  if (o.cv || o.train) throw Error('--cv / --train は廃止されました。--session または --calibrate / --test を使ってください');
  const training = t => t.selected && t.phase === 'calibration';
  const testing = t => t.selected && t.phase === 'use';
  const validate = session => {
    if (!session.trials.some(t => training(t) && t.kind === 'cal_single')) {
      throw Error(`${session.dir}: キャリブレーションの部がありません。2 部構成で記録し直してください`);
    }
    return session;
  };
  if (o.session) {
    if (o.calibrate || o.test) throw Error('--session と --calibrate / --test は併用できません');
    return read(o.session).map(validate).map(s => ({ train: [s], test: [s], training, testing }));
  }
  if (!o.calibrate?.length || !o.test?.length || o.calibrate.length !== 1) throw Error('--session または --calibrate <dir> --test <dir>… が必要です');
  return [{ train: read(o.calibrate).map(validate), test: read(o.test).map(validate), training, testing }];
}

export const contains = (t, i, rate) => i >= (t.cue ?? t.from) && i < t.to + rate * .5;

export function assign(session, taps, testing = t => t.selected ?? t.status === 'ok', totalSamples = 0) {
  const rows = session.trials.filter(t => testing(t) && t.status === 'ok' && !['calibration', 'cal_single', 'cal_double'].includes(t.kind)).map(truth => ({
    session: session.dir,
    truth,
    taps: []
  }));
  const outside = [];
  for (const tap of taps) {
    if (session.trials.some(t => t.status !== 'ok' && tap.i >= t.from && tap.i < t.to + session.meta.rate * .5)) continue;
    // An actual trial window wins over the preceding trial's half-second tail.
    const owner = session.trials.find(t => tap.i >= (t.cue ?? t.from) && tap.i < t.to) ?? session.trials.find(t => contains(t, tap.i, session.meta.rate));
    if (owner) {
      const row = rows.find(r => r.truth === owner);
      if (row) row.taps.push(tap);
    } else outside.push(tap);
  }
  const intervals = session.trials.map(t => [Math.max(0, t.status !== 'ok' ? t.from : t.cue ?? t.from), Math.min(totalSamples, t.to + session.meta.rate * .5)]).sort((a, b) => a[0] - b[0]);
  let covered = 0,
    end = 0;
  for (const [a, b] of intervals) {
    covered += Math.max(0, b - Math.max(a, end));
    end = Math.max(end, b);
  }
  return {
    rows,
    outside,
    outsideSeconds: Math.max(0, totalSamples - covered) / session.meta.rate
  };
}

export function summarize(results) {
  const rows = results.flatMap(r => r.rows),
    tapRows = rows.filter(r => r.truth.kind === 'tap');
  const single = tapRows.filter(r => r.taps.length === 1);
  const rate = (n, d) => ({
    correct: n,
    total: d,
    rate: d ? n / d : 0
  });
  const matrix = Object.fromEntries(labels.map(l => [l, Object.fromEntries([...labels, 'none', 'multiple'].map(k => [k, 0]))]));
  for (const r of tapRows) {
    const prediction = r.taps.length === 0 ? 'none' : r.taps.length > 1 ? 'multiple' : label(r.taps[0]);
    if (matrix[label(r.truth)] && prediction in matrix[label(r.truth)]) matrix[label(r.truth)][prediction]++;
  }
  const nonTap = Object.fromEntries(['rest', 'typing', 'place', 'lean'].map(k => [k, rows.filter(r => r.truth.kind === k).reduce((n, r) => n + r.taps.length, 0)]));
  const outside = results.reduce((n, r) => n + r.outside.length, 0),
    outsideSeconds = results.reduce((n, r) => n + r.outsideSeconds, 0);
  return {
    detection: rate(tapRows.filter(r => r.taps.length).length, tapRows.length),
    exact: rate(single.filter(r => label(r.truth) === label(r.taps[0])).length, tapRows.length),
    ...Object.fromEntries(['zone', 'count'].map(k => [k, rate(single.filter(r => r.truth[k] === r.taps[0][k]).length, single.length)])),
    extra: tapRows.filter(r => r.taps.length > 1).length,
    nonTap,
    outside: {
      count: outside,
      seconds: outsideSeconds,
      perMinute: outsideSeconds ? outside * 60 / outsideSeconds : null
    },
    confusion: matrix
  };
}

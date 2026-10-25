import { diagnosticTable } from './diagnostics.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeFolds, assign, summarize, samples, labels } from './scoring.mjs';

export function options(args) {
  const o = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i].slice(2);
    if (!args[i].startsWith('--') || !['detector', 'calibrate', 'test', 'session', 'takker', 'channels', 'params', 'out'].includes(key)) throw Error(`不明なオプション: ${args[i]}`);
    if (['calibrate', 'test', 'session'].includes(key)) {
      const dirs = [];
      while (args[i + 1] && !args[i + 1].startsWith('--')) dirs.push(args[++i]);
      if (!dirs.length) throw Error(`${key} の値がありません`);
      o[key] = [...(o[key] ?? []), ...dirs];
    } else {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error(`${key} の値がありません`);
      o[key] = args[++i];
    }
  }
  if (!['app', 'takker'].includes(o.detector)) throw Error('--detector app|takker が必要です');
  return o;
}

export async function score(o) {
  const folds = makeFolds(o);
  const params = o.params ? JSON.parse(fs.readFileSync(o.params, 'utf8')) : {};
  if (!params || Array.isArray(params) || typeof params !== 'object') throw Error('params は JSON オブジェクトです');
  const adapter = await (await import(`./detectors/${o.detector}.mjs`)).create(o);
  const results = [],
    training = [];
  try {
    for (const fold of folds) {
      let model, error, diagnostics;
      try {
        model = await adapter.train(fold.train, fold.training, params);
      } catch (e) {
        error = `${e.name}: ${e.message}`;
        diagnostics = e.diagnostics;
      }
      training.push({
        rep: fold.rep,
        train: fold.train.map(s => ({
          dir: s.dir,
          trials: s.trials.filter(fold.training).map(t => t.n)
        })),
        test: fold.test.map(s => ({
          dir: s.dir,
          trials: s.trials.filter(t => fold.testing(t) && t.kind !== 'calibration').map(t => t.n)
        })),
        diagnostics: model?.diagnostics ?? diagnostics ?? null,
        model: model ?? null,
        error: error ?? null
      });
      for (const session of fold.test) {
        let replay;
        if (model) replay = await adapter.replay(session, model);
        else {
          let totalSamples = 0;
          for await (const {
            i
          } of samples(session)) totalSamples = i + 1;
          replay = {
            taps: [],
            totalSamples
          };
        }
        const result = assign(session, replay.taps, fold.testing, replay.totalSamples);
        for (const row of result.rows) Object.assign(row, {
          rep: fold.rep,
          trainingError: error ?? null
        });
        result.rep = fold.rep;
        result.session = session.dir;
        results.push(result);
      }
    }
    const metrics = summarize(results);
    const report = {
      detector: o.detector,
      version: adapter.version,
      timing: adapter.timing,
      params,
      mode: o.session ? 'session' : 'holdout',
      warning: null,
      synthetic: folds.some(f => [...f.train, ...f.test].some(s => s.meta.mock)),
      metrics,
      training,
      outside: results.map(r => ({
        session: r.session,
        rep: r.rep,
        taps: r.outside,
        seconds: r.outsideSeconds
      }))
    };
    const falsePositives = Object.values(metrics.nonTap).reduce((a, b) => a + b, 0);
    const first = `完全一致 ${(metrics.exact.rate * 100).toFixed(1)}%（${metrics.exact.total} 試行）、叩き以外の誤検出 ${falsePositives} 回`;
    const md = [
      first,
      '',
      report.warning ?? '',
      report.synthetic ? '合成データ（mock）の点数です。実機の性能を表しません。' : '',
      adapter.timing,
      '',
      ...training.flatMap(t => t.diagnostics ? diagnosticTable(t.diagnostics) : ['キャリブレーション失敗: ' + t.error, '']),
      '| 指標 | 正解 / 分母 | 割合 |',
      '|---|---:|---:|',
      ...['detection', 'exact', 'withoutStrength', 'zone', 'count', 'strength'].map(k => `| ${{
        detection: '検出',
        exact: '完全一致',
        withoutStrength: '強さを無視した一致',
        zone: '領域',
        count: '回数',
        strength: '強さ'
      }[k]} | ${metrics[k].correct} / ${metrics[k].total} | ${(metrics[k].rate * 100).toFixed(1)}% |`),
      `| 余計 | ${metrics.extra} | |`,
      '',
      '| 種類 | 誤検出 |',
      '|---|---:|',
      ...Object.entries(metrics.nonTap).map(([k, v]) => `| ${k} | ${v} |`),
      `| 試行外 | ${metrics.outside.count} |`,
      `試行外 ${metrics.outside.seconds.toFixed(3)} 秒、1 分あたり ${metrics.outside.perMinute ?? '算出不可'} 回`,
      '',
      '混同行列（行が正解）',
      '',
      `| 正解 | ${[...labels, 'none', 'multiple'].join(' | ')} |`,
      `|---|${[...labels, 'none', 'multiple'].map(() => '---:').join('|')}|`,
      ...Object.entries(metrics.confusion).map(([k, row]) => `| ${k} | ${Object.values(row).join(' | ')} |`),
      '',
      '検出器の版・セッション・設定・キャリブレーションの値・失敗理由',
      '',
      '```json',
      JSON.stringify({
        version: report.version,
        params,
        training
      }, null, 2),
      '```',
      ''
    ].join('\n');
    const out = path.resolve(o.out ?? path.join('scores', `${new Date().toISOString().replace(/[:.]/g, '-')}_${o.detector}`));
    fs.mkdirSync(out, {
      recursive: true
    });
    fs.writeFileSync(path.join(out, 'score.json'), JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(path.join(out, 'score.md'), md);
    fs.writeFileSync(path.join(out, 'predictions.jsonl'), results.flatMap(r => r.rows).map(r => JSON.stringify(r)).join('\n') + '\n');
    return {
      out,
      first,
      report
    };
  } finally {
    adapter.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await score(options(process.argv.slice(2)));
    console.log(result.first + '\n' + result.out);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}

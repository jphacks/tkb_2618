import { zones } from './scoring.mjs';

export function diagnose(sessions, hits, waitMs, result) {
  const intervals = [];
  const ranges = [];
  const doubles = [];
  for (const session of sessions) {
    for (const trial of session.trials.filter(t => t.selected && ['cal_single', 'cal_double'].includes(t.kind))) {
      const found = hits.filter(h => h.session === session.dir && h.i >= trial.cue && h.i < trial.to);
      const expected = trial.kind === 'cal_single' ? 3 : 4;
      intervals.push({
        session: session.dir,
        label: trial.label,
        n: trial.n,
        detected: found.length,
        expected,
        warning: found.length !== expected,
        saturated: found.filter(h => h.saturated).length
      });
      if (trial.kind === 'cal_double') {
        for (let i = 0; i + 1 < found.length; i += 2) {
          doubles.push((found[i + 1].i - found[i].i) * 1000 / session.meta.rate);
        }
      }
    }
    for (const zone of zones) {
      const range = strength => {
        const trials = session.trials.filter(t => t.selected && t.kind === 'cal_single' && t.zone === zone && t.strength === strength);
        const amplitudes = hits.filter(h => h.session === session.dir && !h.saturated && trials.some(t => h.i >= t.cue && h.i < t.to)).slice(0, 3).map(h => h.amplitude);
        return amplitudes.length ? [Math.min(...amplitudes), Math.max(...amplitudes)] : null;
      };
      const weak = range('weak');
      const strong = range('strong');
      ranges.push({
        session: session.dir,
        zone,
        weak,
        strong,
        overlap: !!(weak && strong && weak[1] >= strong[0] && strong[1] >= weak[0])
      });
    }
  }
  return {
    intervals,
    ranges,
    result,
    double: {
      min: doubles.length ? Math.min(...doubles) : null,
      mean: doubles.length ? doubles.reduce((a, b) => a + b, 0) / doubles.length : null,
      max: doubles.length ? Math.max(...doubles) : null,
      waitMs,
      warning: doubles.some(d => d > waitMs)
    }
  };
}

export function diagnosticTable(d) {
  return [
    '| キャリブレーションの診断 | 結果 |',
    '|---|---|',
    ...d.intervals.map(r => `| ${r.session} #${r.n} ${r.label} | ${r.detected} / ${r.expected}${r.warning ? ' ⚠' : ''}、飽和 ${r.saturated} |`),
    ...d.ranges.map(r => `| ${r.zone} 強弱の振幅 | 弱 ${r.weak?.join('〜') ?? 'なし'} / 強 ${r.strong?.join('〜') ?? 'なし'}${r.overlap ? ' ⚠ 重なり' : ''} |`),
    `| 2 回叩きの間隔（最小 / 平均 / 最大 ms） | ${d.double.min} / ${d.double.mean} / ${d.double.max}、待ち時間 ${d.double.waitMs}${d.double.warning ? ' ⚠' : ''} |`,
    `| キャリブレーションの結果 | ${JSON.stringify(d.result)} |`,
    ''
  ];
}

export function diagnose(sessions, hits, waitMs, result) {
  const intervals = [];
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
  }
  return {
    intervals,
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
    `| 2 回叩きの間隔（最小 / 平均 / 最大 ms） | ${d.double.min} / ${d.double.mean} / ${d.double.max}、待ち時間 ${d.double.waitMs}${d.double.warning ? ' ⚠' : ''} |`,
    `| キャリブレーションの結果 | ${JSON.stringify(d.result)} |`,
    ''
  ];
}

import { Store, options, mockValues } from '../core.mjs';

// Same patterns and recording windows as the default collect --mock, without
// waiting for wall-clock time or requiring terminal input.
export function fixture(out, { gain = 1, legacy = false } = {}) {
  const store = new Store(options(['--mock', '--out', out, '--seed', '42']));
  if (legacy) {
    store.session.options.strengths = ['weak', 'strong'];
    store.session.patterns = store.session.patterns.flatMap(p => ['cal_single', 'tap'].includes(p.kind)
      ? ['weak', 'strong'].map(strength => ({ ...p, strength, label: `${p.label}_${strength}` }))
      : [{ ...p, strength: null }]).map((p, id) => ({ ...p, id }));
  }
  const add = (p, seconds, length) => {
    for (let k = 0; k < length; k++) {
      const time = seconds + k / 4000;
      let values = mockValues(p, time, store.i, 42);
      const scale = gain * (legacy && p?.strength === 'strong' ? 2 : 1);
      if (scale !== 1) {
        const noise = mockValues(null, time, store.i, 42);
        values = values.map((v, ch) => Math.max(0, Math.min(4095, Math.round(noise[ch] + (v - noise[ch]) * scale))));
      }
      store.receive({ type: 'sample', values });
    }
  };
  for (const p of store.session.patterns) {
    add(null, -1, (store.session.options.prepare - 1) * 4000);
    store.start(p);
    add(null, -1, 4000);
    store.cue();
    add(p, 0, p.seconds * 4000);
    store.finish('ok');
  }
  add(null, -1, 4000);
  store.close(true);
  return store.dir;
}

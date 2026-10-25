import { Store, options, mockValues } from '../core.mjs';

// Same patterns and recording windows as the default collect --mock, without
// waiting for wall-clock time or requiring terminal input.
export function fixture(out) {
  const store = new Store(options(['--mock', '--out', out, '--seed', '42']));
  const add = (p, seconds, length) => {
    for (let k = 0; k < length; k++) {
      store.receive({
        type: 'sample',
        values: mockValues(p, seconds + k / 4000, store.i, 42)
      });
    }
  };
  for (const p of store.session.patterns) {
    add(null, -1, 2000);
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

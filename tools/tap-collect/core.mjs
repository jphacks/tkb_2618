import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
export const channels = ['D0 左上', 'D1 右上', 'D3 左下', 'D4 右下'];
export const defaults = {
  reps: 3,
  zones: ['lt', 'rt', 'lb', 'rb'],
  counts: [1, 2],
  strengths: ['weak', 'strong'],
  extra: true,
  order: 'shuffle',
  window: 2,
  out: 'tap-logs',
  mock: false
};
export function options(args) {
  const o = structuredClone(defaults);
  const flags = {
    '--mock': 'mock',
    '--list': 'list',
    '--help': 'help'
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (flags[a]) {
      o[flags[a]] = true;
      continue;
    }
    if (a === '--no-extra') {
      o.extra = false;
      continue;
    }
    const key = a.slice(2);
    if (!['port', 'reps', 'zones', 'counts', 'strengths', 'order', 'seed', 'window', 'table', 'sensors', 'out', 'resume'].includes(key) || !a.startsWith('--') || args[i + 1] === undefined || args[i + 1].startsWith('--')) throw Error(`不明なオプションまたは値なし: ${a}`);
    o[key] = args[++i];
  }
  for (const key of ['reps', 'window', 'seed']) if (o[key] !== undefined) o[key] = Number(o[key]);
  if (!Number.isInteger(o.reps) || o.reps < 1 || !Number.isFinite(o.window) || o.window <= 0 || o.seed !== undefined && !Number.isSafeInteger(o.seed)) throw Error('reps は正の整数、window は正の秒数、seed は整数です');
  for (const [key, allowed] of [['zones', ['lt', 'rt', 'lb', 'rb']], ['counts', [1, 2, 3]], ['strengths', ['weak', 'medium', 'strong']]]) {
    if (typeof o[key] === 'string') o[key] = o[key].split(',').map(v => key === 'counts' ? Number(v) : v);
    if (!o[key].length || new Set(o[key]).size !== o[key].length || o[key].some(v => !allowed.includes(v))) throw Error(`${key} の値が不正です`);
  }
  if (!['shuffle', 'sequential'].includes(o.order)) throw Error('order は shuffle / sequential です');
  return o;
}
export function random(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export function patterns(o) {
  const trials = [];
  const add = (kind, zone, count, strength, rep, seconds) => trials.push({
    id: trials.length + 1,
    kind,
    phase: 'use',
    zone,
    count,
    strength,
    rep,
    seconds,
    label: kind === 'tap' ? `${zone}_${count}_${strength}` : kind
  });
  for (const z of o.zones) for (const c of o.counts) for (const s of o.strengths) for (let r = 1; r <= o.reps; r++) add('tap', z, c, s, r, o.window + (c === 3 ? 1 : 0));
  if (o.extra) for (const [k, s] of [['rest', 3], ['typing', 3], ['place', 3], ['lean', 3]]) for (let r = 1; r <= 1; r++) add(k, null, null, null, r, s);
  if (o.order === 'shuffle') {
    const rng = random(o.seed);
    for (let i = trials.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [trials[i], trials[j]] = [trials[j], trials[i]];
    }
  }
  const calibration = [{
    kind: 'calibration', zone: null, count: null, strength: null,
    rep: 1, seconds: 3, label: 'calibration', phase: 'calibration'
  }];
  for (const zone of defaults.zones.filter(z => o.zones.includes(z))) {
    for (const strength of ['weak', 'medium', 'strong'].filter(s => o.strengths.includes(s))) {
      calibration.push({
        kind: 'cal_single', phase: 'calibration', zone, strength, count: 1,
        sets: 3, rep: 1, seconds: 5, label: `cal_single_${zone}_${strength}`
      });
    }
  }
  if (o.counts.includes(2)) {
    for (const zone of defaults.zones.filter(z => o.zones.includes(z))) {
      calibration.push({
        kind: 'cal_double', phase: 'calibration', zone, strength: null, count: 2,
        sets: 2, rep: 1, seconds: 5, label: `cal_double_${zone}`
      });
    }
  }
  return [...calibration, ...trials].map((p, id) => ({ ...p, id }));
}
export function parseLine(line) {
  line = line.replace(/\r/g, '');
  if (line.startsWith('[')) return {
    type: 'line',
    line,
    rate: line.startsWith('[desk]') ? Number(line.match(/\brate=(\d+)/)?.[1]) || undefined : undefined,
    dropped: line.startsWith('[stat]') ? Number(line.match(/\bdropped=(\d+)/)?.[1]) || 0 : 0
  };
  if (/^\d{1,4},\d{1,4},\d{1,4},\d{1,4}$/.test(line)) {
    const values = line.split(',').map(Number);
    if (values.every(v => v <= 4095)) return {
      type: 'sample',
      values
    };
  }
  return {
    type: 'bad_line',
    line
  };
}
export class Lines {
  constructor(receive) {
    this.receive = receive;
    this.pending = '';
    this.decoder = new StringDecoder('utf8');
    this.overflow = false;
  }
  push(chunk) {
    this.pending += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    let end;
    while ((end = this.pending.indexOf('\n')) >= 0) {
      const line = this.pending.slice(0, end);
      this.pending = this.pending.slice(end + 1);
      this.receive(this.overflow ? {
        type: 'bad_line',
        line: '[長すぎる行]'
      } : parseLine(line));
      this.overflow = false;
    }
    if (this.pending.length > 4096) {
      this.pending = '';
      this.overflow = true;
    }
  }
  end() {
    if (this.pending || this.overflow) this.receive({
      type: 'bad_line',
      line: this.pending
    });
    this.pending = '';
    this.overflow = false;
  }
}
const header = 'i,d0,d1,d3,d4\n';
export const format = `# tap-collect の記録形式

raw.csv はセッション全体の生値。列は i,d0,d1,d3,d4。i は 0 始まりのサンプル番号で、D0 左上 / D1 右上 / D3 左下 / D4 右下の ADC 整数（0〜4095）。時間はサンプル数 ÷ session.json の rate（既定 4000 Hz）。欠落は補間しない。再接続・待ち時間も含む。

session.json に版、時刻、ポート、mock、起動行、rate、全オプション、seed、机・センサーのメモ、git コミット、試行順、ch の並びを保存する。mock: true は合成データ。

events.jsonl は各行が JSON。i は次のサンプル番号、t は ISO 時刻。line は [ で始まるファームの行を全文保存。bad_line は不正行。start / cue / end は試行の開始・合図・終了、key は入力、resume は再開。disconnect / connect は接続状態。

trials.jsonl は各行が試行の結果。同じ n の行が複数あれば最後を採用する（後からの redo・メモの追記）。n は記録の連番、id は session.json の patterns の試行 ID。セッションは phase: "calibration"（静止 → cal_single → cal_double の固定順）と phase: "use"（使用試行）の 2 部構成。cal_single は count: 1、cal_double は count: 2、cal_single は sets: 3 と zone / strength、cal_double は sets: 2 と zone、strength: null を持つ。kind は calibration / cal_single / cal_double / tap / rest / typing / place / lean。tap の zone は lt / rt / lb / rb、count は回数、strength は weak / medium / strong。静止・叩き以外は zone / count / strength が null。rep は繰り返し番号。status は ok（採用）/ redo（不採用）/ aborted（中断）。note は自由メモ、t は開始の ISO 時刻。

from / cue / to は raw.csv のサンプル番号。区間は from 以上 to 未満、cue は合図の直後に届くサンプル番号。from から cue までは合図前 1 秒。baseline はこの区間の ch ごとの中央値。peak は全区間の baseline からの絶対差の最大。saturated は全区間で 5 以下または 4090 以上の ch ごとのサンプル数。dropped は区間内の [stat] dropped の合計、badLines は不正行数。中断で合図がなければ cue は null。

trials/NNN_<label>.csv は同じ列で試行区間を切り出したもの。label は rt_2_strong、typing など。redo / aborted も保存する。同じ id で最後の ok を採用する。再開では ok のない試行を保存済みの順で撮り、サンプル番号は継続する。ファームの boot が変わる場合があるため events.jsonl も参照する。
`;
function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
}
// A crash can leave a partial final line. Keep only complete, durable records.
function repair(file) {
  if (!fs.existsSync(file)) return;
  const b = fs.readFileSync(file);
  const end = b.lastIndexOf(10) + 1;
  if (end !== b.length) fs.truncateSync(file, end);
}
export class Store {
  constructor(o, now = () => new Date()) {
    this.now = now;
    this.buffers = {
      raw: '',
      events: ''
    };
    this.active = null;
    if (o.resume) {
      this.dir = path.resolve(o.resume);
      this.session = JSON.parse(fs.readFileSync(path.join(this.dir, 'session.json'), 'utf8'));
      this.session.port = o.port ?? this.session.port;
      this.session.endedAt = null;
      for (const f of ['raw.csv', 'events.jsonl', 'trials.jsonl']) repair(path.join(this.dir, f));
    } else {
      o = {
        ...o,
        seed: o.seed ?? Date.now()
      };
      const stamp = now().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      fs.mkdirSync(o.out, {
        recursive: true
      });
      this.dir = path.resolve(o.out, stamp);
      let suffix = 0;
      while (fs.existsSync(this.dir)) this.dir = path.resolve(o.out, `${stamp}-${++suffix}`);
      fs.mkdirSync(path.join(this.dir, 'trials'), {
        recursive: true
      });
      let git = null;
      try {
        git = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: fileURLToPath(new URL('.', import.meta.url)),
          stdio: ['ignore', 'pipe', 'ignore']
        }).toString().trim();
      } catch {}
      this.session = {
        version: '0.1.0',
        startedAt: now().toISOString(),
        endedAt: null,
        port: o.port ?? null,
        mock: o.mock,
        bootLines: [],
        rate: 4000,
        options: o,
        seed: o.seed,
        table: o.table,
        sensors: o.sensors,
        git,
        patterns: patterns(o),
        channels
      };
      fs.writeFileSync(path.join(this.dir, 'README.md'), format);
      fs.writeFileSync(path.join(this.dir, 'raw.csv'), header);
      for (const f of ['events.jsonl', 'trials.jsonl']) fs.writeFileSync(path.join(this.dir, f), '');
    }
    this.records = [...new Map(readJsonl(path.join(this.dir, 'trials.jsonl')).map(r => [r.n, r])).values()];
    const raw = fs.readFileSync(path.join(this.dir, 'raw.csv'), 'utf8').trimEnd();
    this.i = raw.includes('\n') ? Number(raw.slice(raw.lastIndexOf('\n') + 1).split(',')[0]) + 1 : 0;
    this.fds = {
      raw: fs.openSync(path.join(this.dir, 'raw.csv'), 'a'),
      events: fs.openSync(path.join(this.dir, 'events.jsonl'), 'a'),
      trials: fs.openSync(path.join(this.dir, 'trials.jsonl'), 'a')
    };
    this.save();
    if (o.resume) this.event('resume');
  }
  save() {
    const file = path.join(this.dir, 'session.json');
    fs.writeFileSync(file + '.tmp', JSON.stringify(this.session, null, 2) + '\n');
    fs.renameSync(file + '.tmp', file);
  }
  event(type, data = {}) {
    this.buffers.events += JSON.stringify({
      i: this.i,
      t: this.now().toISOString(),
      type,
      ...data
    }) + '\n';
  }
  receive(e) {
    if (e.type === 'sample') {
      const row = `${this.i},${e.values.join(',')}\n`;
      this.buffers.raw += row;
      if (this.active && !this.active.sealed) {
        this.active.rows.push(row);
        this.active.values.push(e.values);
      }
      this.i++;
    } else {
      this.event(e.type, {
        line: e.line
      });
      if (e.rate) {
        this.session.rate = e.rate;
        this.save();
      }
      if (e.line?.startsWith('[desk]') && /\bboot=/.test(e.line)) {
        this.session.bootLines.push(e.line);
        this.save();
      }
      if (this.active && !this.active.sealed) {
        this.active.dropped += e.dropped || 0;
        if (e.type === 'bad_line') this.active.badLines++;
      }
    }
    if (this.buffers.raw.length + this.buffers.events.length > 65536) this.flush();
  }
  flush(durable = false) {
    for (const key of ['raw', 'events']) {
      if (this.buffers[key]) fs.writeSync(this.fds[key], this.buffers[key]);
      this.buffers[key] = '';
    }
    if (durable) for (const fd of Object.values(this.fds)) fs.fsyncSync(fd);
  }
  start(p) {
    this.active = {
      ...p,
      n: this.records.length + 1,
      from: this.i,
      cue: null,
      t: this.now().toISOString(),
      rows: [],
      values: [],
      dropped: 0,
      badLines: 0
    };
    this.event('start', {
      id: p.id
    });
  }
  cue() {
    this.active.cue = this.i;
    this.event('cue', {
      id: this.active.id
    });
  }
  finish(status, note = '') {
    const a = this.active;
    if (!a) return;
    const end = a.to ?? this.i;
    const pre = a.values.slice(0, (a.cue ?? end) - a.from);
    const baseline = channels.map((_, ch) => {
      const v = pre.map(row => row[ch]).sort((x, y) => x - y);
      const m = Math.floor(v.length / 2);
      return v.length ? v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2 : null;
    });
    const peak = [0, 0, 0, 0],
      saturated = [0, 0, 0, 0];
    for (const row of a.values) for (let ch = 0; ch < 4; ch++) {
      if (baseline[ch] !== null) peak[ch] = Math.max(peak[ch], Math.abs(row[ch] - baseline[ch]));
      if (row[ch] <= 5 || row[ch] >= 4090) saturated[ch]++;
    }
    const {
      rows,
      values,
      sealed,
      ...record
    } = a;
    Object.assign(record, {
      status,
      note,
      to: end,
      baseline,
      peak,
      saturated
    });
    fs.writeFileSync(path.join(this.dir, 'trials', `${String(a.n).padStart(3, '0')}_${a.label}.csv`), header + rows.join(''));
    this.event('end', {
      i: end,
      id: a.id,
      status
    });
    this.flush(true);
    fs.writeSync(this.fds.trials, JSON.stringify(record) + '\n');
    fs.fsyncSync(this.fds.trials);
    this.records.push(record);
    this.active = null;
    return record;
  }
  update(record, changes) {
    Object.assign(record, changes);
    this.flush(true);
    fs.writeSync(this.fds.trials, JSON.stringify(record) + '\n');
    fs.fsyncSync(this.fds.trials);
  }
  remaining() {
    const done = new Set(this.records.filter(r => r.status === 'ok').map(r => r.id));
    return this.session.patterns.filter(p => !done.has(p.id));
  }
  close(complete = false) {
    if (this.active) this.finish('aborted');
    this.session.endedAt = this.now().toISOString();
    this.session.completed = complete;
    this.save();
    this.flush(true);
    for (const fd of Object.values(this.fds)) fs.closeSync(fd);
  }
}
export function mockValues(p, seconds, i, seed = 1) {
  const base = [1900, 2000, 2100, 2200];
  const zone = ['lt', 'rt', 'lb', 'rb'].indexOf(p?.zone);
  // Recreate trial-local randomness so the waveform is independent of chunking.
  const rng = random(seed >>> 0 ^ Math.imul(p?.n ?? p?.id ?? 0, 0x9e3779b1));
  const amplitude = 0.8 + rng() * 0.4;
  const weights = base.map(() => 0.85 + rng() * 0.3);
  const interval = 0.2 + rng() * 0.15;
  // Each five repetitions contain one clipped strong trial, leaving enough
  // clean single hits for calibration even when one rep is held out.
  const clipped = p?.strength === 'strong' && ((p.rep ?? 1) + (seed >>> 0)) % 5 === 0;
  const onsets = [];
  let setStart = 0.4;
  for (let set = 0; set < (p?.sets ?? 1); set++) {
    for (let hit = 0; hit < (p?.count ?? 0); hit++) {
      onsets.push(p?.sets ? setStart + hit * interval : 0.12 + hit * interval);
    }
    setStart += p?.count === 1 ? 1.1 + rng() * 0.6 : 2.2;
  }
  const variations = onsets.map(() => ({ amplitude: 0.8 + rng() * 0.4, weights: base.map(() => 0.85 + rng() * 0.3) }));
  return base.map((b, ch) => {
    let v = b + (Math.imul(i + ch * 7 + (seed >>> 0), 1103515245) >>> 16) % 7 - 3;
    if (seconds >= 0 && p) {
      if (['tap', 'cal_single', 'cal_double'].includes(p.kind)) for (let hit = 0; hit < p.count * (p.sets ?? 1); hit++) {
        const onset = onsets[hit];
        const dt = seconds - onset;
        if (dt >= 0) {
          const amp = {
            weak: 350,
            medium: 850,
            strong: clipped ? 4000 : 800
          }[p.strength ?? 'weak'];
          const weight = ch === zone ? 1 : ch === (zone ^ 3) ? 0.16 : 0.36;
          v += amp * (p.sets ? variations[hit].amplitude : amplitude) * weight * (p.sets ? variations[hit].weights[ch] : weights[ch]) * Math.exp(-dt * 40) * Math.cos(dt * 180);
        }
      }
      if (p.kind === 'typing') {
        const dt = seconds % 0.13;
        v += 60 * Math.exp(-dt * 45) * Math.cos(dt * 200 + ch);
      }
      if (p.kind === 'place' || p.kind === 'lean') v += (p.kind === 'lean' ? 700 : 500) * Math.sin(Math.min(seconds, 1) * Math.PI / 2) * Math.exp(-seconds * (p.kind === 'lean' ? 0.1 : 1.3)) * (1 - ch * 0.12);
    }
    return Math.max(0, Math.min(4095, Math.round(v)));
  });
}
export class MockSource {
  constructor(store, clock = globalThis) {
    this.store = store;
    this.clock = clock;
    this.sample = 0;
    this.p = null;
    this.cueIndex = Infinity;
  }
  start() {
    this.store.receive(parseLine('[desk] stream boot=1 ch=D0,D1,D3,D4 rate=4000'));
    this.timer = this.clock.setInterval(() => this.tick(), 10);
  }
  tick() {
    for (let k = 0; k < 40; k++) {
      const values = mockValues(this.p, (this.sample - this.cueIndex) / 4000, this.sample, this.store.session.seed);
      this.store.receive({
        type: 'sample',
        values
      });
      this.sample++;
    }
    if (this.sample % 4000 === 0) this.store.receive(parseLine('[stat] rate=4000 dropped=0'));
  }
  prepare() {
    this.p = null;
    this.cueIndex = Infinity;
  }
  cue(p) {
    this.p = p;
    this.cueIndex = this.sample;
  }
  stop() {
    this.clock.clearInterval(this.timer);
  }
}
export const clock = {
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms))
};
export function instruction(p) {
  if (p.sets) {
    const zone = { lt: '左上', rt: '右上', lb: '左下', rb: '右下' }[p.zone];
    const strength = { weak: '弱', medium: '中', strong: '強' }[p.strength];
    return p.count === 1 ? `${zone}・${strength} を 3 回、ゆっくり叩く` : `${zone} を 2 回叩きで 2 セット`;
  }
  return p.kind === 'tap' ? `${{
    lt: '左上',
    rt: '右上',
    lb: '左下',
    rb: '右下'
  }[p.zone]}  ${p.count}回  ${{
    weak: '弱',
    medium: '中',
    strong: '強'
  }[p.strength]}` : {
    calibration: '机に触れず静止する',
    rest: '何もしない',
    typing: 'キーボードを普通に打つ',
    place: '机に物（スマホ・コップ）を置く',
    lean: '机に腕・肘をつく'
  }[p.kind];
}
export async function run(store, {
  ui,
  source,
  clock: timer = clock,
  connected = () => true,
  ready = connected
}) {
  let paused = false;
  let retry = null;
  let interrupted = false;
  let last = null;
  const handle = async () => {
    const key = ui.poll?.();
    if (!key) return;
    store.event('key', { key });
    if (key === 'q') ui.stopped = true;
    if (key === 'r') {
      if (store.active) {
        retry = store.session.patterns.find(p => p.id === store.active.id);
        store.finish('redo');
        interrupted = true;
      } else if (last) {
        // Append a replacement status; readers select the latest record per id.
        store.update(last, { status: 'redo' });
        retry = store.session.patterns.find(p => p.id === last.id);
        interrupted = true;
      }
    }
    if (key === ' ' || key === 'space') {
      paused = !paused;
      if (paused && store.active) {
        retry = store.session.patterns.find(p => p.id === store.active.id);
        store.finish('aborted');
        interrupted = true;
      }
      ui.say(paused ? '一時停止' : '再開');
    }
    if (key === 'n' && last) {
      if (store.active) {
        retry = store.session.patterns.find(p => p.id === store.active.id);
        store.finish('aborted');
        interrupted = true;
      }
      const note = await ui.note();
      store.update(last, { note });
    }
  };
  const wait = async ms => {
    for (let elapsed = 0; elapsed < ms; elapsed += 100) {
      await handle();
      while (paused && !ui.stopped) {
        await timer.sleep(100);
        await handle();
      }
      if (ui.stopped || interrupted || !connected()) return false;
      await timer.sleep(Math.min(100, ms - elapsed));
      store.flush();
      ui.progress?.(store.active, store.session.rate);
    }
    await handle();
    return !ui.stopped && !interrupted && connected();
  };
  for (;;) {
    await handle();
    if (ui.stopped) break;
    const p = retry ?? store.remaining()[0];
    retry = null;
    if (!p) break;
    interrupted = false;
    while (!ready() && !ui.stopped) {
      await timer.sleep(100);
      await handle();
    }
    if (ui.stopped) break;
    source.prepare?.();
    ui.say(`次: ${instruction(p)}`);
    let ok = await wait(500);
    if (ok) {
      store.start(p);
      ok = await wait(1000);
    }
    if (ok) {
      store.cue();
      source.cue?.(p);
      ui.say(['tap', 'cal_single', 'cal_double'].includes(p.kind) ? '叩いて' : instruction(p));
      ok = await wait(p.seconds * 1000);
    }
    if (!ok) {
      if (store.active) store.finish('aborted');
      retry ??= p;
      continue;
    }
    const noise = store.records.findLast(r => r.kind === 'calibration' && r.status === 'ok');
    store.active.mountains = countMountains(store.active, noise?.peak, store.session.rate);
    ui.result(store.active);
    last = store.finish('ok');
  }
  if (store.active) store.finish('aborted');
  return !store.remaining().length;
}

// Count excursions with a 50 ms quiet gap so ringing is one mountain.
export function countMountains(a, noise, rate) {
  if (!noise || a.cue === null) return null;
  const pre = a.values.slice(0, a.cue - a.from);
  const baseline = channels.map((_, ch) => {
    const sorted = pre.map(v => v[ch]).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length ? (sorted[mid] + sorted[Math.ceil(sorted.length / 2) - 1]) / 2 : 0;
  });
  let last = -Infinity;
  let count = 0;
  for (let i = a.cue - a.from; i < a.values.length; i++) {
    if (a.values[i].some((v, ch) => Math.abs(v - baseline[ch]) > noise[ch] * 3)) {
      if (i - last > rate * 0.05) count++;
      last = i;
    }
  }
  return count;
}

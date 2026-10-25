import { SerialPort } from 'serialport';
import { emitKeypressEvents } from 'node:readline';
import { pathToFileURL } from 'node:url';
import {
  options,
  Store,
  Lines,
  MockSource,
  run,
  channels,
  clock,
  ignoresRecordingKeys,
} from './core.mjs';

export class Terminal {
  constructor(input = process.stdin, output = process.stdout) {
    this.input = input;
    this.output = output;
    this.stopped = false;
    this.pending = null;
    this.editing = false;
    this.keys = [];
    emitKeypressEvents(input);
    input.setRawMode?.(true);
    input.resume();
    this.handler = (str, key = {}) => {
      if (key.ctrl && key.name === 'c') {
        this.stop();
        return;
      }
      if (this.ignoreKeys) return;
      if (this.editing) {
        if (key.name === 'return') {
          const text = this.text;
          this.editing = false;
          this.output.write('\n');
          this.resolve(text);
        } else if (key.name === 'backspace') {
          this.text = this.text.slice(0, -1);
          this.output.write('\b \b');
        } else if (str && !key.ctrl && !key.meta) {
          this.text += str;
          this.output.write(str);
        }
        return;
      }
      const value = key.name === 'return' ? 'enter' : str;
      if (value === 'q' && !this.pending) {
        this.stop();
        return;
      }
      if (this.pending) this.resolve(value);
      else this.keys.push(value);
    };
    input.on('keypress', this.handler);
    this.signal = () => this.stop();
    process.on('SIGINT', this.signal);
    process.on('SIGTERM', this.signal);
  }
  resolve(v) {
    const p = this.pending;
    this.pending = null;
    p?.(v);
  }
  stop() {
    this.stopped = true;
    this.resolve('q');
  }
  clearLine() {
    if (this.lineVisible) {
      this.output.write('\r\x1b[K');
      this.lineVisible = false;
    }
  }
  say(s) {
    this.clearLine();
    this.output.write(s + '\n');
  }
  warning(message) {
    this.clearLine();
    if (message) {
      if (this.output.isTTY) {
        this.output.write(message);
        this.lineVisible = true;
      } else this.say(message);
    }
  }
  key(prompt) {
    this.say(prompt);
    return this.stopped
      ? Promise.resolve('q')
      : new Promise((resolve) => {
          this.pending = resolve;
        });
  }
  note() {
    this.output.write('メモ: ');
    this.text = '';
    this.editing = true;
    return this.stopped
      ? Promise.resolve('')
      : new Promise((resolve) => {
          this.pending = resolve;
        });
  }
  progress(a, rate = 4000) {
    if (!a || !this.output.isTTY) return;
    const cued = a.cue !== null;
    const elapsed = Math.max(
      0,
      (a.values.length - (cued ? a.cue - a.from : 0)) / rate,
    );
    const filled = Math.min(20, Math.floor((elapsed / a.seconds) * 20));
    const label = cued ? '' : '合図待ち  ';
    this.output.write(
      `\r\x1b[K${label}${'▮'.repeat(filled)}${'▯'.repeat(20 - filled)}  ${elapsed.toFixed(1)} / ${a.seconds} 秒`,
    );
    this.lineVisible = true;
  }
  setRecording(pattern) {
    this.ignoreKeys = ignoresRecordingKeys(pattern);
  }
  poll() {
    return this.keys.shift();
  }
  result(a) {
    const pre = a.values.slice(0, a.cue - a.from);
    const peaks = channels.map((name, ch) => {
      const sorted = pre.map(v => v[ch]).sort((x, y) => x - y);
      const base = sorted[Math.floor(sorted.length / 2)] ?? 0;
      let peak = 0;
      for (const values of a.values) peak = Math.max(peak, Math.abs(values[ch] - base));
      return `${name.split(' ')[0]} ${peak}`;
    });
    const mountains = a.mountains == null ? '' : `  山 ${a.mountains}`;
    this.say(`${peaks.join(' / ')}${mountains}  欠け ${a.dropped}  不正行 ${a.badLines}`);
  }
  close() {
    this.input.off('keypress', this.handler);
    this.input.setRawMode?.(false);
    this.input.pause();
    process.off('SIGINT', this.signal);
    process.off('SIGTERM', this.signal);
  }
}
export class SerialSource {
  constructor(store, ui, { Port = SerialPort, timer = globalThis } = {}) {
    this.Port = Port;
    this.timer = timer;
    this.store = store;
    this.ui = ui;
    this.connected = false;
    this.stopping = false;
  }
  start() {
    this.connect();
  }
  connect() {
    if (this.stopping) return;
    const port = (this.port = new this.Port({
      path: this.store.session.port,
      baudRate: 115200,
      autoOpen: false,
    }));
    this.hasSample = false;
    this.firstBadLine = null;
    this.warned = false;
    const lines = new Lines((e) => {
      this.store.receive(e);
      if (e.type === 'bad_line' && this.firstBadLine === null)
        this.firstBadLine = e.line;
      if (e.type === 'sample') {
        this.hasSample = true;
        this.timer.clearTimeout(this.sampleTimeout);
        if (this.warned) this.ui.warning?.(null);
        this.warned = false;
      }
    });
    port.on('data', (chunk) => lines.push(chunk));
    let handled = false;
    const lost = () => {
      if (handled || this.stopping) return;
      handled = true;
      this.timer.clearTimeout(this.sampleTimeout);
      if (this.warned) this.ui.warning?.(null);
      lines.end();
      this.connected = false;
      this.store.event('disconnect');
      this.ui.say('切断しました。1 秒ごとに再接続します');
      if (port.isOpen) port.close();
      this.retry = this.timer.setTimeout(() => this.connect(), 1000);
    };
    port.on('error', lost);
    port.on('close', lost);
    port.open((error) => {
      if (error) {
        lost();
        return;
      }
      if (this.stopping) {
        port.close();
        return;
      }
      this.connected = true;
      this.store.event('connect');
      port.write('stream\n', (error) => {
        if (error) {
          lost();
          if (port.isOpen) port.close();
        }
      });
      this.ui.say('接続しました');
      if (!this.hasSample && !handled)
        this.sampleTimeout = this.timer.setTimeout(() => {
          if (this.hasSample || !this.connected || this.stopping) return;
          this.warned = true;
          const message =
            this.firstBadLine === null
              ? 'データが届きません（ポート・ケーブル・ファームを確認）'
              : `xiao-stream / deskapi-raw 以外のファームのようです: ${this.firstBadLine}`;
          if (this.ui.warning) this.ui.warning(message);
          else this.ui.say(message);
        }, 3000);
    });
  }
  get ready() {
    return this.connected && this.hasSample;
  }
  stop() {
    this.stopping = true;
    this.timer.clearTimeout(this.sampleTimeout);
    this.timer.clearTimeout(this.retry);
    if (this.port?.isOpen) this.port.close();
  }
}
function summary(store, ui) {
  const groups = new Map();
  for (const r of store.records.filter((r) => r.status === 'ok')) {
    const g = groups.get(r.label) ?? [];
    g.push(r);
    groups.set(r.label, g);
  }
  ui.say('パターン別 最大のずれの平均（D0 / D1 / D3 / D4）');
  for (const [label, rows] of groups)
    ui.say(
      `${label}: ${[0, 1, 2, 3].map((ch) => (rows.reduce((n, r) => n + r.peak[ch], 0) / rows.length).toFixed(1)).join(' / ')}`,
    );
}
export async function resolvePort(o, list = () => SerialPort.list()) {
  if (o.port || o.mock || o.resume) return o.port;
  const ports = await list();
  if (!ports.length) throw Error('シリアルポートがありません。ESP32 を USB で接続してください');
  if (ports.length > 1) throw Error(`ポートが複数あります: ${ports.map(p => p.path).join(', ')}。npm start -- --port <ポート名> で指定してください`);
  return ports[0].path;
}

export async function main(args = process.argv.slice(2)) {
  const o = options(args);
  if (o.help) {
    console.log(
      'npm start（ポート自動検出・メモ入力を省略して開始）\nnode collect.mjs [--port COM5] | --mock | --resume <dir>\n--quick --list --reps 1 --zones lt,rt,lb,rb --counts 1,2\n--no-extra --order shuffle|sequential --seed <整数> --window 5 --prepare 2\n--table <メモ> --sensors <メモ> --out tap-logs',
    );
    return;
  }
  if (o.list) {
    for (const p of await SerialPort.list())
      console.log(`${p.path}  ${p.manufacturer ?? ''}`);
    return;
  }
  if (!process.stdin.isTTY) throw Error('対話端末で実行してください');
  o.port = await resolvePort(o);
  const ui = new Terminal();
  let store, source;
  try {
    if (!o.resume) {
      if (!o.quick) {
        o.table ??= await (ui.say('机のメモ'), ui.note());
        o.sensors ??= await (ui.say('センサーのメモ'), ui.note());
      }
      o.table ??= '';
      o.sensors ??= '';
      if (ui.stopped) return;
    }
    store = new Store(o);
    ui.say(`保存先: ${store.dir}`);
    source = store.session.mock
      ? new MockSource(store)
      : new SerialSource(store, ui);
    source.start();
    const started = Date.now();
    const complete = await run(store, {
      ui,
      source,
      clock,
      connected: () => store.session.mock || source.connected,
      ready: () => store.session.mock || source.ready,
    });
    source.stop();
    ui.say(`所要時間 ${((Date.now() - started) / 1000).toFixed(1)} 秒`);
    if (complete) summary(store, ui);
    store.close(complete);
    store = null;
    ui.say('記録を保存しました');
  } finally {
    source?.stop();
    store?.close();
    ui.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(`エラー: ${error.message}`);
    process.exitCode = 1;
  });

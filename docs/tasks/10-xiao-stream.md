# 10 本番ファーム（xiao-stream）に対応する：判定を PC に移す

`app/` だけ。`firmware/` には触らない（`firmware/xiao-stream/` はチームのコード、それ以外は参考実装）。機能は変えない。

## 背景

本番のファームはチームの `firmware/xiao-stream/xiao-stream.ino` に決まった。**判定をせず、4ch の ADC 生値を送り続けるだけ**（チームの決定：打撃の検出・強弱・回数・位置の判定は PC で行う）。

```text
[desk] stream boot=2126667643 ch=D0,D1,D3,D4 rate=4000   ← 起動時だけ
1923,2101,2088,2240                                        ← 1 行に 4ch（左上,右上,左下,右下。12bit 0〜4095）
[stat] rate=4000 dropped=0                                 ← 1 秒ごと
[view] D0 基準1920 振れ幅   14 ...                          ← 表示モードのとき（"view\n" で入り "stream\n" で戻る）
[desk] 連続送信に戻りました                                  ← "stream\n" を受けたとき
```

- 1ch あたり毎秒 4000 回。1 行 = 250 µs。時刻は送られてこない
- 115200 bps（USB CDC なので実際の速さは関係ない）
- PC からの命令は `view` と `stream` だけ。ほかの行は無視される
- ping への返事・バージョン・校正値の保存はない

いまのアプリの判定・キャリブレーションは、参考実装のファーム `firmware/lib/DeskApiCore/src/Detector.{h,cpp}` が行い、`docs/protocol.md` v1.1 の JSON で `tap` / `hit` / `noise` / `raw` / `ack` を送ってくる前提になっている。これを **PC 側で同じように動かす**。

## やること

1. **検出器を TypeScript に移す**: `Detector.{h,cpp}` を `src/main/protocols/detector.ts` に移植する。動きは変えない（DC 追従、閾値は「>」で発火、15 ms のピーク窓、`refractoryMs`、2 回目の待ち `doubleWindowMs`（打ち始めの時刻で測る）、型（templates）による領域判定と confidence、`strongMin`、飽和 |DC 除去後| ≥ 1800 で `sat`、校正モードの `hit`（`ring` の測り方を含む）、`measure_noise`、raw モードの 10 ms ごとの min/max、`validCalibration`、モード・校正値の変更で途中の打を捨てる）。時刻は µs の数値で受け取る。出す値はアプリ内部の `DeviceEvent`（`src/shared/types.ts`）
   - 参考実装の native テスト `firmware/test/test_core/test_main.cpp` のうち検出器のテスト（`test_protocol_*` と `test_persisted_*`、`test_line_framing_*`、ピンのテスト以外）を、同じ入力・同じ期待値で `tests/detector.cjs` に移し、すべて通すこと。これが「動きを変えない」の確認になる
2. **アダプタの形を接続ごとの状態を持てる形に変える**: 今の `parseLine` / `encode` は状態を持たないので、検出器を入れられない。接続ごとに作るセッションにする

   ```ts
   // 形のイメージ。名前・細部は任せる
   interface DeviceProtocol {
     id: string; serial: { baudRate: number }; capabilities: DeviceCapabilities
     open(io: { write(data: string): void; emit(event: DeviceEvent): void; calibration?: Calibration }): ProtocolSession
   }
   interface ProtocolSession {
     handshake: { send?: string; isHello(e: DeviceEvent): boolean; timeoutMs: number }
     receive(line: string): void        // 0 個以上の DeviceEvent を emit する
     send(command: DeviceCommand): boolean  // 対応しないなら false。ファームへ書くか、手元で処理して ack などを emit する
   }
   ```

   - `deskapi-v1` は今の動きのまま新しい形に移す（`valid()` も今のまま）
   - `SerialDevice` の ACK 待ち・キュー・再接続・タイムアウトは今のまま。アダプタが手元で `ack` / `noise` を emit しても、ファームから届いたときと同じに扱われること
   - ログを流し込むテスト（`tests/protocols.cjs`）は新しい形で、各アダプタの `.log` / `.expected.json` を流す仕組みのまま残す
3. **`xiao-stream` アダプタ**（`src/main/protocols/xiao-stream.ts`）
   - `receive`: `^\d{1,4},\d{1,4},\d{1,4},\d{1,4}$`（各値 ≤ 4095）の行を 1 サンプルとして検出器に渡す。時刻は受け取った行数 × 250 µs（`[desk] ... rate=N` があれば 1e6 / N µs）。`[` で始まる行・壊れた行・範囲外の値は検出器に渡さない
   - hello: データ行が 8 行続いたら（または `[desk] stream` の行で）`{ t: 'hello', fw: 'xiao-stream', cal }` を出す。`cal` は `io.calibration` があるかどうか
   - 接続時の `send` は `"stream\n"`（表示モードのままでも連続送信に戻す）
   - 命令は手元の検出器で処理する: `mode` → `setMode`、`set_cal` → `setCalibration`（不正なら `ok: false`）、どちらも `ack` を emit。`measure_noise` → 検出器が `noise` を出す。`ping` は何もしなくてよい
   - `capabilities: { calibration: true, raw: true }`
   - 接続時、`io.calibration`（保存済みの校正値）があれば検出器に入れておく
4. **校正値をアプリに保存する**: xiao-stream はファームに保存できないので、キャリブレーションで保存した値を `Config.calibration`（省略可）に書く。接続のたびにアダプタへ渡す。`deskapi-v1` でも同じく Config に書いてよい（ファーム側の保存はそのまま）。旧設定（`calibration` なし）はそのまま読めること。`isConfig` で形を確かめる（`Calibration` の形、templates は 4×4）。歯車パネルには出さない
5. **自動で見分ける**: `Config.protocol` の既定を `'auto'` にする。`auto` は接続したら `"stream\n"` と `{"t":"ping"}\n` を両方送り、先に `xiao-stream` のデータ行が 8 行続くか、`deskapi-v1` の `hello` が届いたほうのアダプタに決める（タイムアウト 3000 ms）。決まったあとはそのアダプタとして動く。保存済みの設定の `protocol: 'deskapi-v1'` は UI に出したことがなく既定値が書かれただけなので、読み込み時に `'auto'` に直す。存在しない ID も `auto` 扱い
6. **毎秒 4000 行を軽く受ける**: `SerialDevice` の行の分割を、1 文字ずつの連結から `indexOf('\n')` で切る形にする（512 文字を超える行は捨てる、`\r` は落とす、行をまたぐチャンクを正しくつなぐ）。xiao-stream の 1 サンプルあたりの処理で、配列・オブジェクトを毎回作らないようにする（`split` 程度は可）
   - テスト: 合成した 4ch の波形（DC 1900 前後 + 小さな雑音 + 叩いたときの減衰する振動、乱数は種を固定）を xiao-stream の行にして、2〜3 バイトずつに割ったチャンクで `SerialDevice` に流し、16 種類（4 領域 × 1/2 回 × 弱/強）の tap が正しく届くこと。`sat` になる強さの打も 1 つ入れる。60 秒分（24 万行）を流して、Node で 1 秒以内に処理できること
   - テスト: 校正の一連（`setMode('calibrate')` → `measureNoise()` → hit が届く → `saveCalibration()` → `setMode('run')`）が xiao-stream でもアプリ側だけで完結し、保存した校正値で判定が変わること
7. **`serial-log` を毎秒 4000 行に耐えさせる**: ファイルには今どおり全行を時刻付きで書く。画面には `[` で始まる行と、それ以外の行は 1 秒ごとに「受信 N 行」と最後の 1 行だけ出す（Windows のコンソールに 4000 行/秒を出すと追いつかない）
8. `docs/` は PM が直すので触らない。README などに書くことがあれば報告に書く

## 完了条件

- `npm run typecheck` / `npm run build` / `npm run test` が通る。今のテストも通ったまま（新しい形に合わせて書き換えるのはよい。中身の確認を減らさない）
- `tests/detector.cjs` に参考実装の検出器テストが同じ期待値で移っていて、通る
- `src/main/` で、`protocols/` 以外にシリアルの形式（`"t":"tap"`、`"stream"`、CSV など）を知っているコードがない
- `DESKAPI_MOCK=1` の動きは変わらない
- 報告に、変えたファイル・新しいアダプタの形・テストの件数と所要時間を短く書く

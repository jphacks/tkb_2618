# ESP32 ⇔ PC シリアルプロトコル v1.1

> **本番のファームは `firmware/xiao-stream/`（チームのコード）で、この JSON は送らない。** 4 ch の生値を送り続け、判定はアプリが行う（下の「xiao-stream（本番）」）。この文書の JSON（v1.1）は、参考実装 `firmware/` とアプリのアダプタ `deskapi-v1` の形式。アプリの中では、xiao-stream のときもこの文書と同じ `tap` / `hit` / `noise` / `raw` / `ack` を検出器（`app/src/main/protocols/detector.ts`、参考実装の `Detector` の移植）が作るので、キャリブレーションの手順・計算・判定はどちらでも同じ。

v1.1 は任意のテーブルで動かすための拡張（`hit.ring`、`set_cal` の `templates`、学習した型による領域判定）と、入力回路（[DeskAPI 入力回路](https://claude.ai/artifact/SdUvAXonEdvWRYHbBbfajF)）の受入試験・飽和棄却（FW-007）のための拡張（`raw` モード、`sat`）。v1 の値（`templates` なし）もそのまま受け付ける。

- USB シリアル、115200 bps、8N1
- 1 行 1 メッセージの JSON（UTF-8、`\n` 区切り）。どのメッセージにも `t`（種類）がある
- JSON として読めない行は無視する（ESP32 の起動ログなどが混ざるため）
- 領域番号 `region`: 0 = 左上, 1 = 右上, 2 = 左下, 3 = 右下（ピエゾ ch0〜ch3 に対応。XIAO ESP32S3 では D0 / D1 / D3 / D4 = GPIO1 / 2 / 4 / 5。D2 = GPIO3 はストラッピングピンなので使わない）

## ESP32 → PC

| t | 例 | いつ |
|---|---|---|
| `hello` | `{"t":"hello","fw":"0.1.0","cal":true}` | 起動時と `ping` の応答。`cal` はキャリブレーション値が NVS にあるか |
| `tap` | `{"t":"tap","region":2,"count":1,"strength":"strong","confidence":0.82}` | 通常モードでタップ確定時（`strength` はアプリでは捨てる） |
| `noise` | `{"t":"noise","peak":[41,38,52,40],"rms":[9,8,11,9]}` | `measure_noise` の結果 |
| `hit` | `{"t":"hit","peaks":[120,860,90,140],"ms":18,"ring":64}` | キャリブレーションモードで 1 打検出するたび。判定はしない。`ring` は余韻の長さ（下記） |
| `raw` | `{"t":"raw","min":[2031,2040,2025,2044],"max":[2066,2059,2071,2050]}` | `raw` モード中、10 ms ごと。下記 |
| `ack` | `{"t":"ack","of":"set_cal","ok":true}` | `set_cal` / `mode` の応答。失敗時は `"ok":false,"err":"..."` |

### tap の値

- `count`: 1 または 2
- `strength`: `"weak"` / `"strong"`。参考実装のファームが送る。アプリには強弱がないので、アダプタで捨てる
- `confidence`: 0〜1。`templates` があるときは、型との類似度の 1 位 s1 と 2 位 s2 から `(s1 - s2) / (1 - s2)`（0〜1 に丸める）。ないときは最大チャネルのピークと 2 番目のピークの比 `1 - second/first`

### 飽和（FW-007）

ADC は減衰 12 dB で約 0〜3.1 V、入力は 1.65 V 中心なので、振れ幅はおよそ ±1.4 V。打撃の 15 ms 窓で、どれかの ch の DC 除去後の絶対値が **1800 以上**（≒ ±1.4 V）になった打は飽和とし、`hit` / `tap` に `"sat":true` を付ける（飽和していなければ `sat` は付けない）。PC は飽和した打を棄却する。

- キャリブレーション: `sat` 付きの `hit` は数えない（型の値が歪むため）
- 通常: `sat` 付きの `tap` ではアクションを実行しない

### raw の値

`raw` モードで 10 ms ごとに送る。各 ch のその 10 ms のあいだの ADC 生値（0〜4095、DC を引かない）の最小と最大。無信号なら min・max とも約 2048（1.65 V）付近、叩くとその ch の幅が広がる。受入試験 T-01（ピエゾをつないで軽く叩き、1.65 V を中心に振れること）に使う

### hit の ring

打撃の開始から、全 ch が `threshold` を下回った状態が 10 ms 続くまでの時間（ms、最大 1000）。テーブルの余韻の長さで、PC が `refractoryMs` を決めるのに使う

## PC → ESP32

| t | 例 | 動作 |
|---|---|---|
| `ping` | `{"t":"ping"}` | `hello` を返す。PC は接続直後に送り、2 秒以内に `hello` が来なければ別ポートを試す |
| `mode` | `{"t":"mode","mode":"calibrate"}` | `"run"`（通常）/ `"calibrate"`（`tap` を出さず `hit` を出す）/ `"raw"`（`tap`・`hit` を出さず `raw` を出す。NVS には残さず、再起動すると `run`） |
| `measure_noise` | `{"t":"measure_noise","ms":2000}` | 指定時間のノイズを測り `noise` を返す |
| `set_cal` | 下記 | 値を NVS に保存し `ack` を返す。以後の判定に即反映 |

```json
{"t":"set_cal","cal":{"threshold":[90,85,100,88],"strongMin":[520,480,600,500],"doubleWindowMs":320,"refractoryMs":70,
  "templates":[[0.95,0.25,0.18,0.06],[0.3,0.93,0.08,0.2],[0.2,0.07,0.96,0.2],[0.07,0.22,0.27,0.94]]}}
```

- `threshold[i]`: ch i のピークがこれを超えたら打撃とみなす
- `strongMin[r]`: 参考実装のファームが必須にしている強弱の境目。アプリは強弱を使わないので、アダプタが常に 4095 を入れて送る
- `templates`（省略可）: 領域 r の型 `templates[r]`。4 ch のピークの出方（長さ 1 に正規化したベクトル）。あるときは、打撃の 4 ch のピーク p と各型のコサイン類似度を取り、最も似た型の領域にする。ないときは v1 どおり最大の ch を領域にする
- `doubleWindowMs`: 1 打目からこの時間内に 2 打目が来たら 2 回叩き。来なければ時間切れで 1 回として送る
- `refractoryMs`: 1 打検出後、振動の残りを無視する時間

キャリブレーション値がないときの既定値: `threshold` 全 ch 150、`doubleWindowMs` 320、`refractoryMs` 70（ADC 12bit の生値想定）

## PC 側のキャリブレーション計算

1. `mode calibrate` → `measure_noise 2000` → `noise` を受け取る
2. 領域 r ごとに 3 打。届いた `hit` をすべて記録する（`peaks` 4 つと `ring`。最大の ch が r でなくても捨てない。金属のテーブルなどでは隣の ch の方が大きく出ることがあり、それも型として覚える）
3. 値を決めて `set_cal` → `ack` → `mode run`
   - `threshold[ch] = max(noise.peak[ch] * 2, ch が一番鳴った打の peaks[ch] の最小 * 0.5)`。「一番鳴った」は `peaks[c] / noise.peak[c]` が最大の ch。センサーごとに感度が違っても、領域とセンサーの番号がずれていても、各 ch は自分のノイズと自分に届いた打で決まる。どの打でも一番にならなかった ch は `noise.peak[ch] * 2`
   - `templates[r]` = 領域 r の 3 打それぞれを長さ 1 に正規化して平均し、もう一度長さ 1 に正規化したもの
   - `refractoryMs = 12 打の ring の最大 * 1.2` を 40〜250 に丸める
   - `doubleWindowMs = 320`（固定）
4. 確かめ（当たった領域は、UI でその領域を赤にしてやり直させる）
   - 型で判定を間違える: 12 打それぞれを、その打を除いて作った型（leave-one-out）で判定し、別の領域になった打があれば、その打の正しい領域

## 判定（参考実装のファーム / xiao-stream ではアプリの検出器）

- 各 ch を 2 kHz 以上でサンプリングし、DC を引いた絶対値のピークを見る
- いずれかの ch が `threshold` を超えたら、そこから 15 ms の窓で全 ch のピークを取る。`templates` があれば最も似た型の領域、なければ最大の ch を領域とする
- `refractoryMs` の間は次の打撃を見ない
- `templates` があるとき、`confidence` が 0.3 未満の打は送らない（アプリの検出器の `MIN_CONFIDENCE`）
- 1 打目のあと `doubleWindowMs` 待ち、同じ領域に 2 打目が来たら `count: 2`。別の領域に来たら 1 打目を `count: 1` で確定して送り、2 打目を新しい 1 打目として扱う

## xiao-stream（本番）

チームの `firmware/xiao-stream/xiao-stream.ino`。2026-10-24 にチームで、判定をマイコンから PC に移すと決めた。

```text
[desk] stream boot=2126667643 ch=D0,D1,D3,D4 rate=4000   ← 起動時だけ
1923,2101,2088,2240                                        ← 1 行に 4 ch（region 0〜3 の順。12bit 0〜4095）
[stat] rate=4000 dropped=0                                 ← 1 秒ごと
```

- USB シリアル（115200 bps 指定。USB CDC なので速さは関係ない）。1 ch あたり毎秒 4000 回 = 1 行 250 µs。時刻は送られないので、アプリは受け取った行数から時刻を決める
- `[` で始まる行は状態表示。PC → ファームの命令は `view`（0.25 秒ごとの振れ幅表示。人が見る用）と `stream`（連続送信に戻す）だけ
- アプリ（アダプタ `xiao-stream`）
  - 接続したら `stream` を送り、データ行が 8 行続いたら接続とする（`hello` 相当、`fw: 'xiao-stream'`）
  - `mode` / `measure_noise` / `set_cal` は手元の検出器で処理し、`ack` / `noise` も手元で作る
  - ファームに保存場所がないので、校正値はアプリの設定（`Config.calibration`）に保存し、接続のたびに検出器へ入れる。`cal` は保存済みかどうか
- `Config.protocol` の既定 `auto` は、`stream` と `{"t":"ping"}` を両方送り、xiao-stream のデータ行か deskapi-v1 の `hello` のどちらが来たかで形式を決める


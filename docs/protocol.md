# ESP32 ⇔ PC シリアルプロトコル v1

- USB シリアル、115200 bps、8N1
- 1 行 1 メッセージの JSON（UTF-8、`\n` 区切り）。どのメッセージにも `t`（種類）がある
- JSON として読めない行は無視する（ESP32 の起動ログなどが混ざるため）
- 領域番号 `region`: 0 = 左上, 1 = 右上, 2 = 左下, 3 = 右下（ピエゾ ch0〜ch3 に対応）

## ESP32 → PC

| t | 例 | いつ |
|---|---|---|
| `hello` | `{"t":"hello","fw":"0.1.0","cal":true}` | 起動時と `ping` の応答。`cal` はキャリブレーション値が NVS にあるか |
| `tap` | `{"t":"tap","region":2,"count":1,"strength":"strong","confidence":0.82}` | 通常モードでタップ確定時 |
| `noise` | `{"t":"noise","peak":[41,38,52,40],"rms":[9,8,11,9]}` | `measure_noise` の結果 |
| `hit` | `{"t":"hit","peaks":[120,860,90,140],"ms":18}` | キャリブレーションモードで 1 打検出するたび。判定はしない |
| `ack` | `{"t":"ack","of":"set_cal","ok":true}` | `set_cal` / `mode` の応答。失敗時は `"ok":false,"err":"..."` |

### tap の値

- `count`: 1 または 2
- `strength`: `"weak"` / `"strong"`。2 回叩きは 2 打のうち強いほう
- `confidence`: 0〜1。最大チャネルのピークと 2 番目のピークの比から出す（`1 - second/first`）

## PC → ESP32

| t | 例 | 動作 |
|---|---|---|
| `ping` | `{"t":"ping"}` | `hello` を返す。PC は接続直後に送り、2 秒以内に `hello` が来なければ別ポートを試す |
| `mode` | `{"t":"mode","mode":"calibrate"}` | `"run"`（通常）/ `"calibrate"`（`tap` を出さず `hit` を出す） |
| `measure_noise` | `{"t":"measure_noise","ms":2000}` | 指定時間のノイズを測り `noise` を返す |
| `set_cal` | 下記 | 値を NVS に保存し `ack` を返す。以後の判定に即反映 |

```json
{"t":"set_cal","cal":{"threshold":[90,85,100,88],"strongMin":[520,480,600,500],"doubleWindowMs":320,"refractoryMs":70}}
```

- `threshold[i]`: ch i のピークがこれを超えたら打撃とみなす
- `strongMin[i]`: 打撃と判定した ch のピークがこれ以上なら強
- `doubleWindowMs`: 1 打目からこの時間内に 2 打目が来たら 2 回叩き。来なければ時間切れで 1 回として送る
- `refractoryMs`: 1 打検出後、振動の残りを無視する時間

キャリブレーション値がないときの既定値: `threshold` 全 ch 150、`strongMin` 全 ch 700、`doubleWindowMs` 320、`refractoryMs` 70（ADC 12bit の生値想定）

## PC 側のキャリブレーション計算

1. `mode calibrate` → `measure_noise 2000` → `noise` を受け取る
2. 領域 r ごとに弱 3 打、強 3 打。届いた `hit` の `peaks[r]` を記録する（`peaks` の最大が r でない打は数えない）
3. 値を決めて `set_cal` → `ack` → `mode run`
   - `threshold[r] = max(noise.peak[r] * 2, 弱 3 打の最小 * 0.5)`
   - `strongMin[r] = sqrt(弱の平均 * 強の平均)`（幾何平均）
   - 弱の最大 ≥ 強の最小のときは、その領域を「強弱が分かれない」として UI で領域をやり直させる
   - `doubleWindowMs`, `refractoryMs` は既定値のまま

## 判定（ファームウェア）

- 各 ch を 2 kHz 以上でサンプリングし、DC を引いた絶対値のピークを見る
- いずれかの ch が `threshold` を超えたら、そこから 15 ms の窓で全 ch のピークを取り、最大の ch を領域とする
- `refractoryMs` の間は次の打撃を見ない
- 1 打目のあと `doubleWindowMs` 待ち、同じ領域に 2 打目が来たら `count: 2`。別の領域に来たら 1 打目を `count: 1` で確定して送り、2 打目を新しい 1 打目として扱う

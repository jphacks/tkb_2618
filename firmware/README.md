# DeskAPI XIAO ESP32S3 ファームウェア（参考実装）

> 本番で書き込むファームはチームの [`xiao-stream/`](xiao-stream/xiao-stream.ino)（生値を送るだけ。判定はアプリ）。この README は `docs/protocol.md`（v1.1）の参考実装（判定をマイコンで行う版）のもので、アプリの検出器の移植元とテスト相手。アプリは `protocol: 'auto'` でどちらも見分ける。

仕様は [シリアルプロトコル](../docs/protocol.md)。PlatformIO / Arduino、
Seeed Studio XIAO ESP32S3 を既定とする。USB Serial/JTAG の CDC に
`Serial` を出力する（USB MODE=1 / CDC ON BOOT=1）。USB-UART チップは不要。

## 部品と配線

回路の正はチームの回路図 [`docs/circuit.html`](../docs/circuit.html)
（[元のページ](https://claude.ai/artifact/SdUvAXonEdvWRYHbBbfajF)）。回路は変えない。
部品は買い足さず、テーブルごとの違いはキャリブレーションの型・閾値・`refractoryMs` だけで吸収する。
以下はその要点。電源は XIAO の3V3、GNDは全体で共通。

| 部品（4 ch 全体） | 数 |
|---|---|
| NJU7043D（2回路、ボルテージフォロワ） | 2 |
| 10 kΩ（R1・R4） | 8 |
| 1 MΩ（R2・R3、全chで同じ値） | 8 |
| 小信号ショットキー 1SS106（手持ち。回路図の BAT43 / BAT85 / BAT54 と同じ用途） | 8 |
| 10 nF（C1） | 4 |
| 0.1 µF（IC電源デカップリング） | 2 |
| ピエゾ 7BB-27-4L0（約20 nF） | 4 |

1 ch 分（これを独立に4組）:

```text
ピエゾ片側 ─ GND
ピエゾもう片側 ─ R1 10kΩ ─ X ─ R4 10kΩ ─ NJU7043D +IN
                              │
                              ├─ R2 1MΩ ─ 3V3
                              ├─ R3 1MΩ ─ GND
                              ├─ C1 10nF ─ GND
                              ├─ D1 ─ 3V3 （アノードX、カソード3V3）
                              └─ D2 ─ GND （アノードGND、カソードX）
NJU7043D OUT ─ −IN （直結、利得1）
            └─ ADC （直結）
```

D1はアノードX・カソード3V3、D2はアノードGND・カソードXの
小信号ショットキーでクランプする。R2/R3はchごとの1.65 Vバイアス。
R1とC1で約1.6 kHzのローパスを構成する。
1N4148は順方向電圧が高いため使わない。1N5819も漏れ電流で
1 MΩのバイアスがずれるため使わない。

| ch / 領域 | IC回路 | +IN / −IN / OUT | XIAO | GPIO |
|---|---|---|---|---|
| 0 / 左上 | IC1 A | 3 / 2 / 1 | D0 | 1 |
| 1 / 右上 | IC1 B | 5 / 6 / 7 | D1 | 2 |
| 2 / 左下 | IC2 A | 3 / 2 / 1 | D3 | 4 |
| 3 / 右下 | IC2 B | 5 / 6 / 7 | D4 | 5 |

各ICは1–2番、7–6番を直結。8番を3V3、4番をGNDへ接続し、
8–4番間に0.1 µFをできるだけ近くに置く。
D2（GPIO3）はストラッピングピンなので使わない。
ADCは減衰12 dBで約0〜3.1 V、中点1.65 Vから約±1.4 Vを超える振幅は
飽和として扱う。Arduino-ESP32 2.xではこの減衰のAPI名は `ADC_11db`。

作業する範囲の4象限の中心あたりの天板の裏に、4個とも同じテープで貼る。
脚・フレーム・天板のつなぎ目の真上は避ける。金属のテーブルでは、
ピエゾの金属面が天板に触れないよう絶縁テープを1枚はさむ。

## 受入試験 T-01 / T-02

1. 通電前にテスターで3V3–GND間が短絡していないこと、各ICの8番が3V3、
   4番がGNDにつながっていることを確認する。
2. ピエゾをまだつながず通電し、各chのXとADCピン（D0/D1/D3/D4）が
   約1.65 Vであることをテスターで確認する。
3. T-01: ピエゾをつなぎ、PCアプリを閉じて
   `pio device monitor --port COM5 --baud 115200 --filter send_on_enter` を開く。
   `{"t":"mode","mode":"raw"}` を改行付きで送り、`ack` の `ok:true` を確認する。
   10 msごとの `raw.min` / `raw.max` は各4要素。無信号で2048付近、
   指で軽く叩くと1.65 Vを中心に振れてmin/maxの幅が広がることを見る。
   テスターだけでは振動を追えない。
4. T-02: 4つのセンサーの近くを順に叩き、近くのchの振幅が最大になることを確認する。
   隣のchにも同じ形の波形が出る場合は配線の引き回しを見直す。
5. 確認後 `{"t":"mode","mode":"run"}` を送り `ack` を確認する。
   rawモードはNVSに保存せず、再起動時はrunになる。

## ビルドと書き込み

PlatformIO Core または VS Code の PlatformIO IDE を用意し、
以下はすべて `firmware/` で実行する。

```powershell
pio run                          # 既定: XIAO ESP32S3
pio run -e xiao_esp32s3
pio test -e native               # 実機不要。PATH 上に GCC / G++ が必要
pio device list
pio run -e xiao_esp32s3 -t upload
pio device monitor --port COM5 --baud 115200
```

COM5 は実際のポート名に置き換える。必要なら upload にも
`--upload-port COM5` を付ける。書き込めないときは **BOOT（B）ボタンを
押しながら USB を挿す**。ポートを再確認して書き込む。
モニタと PC アプリは同時にポートを開かない。

## ほかのボード

`pio run -e esp32dev` は ESP32-DevKitC（ch0〜3 = GPIO32 / 33 / 34 / 35）、
`pio run -e esp32s3` は ESP32-S3-DevKitC-1-N8（GPIO1〜4）。
これらの env は USB–UART 側を使用する。upload / erase も該当 env を指定する。
接続できなければ BOOT を押しながら EN/RESET を押す。
入力には同じバイアス付きバッファを使用する。

## シリアルでの動作確認

115200 bps / 8N1、各 JSON の末尾に改行 LF を送る。CRLF も受け付ける。
USB データケーブルで XIAO を接続する。ポートを開くだけではリセットされない。
起動すると、未保存なら `{"t":"hello","fw":"0.1.0","cal":false}` が出る。
モニタが開く前に起動メッセージを逃した場合は、次を送る。

```json
{"t":"ping"}
```

1. 通常モードで左上を 1 回叩く。1 打目の開始から 320 ms 後に
   `{"t":"tap","region":0,"count":1,"strength":"weak","confidence":...}` が出る。
2. 同じ領域を 320 ms 以内に 2 回叩く。`count:2` が 1 回出て、強さは 2 打の強い方になる。
   他領域も `region` が表の対応になることを確認する。
3. キャリブレーションモードに切り替え、机を静かにしてノイズを測る。

```json
{"t":"mode","mode":"calibrate"}
{"t":"measure_noise","ms":2000}
```

`mode` の `ack` に続き、2 秒後に `noise` の `peak` / `rms` が各 4 要素で出る。
このモードで叩くと `tap` ではなく、4 ch のピークと捕捉時間 `ms`、余韻 `ring` を持つ `hit` が出る。
ノイズ測定中は机を叩かない。実際のキャリブレーション値の計算は PC 側の担当。

4. 保存と通常モードへの復帰を確認する。

```json
{"t":"set_cal","cal":{"threshold":[90,85,100,88],"strongMin":[520,480,600,500],"doubleWindowMs":320,"refractoryMs":70}}
{"t":"mode","mode":"run"}
{"t":"ping"}
```

`set_cal` / `mode` がそれぞれ `ok:true`、`hello` が `cal:true` になる。
リセット後にも `cal:true` で、保存した値が使われることを確認する。
例の数値は疎通確認用なので、最終的には実際の机で計測した値を保存する。
保存値を消す場合は `pio run -e xiao_esp32s3 -t erase --upload-port COM5` で
フラッシュ全体を消去してから、再度書き込む。

`mode` / `set_cal` の不正値には `ok:false` と `err` を返す。保存失敗時は
`nvs_write_failed`、コマンド処理待ちが満杯のときは `busy`。
不正 JSON、未知の種類、1024 バイト超の行は無視し、次の改行で受信を再開する。
`measure_noise` は正の uint32 ミリ秒を受け付け、計測中の追加要求や不正値は無視する。

## 実装と判定

- `lib/DeskApiCore/src/Detector.*`: Arduino に依存しない判定。最初のフレームで
  DC を初期化し、静穏時の EMA（係数 1/2048）で追従する。DC を引いた絶対値で判定する。
  起動直後の初期化は机を静かにして行う。
  無信号は約2048（1.65 V）で、正負どちらの振動も同じ絶対値として扱う。
  既定の threshold=150 / strongMin=700 は DC 除去後の振幅なので変更しない。
  native テストで全4 ch、両極性の振動、151 / 699 / 700 / 1200 の振幅を確認する。
  実際の机・取り付け・ch差に適した値は PC のキャリブレーションで決める。
- `src/main.cpp`: 500 µs 周期の `esp_timer` が専用 FreeRTOS タスクを通知する。
  タスクは ADC1 を ch0→ch3 の順に読み、各 ch 2 kHz を目標に判定する。
  JSON の解析・生成、USB シリアル送信、NVS 書き込みは `loop()` 側で行う。
  実際のサンプル間隔と NVS 書き込み時のフラッシュアクセスの影響は実機で確認する。
- 閾値を超えたサンプルから `[開始, 開始+15 ms)` のピークを捕捉し、
  保存された型とのコサイン類似度で領域を決める（型なしの旧保存値は全 ch の最大）。同値は小さい ch を選び、confidence は 0 になる。
  その後 `refractoryMs` の間は残留振動を無視する。
- 連打の時間は打撃開始時刻同士で比較する。時間窓の境界を含み、
  別領域なら先の 1 打を確定する。2 回叩きの confidence は 2 打の小さい方。
  強さは最大 ch が `strongMin` 以上なら strong、2 打では強い方を使う。
- `mode` / `set_cal` 成功時は捕捉中・確定待ちの打撃を捨て、新しい条件で再開する。
  設定を保存してタスクに反映した後に `ack` を返す。
- NVS の名前空間 `deskapi` / キー `cal_v1` に設定全体を 1 つの JSON として保存する。
  欠落・破損した保存値では既定値（150 / 700 / 320 ms / 70 ms）を使う。
  ADC 値は 0〜4095 の有限数（小数も可）、doubleWindowMs は正の uint32、
  refractoryMs は 0 以上の uint32 に限定する。
- ノイズは DC 除去後の絶対値について、指定時間の全フレームから最大と RMS を計算する。
  ノイズ測定は打撃判定と並行する。
- rawはサンプリング側で10 msの半開区間の生値min/maxを集計し、loop側でJSON化する。
  raw中はhit/tapを出さない。
- 15 ms窓内のどれかのchのDC除去後絶対値が1800以上ならhit/tapに `sat:true` を付ける。
  2打ではどちらかが飽和していれば付ける。非飽和なら省略し、棄却はPC側で行う。
- タスク間の設定キューは 8 件、送信イベントキューは 64 件。ホスト停止などで
  送信が詰まった場合、新しい打撃・ノイズの通知を捨ててサンプリングを継続する。
  XIAO の CDC 送信待ちは0、TXバッファは1024バイトとし、1行全体と改行が
  入る空きがなければその通知を捨てる。Serial の接続待ちループは置かない。
  PC は接続時に ping を送り、既存の hello 応答で起動通知の見逃しを補う。
  切断・混雑時の応答も再送しないため PC 側のタイムアウト後に再接続する。
  設定応答には別のキューと予約枠を使い、打撃イベントの混雑による `ack` の欠落を防ぐ。

キャリブレーションの `hit.ring` は開始から全chが閾値未満で10 ms続くまで（最大1000 ms）。
15 ms窓のピーク・飽和フラグを保持し、余韻測定が終わってから送信する。
`templates` は4×4の有限・非零ベクトルを受け付け、各行を正規化してNVSに保存する。
型ありのconfidenceは `(s1-s2)/(1-s2)` を0〜1に制限する。

## テストと依存

`test/test_core/` の native テストは、閾値・ピーク窓・領域・強弱・連打境界・
残留振動・DC 除去・長時間稼働・モード切替・ノイズ peak/RMS と、
全プロトコルメッセージの解析/生成・不正入力・保存データの復元を確認する。
ADC の実際の入力、サンプル周期、USB 通信、NVS の実機永続化はハード入手後に上記手順で確認する。

実行時の追加ライブラリは **ArduinoJson 6.21.5** のみ（改行 JSON の安全な解析・生成用）。
Arduino framework に含まれる Preferences / FreeRTOS / esp_timer を利用し、
テストでは PlatformIO 標準の Unity を利用する。

実装時に参照した一次資料:

- [Espressif: ESP Timer（使用する ESP-IDF 4.4）](https://docs.espressif.com/projects/esp-idf/en/v4.4/esp32/api-reference/system/esp_timer.html)
- [Espressif: Arduino ADC API](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/adc.html)
- [Espressif: Preferences 2.0.17 の実装](https://github.com/espressif/arduino-esp32/blob/2.0.17/libraries/Preferences/src/Preferences.cpp)
- [PlatformIO: native と GCC の準備](https://docs.platformio.org/en/latest/platforms/native.html)
- [PlatformIO: Unity テスト](https://docs.platformio.org/en/latest/advanced/unit-testing/frameworks/unity.html)

# DeskAPI ESP32 ファームウェア

仕様は [`../docs/protocol.md`](../docs/protocol.md)。ESP32-DevKitC を既定にした
PlatformIO / Arduino プロジェクト。ESP32-S3-DevKitC-1-N8 にも対応する。

## 配線

4 個のピエゾを机の各領域に固定し、次の対応で ADC1 に接続する。
すべての GND は ESP32 の GND と共通にする。

| ch / region | 領域 | ESP32-DevKitC | ESP32-S3 |
|---|---|---|---|
| 0 | 左上 | GPIO32 | GPIO1 |
| 1 | 右上 | GPIO33 | GPIO2 |
| 2 | 左下 | GPIO34 | GPIO3 |
| 3 | 右下 | GPIO35 | GPIO4 |

各 ch に同じ回路を用意する。1 MΩ はピエゾと並列、保護回路は ADC の直前に置く。

```text
ピエゾ信号端子 ──┬── [10 kΩ 直列保護抵抗] ──┬── ADC1 GPIO
                 │                          │
               [1 MΩ]                       ├── 正電圧クランプ ── GND
                 │                          └── 負電圧クランプ ── GND
ピエゾ GND端子 ──┴────────────────────────────── ESP32 GND
```

- 正側は 3.0 V 級のツェナー（カソードを ADC、アノードを GND）などで保護する。
  定格だけでなく実際の電流・許容差で **ADC 入力が 3.3 V を超えない** 部品・回路を選ぶ。
- 負側はショットキー（アノードを GND、カソードを ADC）で保護する。
  正側もショットキーで構成する場合は、順方向電圧を加えても 3.3 V 以下になる
  クランプ先の電圧を用意する。
- 実機で最大打撃時の ADC 入力電圧を確認してから接続する。ピエゾを GPIO に直結しない。
- USB は両ボードとも **USB–UART 側** を使用する。S3 のネイティブ USB CDC はこの env では使わない。

## ビルドと書き込み

PlatformIO Core、または VS Code の PlatformIO IDE をインストールする。
以下はすべて `firmware/` で実行する。

```powershell
pio run                          # 既定: ESP32-DevKitC
pio run -e esp32s3                # ESP32-S3-DevKitC-1-N8
pio test -e native               # 実機不要。PATH 上に GCC / G++ が必要
pio device list
pio run -e esp32dev -t upload --upload-port COM5
pio device monitor --port COM5 --baud 115200
```

S3 は upload 時も `-e esp32s3` を指定する。COM5 は実際のポート名に置き換える。
アップロード開始時に接続できない場合は BOOT を押しながら EN/RESET を押し、
接続が始まったら BOOT を離す。

今回の検証用に作成した `.venv/` を使う場合、`pio` の代わりに
`.venv/Scripts/python.exe -m platformio` とする。`.venv/` と `.pio/` は Git 管理対象外。

## シリアルでの動作確認

115200 bps / 8N1、各 JSON の末尾に改行 LF を送る。CRLF も受け付ける。
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
このモードで叩くと `tap` ではなく、4 ch のピークと捕捉時間 `ms` を持つ `hit` が出る。
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
保存値を消す場合は `pio run -e esp32dev -t erase --upload-port COM5` で
フラッシュ全体を消去してから、再度書き込む。

`mode` / `set_cal` の不正値には `ok:false` と `err` を返す。保存失敗時は
`nvs_write_failed`、コマンド処理待ちが満杯のときは `busy`。
不正 JSON、未知の種類、512 バイト超の行は無視し、次の改行で受信を再開する。
`measure_noise` は正の uint32 ミリ秒を受け付け、計測中の追加要求や不正値は無視する。

## 実装と判定

- `lib/DeskApiCore/src/Detector.*`: Arduino に依存しない判定。最初のフレームで
  DC を初期化し、静穏時の EMA（係数 1/2048）で追従する。DC を引いた絶対値で判定する。
  起動直後の初期化は机を静かにして行う。
- `src/main.cpp`: 500 µs 周期の `esp_timer` が専用 FreeRTOS タスクを通知する。
  タスクは ADC1 を ch0→ch3 の順に読み、各 ch 2 kHz を目標に判定する。
  JSON の解析・生成、USB シリアル送信、NVS 書き込みは `loop()` 側で行う。
  実際のサンプル間隔と NVS 書き込み時のフラッシュアクセスの影響は実機で確認する。
- 閾値を超えたサンプルから `[開始, 開始+15 ms)` のピークを捕捉し、
  全 ch の最大で領域を決める。同値は小さい ch を選び、confidence は 0 になる。
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
- タスク間の設定キューは 8 件、送信イベントキューは 64 件。ホスト停止などで
  送信が詰まった場合、新しい打撃・ノイズの通知を捨ててサンプリングを継続する。
  設定応答には別のキューと予約枠を使い、打撃イベントの混雑による `ack` の欠落を防ぐ。

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

# 04 ESP32 ファームウェア

`app/` には触らない。`firmware/` に PlatformIO（Arduino framework）のプロジェクトを作る。

## 前提

- ボード: ESP32-DevKitC（`esp32dev`）を既定にし、ESP32-S3 用の env も用意する
- ピエゾ 4 個を ADC1 の 4 ピン（GPIO 32/33/34/35。S3 は 1/2/3/4）に入れる。各ピエゾには 1 MΩ の並列抵抗と、3.3 V を超えないようにクランプ（ショットキー or ツェナー）を付ける前提。配線図を `firmware/README.md` に書く

## やること

- `docs/protocol.md` を全部実装する（hello / tap / noise / hit / ack、ping / mode / measure_noise / set_cal、NVS 保存、既定値、判定アルゴリズム）
- サンプリングはタイマー割り込みかタスクで 2 kHz 以上、ch を順に読む。JSON 送信はループ側で行い、判定を止めない
- 判定ロジック（ピーク検出・領域決定・強弱・2 回叩き）はハードに依存しない C++ にして `firmware/test/` で PlatformIO の native テストを書く
- `pio` が入っていなければ、ビルド確認は省略してよいが、その旨を報告する

## 完了条件

- `pio run`（入っていれば）と native テストが通る
- `firmware/README.md` に配線、書き込み手順、動作確認手順（シリアルモニタで tap が出る）を書く

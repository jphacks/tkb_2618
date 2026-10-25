# 09 ファームウェアの形式を差し替えられるようにする

`app/` だけ。`firmware/` には触らない。機能は変えない。

## 背景

ESP32 に書き込むファームは別の担当のコードに決まる予定で、`firmware/`（こちらの参考実装）は本番では使わない。相手のシリアルの形式はまだ分からない。今は `src/main/serial-device.ts` に `docs/protocol.md`（v1.1）の JSON の解釈・組み立てが直接書かれているので、形式が違うとあちこち直すことになる。アプリがファームに求めることは `docs/firmware-interface.md`。

## やること

1. **プロトコルのアダプタ**を `src/main/protocols/` に作る。シリアルの形式に依存するものはすべてここに閉じ込める

   ```ts
   // 形のイメージ。名前・細部は任せる
   interface DeviceProtocol {
     id: string                       // 'deskapi-v1'
     serial: { baudRate: number }     // 115200 など
     capabilities: { calibration: boolean; raw: boolean }
     handshake(): { send?: string; isHello(e: DeviceEvent): boolean; timeoutMs: number }
     parseLine(line: string): DeviceEvent | null   // 読めない行は null
     encode(command: DeviceCommand): string | null // 対応しない命令は null
   }
   ```

   - `DeviceEvent` / `DeviceCommand` はアプリ内部の形（`src/shared/types.ts`）で、今の `tap` / `hit` / `noise` / `ack` / `hello` / `raw` と `ping` / `mode` / `measure_noise` / `set_cal` を表せること。シリアルの JSON の形とは切り離す
   - 今の v1.1 を `deskapi-v1.ts` として移す（`valid()` もここへ）。動きは変えない
   - `SerialDevice` はアダプタだけを使う（行の分割、ポートの開閉、再接続、ACK 待ち、キューは今のまま `SerialDevice` に残す）
2. **使うアダプタの選び方**: 既定は `deskapi-v1`。Config に `protocol`（既定 `'deskapi-v1'`）を足し、`src/main/protocols/index.ts` の一覧から選ぶ。UI には出さない（歯車パネルは今の 3 項目のまま）。旧設定は既定値で読めること
3. **できないことで落ちない**: `capabilities.calibration` が false なら、キャリブレーションボタンを押せなくし（`disabled`、デザインどおりの見た目）、赤い点も出さない。`DeviceStatus` に `capabilities` を載せて renderer に渡す。`hello` に `cal` がない・版がないファームでも接続できること
4. **ログを流し込むテスト**: テキストファイル（1 行 1 メッセージのシリアルの記録）を `parseLine` に通して、期待する `DeviceEvent` の列と比べるテストの仕組みを `tests/` に作る。v1.1 の記録の例（`tests/fixtures/deskapi-v1.log`: 起動ログの混ざった hello、16 種類の tap、sat 付き、壊れた行）で確かめる。新しいアダプタを足すときは、記録とテストを 1 組足すだけで済むようにする
5. **シリアルを記録する道具**: `npm run serial-log -- COM5 [baud]` で、指定ポートを開いて届いた行を時刻付きでファイル（`serial-log-<日時>.txt`、カレントディレクトリ）に保存し、画面にも出す。Ctrl+C で止める。`serialport` は入っているので依存は足さない。Windows で、書き込み担当のファームの出力を記録して PM に渡すのに使う
6. `docs/` は PM が直すので触らない。README などに書くことがあれば報告に書く

## 完了条件

- `npm run typecheck` / `npm run build` / `npm run test` が通る。今のテスト（シリアル・キャリブレーション・hotkey）も通ったまま
- `src/main/` で、`protocols/` 以外にシリアルの JSON の形（`"t":"tap"` など）を知っているコードがない
- `capabilities.calibration: false` のテスト用アダプタで、接続・タップが動き、キャリブレーションを始めようとしても落ちない（テストで確認）
- `DESKAPI_MOCK=1` の動きは変わらない
- 報告に、新しいファームが来たときの手順（どのファイルを足すか）を短く書く

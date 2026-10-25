# 03 シリアル接続とキャリブレーション

前提: 01 が終わっている（02 と並行しない）。

## やること

1. `serialport` を入れ、`SerialDevice` を実装（`docs/protocol.md`, `docs/spec.md` のデバイス接続節）
   - 自動検出、`ping`/`hello`、2 秒ごとの再接続、行単位の JSON パース、壊れた行の無視
   - electron-builder でネイティブモジュールが同梱されるよう設定（`asarUnpack` など）
2. キャリブレーションの main 側
   - `mode calibrate` → `measure_noise` → `hit` を renderer に流す → renderer の集計結果から `docs/protocol.md` の計算で値を出す → `set_cal` → `ack` → `mode run`
   - 計算は `src/shared/calibration.ts` の純粋関数にし、`node --test` で動く単体テストを付ける（強弱が分かれないケースを含む）
   - 画面を閉じた・キャンセルしたら必ず `mode run` に戻す
3. 実機がないので、仮想シリアルの代わりに「行を流し込める Duplex」を使ったテストで、接続 → hello → tap → 切断 → 再接続の流れを確認する

## 完了条件

- `npm run typecheck` / `npm run build` / テストが通る
- `DESKAPI_MOCK` なしで起動しても落ちず、未接続表示になる
- 報告に、実機が来たら確認すべき項目を列挙する

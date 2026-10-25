# 16 tap-collect から強弱をなくす

強弱（弱 / 強）の判定は製品から削除した。キーは 4 領域 × 1 回 / 2 回 = 8 個。アプリ側は変更済み。tools/tap-collect をアプリに合わせる。

## アプリ側で変わったこと（読むだけ。変えない）

- `app/src/shared/tap-procedure.ts`: `STEPS` は領域ごとに 1 段（4 段）。`STEPS[i] = { region: i }`
- `app/src/shared/calibration.ts`: `calculateCalibration(noise, samples)` の samples は 4 段 × 3 打。`strongMin` はなくなった。しきい値は ch ごと
- `app/src/shared/types.ts`: `TapEvent` に `strength` がない。`Calibration` に `strongMin` がない。`keyIndexOf = region * 2 + count - 1`

## やること

1. collect.mjs / core.mjs のキャリブレーションの部を、領域ごとに 1 段（`cal_single_<zone>`、3 打、強さの指示なし）にする。表示する指示も「叩く」だけにする。cal_double はそのまま。
2. 使用の部の既定から強弱をなくす（ラベルは `<zone>_<count>`）。`--strengths` のような強弱のオプションがあれば消す。
3. score.mjs / scoring.mjs / detectors/app.mjs / diagnostics.mjs:
   - 採点から強さをなくす。完全一致は「領域と回数が合う」。強さの指標・強弱の振幅の診断を消す。混同行列は 8 キー＋none / multiple。
   - app 採点の校正は、`zones.indexOf(zone)` を段の番号にする。**旧ログ**（`cal_single_<zone>_weak` / `_strong` がある）も読めること。旧ログでは同じ領域の弱・強の試行を 1 段にまとめ、合わせた山から `pickHits` で 3 打を選ぶ。
   - 旧ログの使用の部のラベル `<zone>_<count>_<strength>` は、強さを無視して採点する。
   - `params` の許可リストから `strongMin` を消す。
4. README（tap-collect の README と、core.mjs が書くセッションの README）から強弱の記述を消す。
5. テストを直し、足りなければ足す（旧ログ形式の校正・採点が通るテストを含める）。

## 守ること

- アプリのファイル（app/ 以下）は変えない。
- `tap-logs/` の既存ログは変えない・消さない。
- 依存は追加しない。git commit / push はしない。
- 実機（COM5）を開くものは起動しない。起動したプロセスは終わる前にすべて止める。

## 完了条件

- tools/tap-collect で `npm test` がすべて通る。
- `node score.mjs --detector app --session tap-logs/20261025-033727` が強さなしで動き、結果を出す。

## 報告

変更したファイル、要点、テストの件数を日本語で報告する。

# tap-collect

Windows の Node.js 22 以降で `npm ci` を実行する。アプリや Arduino IDE のシリアルモニタなど、同じ COM ポートを開くものは閉じる。

```powershell
node collect.mjs --list
node collect.mjs --port COM5
node collect.mjs --mock
node collect.mjs --resume tap-logs/20261025-183000
```

机・センサーのメモを入力すると自動で進む。静止 3 秒 → 領域ごとの弱・強の単打（各 3 打）→ 領域ごとの 2 回叩き（各 2 セット）の固定順でキャリブレーションを記録する。続く使用の部は 16 パターン各 3 試行と叩き以外の 4 試行。指示から合図まで 1.5 秒で、その最後の 1 秒は机に触れず基準値を記録する。使用の部は各 2 秒、叩き以外は各 3 秒。`--order` と `--seed` は使用の部の並びだけに効く。

各区間の終了時に ch ごとの最大のずれと山の数を 1 行で表示する。山は静止の最大のずれ × 3 を超えた波を数えた確認用の値で、採点には使わない。

- `r`: 記録中ならその試行、指示待ちなら直前の完了試行を redo にして撮り直す。
- `n`: 直前の完了試行にメモ。入力中は進行を止める。記録中の試行は aborted にして撮り直す。
- Space: 一時停止 / 再開。記録中の試行は aborted にして再開後に撮り直す。
- `q` / Ctrl+C: 保存して終了。`--resume` で未完了の試行から続ける。

既定は 65 試行、操作・再接続・撮り直しを除いて 268.5 秒（約 4 分半）。4000 Hz で raw.csv は約 29 MB。机の上で約 5 分のセッションを何度も撮り、合算して比べる。

```powershell
node score.mjs --detector app --session tap-logs/A tap-logs/B tap-logs/C
node score.mjs --detector app --calibrate tap-logs/A --test tap-logs/B
node score.mjs --detector takker --takker <sensor-runtime のフォルダ> --channels D0,D4 --session tap-logs/A
```

app の採点には app/node_modules/typescript が必要。各セッションのキャリブレーションの部だけで基準を決め、使用の部だけで採点する。センサーの貼り直しや別の日の影響は `--calibrate A --test B` で確認する。旧 `--cv` / `--train` と、キャリブレーションの部がない旧ログは使えない。出力は score.md、score.json、predictions.jsonl。合成データの点数は実機の性能を表さない。

各ログの README.md に CSV・JSONL の形式を保存する。phase は calibration / use、kind は calibration / cal_single / cal_double / tap / rest / typing / place / lean。cal_single は count: 1、sets: 3、cal_double は count: 2、sets: 2、strength: null。同じ n の行が複数ある場合は最後の行が確定値（後からの redo・メモ）。同じ id の最後の ok を採用する。raw.csv と試行別 CSV は不採用・中断区間も保存する。

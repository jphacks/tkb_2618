# tap-collect

Windows の Node.js 22 以降で、`app/` と `tools/tap-collect/` の両方で `npm ci` を実行する。アプリや Arduino IDE のシリアルモニタなど、同じ COM ポートを開くものは閉じる。

記録・採点はアプリの `tap-procedure.ts` を共用し、手順の時間・山の数え方・基準値・ピーク・打撃の選択をそろえる。`app/node_modules/typescript` の tsc で一時ディレクトリにコンパイルし、ソースの内容が変わらなければキャッシュを再利用する。

```powershell
npm start
```

`npm start` だけで、接続ポートを自動検出し、メモ入力を省略して新規の記録を開始する。ポートが複数ある場合は `npm start -- --port COM5` で指定する。メモを残すなら `npm start -- --table "机のメモ" --sensors "センサーのメモ"`。`pnpm start` でも同じ。

ポートの一覧、メモを対話入力して開始、実機なしでの確認、記録の再開:

```powershell
node collect.mjs --list
node collect.mjs
node collect.mjs --mock
node collect.mjs --resume tap-logs/20261025-183000
```

机・センサーのメモを入力すると自動で進む。静止 3 秒 → 領域ごとの単打（各 3 打、4 段）→ 領域ごとの 2 回叩き（各 2 セット）の固定順でキャリブレーションを記録する。続く使用の部は 8 パターン各 1 試行と叩き以外の 4 試行。指示から合図まで 2 秒で、その最後の 1 秒は机に触れず基準値を記録する。叩く区間は校正・使用とも 5 秒、叩き以外は各 3 秒。指示に試行番号と総数を出し、「叩いて」は各試行で 1 回だけ表示する。進捗行は時間とバーだけ。`--order` と `--seed` は使用の部の並びだけに効く。

「2 回叩き」はダブルタップ（トントンと素早く 2 回叩くこと）を指し、校正の 2 セットはセットの間をあける。

各区間の終了時に ch ごとの最大のずれを 1 行で表示する。校正用の打撃記録（cal_single / cal_double）では、静止の最大のずれ × 1.5 を超えた波の数も表示し、その場で打撃を拾えているか確認できる。静止の測定と使用の部では山を表示しない。山は確認用の値で、検出器の校正・採点には使わない。旧ログの山の数（× 3）とは直接比較しない。記録中に検出器の校正は行わず、`score.mjs` が保存したキャリブレーションの部から校正し、使用の部を校正済みの検出器で判定する。

- `r`: 記録中ならその試行、指示待ちなら直前の完了試行を redo にして撮り直す。
- `n`: 直前の完了試行にメモ。入力中は進行を止める。記録中の試行は aborted にして撮り直す。
- Space: 一時停止 / 再開。記録中の試行は aborted にして再開後に撮り直す。
- `q` / Ctrl+C: 保存して終了。`--resume` で未完了の試行から続ける。

typing の記録中（合図前の基準値の区間を含む）は Ctrl+C 以外のキーをすべて無視し、events.jsonl にも残さない。記録が終わると通常のキー操作に戻る。

既定は 21 試行、操作・再接続・撮り直しを除いて 137 秒（2 分 17 秒）。4000 Hz で raw.csv は約 15 MB。後半の繰り返しは `--reps`、後半の叩く時間は `--window`、指示から合図までの時間は `--prepare`（1 秒以上）で変更できる。`--resume` は元の試行数・記録時間・待ち時間を引き継ぐため、新しい既定値で撮るときは新規に開始する。短いセッションを何度も撮り、合算して比べる。

```powershell
node score.mjs --detector app --session tap-logs/A tap-logs/B tap-logs/C
node score.mjs --detector app --calibrate tap-logs/A --test tap-logs/B
node score.mjs --detector takker --takker <sensor-runtime のフォルダ> --channels D0,D4 --session tap-logs/A
```

app の採点には app/node_modules/typescript が必要。各セッションのキャリブレーションの部だけで基準を決め、使用の部だけで採点する。センサーの貼り直しや別の日の影響は `--calibrate A --test B` で確認する。旧 `--cv` / `--train` と、キャリブレーションの部がない旧ログは使えない。出力は score.md、score.json、predictions.jsonl。合成データの点数は実機の性能を表さない。

app の採点用アダプタはアプリの共通処理（`tap-procedure.ts`）を使い、校正用の打撃を記録した静止ピーク × 1.5（最低 1）で抽出する。各区間の合図前の中央値を基準にし、同じ領域の単打試行の山をまとめ、設定画面と同じく飽和していない山のうち振幅が大きい 3 個を校正に使う。固定 150 で校正用の打撃を探さない。使用の部の判定には、集めた打撃から計算した校正値を使う。完全一致は領域と回数の一致で、混同行列は 8 キーと none / multiple。校正用のしきい値は score.json の calibrationThresholds に残す。

各ログの README.md に CSV・JSONL の形式を保存する。phase は calibration / use、kind は calibration / cal_single / cal_double / tap / rest / typing / place / lean。cal_single は count: 1、sets: 3、ラベル cal_single_<zone>、cal_double は count: 2、sets: 2。使用の部の叩くラベルは <zone>_<count>。同じ n の行が複数ある場合は最後の行が確定値（後からの redo・メモ）。同じ id の最後の ok を採用する。raw.csv と試行別 CSV は不採用・中断区間も保存する。

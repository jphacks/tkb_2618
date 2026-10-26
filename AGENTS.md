# DeskAPI — エージェント向けガイド

机を叩くと、割り当てたショートカットが動く。JPHACKS 作品。

- 机の 4 領域（左上 / 右上 / 左下 / 右下）× 回数（1 回 / 2 回）= 8 キー（強弱は 2026-10-25 に削除）
- XIAO ESP32S3 + ピエゾ 4 個の生値を USB シリアルで PC に送り、PC アプリが判定する（ハードは購入済み。開発環境に実機はないので、実機なしでも動くこと）。任意のテーブルで成り立たせる
- PC アプリは Windows 専用の Electron 常駐アプリ（設定画面は React）

## 役割

- PM と視覚の制作（UI デザイン、動画、図）: Claude。仕様と見た目の正は `docs/` にある
- 単純な実装: Codex。`docs/tasks/` のタスク書を 1 つずつ実装する

## 正となるドキュメント

正はコード（main）。下のドキュメントとコードが食い違ったら、コードに合わせてドキュメントを直す。ドキュメントに決まったことを書くときは、話した日付を添える。

| ファイル | 中身 |
|---|---|
| `docs/spec.md` | 製品仕様、設定データの形、各アクションの動き |
| `docs/protocol.md` | ESP32 ⇔ PC のシリアルプロトコル。本番ファーム `xiao-stream`（生値を送るだけ。判定はアプリの検出器）と、参考実装の JSON `deskapi-v1` |
| `docs/design/settings.dc.html` | 設定画面のデザイン（承認済み）。色・寸法・アイコンの SVG パスはここから写す |
| `docs/design/calibrate.dc.html` | キャリブレーション画面のデザイン（承認済み） |
| `docs/circuit.html` | 入力回路（チームの回路図）。**回路は変えない**。ピン・部品・受入試験はここが正 |
| `docs/hardware-test.md` | Windows の PC で実機をつないで確かめる手順 |
| `docs/setup.md` | 別の PC で開発を始める手順（入れるもの、`npm ci`、Git に入っていないもの） |
| `docs/tasks/NN-*.md` | 実装タスク。完了条件まで満たすこと。書いた時点の指示なので、終わったタスクの中身は今のコードと違うことがある |

`*.dc.html` は独自テンプレート形式のデザインモックで、そのままでは動かない。`<script type="text/x-dc">` 内の定数（`IC`, `COLORS`, `ACTS` など）と、テンプレート部のインラインスタイルを React + Tailwind に移植する。

## 構成

```
app/          Electron アプリ（electron-vite）
  src/main/       メインプロセス（シリアル、アクション実行、トレイ、通知）
    protocols/      シリアルの形式のアダプタと検出器（判定）。形式を知っているのはここだけ
  src/preload/    contextBridge で window.deskapi を公開
  src/renderer/   React 19 + Tailwind v4 の設定画面
  src/shared/     main / renderer 共通の型と定数
firmware/     ESP32 ファームウェア
  xiao-stream/    本番（チームのコード、Arduino IDE で書き込む）。触らない
  それ以外         参考実装（PlatformIO。判定をマイコンで行う版。検出器の移植元とテスト相手）
docs/         仕様・デザイン・タスク
```

## キャリブレーションは tap-collect と同期する

- キャリブレーションの最適化は `tools/tap-collect` で行い、score.mjs の点で良くなったものを本番（アプリ）に採用する。手順の正は collect.mjs
- アプリと tap-collect は同じコードを使う。score.mjs の app 採点（`detectors/app.mjs`）は、アプリの次のファイルをコンパイルして使う
  - `app/src/shared/tap-procedure.ts`：手順の時間、打（山）の数え方、使う 3 打の選び方
  - `app/src/shared/calibration.ts`：校正値の計算（ch ごとのしきい値、型、不感時間、2 回叩きの待ち時間）
  - `app/src/main/recorder.ts`：アプリでの記録（上の 2 つを使う）
- 数え方や校正値の式を変えるときは、tap-collect に複製を作らずに、上のアプリのファイルを直し、score.mjs で採点する。そうすれば本番にもそのまま入る
- collect.mjs の手順（静止 3 秒、指示から合図まで 2 秒、そのうち最後の 1 秒が基準値、叩く区間 5 秒、静止のピーク × 1.5、50 ms の間で区切る）を変えたら、`tap-procedure.ts` の定数も同じ値にする。2 回叩きは最適化しない

## 実装ルール

- TypeScript strict。main と renderer で共有する型は `app/src/shared/` に置き、二重定義しない
- renderer は Node API に触れない（`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`）。IPC は `src/shared/ipc.ts` の型付き API だけ
- UI 文言は日本語。デザインにない説明文・ラベル・ツールチップ以外のテキストを足さない（アイコンで分かるものに文字を付けない。`aria-label` / `title` は付ける）
- 影・グラデーション・質感表現は入れない（フラット）。色はデザインの定数を使う
- 実機がなくても全画面が動くこと。デバイス未接続時は「未接続」表示になるだけで落ちない
- 開発用のタップ擬似入力は `DESKAPI_MOCK=1` のときだけ有効にし、本番 UI にシミュレータを出さない
- 依存の追加は必要最小限。追加したら理由をタスク完了報告に書く
- `git commit` / `git push` はしない（PM がレビューしてからコミットする）

## 確認コマンド（app/ で実行）

```
npm run typecheck
npm run build
npm run dev          # 画面確認用
```

タスクの最後に `typecheck` と `build` が通ることを確認し、通らないまま終えない。

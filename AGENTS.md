# DeskAPI — エージェント向けガイド

机を叩くと、割り当てたショートカットが動く。JPHACKS 作品。

- 机の 4 領域（左上 / 右上 / 左下 / 右下）× 回数（1 回 / 2 回）× 強さ（弱 / 強）= 16 キー
- XIAO ESP32S3 + ピエゾ 4 個が判定し、USB シリアルで PC に送る（ハードは購入済み。開発環境に実機はないので、実機なしでも動くこと）。任意のテーブルで成り立たせる
- PC アプリは Windows 専用の Electron 常駐アプリ（設定画面は React）

## 役割

- PM / UI デザイン: Claude。仕様と見た目の正は `docs/` にある
- 実装: Codex。`docs/tasks/` のタスク書を 1 つずつ実装する

## 正となるドキュメント

| ファイル | 中身 |
|---|---|
| `docs/spec.md` | 製品仕様、設定データの形、各アクションの動き |
| `docs/protocol.md` | ESP32 ⇔ PC のシリアルプロトコル（参考実装 `firmware/` とアプリの既定アダプタ `deskapi-v1`） |
| `docs/firmware-interface.md` | アプリがファームに求めること。本番のファームは別担当のコードになる予定で、形式の違いは `app/src/main/protocols/` のアダプタで吸収する |
| `docs/design/settings.dc.html` | 設定画面のデザイン（承認済み）。色・寸法・アイコンの SVG パスはここから写す |
| `docs/design/calibrate.dc.html` | キャリブレーション画面のデザイン（承認済み） |
| `docs/circuit.html` | 入力回路（チームの回路図）。**回路は変えない**。ピン・部品・受入試験はここが正 |
| `docs/hardware-test.md` | Windows の PC で実機をつないで確かめる手順 |
| `docs/tasks/NN-*.md` | 実装タスク。完了条件まで満たすこと |

`*.dc.html` は独自テンプレート形式のデザインモックで、そのままでは動かない。`<script type="text/x-dc">` 内の定数（`IC`, `COLORS`, `ACTS` など）と、テンプレート部のインラインスタイルを React + Tailwind に移植する。

## 構成

```
app/          Electron アプリ（electron-vite）
  src/main/       メインプロセス（シリアル、アクション実行、トレイ、通知）
    protocols/      シリアルの形式のアダプタ。形式を知っているのはここだけ
  src/preload/    contextBridge で window.deskapi を公開
  src/renderer/   React 19 + Tailwind v4 の設定画面
  src/shared/     main / renderer 共通の型と定数
firmware/     ESP32 ファームウェアの参考実装（PlatformIO, Arduino）。本番は別担当のコード
docs/         仕様・デザイン・タスク
```

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

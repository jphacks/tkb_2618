# 別の PC で開発を始める

Windows 11 の PC で、このリポジトリの開発（アプリ・tap-collect・ファーム書き込み・Claude / Codex での作業）を再開する手順。2026-10-25 に Node.js 24.14 / npm 11.9 で確認。

## 1. 入れるもの

| もの | 用途 | 確認 |
|---|---|---|
| Git for Windows | クローン。Claude Code の Bash ツールも Git Bash を使う | `git --version` |
| Node.js 22 以降（24 推奨） | アプリ・tap-collect | `node -v` |
| Claude Code | PM / デザイン（`CLAUDE.md` を読む） | `claude --version` |
| Codex CLI | 実装（`AGENTS.md` と `docs/tasks/` を読む） | `codex --version` |
| Arduino IDE 2 + ESP32 ボード定義 | 本番ファーム `firmware/xiao-stream/` の書き込み（ボードは XIAO_ESP32S3、USB CDC On Boot: Enabled） | |
| PlatformIO（任意） | 参考実装のファーム（`firmware/platformio.ini`）。`uv tool install platformio` | `pio --version` |
| GitHub CLI（任意） | PR 作成など | `gh --version` |

## 2. クローン

```powershell
git clone https://github.com/jphacks/tkb_2618.git
cd tkb_2618
git switch yub4-arema
```

作業ブランチは `yub4-arema`。`jphacks/tkb_2628` は別チームのリポジトリなので触らない。

## 3. 依存を入れる

`koffi` と `serialport` は OS ごとに別バイナリなので、`node_modules` はコピーせず、その PC で `npm ci` する。ロックファイルは `package-lock.json`（npm）が正。

```powershell
cd app;                npm ci
cd ..\tools\tap-collect; npm ci
cd ..\..\video;          npm ci   # デモ動画を作り直すときだけ
```

Electron 本体が入らなかったとき（`npm run dev` で「Electron failed to install correctly」）は `app/` で `node node_modules/electron/install.js` を実行する。

## 4. 動くか確かめる（`app/`）

```powershell
npm run typecheck
npm run build
npm test
$env:DESKAPI_MOCK = 1; npm run dev   # 実機なしで画面確認（モックの打が 4 秒ごとにアクションを本当に動かす）
```

- 実機をつないで確かめるときは `DESKAPI_MOCK` を外して `npm run dev`。手順は `docs/hardware-test.md`
- `xiao-stream` の速度テスト（24 万行を 1 秒以内）は、遅めの PC だと 1.1 秒ほどかかって落ちることがある。そのほかが通っていればよい
- 確認で起動した Electron は、終わったら閉じる（COM ポートを 1 プロセスしか開けないため、tap-collect や Arduino IDE が使えなくなる）

## 5. Git に入っていないもの

| もの | 場所 | 移すなら |
|---|---|---|
| 実機のログ（約 320 MB） | `tools/tap-collect/tap-logs/` | 同じ場所にコピーする（USB・クラウドドライブ）。`docs/HANDOFF.md` の採点結果はこのログのもの |
| アプリの設定・校正値 | `%APPDATA%\DeskAPI\config.json` | 同じ場所にコピーする。机が変わるならコピーせず、キャリブレーションし直す |
| 採点の出力 | `tools/tap-collect/scores/` | 移さなくてよい（score.mjs で作り直せる） |
| デモ動画の実機の映像 | `video/public/footage/IMG_4968.mp4` | 元の `IMG_4968.MOV` を H.264 の MP4 にして置く（`ffmpeg -i IMG_4968.MOV -c:v libx264 -crf 18 -c:a aac IMG_4968.mp4`） |
| 書き出した動画 | `video/out/` | 移さなくてよい（`npm run render` で作り直せる） |
| 個人の資料 | `.orca/` | 移さない（コミットもしない） |

Claude Code のメモリ（`~/.claude/projects/...`）は PC ごと。引き継ぐべき指示は `CLAUDE.md` に書いてある。

## 6. Claude / Codex の進め方

- Claude はリポジトリのルートで `claude` を起動する。`CLAUDE.md` → `AGENTS.md` → `docs/HANDOFF.md` の順に読まれる
- Codex はリポジトリのルートで、PowerShell なら `$null | codex exec -s workspace-write -C . "docs/tasks/NN-*.md を実装して"`、Git Bash なら末尾に `< /dev/null`（stdin を閉じないと入力待ちで止まることがある）。サンドボックスはネットワークなしなので、依存の追加が要るときは先に `npm install` しておく
- コミット・プッシュは PM（Claude）がレビューしてから。Codex はしない

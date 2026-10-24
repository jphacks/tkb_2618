# 01 土台と設定画面

## やること

1. `app/` を electron-vite のプロジェクトにする（依存はインストール済み。`app/package.json` を見て、足りない scripts・設定を作る）
   - scripts: `dev`, `build`, `typecheck`, `dist`（electron-builder、Windows NSIS）
   - `main` を electron-vite の出力に向ける。`electron.vite.config.ts`、`tsconfig*.json`、`electron-builder.yml`
   - TypeScript は 7 系が入っている。`baseUrl` など 7 で消えたオプションを使わない
2. `src/shared/`
   - `types.ts`: `docs/spec.md` の `Config` ほか全型、`TapEvent`、`DeviceStatus`
   - `constants.ts`: 色、アイコンの SVG パス（デザインの `IC`）、アクション種別の名前・既定アイコン・既定色（`ACTS`）、領域名、パターン名、既定 Config
   - `ipc.ts`: renderer から使う API の型（`window.deskapi`）。最低限: `getConfig`, `saveConfig`, `onConfigChanged`, `getDeviceStatus`, `onDeviceStatus`, `onTap`, `runKey(index)`, `pickFile()`, `pickImage()`, キャリブレーション一式（`calStart`, `calMeasureNoise`, `onCalHit`, `calSave`, `calCancel`, モック時の `calMockHit`）
3. `src/preload/`: 上の API を contextBridge で公開
4. `src/main/`
   - ウィンドウ（`docs/spec.md` の設定ウィンドウ節のサイズ・タイトルバー）
   - Config の読み書き（壊れたファイルの退避を含む）
   - `Device` インターフェースと `MockDevice`（`docs/spec.md` の開発用モック）。シリアル実装は 03 で作るので、モックでないときは常に `disconnected` を返す仮実装でよい
   - `ActionRunner` インターフェースと、ログを出すだけの仮実装（本実装は 02）
   - タップを受けたら spec の「タップを受けたとき」の 1〜4 を行う
5. `src/renderer/`: 設定画面とキャリブレーション画面をデザインどおりに作る
   - `docs/design/settings.dc.html` / `calibrate.dc.html` を開き、寸法・色・角丸・余白・アニメーション（`dk-bump`, `dk-ripple`, `dk-breathe`, `dk-fill`）をそのまま写す
   - キーの角の線（左上と右下の L 字、アイコン色 60%）を忘れない
   - 机マップ上端・左端の点（強弱・回数）を忘れない。文字は付けない
   - ドラッグは @dnd-kit/core で。キー同士の入れ替えと、アクション種別タイルからキーへの割り当て
   - アイコンは `constants.ts` の SVG パスを描く小さなコンポーネントで。lucide-react は歯車・フォルダなど汎用 UI アイコンにだけ使ってよい
   - フォントは Noto Sans JP と JetBrains Mono。オフラインで動くよう、Google Fonts ではなく `@fontsource` 系を入れるか、なければ system-ui / Consolas にフォールバックする
   - 歯車パネル、プロファイルの名前変更・削除、hotkey 記録、画像の切り抜きも spec どおり
   - 編集は即保存（300 ms デバウンスで `saveConfig`）

## 完了条件

- `npm run typecheck` と `npm run build` が通る
- `DESKAPI_MOCK=1 npm run dev` で設定画面が開き、4 秒ごとにキーが光る。キャリブレーションをモックで最後まで進められる
- 画面がデザインのモックと見比べて同じに見える（色・寸法・配置）
- 最後に、作ったファイルと判断したことを短く報告する

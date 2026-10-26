# DaaS デモ動画

審査用のデモ動画（1920×1080、30 fps、約 58 秒）と、README の画像を [Remotion](https://www.remotion.dev/) で作る。ソース、ロックファイル、ロゴ、使用する実機映像をこのディレクトリに含める。生成物は `out/` に出力し、Git には入れない。

アプリの画面は隣の `app/` の定数（`COLORS`、`IC`、`ACTS`、`DEFAULT_CONFIG` など）と `Icon` を import して描く。リポジトリ全体をクローンして使う。シンボリックリンクは不要。

Node.js 22 以降と npm を使う。リポジトリのルートで、まずアプリ側の依存を入れる（アプリの起動や実機の接続は不要）。

```sh
cd app
npm ci
cd ../video
```

続けて動画側の依存を入れ、型チェックと書き出しを行う。Windows の PowerShell でも同じコマンドを使える。初回のプレビュー・書き出しでは Remotion が使用するブラウザーもダウンロードされる。

```sh
npm ci
npm run typecheck
npm run studio     # プレビュー
npm run render     # out/daas.mp4
npm run stills     # out/stills/readme-*.png（リポジトリの docs/images/ に写す）
```

動画で使う実機映像 `public/footage/IMG_4968-1080.mp4`（約 45 MB）とロゴ `public/brand/gtm-logo.png` は収録済みなので、別 PC への手動コピーは不要。未使用の撮影素材、元の 4K 映像、完成動画、`node_modules/` は収録しない。

1080p の素材は、元の `IMG_4968.MOV` を H.264 の MP4 に変換し、切り出したもの（作り方は `src/scenes/Demo.tsx` の先頭）。収録済み素材を使う通常の書き出しでは、元映像や別途インストールした FFmpeg は不要。4K のままだと、書き出しの途中でコマの取り出しが失敗することがある。

| 場面 | ファイル | 秒数 |
|---|---|---:|
| 題名 | `src/scenes/Title.tsx`（`Title`） | 4 |
| 実機のデモ | `src/scenes/Demo.tsx` | 15 |
| 場所と回数 | `src/scenes/Keys.tsx` | 6 |
| 操作の種類 | `src/scenes/Actions.tsx` | 7 |
| 設定画面 | `src/scenes/Settings.tsx`、`src/app-ui/` | 7 |
| 仕組み | `src/scenes/How.tsx` | 9 |
| キャリブレーション | `src/scenes/Calibration.tsx` | 6 |
| 終わり | `src/scenes/Title.tsx`（`End`） | 4 |

使う人に向けて、アプリの機能を見せる。開発の進め方（tap-collect での採点など）は入れない。`Problem` は README の画像だけに使う。

実機の映像は 0.5〜4.4 秒と 9.5〜19.4 秒を使う。7 秒付近のノックでは PC の画面が変わらず、同じ場所を叩き直しているので、その間を切る。輪は、そのあと画面が変わったノックにだけ、叩いた瞬間（音のピーク）に手が机に当たった位置へ重ねる。設定画面の場面では、叩いていないのでキーを光らせない。

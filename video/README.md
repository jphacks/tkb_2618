# DaaS デモ動画

審査用のデモ動画（1920×1080、30 fps、68 秒）と、README の画像を [Remotion](https://www.remotion.dev/) で作る。アプリの画面は `app/` の定数（`COLORS`、`IC`、`ACTS`、`DEFAULT_CONFIG` など）と `Icon` を import して描くので、キーの色やアイコンはアプリと同じになる。

```sh
npm ci
npm run studio     # プレビュー
npm run render     # out/daas.mp4
npm run stills     # ../docs/images/readme-*.png
```

実機の映像 `public/footage/IMG_4968.mp4`（3840×2160、H.264）は Git に入れていない。元の `IMG_4968.MOV` を H.264 の MP4 にして置く。

| 場面 | ファイル | 秒数 |
|---|---|---:|
| 題名 | `src/scenes/Title.tsx`（`Title`） | 4 |
| 困りごと | `src/scenes/Problem.tsx` | 7 |
| 答え | `src/scenes/Answer.tsx` | 4 |
| 場所と回数 | `src/scenes/Keys.tsx` | 6 |
| 実機のデモ | `src/scenes/Demo.tsx` | 19 |
| 仕組み | `src/scenes/How.tsx` | 9 |
| 設定画面 | `src/scenes/Settings.tsx`、`src/app-ui/` | 9 |
| キャリブレーション | `src/scenes/Calibration.tsx` | 6 |
| 終わり | `src/scenes/Title.tsx`（`End`） | 4 |

場面の切り替えは 8 フレームのフェード。実機の映像は 0.5〜19.4 秒を使い、叩いた瞬間（音のピーク）に、手が机に当たった位置へ輪を重ねる。

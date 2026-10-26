# DeskAPI 製品仕様

2026-10-27 に main のコード（288b5c1）と照合した。

## 全体

- Windows 10 / 11 専用。Electron の常駐アプリ。起動するとトレイに入り、設定ウィンドウは必要なときだけ開く
- 多重起動しない（2 つ目を起動したら既存の設定ウィンドウを前に出す）
- 設定ウィンドウの × は終了ではなく非表示。終了はトレイメニューから

## キーの番号

4 領域 × 回数（1 回 / 2 回）= 8 キー。強弱はない（2026-10-25 に削除。実機ログで弱と強の振幅が重なり、弱い打はノイズに埋もれてキャリブレーションが進まなかったため）。

```
keyIndex = region * 2 + (count - 1)
```

画面では 4 領域を机の配置どおり 2×2 に並べ、各領域の中は横に 2 キー（左 = 1 回、右 = 2 回）。上端に回数を示す点（1 個 / 2 個）を置く。文字は付けない。

設定の `version` は 2。`version: 1`（16 キー、`calibration.strongMin` あり）を読んだら、領域ごとに弱のキーを残し、弱が空なら強のキーを使って 8 キーにし、`strongMin` を捨てる（`upgradeConfig`）。

## 設定データ

`%APPDATA%/DeskAPI/config.json`（`app.getPath('userData')`）に保存。読み込み時に壊れていたら `config.broken-<日時>.json` に退避して既定値で起動する。

```ts
type ColorId = 'red' | 'orange' | 'yellow' | 'cyan' | 'indigo';
type IconId = 'mic' | 'capture' | 'code' | 'app' | 'playpause' | 'next' | 'volume' | 'music' | 'terminal'
  | 'hammer' | 'bubble' | 'lock' | 'keyboard' | 'send' | 'layers' | 'broadcast' | 'star' | 'bolt';

type Action =
  | { type: 'hotkey'; keys: string[] }                 // 例 ['Ctrl','Shift','M']。修飾キーが先、最後に主キー
  | { type: 'launch'; file: string; args?: string }
  | { type: 'media'; op: 'prev' | 'playpause' | 'next' | 'volDown' | 'volUp' | 'mic' }
  | { type: 'command'; cmd: string }
  | { type: 'http'; url: string }
  | { type: 'profile'; to: string }                    // Profile.id
  | { type: 'lock' };

type DeskKey = {
  icon: IconId;
  slash?: boolean;      // アイコンに斜線（ミュートなど）
  image?: string;       // 画像を選んだとき。192×192 PNG の data URL。あれば icon より優先
  color: ColorId;
  action: Action;
};

type Profile = { id: string; name: string; keys: (DeskKey | null)[] };   // keys は長さ 8

type Config = {
  version: 2;
  profiles: Profile[];
  activeProfileId: string;
  locked: boolean;
  notify: boolean;          // 非表示中の発火を Windows 通知で知らせる（既定 true）
  autostart: boolean;       // Windows ログイン時に起動（既定 true）
  port: string | 'auto';    // シリアルポート（既定 'auto'）
  protocol: string;         // シリアルの形式（既定 'auto'。UI には出さない）
  calibration?: Calibration; // 最後に保存したキャリブレーション（docs/protocol.md）
};
```

既定値はデザイン（`docs/design/settings.dc.html` の `INITIAL`, `PROFILES`）と同じ 3 プロファイル「作業 / 配信 / ゲーム」。最初のプロファイルに `INITIAL` の 8 キー、残りは空。

色（`COLORS`）: 背景色と、その上のアイコン色。

| id | 背景 | アイコン |
|---|---|---|
| red | #D12052 | #121212 |
| orange | #F45B26 | #121212 |
| yellow | #F8DE22 | #121212 |
| cyan | #03AED2 | #121212 |
| indigo | #3C3781 | #FFFFFF |

## タップを受けたとき（main）

1. 飽和した打（`sat`）は無視する
2. `locked` のときは `lock` アクションのキー以外を無視する
3. アクティブプロファイルの `keys[keyIndex]` が空なら何もしない
4. アクションを実行する
5. 設定ウィンドウが表示中なら renderer に `tap` を送り、そのキーを光らせる（デザインの `dk-bump` + 波紋）
6. 非表示中で `notify` が true なら Windows 通知を出す。タイトルはアクション種別名、本文はキーの位置（例「左下 · 2回」）。連続発火で通知が溜まらないよう、同じ通知は置き換える
7. 実行に失敗したら、`notify` に関係なく通知でエラーを出す

## アクション

| type | 動き |
|---|---|
| hotkey | Win32 `SendInput` でキーを押して離す。押す順は配列順、離すのは逆順。前面ウィンドウに届く |
| launch | `file` を起動。exe ならそのまま、ショートカット（.lnk）や他の拡張子は関連付けで開く。既に起動中なら新しく起動するだけでよい |
| media | `prev` / `playpause` / `next` / `volDown` / `volUp` はメディア仮想キー（VK_MEDIA_* / VK_VOLUME_*）を SendInput。`mic` は既定の録音デバイスのミュートを切り替える（Core Audio の `IAudioEndpointVolume::SetMute`） |
| command | `cmd.exe /d /s /c <cmd>` をウィンドウを出さずに実行。30 秒で打ち切り。終了コード 0 以外は失敗扱い |
| http | `url` に POST。本文 `{"key":3,"region":1,"count":2,"profile":"作業","at":"<ISO8601>"}`。5 秒でタイムアウト。2xx 以外は失敗扱い |
| profile | `activeProfileId` を `to` に切り替え、設定を保存 |
| lock | `locked` を反転して保存。トレイアイコンも切り替える |

設定画面の「テスト実行」ボタンは、選択中のキーのアクションを今すぐ実行する（光らせる演出も同じ）。

## デバイス接続（main）

- `port: 'auto'` のときは、シリアルポート一覧から ESP32 系の USB-UART（VID 10C4 / 1A86 / 303A）を優先して順に開き、DeskAPI のボードだと分かったポートを使う。本番ファーム（xiao-stream）はデータ行、参考実装は `ping` → `hello` で分かる（`docs/protocol.md`。形式は `protocol: 'auto'` で自動で見分ける）
- 本番ファームは生値を送るだけなので、判定（領域・回数・飽和）とキャリブレーションの計測はアプリの検出器が行う。校正値は設定（`calibration`）に保存し、接続のたびに使う
- 切断されたら 2 秒ごとに再接続を試す。ポートを手放すときは OS のハンドルまで閉じる（`destroy()` だけでは閉じず、アプリを終了するまで「使用中」になる）
- 本番ファームは毎秒 4000 行送るので、接続後に 2 秒データが来なければ切断として扱う（一度データが来ただけで「接続中」のままにしない）
- 未接続の状態には理由を付ける: `no-port`（USB の機器がない）/ `busy`（ほかのアプリがポートを使っている）/ `no-response`（ポートはあるがデータが来ない）
- 設定画面を開いているとき、起動して 7 秒たっても未接続か、接続中から切れたら、ポップアップ「デバイスにつながっていません」を出す（理由ごとの対処、「ポートを選ぶ」「閉じる」）。つながると自動で閉じる。閉じたら次に切れるまで出さない。ウィンドウを閉じているときは Windows 通知（起動 10 秒後に未接続のとき、接続中から切れたとき）
- 状態: `disconnected` / `connecting` / `connected`（ポート名、ファームウェア版、キャリブレーション済みか）。設定画面右上の点で示す（緑 #13D66A = 接続中、灰 #5A5A5A = 未接続、点滅 = 接続試行中）。`title` に「接続中 · COM3」などを入れる
- `hello` の `cal` が false なら、設定画面のキャリブレーションボタンに赤い小さな点を付けて促す

## トレイ

- アイコン: 通常 / ロック中 / 未接続の 3 種（16×16 と 32×32。フラットな単色で作る）
- 左クリック: 設定ウィンドウを開く
- 右クリックメニュー: 設定を開く / プロファイル（ラジオで切り替え）/ ロック（チェック）/ 終了

## 設定ウィンドウ

デザインどおり（`docs/design/settings.dc.html`）。最小 960×640、既定 1280×860、背景 #121212、フレームは Windows 標準（タイトルバーは `titleBarStyle: 'hidden'` + `titleBarOverlay` で #121212 に合わせる）。

- 上部: プロファイル切り替え（文字のピル）、追加ボタン、接続状態の点、ロック、キャリブレーション、設定（歯車）
  - プロファイル名はダブルクリックで名前変更、右クリックで削除（最後の 1 つは消せない）
- 机マップ: 8 キー。クリックで選択、ドラッグで入れ替え、右パネルのアクションをキーにドラッグで割り当て
- 右パネル: 選択中キーのプレビュー、トリガー表示（領域ミニマップ + 点）、アクション種別、アクションごとの入力、色、アイコン / 画像、テスト実行、割り当て解除
  - hotkey: 記録ボタン（赤い点）を押すと次に押した組み合わせを記録。Esc で中止。Win キーは renderer で拾えないので、記録中に表示する修飾キーのトグル（Ctrl / Shift / Alt / Win のアイコンボタン）でも足せる
  - launch: パスを直接編集できる。フォルダアイコンでファイル選択ダイアログ（main 経由）
  - command / http: 1 行テキスト入力
  - 画像: ファイルを選ぶと中央を正方形に切り抜き 192×192 PNG にして `image` に入れる
- 歯車: 右からのパネル（右パネルと同じ #1A1A1A）。項目は「通知」「自動起動」のトグルと「ポート」の選択（自動 + 一覧）。この 3 つだけ文字ラベルを付ける

## キャリブレーション画面

デザインどおり（`docs/design/calibrate.dc.html`）。設定ウィンドウ内の画面遷移で、`docs/protocol.md` の手順を進める。

- 静止 → 各領域 3 打（4 段。タイルには「叩く」）→ 完了
- 完了画面の保存（チェック）で `set_cal` を送り、`ack` を受けたら机マップに戻る
- 叩いた打はすべて数える（最大の ch が叩いた領域でなくても捨てない。任意のテーブルで成り立たせるため）
- 完了時に `docs/protocol.md` の「確かめ」を行い、当たった領域（型で判定を間違える）は、そのタイルを赤 #D12052 にしてやり直す
- デバイス未接続ならキャリブレーションボタンは押せない（モック時は押せる）
- **正は tools/tap-collect（collect.mjs）の手順**。キャリブレーションの最適化は tap-collect で行い（score.mjs の app 採点は `app/src/main/recorder.ts` と `app/src/shared/tap-procedure.ts` を使う）、良くなったものをアプリに採用する。数値と数え方は `app/src/shared/tap-procedure.ts` にまとめる
- 打を自動で拾わない。静止：指示から 1 秒 → 机に触れず 1 秒（基準値＝この区間の中央値）→ 3 秒。静止のピークは合図前の 1 秒と 3 秒を通した基準値からの最大のずれ（collect の `peak`）。各ステップ：指示から 1 秒 → 机に触れず 1 秒（ステップの基準値）→ 合図（タイルが明るくなり、5 秒のバーが減っていく）→ 5 秒の区間を記録
- 区間内で、基準値からのずれが静止のピーク × 1.5 を超え、50 ms の静かな間で区切られた波を 1 打とする（tap-collect の `countMountains` と同じ）。打ごとの各 ch の最大のずれを `hit.peaks`、波の長さを `ring` にする。合図の外の揺れは数えない
- 振り切れていない打が 3 打に足りなければ「N 回しか拾えませんでした。合図のあとに 3 回叩く」と出して同じステップをやり直す。多ければ大きい順に 3 打を使う
- 型で区別できない領域は「ほかの場所と区別できません。センサーの近くを叩く」と出してやり直す
- 山の係数 1.5 は 2026-10-25 に実ログで選んだ（6 セッション × 4 領域、弱・強の試行をまとめて数えた）。1.5 で 3 打そろう段は 9/24、静止 87 秒の誤検出の山 0。1.25 は 11/24 だが誤検出 3、1.1 は 17/24 だが誤検出 33。4 ch を合わせたエネルギーで数える案は、同じ誤検出の水準でそろう段が少なかった
- 「1 回戻す」は 1 つ前のステップを撮り直す（記録中の区間は捨てる）
- 生値を送らないファーム（参考実装 deskapi-v1）では「デバイスから生値が届きません」と出る
- エラー（生値が届かない・接続が切れた）は画面に文字で出す。接続が切れたら手順を止め、やり直すボタンはつながるまで押せない
- モックで行ったキャリブレーションは設定に保存しない（実機の校正値にしない）

## 開発用モック

`DESKAPI_MOCK=1` で起動すると、シリアルの代わりに MockDevice を使う。

- 常に `connected`（port 名 `MOCK`）
- 通常モードのランダムな `tap` は割り当てたアクションを実際に動かす。試すときは `DESKAPI_USER_DATA=<空のフォルダ>` で設定の置き場所を本物から離す（Windows の Electron は `APPDATA` 環境変数を見ない）
- 通常モードでは 4 秒ごとにランダムな `tap` を出す
- キャリブレーションモードでは、画面の現在のタイルをクリックすると、その領域らしい `hit` を出す（本番ではクリックしても何も起きない）

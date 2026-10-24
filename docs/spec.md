# DeskAPI 製品仕様

## 全体

- Windows 10 / 11 専用。Electron の常駐アプリ。起動するとトレイに入り、設定ウィンドウは必要なときだけ開く
- 多重起動しない（2 つ目を起動したら既存の設定ウィンドウを前に出す）
- 設定ウィンドウの × は終了ではなく非表示。終了はトレイメニューから

## キーの番号

```
keyIndex = region * 4 + pattern
pattern  = (count - 1) * 2 + (strength === 'strong' ? 1 : 0)
```

| pattern | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| 意味 | 1 回 弱 | 1 回 強 | 2 回 弱 | 2 回 強 |

画面では 4 領域を机の配置どおり 2×2 に並べ、各領域の中を 2×2（横 = 強弱、縦 = 回数）にする。上端に強弱を示す点（小 = 弱、大 = 強）、左端に回数を示す点（1 個 / 2 個）を置く。文字は付けない。

## 設定データ

`%APPDATA%/DeskAPI/config.json`（`app.getPath('userData')`）に保存。読み込み時に壊れていたら `config.broken-<日時>.json` に退避して既定値で起動する。

```ts
type ColorId = 'red' | 'yellow' | 'green' | 'blue' | 'indigo';
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

type Profile = { id: string; name: string; keys: (DeskKey | null)[] };   // keys は長さ 16

type Config = {
  version: 1;
  profiles: Profile[];
  activeProfileId: string;
  locked: boolean;
  notify: boolean;          // 非表示中の発火を Windows 通知で知らせる（既定 true）
  autostart: boolean;       // Windows ログイン時に起動（既定 true）
  port: string | 'auto';    // シリアルポート（既定 'auto'）
};
```

既定値はデザイン（`docs/design/settings.dc.html` の `INITIAL`, `PROFILES`）と同じ 3 プロファイル「作業 / 配信 / ゲーム」。最初のプロファイルに `INITIAL` の 16 キー、残りは空。

色（`COLORS`）: 背景色と、その上のアイコン色。

| id | 背景 | アイコン |
|---|---|---|
| red | #D62413 | #FFFFFF |
| yellow | #D6B813 | #121212 |
| green | #13D66A | #121212 |
| blue | #2214D6 | #FFFFFF |
| indigo | #3C3781 | #FFFFFF |

## タップを受けたとき（main）

1. `locked` のときは `lock` アクションのキー以外を無視する
2. アクティブプロファイルの `keys[keyIndex]` が空なら何もしない
3. アクションを実行する
4. 設定ウィンドウが表示中なら renderer に `tap` を送り、そのキーを光らせる（デザインの `dk-bump` + 波紋）
5. 非表示中で `notify` が true なら Windows 通知を出す。タイトルはアクション種別名、本文はキーの位置（例「左下 · 2回 強」）。連続発火で通知が溜まらないよう、同じ通知は置き換える
6. 実行に失敗したら、`notify` に関係なく通知でエラーを出す

## アクション

| type | 動き |
|---|---|
| hotkey | Win32 `SendInput` でキーを押して離す。押す順は配列順、離すのは逆順。前面ウィンドウに届く |
| launch | `file` を起動。exe ならそのまま、ショートカット（.lnk）や他の拡張子は関連付けで開く。既に起動中なら新しく起動するだけでよい |
| media | `prev` / `playpause` / `next` / `volDown` / `volUp` はメディア仮想キー（VK_MEDIA_* / VK_VOLUME_*）を SendInput。`mic` は既定の録音デバイスのミュートを切り替える（Core Audio の `IAudioEndpointVolume::SetMute`） |
| command | `cmd.exe /d /s /c <cmd>` をウィンドウを出さずに実行。30 秒で打ち切り。終了コード 0 以外は失敗扱い |
| http | `url` に POST。本文 `{"key":5,"region":1,"count":1,"strength":"strong","profile":"作業","at":"<ISO8601>"}`。5 秒でタイムアウト。2xx 以外は失敗扱い |
| profile | `activeProfileId` を `to` に切り替え、設定を保存 |
| lock | `locked` を反転して保存。トレイアイコンも切り替える |

設定画面の「テスト実行」ボタンは、選択中のキーのアクションを今すぐ実行する（光らせる演出も同じ）。

## デバイス接続（main）

- `port: 'auto'` のときは、シリアルポート一覧から ESP32 系の USB-UART（VID 10C4 / 1A86 / 303A）を優先して順に開き、`ping` → `hello` が返ったポートを使う
- 切断されたら 2 秒ごとに再接続を試す
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
- 机マップ: 16 キー。クリックで選択、ドラッグで入れ替え、右パネルのアクションをキーにドラッグで割り当て
- 右パネル: 選択中キーのプレビュー、トリガー表示（領域ミニマップ + 点）、アクション種別、アクションごとの入力、色、アイコン / 画像、テスト実行、割り当て解除
  - hotkey: 記録ボタン（赤い点）を押すと次に押した組み合わせを記録。Esc で中止。Win キーは renderer で拾えないので、記録中に表示する修飾キーのトグル（Ctrl / Shift / Alt / Win のアイコンボタン）でも足せる
  - launch: パスを直接編集できる。フォルダアイコンでファイル選択ダイアログ（main 経由）
  - command / http: 1 行テキスト入力
  - 画像: ファイルを選ぶと中央を正方形に切り抜き 192×192 PNG にして `image` に入れる
- 歯車: 右からのパネル（右パネルと同じ #1A1A1A）。項目は「通知」「自動起動」のトグルと「ポート」の選択（自動 + 一覧）。この 3 つだけ文字ラベルを付ける

## キャリブレーション画面

デザインどおり（`docs/design/calibrate.dc.html`）。設定ウィンドウ内の画面遷移で、`docs/protocol.md` の手順を進める。

- ノイズ測定 2 秒 → 各領域 弱 3 打 → 強 3 打 → 完了
- 完了画面の保存（チェック）で `set_cal` を送り、`ack` を受けたら机マップに戻る
- 叩いた打はすべて数える（最大の ch が叩いた領域でなくても捨てない。任意のテーブルで成り立たせるため）
- 完了時に `docs/protocol.md` の「確かめ」を行い、当たった領域（強弱が分かれない・型で判定を間違える）は、そのタイルを赤 #D62413 にして弱からやり直す。説明文は出さない
- デバイス未接続ならキャリブレーションボタンは押せない（モック時は押せる）

## 開発用モック

`DESKAPI_MOCK=1` で起動すると、シリアルの代わりに MockDevice を使う。

- 常に `connected`（port 名 `MOCK`）
- 通常モードでは 4 秒ごとにランダムな `tap` を出す
- キャリブレーションモードでは、画面の現在のタイルをクリックすると、その領域・強弱らしい `hit` を出す（本番ではクリックしても何も起きない）

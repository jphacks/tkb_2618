# 02 アクション実行・トレイ・通知

前提: 01 が終わっている。

## やること

1. `ActionRunner` の本実装（`docs/spec.md` のアクション表）
   - SendInput は koffi で user32 を呼ぶ（ネイティブビルド不要のため）。キー名 → 仮想キーコードの表を `src/main/` に置く
   - マイクのミュートは Core Audio。koffi で COM を直接叩くのが難しければ、常駐させた PowerShell（C# の Add-Type）に標準入力で命令を送る方式でもよい。2 回目以降 300 ms 以内に効くこと
   - http は Node の fetch
2. トレイ（3 種アイコン、メニュー、左クリックで表示）。アイコン画像は `app/resources/` に PNG で作って置く
3. Windows 通知（spec の 5・6）。`app.setAppUserModelId` を設定し、同じ通知は置き換える
4. 多重起動防止、× で非表示、自動起動（`app.setLoginItemSettings`）、`locked` と `profile` の切り替えをトレイと画面で同期
5. 「テスト実行」ボタンを本実装につなぐ

## 完了条件

- `npm run typecheck` / `npm run build` が通る
- `DESKAPI_MOCK=1` で、hotkey（例: メモ帳を前面にして Ctrl+V）、launch（notepad.exe）、media（音量）、command、lock、profile が実際に動く
- ウィンドウを閉じた状態でモックのタップが通知になる
- 変更点と、手で確認した項目を報告する

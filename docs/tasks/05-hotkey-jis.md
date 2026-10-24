# 05 hotkey を物理キーで記録する（JIS 配列対応）

前提: 02 が終わっている。

## 問題

hotkey の記録（`KeyEditor.tsx` の `HotkeyInput`）は `KeyboardEvent.key`（入力された文字）を保存し、`src/main/virtual-keys.ts` は US 配列の文字だけを仮想キーコードに変換する。日本語キーボード（JIS）では次のことが起きる。

- `@` `^` `¥` `_`（ろ）、変換・無変換・半角/全角などが表になく、実行時に「未対応のキーです」になる
- Shift を押しながら記録すると、`Shift+2` が `"` のように文字で保存され、配列によって別のキーが送られる

## やること

1. 記録は `KeyboardEvent.code`（物理キーの位置。例 `KeyA`, `Digit2`, `BracketLeft`, `IntlYen`, `IntlRo`, `Convert`, `NonConvert`）で行う
2. 保存形式は spec の `hotkey.keys`（文字列配列）のまま、値を `code` 系の名前にする。修飾キーは今までどおり `Ctrl` / `Shift` / `Alt` / `Win`
3. `virtual-keys.ts` を `code` → 仮想キーコードの表にする。JIS 固有キー（`IntlYen` 0xDC, `IntlRo` 0xE2, `Convert` 0x1C, `NonConvert` 0x1D, `KanaMode` 0x15 など）を含める。`Backquote` は US では 0xC0、JIS では半角/全角キーになるので、どう扱ったかを報告に書く。OEM キーに `KEYEVENTF_EXTENDEDKEY` を付けない（`windows.ts` の判定を、本当に拡張キーのものだけにする）
4. 既存の設定（`key` 由来の値）は読み込み時に `code` 系へ変換する。変換できない値はそのまま残し、実行時のエラー通知で分かるようにする
5. キーキャップの表示は、`code` から見た目の文字に直して出す（`KeyA` → `A`、`Digit2` → `2`、`IntlYen` → `¥`）。可能なら `navigator.keyboard.getLayoutMap()` で現在の配列の文字を使い、使えなければ US 配列の文字にフォールバック
6. `virtual-keys.ts` の変換と旧形式からの移行に `node --test` の単体テストを付ける

## 完了条件

- `npm run typecheck` / `npm run build` / `npm run test` が通る
- 単体テストで、JIS 固有キーと旧形式の値が正しい仮想キーコードになることを確認する
- 報告に、Windows の JIS キーボードで手で確認すべき項目を列挙する

## 追加修正（PM レビュー後）

`code` → 仮想キーコードの固定表では、JIS 配列で OEM キーがずれる。VK と物理キーの対応はキー配列で変わるため（JIS で `BracketLeft` の位置は `@` = VK_OEM_3 だが、表の 0xDB を送ると JIS の `[` キーとして解釈される。`Equal`(^) `Quote`(:) `Semicolon`(;) `BracketRight`([) `Backslash`(]) も同様）。

- hotkey の送信は、`code` から **スキャンコード**（Set 1。W3C UI Events KeyboardEvent code の表どおり。例 `KeyA` 0x1E、`BracketLeft` 0x1A、`IntlYen` 0x7D、`IntlRo` 0x73、`Convert` 0x79、`NonConvert` 0x7B、`KanaMode` 0x70、`Backquote` 0x29）に変換し、`KEYEVENTF_SCANCODE`（0x0008）で送る。E0 付きのキー（矢印、Insert/Delete/Home/End/PageUp/PageDown、右 Ctrl/Alt、Win、NumpadEnter、NumpadDivide など）は `KEYEVENTF_EXTENDEDKEY` を付ける
- 修飾キー `Ctrl` / `Shift` / `Alt` / `Win` は左側のスキャンコード（0x1D / 0x2A / 0x38 / E0 0x5B）
- media の仮想キー（音量・再生など）はスキャンコードを持たないので、今までどおり VK で送る
- 旧形式（`key` 由来）の移行は US 配列の位置として `code` に直す今の方針のままでよい
- テストは「`code` → スキャンコード・拡張フラグ」の表と、INPUT 構造体に書く値（wVk=0, wScan, dwFlags）を確認する

@AGENTS.md

作業を始める前に `docs/HANDOFF.md` を読む。Claude はこのプロジェクトの PM / UI デザイン担当で、実装は Codex CLI に任せる。新しい PC での準備は `docs/setup.md`。

## ユーザーとのやりとり

- チャットに出す文は、途中の短い経過報告も含めてすべて日本語で書く。長い作業の後半ほど英語に戻りやすいので毎回確かめる（コード内コメントは周りに合わせて英語）
- 確認のために起動したアプリ（`npm run dev` の Electron など）は、確認が終わったら自分で終了し、`Get-Process electron` が 0 個になったのを確かめてから報告する。background タスクを止めるだけでは electron.exe が残ることがある。COM ポートは 1 プロセスしか開けないので、残すとユーザーの tap-collect や Arduino IDE が使えなくなる

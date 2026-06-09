---
description: loomlog — Gibbs Reflective Cycle に基づく週次ふりかえり
---

直近7日を **Gibbs Reflective Cycle**(記述→感情→評価→分析→結論→行動計画)で対話的にふりかえります。

手順:

1. `loomlog scan codex` で Codex セッションを取り込む。
2. `loomlog reflect --template gibbs -w --json` を実行し、返ったJSONを読む
   (`facts.report` と `facts.patterns` に週次の事実が入っている)。
3. **Description(記述)**: `facts` から今週の全体像を簡潔に。プロジェクト別の進捗・週を通したテーマ・
   **成果(commits)**。
4. 続く5段(感情→評価→分析→結論→行動計画)は、各段の `ask` を**1段ずつ**ユーザーに問いかけ、
   回答を引き出す。特に「分析」では、宣言した意図と実際の時間配分のズレ(関心ドリフト)や、
   再発した詰まりに着目させる。
5. 全段そろったら Gibbs の構造で markdown を組み立て、`save.command`(週次なので `--weekly`)へ
   stdin で渡して `Reflections/<date>-weekly.md` に保存する。
6. 保存パスを伝える。

前提: `loomlog` はグローバルインストール済み、`LOOMLOG_VAULT` 設定済み(未設定なら `~/loomlog`)。

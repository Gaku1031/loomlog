---
description: loomlog — 今日の横断作業レポート
---

まず `loomlog scan all --since $(date +%F)` を実行して当日のセッションを更新し、続いて `loomlog report --json` を実行してください。返ったJSONを基に、**今日の日報**を日本語で書きます。

- プロジェクトごとに: 取り組んだこと(意図)・主な変更・成果(commits があれば)
- 余計な前置きや統計の羅列はしない。簡潔に
- 最後に、振り返りのための短い問いを2〜3個

前提: `loomlog` はグローバルインストール済み、環境変数 `LOOMLOG_VAULT` 設定済み(未設定なら `~/loomlog`)。

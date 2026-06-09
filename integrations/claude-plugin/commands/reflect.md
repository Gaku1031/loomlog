---
description: loomlog — 学術メソッド(WSN)に基づく対話的な振り返り(日次)
argument-hint: "[wsn|gibbs|aar|kpt|ywt] (省略時は wsn)"
---

今日の作業を **What / So What / Now What**(Borton→Driscoll の振り返り型)で対話的にふりかえります。
テンプレートは `$1`(未指定なら `wsn`)。

手順:

1. まず `loomlog scan codex --since $(date +%F)` で当日の Codex セッションを取り込む。
2. `loomlog reflect --template ${1:-wsn} --json` を実行し、返ったJSONを読む。
   - `facts`(事実)・`stages`(振り返りの型の各段)・`template`(学術的出典)・`save.command`(保存コマンド)が入っている。
3. **What(事実)**: `stages` のうち `fromFacts: true` の段を、`facts.report` から簡潔に日本語で提示する
   (プロジェクト別に: 意図・主な変更・作業の種類・**成果(commits)**)。羅列せず要点だけ。
4. **So What / Now What(内省)**: `ask` を持つ段について、その質問をユーザーに**1段ずつ**問いかけ、
   回答を待つ。先回りして答えを埋めない。ユーザーの言葉を引き出す。
5. 全段そろったら、`template.name` の構造で振り返りを markdown に組み立て、最後に
   `save.command` のコマンドへ **その markdown を stdin で渡して保存**する。例:
   ```bash
   printf '%s' "<組み立てた振り返り>" | loomlog reflect-save --date <range.to> --template <id>
   ```
   保存先は `Reflections/<date>.md`(captureに上書きされない・Obsidianグラフに出る)。
6. 最後に「保存しました」と保存パスを伝える。

前提: `loomlog` はグローバルインストール済み、`LOOMLOG_VAULT` 設定済み(未設定なら `~/loomlog`)。
出典(`template.source`)を1行添えると、振り返りの“型”の根拠が伝わる。

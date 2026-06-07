---
description: loomlog — 今週の横断作業ふりかえり
---

`loomlog scan codex --since $(date -v-6d +%F 2>/dev/null || date +%F)` を実行してから `loomlog report -w --json` を実行し、返ったJSON(直近7日)を基に**週次のふりかえり**を日本語で書いてください。

- プロジェクト別の進捗と、週を通したテーマ
- 繰り返し現れた詰まり(#blocker)があれば指摘
- 最後に、来週に向けた短い問いを2〜3個

# 🔥 grill-me 合意メモ: loomlog (v1設計仕様)

> 生成: 2026-06-07 / grill-me による壁打ちの確定版。実装・README にそのまま渡せる v1 スペック。

## 一言でいうと
**claude code / codex / gemini-cli の作業ログを、各自が既にローカルに吐く生ログから受動的に拾い、Obsidian互換のMarkdown(＋自動グラフ)に蓄積し、任意のタイミングで横断的な日報・振り返りを得る、誰でもインストールできる公開ツール。** 「織機(loom)」= 3エージェントの糸を1本に織る。

## スコープ(v1 = Locked)
**作る:**
- 3エージェントの生ログ → **共通フォーマットのローカルMD永続ストア**への収集レイヤー
- **構造グラフ自動生成**(Daily ↔ Project ↔ Topic を wikilink/tag で機械的に)
- **オンデマンドの日報/週報**(各エージェント内のスラッシュコマンドから)
- **1コマンド初期化**(`loomlog init`: vault作成＋各エージェント連携設定)

**作らない(意図的に v2 送り):**
- インサイトLLM層(ただしストア設計で“殺さない”→下記)
- MCPサーバ(過去を自由問い合わせる power-user面)
- Notion/カレンダー連携(既存の自分用 daily-report の領分。loomlog は無関係)
- 単体バイナリ配布、クラウド同期

## アーキテクチャ(Hybrid C)
**共通コアエンジン** = Node/TS 単一npmパッケージ。サブコマンド:
- `loomlog init` — vault作成 / `obsidian.json`追記 / `.obsidian/graph.json`書込 / 導入済みエージェント検出 / 各設定へ**マージ(バックアップ＋冪等)**登録 / 変更内容表示
- `loomlog capture <session-log-path>` — 1セッションを機械パース → ストア追記(**LLM不使用=0トークン**)
- `loomlog scan [agent]` — 前回取込位置以降の新規セッションを検出して capture(冪等・`ingested.json`管理)
- `loomlog report [--date|-w|--project]` — ストアからコンパクトJSONを出力(整形はホストモデルが担当)

## キャプチャ戦略(保持仕様を一次情報で確定済み)
| エージェント | 自動削除 | v1方式 |
|---|---|---|
| **Claude Code** | 30日(`cleanupPeriodDays`既定) | **Stopフック**(プラグインが自己登録 → settings.jsonマージ地雷を回避)。stdinの`transcript_path`を`capture`へ |
| **Codex** | **無し**(公式: retention未実装、`--ephemeral`のみ) | **遅延スキャン**。`~/.codex/sessions/**/rollout-*.jsonl`を**ストリーム読み**(91GB級あり得るので全読み禁止) |
| **Gemini** | **あり**(`SessionRetentionSettings`既定ON・件数＋期間で削除) | **日次スケジュールスキャン**(launchd/cron, init任意導入)を主手段。不安定なhookに依存しない。**実験的** |

出典:
- Claude Code `cleanupPeriodDays` 既定30日
- Codex retention無し: https://developers.openai.com/codex/cli/reference / https://github.com/openai/codex/issues/24948
- Gemini retention既定ON: https://google-gemini.github.io/gemini-cli/docs/cli/checkpointing.html / https://geminicli.com/docs/cli/session-management/

## データ契約(Locked)
**Vault構造**(グラフのノードは Daily/Project/Topic の3種に限定):
```
<vault>/
  Daily/2026-06-07.md      # 1日1枚・プロジェクト別セクション
  Projects/<project>.md    # MOC・自動更新・全Dailyへ逆リンク
  .obsidian/graph.json     # init時に色分け書込
  .loomlog/ingested.json   # 取込済みセッションID(冪等)
```
**日次ノート schema**(0トークンの機械抽出で埋まる):
```markdown
---
date: 2026-06-07
agents: [claude-code, codex]
projects: ["[[loomlog]]"]
tools: [Bash, Edit]
sessions: 3
duration_min: 150
tags: [area/dev, topic/mcp]
---
## [[loomlog]] · claude-code · 90m
- 意図: 設計の壁打ち            # プロンプト先頭行/要旨
- 変更ファイル: SKILL.md         # パスのみ(中身は保存しない)
- コマンド: 12回 (find/grep)     # 件数+種別(引数全文は保存しない)
- 詰まり: なし                   # エラー痕跡から #blocker
- 決定/発見: capture=0トークン #decision
```
**キャプチャ粒度 = A(構造抽出＋秘匿フィルタ)**:
- 既定 = 意図(先頭行) / ファイルはパスのみ / コマンドは件数+種別 / **ファイル中身は保存しない**
- **書込前に env・トークン・.env・APIキーを正規表現でredact**(必須・信頼の生命線)
- プロンプト保存は `full / first-line / off` で設定可
- → v2インサイト(#blocker / topicタグ / #decision・#discovery)の**種データがv1から自然に溜まる**

## 振り返りの実行機構(Locked)
- **report面 = 各エージェントのスラッシュコマンド/プロンプト**(MCPではない):
  - Claude: プラグイン同梱の `/report`・`/weekly`(＋内省フロー用の薄いskill)
  - Codex: `~/.codex/prompts/report.md`
  - Gemini: カスタムコマンド(TOML)
- 中身 = 「`loomlog scan && loomlog report --json` 実行 → この書式で日報化 → 内省を数問」
- **要約LLMはホストモデルが担当 → APIキー不要・追加課金ほぼ0**。capture(フック/スキャン)もキー不要 → **全工程ノーAPIキー**

## 配布(Locked)
- **GitHub公開 + READMEを3セクション**(claude / codex / gemini 別インストール手順)
- npm: 名前衝突時は **スコープ付き `@<user>/loomlog`**、コマンド名は `loomlog`
- ライセンス **MIT**
- フェーズ: **Claude Code + Codex を正式サポート / Gemini は実験的**(消える＝データロス時は本当に失う旨を明記)

## v2(種は今撒く)
インサイトの核 = **① 再発する詰まり / ④ 関心のドリフト / ⑤ 学びの結晶化**。
実装方針: **先に数値シグナル(頻度・遷移・空白・再発)を機械集計 → それをLLMに解釈させる二段**(素のLLM要約=スロップを回避)。on-demand or 定期バッチ。MCP面もv2で追加。

## 残った前提・未決事項
- [ ] **Gemini の `SessionRetentionSettings` 既定値**(Max Count / Min Retention)— バージョン依存。日次スキャン間隔の根拠に実測が要る
- [ ] **Gemini hook ペイロード仕様** / `logs.json` の追記フォーマット差分パース — 実装時に実ログで確定
- [ ] **Codex `notify` 単一スロット** — もし将来フック化するなら既存notifyのチェイン必須(v1は遅延スキャンなので回避済み)
- [ ] **Claude Code プラグインのhook自己登録**の実挙動(他フックと共存)を最初に検証
- [ ] redact ルールセットの初期辞書(どのパターンを既定で伏せるか)

## 次のアクション
1. リポジトリ雛形(`loomlog/`: src/{init,capture,scan,report}.ts, パーサ adapters/{claude,codex,gemini}.ts)
2. **最小縦割り**: Claude Code の `capture`(transcript.jsonl→日次MD) を最初に通す(一番堅い)
3. Codex アダプタ(rolloutストリームパース)→ `scan`
4. `init` のエージェント検出＋設定マージ(バックアップ/冪等)
5. README 3セクション → 公開

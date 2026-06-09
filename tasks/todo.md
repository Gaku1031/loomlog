# loomlog 実装 TODO

設計確定版: `grill-loomlog-20260607.md`

## v1 マイルストーン

### M1: コア & Claude Code 縦割り(最優先・一番堅い) ✅ 完了 2026-06-07
- [x] リポジトリ雛形(package.json / tsconfig / .gitignore / LICENSE(MIT) / README骨子)
- [x] 型定義 `src/types.ts`(SessionRecord)
- [x] 秘匿フィルタ `src/redact.ts`
- [x] Claude アダプタ `src/adapters/claude.ts`(transcript.jsonl → SessionRecord)
- [x] ストア `src/store.ts`(.loomlog/days/*.json を真実とし Daily/*.md・Projects/*.md をレンダー、ingested.json で冪等)
- [x] `src/capture.ts` + `src/cli.ts capture <path>`
- [x] **検証**: 実transcriptで capture → 日次MD生成を確認(冪等・typecheck pass・tsupビルド→node実行まで確認)

### M2: Codex 遅延スキャン ✅ 完了 2026-06-07
- [x] Codex アダプタ(rollout-*.jsonl ストリーム読み。exec_command→コマンド / apply_patch→ファイル / AGENTS.md注入除外の意図抽出 / exit_codeでの詰まり検出)
- [x] `src/cli.ts scan codex [--since]`(scanned.json の mtime 差分で冪等)
- [x] **検証**: 実Codex 7セッション取込→再scanは全skip / 複数プロジェクト集約 / 同一vaultで claude+codex 共存 / typecheck pass

### M3: init & 連携 ✅ 完了 2026-06-07
- [x] `loomlog init`(vault作成 / graph.json書込 / obsidian.json登録=追記・冪等・バックアップ)
- [x] エージェント検出 + Claude `settings.json` 安全マージ(`--wire-claude`、追記のみ・バックアップ・冪等)＋`capture --hook`(Stopペイロードstdin)
- [x] Claude プラグイン(integrations/claude-plugin: Stopフック自己登録 + /report,/weekly)
- [x] Codex prompt / Gemini command(integrations/)
- [x] **検証**: 実configのコピーに対し init/--wire-claude → 既存vault4→5・既存pccフック保全・loomlog追加・冪等 / capture --hook 動作 / typecheck pass

### M4: report & 公開
- [x] `loomlog report [--date|-w|--since/--until|--project] [--json]`(2026-06-07 完了・検証済み: 横断レンジ/フィルタ/JSON妥当性)
- [x] README 3セクション(claude/codex/gemini)(2026-06-07)
- [x] Gemini アダプタ + `scan gemini`/`scan all`(2026-06-09 完了・検証済み: logs.json を複数セッションに分解、3エージェント統合レポート確認。logs.jsonはプロンプトのみ=files/commands無し)
- [ ] Gemini 日次スキャンの **自動化**(launchd/cron インストーラ。現状は手動 or 手動cron設定)
- [x] GitHub 公開(Gaku1031/loomlog)＋ npm publish(loomlog@0.1.0)(2026-06-09)

## v2(種は撒く・今は作らない)
- [ ] インサイト: 再発する詰まり / 関心ドリフト / 学びの結晶化(数値シグナル→LLM解釈の二段)
- [ ] MCP サーバ(過去の自由問い合わせ)

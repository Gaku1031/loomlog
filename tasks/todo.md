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

### M2: Codex 遅延スキャン
- [ ] Codex アダプタ(rollout-*.jsonl ストリーム読み)
- [ ] `src/cli.ts scan codex`(前回オフセット以降のみ)

### M3: init & 連携
- [ ] `loomlog init`(vault作成 / obsidian.json追記 / graph.json書込)
- [ ] エージェント検出＋設定マージ(バックアップ・冪等)
- [ ] Claude プラグイン(Stopフック + /report,/weekly)
- [ ] Codex prompt / Gemini command

### M4: report & 公開
- [ ] `loomlog report --json`(date/-w/--project)
- [ ] README 3セクション(claude/codex/gemini)
- [ ] Gemini 日次スキャン(launchd/cron, 実験的)
- [ ] npm publish / GitHub 公開

## v2(種は撒く・今は作らない)
- [ ] インサイト: 再発する詰まり / 関心ドリフト / 学びの結晶化(数値シグナル→LLM解釈の二段)
- [ ] MCP サーバ(過去の自由問い合わせ)

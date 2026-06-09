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

## v0.2.0: 信頼性 & CI/CD パス(2026-06-09 — Codex独立レビュー+実ログ検証を反映)
- [x] **Codex アダプタの実害バグ修正**(実ログ実証): `shell_command`(コマンド未計上→計上)・プレーン `Exit code: N` 出力(詰まり未検出→検出)・`apply_patch` が custom_tool_call の場合のファイル抽出・先頭user msgの合成ブロックを「丸ごと破棄」せず除去して実依頼をintentに。同一rolloutで commandCount 0→162 / errorCount 0→26 / files 0→33 を確認
- [x] **秘匿強化**: redact→正規化→truncate の順に統一(`redactClip`。truncate先行で秘密が境界分断され漏れる問題を解消)。パターン追加(github_pat/glpat/npm/stripe/notion/hf/Bearer/webhook/ya29/ASIA/URL埋込資格情報)。JSON `"key":"val"` 形式もマスク。`cwd`/`sourcePath` を `~` 短縮しユーザー名漏洩を低減
- [x] **ストア堅牢化**: 全書込を atomic(temp+rename)化し Stopフック/scan 同時実行での破損を防止。セッションキーを `agent:id` 名前空間化(旧 bare-id を移行削除)。scan dedup を mtime+size に
- [x] **CLI 検証**: 値必須flag欠落をエラー化(`--date --json`)/日付の実在&範囲検証/不明flag検出。`src/args.ts` に分離してテスト可能化
- [x] **テスト導入**(node:test, 23件): adapters(fixtures)/redact/args/store idempotency&名前空間/util 日付演算。`npm test` + CI
- [x] **CI/CD**: `.github/workflows/ci.yml`(push/PRで typecheck+test, Node 20/22)＋`publish.yml`(main push→version差分検知→OIDC trusted publish+provenance+tag/Release)。`RELEASING.md` に初期設定手順
- [x] ドキュメント整合: README status 更新 / cli.ts の `loomlog.md` 案内修正 / `capture --agent gemini` 実装 / weekly.md の macOS専用 `date -v` 除去

### v0.2 残(Codexレビューで挙がった未着手・次サイクル)
- [ ] **真の書込ロック**(lockfile)で read-modify-write の lost-update を排除(atomic化で破損は解消済み、競合更新の取りこぼしは未解消)
- [ ] スキーマに `schemaVersion`/`parserVersion`/`projectId=hash(cwd)`/`daySpans`(深夜またぎ分割)を追加 → v2インサイトの集計・移行を安くする
- [ ] 同名repo統合の回避(`projectId` 分離)/ 絶対パス raw 保存の opt-in 設定
- [ ] scan の日付抽出を Windows パス対応(`path.sep`非依存)/ 成長中ログの安定化待ち
- [ ] Gemini 日次スキャンの **自動化**(launchd/cron インストーラ)

## v2(種は撒く・今は作らない)
- [ ] インサイト: 再発する詰まり / 関心ドリフト / 学びの結晶化(数値シグナル→LLM解釈の二段)
- [ ] MCP サーバ(過去の自由問い合わせ)

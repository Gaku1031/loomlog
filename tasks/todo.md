# loomlog 実装 TODO

設計確定版: `grill-loomlog-20260607.md`

## v0.5: Topic ノード(グラフを概念地図化) — 2026-06-09

問題: graph が Daily↔Project の二部グラフ(毛玉)。`tags: [area/dev]` 固定で Topic ノードが無い。
方針(ユーザー承認済): Daily+Project 両方に `#topic/*` タグ / 0トークン決定論抽出 / `rerender` で過去遡及。

- [x] `src/topics.ts` — `extractTopics(rec)`: 概念辞書(EN+JA) / 拡張子 / commandCats の3系統、dedup+cap6
- [x] `src/store.ts` — renderDaily に topic タグ&本文行 / recomputeProjectDate に topics 保存 / renderProject に top-6 タグ
- [x] `src/obsidian.ts` — graph.json に `tag:#topic`=orange の色グループ追加
- [x] `src/cli.ts` + `rerenderVault` — `loomlog rerender`(store から全Markdown再投影)
- [x] `src/obsidian.ts` — `applyGraphConfig`(graph.json を merge: showTags強制ON+不足色グループ追加, backup, 冪等。ObsidianがshowTagsをリセットする問題に対応)/ kebab-caseキー修正
- [x] **真因(Codex診断): タグノードは生成されてたが既定の緑でProjectと同色＝埋もれ。colorGroupsはfileノード専用でtagノードに効かない** → CSSスニペット `applyGraphSnippet`(.obsidian/snippets + appearance.json enable, merge/backup/冪等)を `init` に配線。タグノード=オレンジ(#E89B30)
- [x] `test/obsidian.test.ts` 追加 / typecheck pass / **test 69件緑** / 実vaultで init・rerender 検証 / **ユーザー実機でオレンジ表示確認(2026-06-09「いけた」)**
- [x] 配布反映: `npm run build`(dist再生成)→ 実vaultに `loomlog rerender` + `loomlog init`(snippet)適用済み
- [ ] README のグラフ記述(Daily↔Project↔Topic + CSSスニペットでタグ色付け が実際に成立)— 任意・別途

## v0.6: クリップボード貼り付けUX (--copy) — 2026-06-09

問題(実ユーザー不満): ターミナル出力をNotion等に貼ると ①2行目以降が1段ネストされる ②markdownが整形描画されない。
原因確定:
- ① renderText の `  - ` 先頭2スペース字下げ(report.ts:152-156)。端末では綺麗だが、Notionのmarkdownパーサは空白に敏感で「1段ネスト」と解釈する**自損**。
- ② ターミナルはクリップボードにプレーンテキスト1種類しか載せない(リッチ型 RTF/HTML が無い)。検証済: 素のpbcopyは `utf8/string/Unicode text` のみ、`textutil html→rtf|pbcopy` で `«class RTF »` が載る。

方針(ユーザー承認済): **表示用フォーマットと貼付用フォーマットを分離**。`--copy` フラグ / デフォルトはリッチ(RTF on macOS)。
リリース: **v0.5.0**(Topic ノード v0.5 + 本機能をまとめて公開。published は 0.4.0 のままだった)。

- [x] `src/report.ts` — `renderMarkdown(ReportData)` / `renderMarkdownPatterns(PatternsData)`: 字下げ無しのクリーンGFM(`# タイトル` + `## 見出し` + 見出し後空行 + 行頭`- `)。①の根治。フリーテキストはブロックレベルのみ(inline `*`/`` ` `` を再解釈しない)
- [x] `src/clipboard.ts`(新規)— `copyToClipboard({plain, html?})`: darwin=html時 `textutil html→rtf`(spawnSync)→`pbcopy`(RTF)/plainは`pbcopy`。linux=`wl-copy --type text/html`→`xclip -t text/html`→plain各種。win32=`clip`(plainのみ)。never-throw(欠落バイナリは `error` 返り→fallback)、返値 `{ok, mechanism, rich}`。不在時は呼び元がstdoutフォールバック
- [x] `mdToHtml(md)`(clipboard.ts)— `#..######`/`- `/段落 のブロックレベル極小コンバータ。**HTMLエスケープ必須**(`<`/`&`/`>`)・`<meta charset=utf-8>` 必須(textutilが日本語を化けさせる)。renderMarkdown 1ソースから plain+rich を派生
- [x] `src/cli.ts` — `--copy`(alias `-c`)+ `--md` フラグ。report/query(patterns含む) を `emit()` 共通ヘルパ化。`--copy`(mac)=RTF / `--copy --md`=プレーンmd / `--copy --json`=JSON。stdout: `--md`=クリーンmd / `--json`(既存)/ 既定=端末text(不変)。確認行 `✓ copied report (rich · <span>) → clipboard — paste into Notion`
- [x] `src/args.ts` — `--copy`/`md` を BOOLEAN_FLAGS に / `-c` short alias 追加
- [x] USAGE(cli.ts)+ README + README.ja に `--copy`/`--md` を追記
- [x] test: report.test.ts(renderMarkdown/Patterns が行頭スペース0=①回帰固定・見出し後空行・H1/H2・空レンジ)/ clipboard.test.ts(mdToHtml の見出し/ul集約/HTMLエスケープ/inline非解釈/charset/日本語)/ args.test.ts(--copy/-c/--md)。**全82件緑**(69→82)・typecheck pass
- [x] 検証(実vault `~/loomlog` 42セッション): `report --copy`→`clipboard info`=«class RTF » / `--copy --md`→plainのみ・pbpaste=`# loomlog report` / `--copy --json`→JSON / `today --copy`・`patterns --copy` rich / `--md` 行頭スペース0 / 空レンジOK / **既定text出力は不変**を確認。`npm run build` でdist再生成済み
- [ ] 残: Notion 実貼付の目視(ユーザー手元)/ 配布(commit→PR→main→npm publish 0.5.0)

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

## v0.3.0: 想起(recall)＋学術メソッドの振り返り(2026-06-09)
設計全文: `tasks/v0.3-reflection-design.md`
- [x] **commitメッセージ捕捉**(`commits`): git commit subject を shell/Bash から0トークン抽出(-m/-am/$''/heredoc対応)。実データでiOS開発の濃い4 commit抽出を確認。日報・patternsに「成果」として表示
- [x] **`loomlog <query>`**: 日付 / today / yesterday / week / month / `<project>` / `patterns` を機械ルーティング(素のターミナルで0トークン)。「毎日何したか忘れる」を想起で解決
- [x] **`patterns`**: 作業種別の分布 / プロジェクト時間配分 / エージェント使い分け / 多忙日 / 最近の成果commit
- [x] **振り返りエンジン**: 4メソッド(WSN/Gibbs/AAR/KPT/YWT)を `src/reflect.ts` に。`loomlog reflect --template <t> --json`(事実+型の段階を出力)→ ホストモデルが対話進行 → `loomlog reflect-save`(stdin→`Reflections/<date>.md`、captureに上書きされない、Daily/Projへ逆リンク、グラフ紫)
- [x] スラッシュコマンド: `/loomlog:reflect`(WSN日次・対話・保存)/`/loomlog:weekly`(Gibbs週次)/codex・gemini reflect prompt。plugin v0.2.0
- [x] テスト 23→29件 / README更新 / init が Reflections/ も作成 / 0.3.0

## v0.4.0: 全プロンプト捕捉 + Claudeスキャン + Codexスキル(2026-06-09 — 実ユーザー不満「日報が最新セッションしか拾えず全部を振り返れない」への修正)
- [x] **全プロンプト捕捉** `prompts[]`: 3アダプタ(claude/codex/gemini)が初回intentだけでなく**当該セッションの全人間プロンプト**を時系列で収集(redact→clip 180字・最大24件)。`intent` は `prompts[0]` 互換。report の `intents` は全プロンプトをflatMap(最大24)、Daily/*.md は先頭=「意図」/残り=「追加の依頼」で描画。schema v1 互換(`prompts?` 省略時は `[intent]` にフォールバック)
- [x] **`scan claude`** (`scanClaude`): Stopフックを主経路としつつ、レポート時スキャンで**取りこぼし/スキーマ更新を回収**(`~/.claude/projects/**/*.jsonl`、subagents除外)。scan署名に `SCHEMA_VERSION` を含め(`scanSignature`)、スキーマ昇格で自動再取込。実データ検証: 4捕捉/23スキップ(本日mtimeだが内容日付が過去)→再実行で27全スキップ(冪等)
- [x] **`SCHEMA_VERSION` 1→2**: `prompts` 追加に伴う版上げ。codex の scan署名も `scanSignature` に統一
- [x] **`extractCommits` 堅牢化**: コマンド境界(`^`/`;&|(`改行・env接頭辞・sudo)の**本物の `git … commit` invocation のみ**に発火。`echo "git commit -m x"`/`grep "git commit"`/`rg "git commit -m"` 等の引用符内偽陽性を排除。負例テスト追加で固定
- [x] **Codexスキル化** (`integrations/codex/skills/loomlog/`): Codex 0.117+ が `~/.codex/prompts` カスタムスラッシュを廃止 → SKILL.md + agents/openai.yaml(`allow_implicit_invocation`)。`$loomlog`/自然言語で起動。旧 `prompts/` は legacy として残置。vault既定を `${LOOMLOG_VAULT:-./.loomlog-vault}` にしサンドボックス書込を担保。各 integration の `scan codex` → `scan all` に更新
- [x] テスト 31件(extractCommits負例 + 各アダプタ follow-up prompt + buildReport follow-up)・typecheck pass・report/scan 実データスモーク

### v0.4 残・候補(次の価値)
- [ ] **report renderText の整形**: follow-up を全部「意図:」で出すのは冗長。Daily同様に先頭/追加で出し分け(JSONは現状でOK・人間ターミナル表示のみの問題)
- [ ] **vault分裂の注意喚起**: `LOOMLOG_VAULT` 未設定時 Claude=`~/loomlog` / Codex=`./.loomlog-vault` に分かれる。横断性のため init で env設定を強く促す(README追記 or init出力強化)
- [ ] **再発する詰まり**: error fingerprint(失敗テキストの正規化署名)をキャプチャ → 「別エージェントでも同じ失敗」検出。AAR/Gibbsの分析が強くなる
- [ ] **関心ドリフト**: 宣言intent vs 実時間配分(promptTurns捕捉は v0.4 で完了 → 次は分析)
- [ ] agent fit profile / marker(decision/root cause/TODO)抽出 / MCP 自由問い合わせ

## v2(種は撒く・今は作らない)
- [ ] インサイト: 再発する詰まり / 関心ドリフト / 学びの結晶化(数値シグナル→LLM解釈の二段)
- [ ] MCP サーバ(過去の自由問い合わせ)

## v0.6.0: 初回成功率 — doctor + 失敗の可視化 + Stopフック堅牢化(2026-06-13 — Codexレビュー反映)

優先は機能追加より「導入の成功率」。Codex レビューの6点を実コードで検証してから対応。

- [x] **`loomlog doctor`**(新規 `src/doctor.ts` + cli 配線): PATH上のCLI / `LOOMLOG_VAULT` / vault初期化 / 最終キャプチャ鮮度 / **vault分裂検出**(active+`~/loomlog`+`./.loomlog-vault` を走査し複数にデータがあれば警告)/ Codex sandbox split の的確警告(env未設定×codex導入時のみ)/ Claude Stopフック(settings.json or プラグイン検出)/ Codexスキル / Geminiコマンド / hook.log のエラー尾。`--json` 対応。hard fail 時 exit 1(=スクリプト/CIのゲートに使える)。v0.4残「vault分裂の注意喚起」をこれで解消
- [x] **Stopフック堅牢化**: `wireClaudeHook` の vault 埋込を `JSON.stringify`(二重引用→`$`/backtick が生きる)から **POSIX単一引用**(`shellSingleQuote`、`'\''` エスケープ)へ。パスに `$(...)`/space/backtick を含んでもシェル再解釈不可。`init.test.ts` で固定
- [x] **失敗の可視化**: `captureHook` を try/catch で全面ガード(エージェントを絶対ブロックしない)し、失敗を `<vault>/.loomlog/hook.log` に追記(自己truncate 64KB上限)。`2>/dev/null` で消えていた Stopフックエラーが doctor から見える。`/loomlog:report`(report.md)に「loomlog不在/report失敗時は `loomlog doctor` を実行して要約をユーザーに伝える」導線を追加
- [x] **vault分裂の根治導線**: Codex `SKILL.md` の Defaults に「`./.loomlog-vault` はディレクトリ毎のfallback。横断性のため `LOOMLOG_VAULT` を設定(`loomlog doctor` で分裂検出)」を明記
- [x] **README 冒頭に 60秒 quickstart**(EN/JA 両方): install → `LOOMLOG_VAULT` → `init --wire-claude` → `doctor` の4行 + 「visuals TODO」プレースホルダ(GIF/グラフは別途ユーザーが追加)
- [x] **GitHub topics 設定**: claude-code / codex / gemini-cli / obsidian / ai-agents / dev-journal / knowledge-graph / productivity(空→8件)。npm keywords も同期(dev-journal/knowledge-graph/productivity 追加)
- [x] バージョン 0.5.0→**0.6.0**(package.json + plugin.json)。typecheck pass・**test 91件緑**(82→91、doctor 6 + init 3)・`npm run build` で dist 再生成・実環境スモーク(未init=exit1で fail/warn 表示、init+env=all green)
- [ ] 残: visuals(report GIF + Obsidian グラフ スクショ)をユーザー手元で追加 / 配布(commit→PR→main→npm publish 0.6.0)

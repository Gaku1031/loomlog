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
- [x] 配布: commit→PR #1→main→**npm publish 0.6.0 完了**(workflow success / `latest: 0.6.0`)。GitHub topics 8件 live

## v0.7.0: 0トークン日報フォーマット + README visuals(2026-06-14 — 実ユーザーFB反映)

きっかけ: README用にGIFを作る過程で「`loomlog report` の出力だと "何をやったか" が伝わらない」「`claude -p` で日報生成を見せると、6/15からのクレジット課金と『0トークン』の売りに矛盾」。→ **標準コマンドの日報体裁を改善し、LLM不要で読める日報にする**のが本質と判断。

- [x] **`renderText`/`renderMarkdown` を日報体裁に改修**(`src/report.ts`): プロジェクトごとに見出し + 各セッションの意図を**素の箇条書き**(`意図:` プレフィックス廃止)+ `↳ 成果:`(text)/`- 成果:`(md)にコミット。生の `files:`/`commands: npm×N` は日報から除外(`--json`・Dailyノート・`loomlog patterns` に残す)。`1 session` 単数化。`topCommands` 削除
- [x] **`renderPatterns` にインサイト要点 + 横棒グラフ可視化を追加**(`src/report.ts`、Codex に可視化方針を相談の上): 生の数字羅列だと「何が言えるか/どんなパターンか」が伝わらない、という実FB対応。(1) 各セクション先頭に**数字から機械生成した一文**(0トークン)— 時間配分「acme-web が最多(49%)、上位2件で87%」/ エージェント「claude-code と codex をほぼ同等に、gemini は補助的」/ 作業種別: commandカテゴリ→可読ラベル(WORK_LABEL)「Git・パッケージ管理・Go が中心」/ ペース「<日> が最多(N分)、稼働N日」/ 出荷: conventional-commit型(COMMIT_TYPE)「9件 — テスト2・修正2…」。(2) **Unicode横棒グラフ**(`bar()` = █+端数▏▎▍▌▋▊▉、`displayWidth()`/`padTo()` でCJK幅=2を考慮した整列)を proportional 3セクション(プロジェクト時間配分・エージェント・多忙日)に描画。markdownは等幅前提を崩さないようテキスト維持。セクション順 time→agent→work→pace→ship
- [x] **テスト更新**(`test/report.test.ts`): renderText の新体裁(素の意図箇条書き+↳成果・stats非ダンプ)/ renderMarkdown の見出し`· agents`化・`files:`/`commands:`/`意図:` 非出力 / patterns の各セクション要点(time集中・agent分担・work種別・commit型mix・rhythm)を text+md 両方で固定。**test 94件緑**(91→94)・typecheck pass・build OK
- [x] **README visuals 確定**(EN/JA): hero GIF(`docs/report.gif`、3.4s)= 実 `loomlog today`(0トークン・LLM不要・claude不使用)が横断日報を出力。Recall セクションに `loomlog patterns` の別GIF(`docs/patterns.gif`、4.5s = 作業傾向・エージェント使い分け・成果)。Obsidianグラフ スクショ(`docs/obsidian-graph.png`)。ハイライト「レポートもトークン0」に更新。`/loomlog:report`(課金あり)は任意のプロ文体レイヤと整理
- [x] **GIF再現基盤**(`docs/demo/`): `seed.ts`(synthetic・相対日付・今日=7セッション3エージェント)+ `report.tape`(vhs、dev CLIを `loomlog` 関数化して実コマンド表示)。`claude -p` 再生シムは廃止・削除。`docs/` は npm `files` 外
- [x] バージョン 0.6.0→**0.7.0**(日報フォーマットは利用者可視の変更)
- [ ] 残: GIF最終目視OK → 配布(commit→PR→main→npm publish 0.7.0)

## v0.8.0: patterns を「インサイト」に — トレンド/エージェント適性/出荷/詰まり(2026-06-14 — 実FB「数字の羅列でインサイトが無い」)

Codex に可視化方針も相談。**#4 詰まりは実vaultで検証 → ノイズ誤検出を発見し修正**(これが「判定と実際の整合」)。

- [x] **#4 詰まり捕捉**(schema v2→v3): 失敗したツール呼び出しを *何が* 失敗したかと紐付け、正規化シグネチャ(`go test`/`npm run build`/`edit X`)+ redact済みサンプル(根拠)で記録。`src/util.ts commandSignature`(chainの`cd .. &&`を剥がして実作業コマンドを採る/runnerはサブコマンド保持)+ `blockerSignature` / `src/adapters/blockers.ts BlockerCollector`。claude(tool_use id↔tool_use_id)・codex(call_id)アダプタで紐付け。SCHEMA_VERSION昇格で既存ログ自動再scan
- [x] **詰まり判定 = 再発(2回以上)のみ**: 1回限りの失敗は除外。集計時に `count>=2` のシグネチャだけ「詰まり」として根拠付きで提示(sig ✕回数・プロジェクト・サンプル)
- [x] **実vault検証でノイズ誤検出を修正(整合性の肝)**: 実ログ855セッションで検証→ `cd✕139`/`Read✕136`/`rm`/`echo`/`AskUserQuestion`/`?` 等のナビ・探索・対話ツールの失敗を誤って「詰まり」判定していた。`isNoiseSignature`(NOISE_COMMANDS/NOISE_TOOLS/read-only git/`?`)で除外 → 再検証で `python3✕26`/`git mv✕10`/`WebFetch✕9`/`edit MEMORY.md✕8` 等の**本物の再発失敗**のみに。重い日も raw errorCount でなく*意味のある*失敗数で算出
- [x] **詰まりの解像度UP(実FB「何に詰まって・どう解消するか見えない」)**: (1) **エラー本文の抜粋**(`errorExcerpt` がANSI除去+エラー行抽出)を捕捉=「なぜ失敗したか」。(2) **解消/未解決判定** — 失敗だけでなく成功も `record(call, ok)` で追跡し、同シグネチャが後で成功したら resolved。集計は最新セッションの状態を採用。実vault再検証: 「`claude-mem MCP ✕11 未解決` — Request timed out 30000ms」「`edit package.json ✕8 解消` — File has not been read yet」「`node/WebFetch — context-mode redirected`」等が出るように
- [x] **詰まりが「刺さらない」FB → Codex相談の上、表示と媒体を刷新**: (1) 出力形式を `✗ 未解決 ×5 go test · billing-api` + `理由 <エラー>` の2行カード形式に(状態を文字で明示・`理由`ラベルで「なぜ」を同格に・lead は件数サマリに)。(2) `errorExcerpt` を *最後の*(最も具体的な)マッチ行を採用+スタックフレーム除外に改善。(3) **`loomlog patterns --blockers`** フラグ追加=詰まりだけの集中ビュー(`renderPatterns(p, {blockersOnly})` / args BOOLEAN_FLAGS / USAGE)。(4) **専用GIF `docs/blockers.gif`**(FontSize 22・少行・低速)で詰まりが大きく読める。密な full patterns GIF だと埋もれる問題を媒体ごと解決(Codex提案)。README Recall に配置
- [x] test 102件緑(--blockers focused view・新フォーマット・errorExcerpt last-match を追加固定)
- [x] **詰まりを「文章で(日報みたいに)」FB対応**: 生エラー1行だと意味が伝わらない → **セッションの intent(=ユーザー自身の言葉)で文に**: 「<intent>」中に <cmd> が N回失敗、未解決のまま/その後解消。+ 下にエラー(根拠)。`BlockerStat.intent` を最新セッションから集計。focused `--blockers`(prose・大フォント1行GIF `docs/blockers.gif` 1600px幅で折返し回避)と overview(compact 1行)を分離。test 102緑
- [x] **#1 トレンド**: 前期間(同じ長さの直前期間)と比較。ヘッダに `▲ 前期間比 +N%`、プロジェクト別に `▲+Nm/▼-Nm/＋新規` + `(前期間のみ: X)`。前期間が空の時はmover非表示
- [x] **#2 エージェント適性**: エージェントごとに「何に使っているか」(commit型mix→ラベル、無ければwork型)を棒グラフ横に。"codex: テスト・CI・修正"
- [x] **#3 出荷とフロー**: セッション単位の出荷率%は粒度依存で誤解を生む(実データで90%↔4%に振れた)ため**廃止**。コミット数/稼働日 + commit型内訳 + 詰まりの重い日に。
- [x] **`renderPatterns`/`renderMarkdownPatterns` 再構成**: 詰まり→出荷→エージェント→プロジェクト(mover)→ペース。markdownはテキスト維持
- [x] テスト: commandSignature(peel)・blockerSignature・noise除外(claude adapter)・blocker grouping・patterns #1-4 + 再発のみ。**test 100件緑**・typecheck・build OK
- [x] seed にsynthetic blocker + 前期間(gone project含む)を追加 / patterns GIF 再生成 / README Recall キャプションを「トレンド・詰まり(根拠付き)・出荷率・エージェント適性」に更新(EN/JA)
- [x] バージョン 0.7.0→**0.8.0**(schema変更 + 利用者可視の大型変更)
- [ ] 残: 配布(commit→PR→main→npm publish 0.8.0)

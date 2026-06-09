<div align="center">

# loomlog

**すべてのAIコーディングエージェントのための、ひとつのローカル日報。**

loomlog は **Claude Code**・**Codex**・**Gemini CLI** がすでにローカルに吐いているセッションログを
受動的に拾い、Obsidian互換のひとつのvaultへ織り込みます。あとは任意の日を **recall（振り返り＝何をやった？）**
し、研究に裏打ちされたフレームワークで **reflect（内省）** するだけ。APIキー不要・トークン消費ほぼゼロ。

<br>

[![npm version](https://img.shields.io/npm/v/loomlog.svg?logo=npm&label=npm&color=cb3837)](https://www.npmjs.com/package/loomlog)
[![npm downloads](https://img.shields.io/npm/dm/loomlog.svg?color=cb3837)](https://www.npmjs.com/package/loomlog)
[![node](https://img.shields.io/node/v/loomlog.svg?logo=node.js&logoColor=white&color=339933)](https://nodejs.org)
[![CI](https://github.com/Gaku1031/loomlog/actions/workflows/ci.yml/badge.svg)](https://github.com/Gaku1031/loomlog/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/npm/l/loomlog.svg?color=blue)](./LICENSE)

[English](./README.md) · **日本語**

[動作要件](#動作要件) · [セットアップ](#セットアップ) · [使い方](#使い方) · [仕組み](#仕組み) · [データモデル](#データモデル)

</div>

---

`loom`（織機）= 3つのエージェントの糸を、1本のログとナレッジグラフに織り上げる。

**ハイライト**

- **キャプチャはトークン0。** loomlog はエージェントが既に書き出しているログをパースするだけ。LLMもAPIキーも不要。
  保存前に秘密情報を正規表現でredact（伏字化）します。
- **レポートはエージェント内で動く。** 整形は各エージェントのネイティブコマンド経由でホストモデルが担当。
  追加サービスも追加コストもありません。
- **あなたが所有するプレーンMarkdown。** Obsidian vaultを指すだけで、Daily ↔ Project ↔ Topic の
  グラフが自動で立ち上がります。

> **ステータス:** [npm](https://www.npmjs.com/package/loomlog) で公開済み。Claude Code と Codex は
> 正式サポート、Gemini CLI は実験的（プロンプトのみ記録し、セッションを自動削除します）。
>
> **対応プラットフォーム:** macOS / Linux / Windows。CLI本体は純粋なNodeです。OS依存の手順は
> 以下で **macOS / Linux** と **Windows (PowerShell)** に分けて示します。

## 目次

- [動作要件](#動作要件)
- [セットアップ](#セットアップ) — インストール・vault作成・エージェント連携
- [使い方](#使い方) — Recall と Reflect
- [仕組み](#仕組み)
- [データモデル](#データモデル)
- [開発](#開発)

## 動作要件

- **Node.js 20+**
- **Claude Code**・**Codex**・**Gemini CLI** のいずれか1つ以上（loomlog は *それらの* ログをキャプチャします）
- **Obsidian** — 任意。グラフビュー用のみ。どのMarkdownエディタでも動きます。

## セットアップ

3ステップ: CLIをインストール → vaultを作成 → 使うエージェントを連携。CLI はどのOSでも共通で、
**vaultの環境変数** と **ファイルコピー / スケジュール実行** のコマンドだけがOSで異なります。
それぞれ **macOS / Linux** と **Windows (PowerShell)** の両方を以下に示します。

### 1. CLIをインストール

```bash
npm install -g loomlog
```

### 2. vaultを作成

`loomlog init` は `~/loomlog` を作成し、Obsidianのグラフ設定を書き込み、vaultをObsidianに登録し、
導入済みエージェントを検出します。OSを自動判定して正しいObsidian設定パス（macOS は
`~/Library/Application Support`、Windows は `%APPDATA%`、Linux は `~/.config`）へ書き込むので、
ここを自分で設定する必要はありません。

```bash
loomlog init
```

続いて、すべてのコマンドとスケジュールタスクがvaultを見つけられるよう、場所を永続化します:

**macOS / Linux**

```bash
echo 'export LOOMLOG_VAULT="$HOME/loomlog"' >> ~/.zshrc   # または ~/.bashrc
export LOOMLOG_VAULT="$HOME/loomlog"                       # 現在のシェル用
```

**Windows (PowerShell)**

```powershell
setx LOOMLOG_VAULT "$HOME\loomlog"          # 新しいシェル・スケジュールタスクに永続化
$env:LOOMLOG_VAULT = "$HOME\loomlog"        # 現在のシェル用
```

すべては `$LOOMLOG_VAULT`（既定 `~/loomlog`）にキャプチャされます。`init` は検出したエージェントに
合わせた次の手順を表示します。

### 3. エージェントを連携

使うエージェントをセットアップします。**Claude Code** は完全自動。**Codex** と **Gemini** は
インストール済みパッケージから数ファイルをコピーする必要があります。まず、以下のコピーコマンドを
OS非依存にするためにパッケージパスを取得します:

**macOS / Linux**

```bash
LOOMLOG_PKG="$(npm root -g)/loomlog"   # `npm install -g` がloomlogを置いた場所
```

**Windows (PowerShell)**

```powershell
$LOOMLOG_PKG = "$(npm root -g)\loomlog"
```

#### Claude Code — プラグインをインストール（推奨）

Claude Code 内で実行（どのOSでも同じ）:

```
/plugin marketplace add Gaku1031/loomlog
/plugin install loomlog@loomlog
```

これだけです。プラグインは:

- すべてのセッションを **自動キャプチャ** — `Stop` フックが自己登録するので、`settings.json` を
  触る必要はありません;
- スラッシュコマンド **`/loomlog:report`**（今日のレポート）、**`/loomlog:reflect`**（日次の内省）、
  **`/loomlog:weekly`**（Gibbsの週次）を追加します。

プラグインは内部で `loomlog` CLI を呼ぶので、インストールしたまま（手順1）にしておいてください。

<details>
<summary>プラグインを使いたくない場合は？</summary>

Stopフックを自分のsettingsに追記し（追記のみ・バックアップあり・冪等）、コマンドをコピーします。

**macOS / Linux**

```bash
loomlog init --wire-claude
mkdir -p ~/.claude/commands/loomlog
cp "$LOOMLOG_PKG"/integrations/claude-plugin/commands/*.md ~/.claude/commands/loomlog/
```

**Windows (PowerShell)**

```powershell
loomlog init --wire-claude
New-Item -ItemType Directory -Force "$HOME\.claude\commands\loomlog" | Out-Null
Copy-Item "$LOOMLOG_PKG\integrations\claude-plugin\commands\*.md" "$HOME\.claude\commands\loomlog\"
```

プラグイン *か* これ *のどちらか* を使ってください。両方だと Stop フックが2回走ります（無害ですが冗長）。

> **Windows の注意:** 配線される Stop フックのコマンドは POSIX シェル構文（`2>/dev/null || true`）を使います。
> もし Claude Code がフックを POSIX シェルで実行しない環境なら、フックは使わず、スケジュール実行の
> `loomlog scan claude` でキャプチャしてください（Claude はトランスクリプトを約30日保持します）。
> 下の [スケジュールスキャンのレシピ](#gemini-cli--実験的) を参照し、`all` を `claude` に置き換えます。

</details>

#### Codex — スキルをインストール

**macOS / Linux**

```bash
mkdir -p ~/.codex/skills
cp -R "$LOOMLOG_PKG"/integrations/codex/skills/loomlog ~/.codex/skills/loomlog
```

**Windows (PowerShell)**

```powershell
New-Item -ItemType Directory -Force "$HOME\.codex\skills" | Out-Null
Copy-Item -Recurse -Force "$LOOMLOG_PKG\integrations\codex\skills\loomlog" "$HOME\.codex\skills\loomlog"
```

Codexのスキルはスラッシュコマンドではないため、ピッカーに `/loomlog` は出ません。スキルは
**`$loomlog`** または自然言語で呼び出します — *「loomlogで今日の日報を書いて」*、*「今日の振り返りを作って」*。
任意のターミナルで `loomlog scan all && loomlog report` を実行することもできます。

> Codex 0.117+ はカスタムスラッシュプロンプトを廃止したため、スキルがサポート対象の経路です。
> 旧Codex向けのレガシープロンプトは
> [`integrations/codex/prompts/`](./integrations/codex/prompts/) にあります。

#### Gemini CLI — 実験的

**macOS / Linux**

```bash
mkdir -p ~/.gemini/commands/loomlog
cp "$LOOMLOG_PKG"/integrations/gemini/commands/loomlog/*.toml ~/.gemini/commands/loomlog/
loomlog scan gemini               # 現在のGeminiセッションを取り込む
```

**Windows (PowerShell)**

```powershell
New-Item -ItemType Directory -Force "$HOME\.gemini\commands\loomlog" | Out-Null
Copy-Item "$LOOMLOG_PKG\integrations\gemini\commands\loomlog\*.toml" "$HOME\.gemini\commands\loomlog\"
loomlog scan gemini               # 現在のGeminiセッションを取り込む
```

その後、Gemini内で **`/loomlog:report`** または **`/loomlog:reflect`** を実行します。Gemini は
プロンプトのみ記録（ファイル/コマンドの詳細なし）し、古いセッションを自動削除するため、履歴を
失わないよう日次スキャンをスケジュールしておきます:

**macOS / Linux** — cron に追記（`crontab -e`）:

```cron
0 22 * * *  loomlog scan all --vault ~/loomlog
```

**Windows (PowerShell)** — 日次スケジュールタスクを登録（手順2の `LOOMLOG_VAULT` を引き継ぎます）:

```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" -Argument '-NoProfile -Command "loomlog scan all"'
$trigger = New-ScheduledTaskTrigger -Daily -At 10PM
Register-ScheduledTask -TaskName "loomlog-scan" -Action $action -Trigger $trigger -Description "Daily loomlog scan"
```

Gemini サポートはベストエフォートとお考えください。

## 使い方

loomlog には2つの動詞があります: **recall（何をやった？）** と **reflect（だから何？/次は何？）**。

### Recall — 「何をやった？」

機械的・トークン0・素のターミナルで動きます。第1引数がクエリです:

```bash
loomlog today              # yesterday や日付も可 — loomlog 2026-06-08
loomlog week               # 直近7日           loomlog month   # 直近30日
loomlog <project>          # 1プロジェクトの履歴
loomlog patterns           # どんな仕事をしているかの傾向
```

`patterns` は「どんな種類の仕事をしているか？」に答えます — コマンド種別の内訳、プロジェクト別の
時間配分、エージェント利用、忙しかった日、そして直近の **コミット**（ログ内の `git commit` メッセージから
直接読み取る、あなた自身の「何を出荷したか」ログ。トークン0）。

### Reflect — 構造化された内省

内省は **AIエージェント内で** 動きます — 対話にはモデルが要り、loomlog のルールは「ホストモデルが
やる（APIキー不要）」です。loomlog は事実レイヤーを機械的に埋め、エージェントが本物の内省実践
フレームワークに沿って案内し、結果は `Reflections/<date>.md` に保存されます（キャプチャがこれを
上書きすることはありません）。

Claude Code で、1日の作業のあとに:

```
/loomlog:reflect           # 日次  — What / So What / Now What（Borton → Driscoll）
/loomlog:weekly            # 週次  — Gibbs Reflective Cycle（1988）
```

日次の内省は:

1. 今日の事実を集め、
2. プロジェクト別に **What（やったこと）** を提示 — 意図・主要ファイル・作業種別・出荷したコミット、
3. **So What** の問いを1問ずつ — *「今日いちばん重要だった作業は？」*、*「詰まったのはなぜ？」*、
   *「新しく分かった/決めたことは？」*、
4. **Now What** を質問 — *「次にやること/変えることは？」*、
5. 仕上がった内省を `~/loomlog/Reflections/<date>.md` に書き、その日のノートへリンクし直します
   （Obsidianグラフに表示されます）。

引数で別のフレームワークを選べます。例: `/loomlog:reflect aar`:

| テンプレート | 用途 |
|----------|------|
| `wsn`    | 日次（既定）— What / So What / Now What |
| `gibbs`  | 週次 — Gibbs Reflective Cycle |
| `aar`    | 詰まりの多い日 — After-Action Review |
| `kpt`    | Keep / Problem / Try |
| `ywt`    | やったこと / わかったこと / つぎやること |

内部的には `loomlog reflect --template <t> --json` → あなたが回答 → `loomlog reflect-save`
（APIキー不要・追加トークンほぼ0）です。エージェントのない素のターミナルでは、代わりに上の Recall
コマンドを使ってください — `loomlog reflect` 単体はモデル向けのJSONを出力するだけです。

## 仕組み

```
エージェントのセッションログ ──(キャプチャ・機械的・トークン0)──▶ <vault>/Daily/*.md, Projects/*.md
                                                                  │
                              エージェント連携コマンド ────────────┘──▶ ホストモデルがレポートを書く
```

キャプチャは機械的な半分（LLMなし・トークンなし）、レポートと内省はモデルの半分で、いま使っている
エージェントが実行します。各エージェントはログの扱いが異なるため、キャプチャのタイミングも異なります:

| エージェント | ログを自動削除？ | キャプチャ戦略 |
|-------|--------------------|------------------|
| Claude Code | する（既定30日） | `Stop` フックで即時キャプチャ |
| Codex | しない | レポート時の遅延スキャン |
| Gemini CLI | する（既定ON） | 日次スケジュールスキャン *（実験的）* |

キャプチャの粒度は意図的に保守的です: プロンプトの意図（先頭行）、ファイルの **パス**（中身は保存しない）、
コマンドの **種別ごとの件数**（引数全文は保存しない）、使ったツール、エラー数 — すべて秘匿redactorを
通します。

## データモデル

vault は単なる Markdown です:

```
<vault>/
  Daily/2026-06-07.md      # 1日1枚・プロジェクト別セクション
  Projects/<name>.md       # 自動メンテされるプロジェクト索引（MOC）
  Reflections/<date>.md    # 保存された内省（キャプチャは上書きしない）
  .obsidian/graph.json     # グラフビュー設定（`init` が書き込む）
  .loomlog/                # 一次情報のJSON。Markdownはその射影
```

## 開発

```bash
npm install
npm test
# Claude Code のトランスクリプト1本をスクラッチvaultにキャプチャ:
npx tsx src/cli.ts capture ~/.claude/projects/<proj>/<session>.jsonl --vault ./my-vault
cat ./my-vault/Daily/*.md
```

確定した設計の全文は [`grill-loomlog-20260607.md`](./grill-loomlog-20260607.md)、リリースパイプラインは
[`RELEASING.md`](./RELEASING.md) を参照してください。

## ライセンス

[MIT](./LICENSE) © 2026 Gaku1031

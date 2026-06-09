# loomlog

> Local, cross-agent dev journal for **Claude Code**, **Codex**, and **Gemini CLI**.
> Passively weaves the sessions your AI tools already log into an Obsidian-compatible
> vault — then gives you a daily/weekly report on demand. No API key. Token-cheap.

`loom` = the three agents' threads, woven into one log + knowledge graph.

> **Status: v1, published on [npm](https://www.npmjs.com/package/loomlog).** Claude Code
> and Codex are fully supported; Gemini CLI is best-effort/experimental (it logs prompts
> only and auto-deletes sessions). See [`grill-loomlog-20260607.md`](./grill-loomlog-20260607.md)
> for the full locked design and [`RELEASING.md`](./RELEASING.md) for the release pipeline.

## Why

Your AI coding sessions already get logged to disk — but they scatter across three
tools and (for Claude Code & Gemini) **get auto-deleted** after a while. loomlog
captures them promptly into durable Markdown you own, and lets you ask
"what did I do today?" across every agent at once.

- **Capture is mechanical (no LLM) → 0 tokens.** It just parses logs the agents
  already write. Secrets are redacted before anything is stored.
- **Reports run inside your agent** via a slash command — the host model formats
  them, so there's **no API key and no extra cost**.
- **Storage is plain Markdown** in a folder. Point it at an Obsidian vault and the
  graph (Daily ↔ Project ↔ Topic) lights up automatically.

## How it works

```
agent session logs ──(capture, mechanical, 0 tokens)──▶ <vault>/Daily/*.md , Projects/*.md
                                                              │
                                   /report (slash command) ───┘──▶ host model writes your report
```

| Agent | Auto-deletes logs? | Capture strategy |
|-------|--------------------|------------------|
| Claude Code | Yes (30d default) | `Stop` hook → capture immediately |
| Codex | No | lazy scan at report time |
| Gemini CLI | Yes (on by default) | scheduled daily scan *(experimental)* |

## Quick try (dev)

```bash
npm install
# Capture one Claude Code transcript into a vault:
npx tsx src/cli.ts capture ~/.claude/projects/<proj>/<session>.jsonl --vault ./my-vault
cat ./my-vault/Daily/*.md
```

## Install

```bash
npm install -g loomlog
loomlog init                 # creates ~/loomlog, writes the Obsidian graph config,
                             # registers the vault with Obsidian, detects your agents
export LOOMLOG_VAULT=~/loomlog
```

`init` prints tailored next-steps for whichever agents it finds. The core engine is
shared; each agent gets a thin integration (in [`integrations/`](./integrations)).

### Claude Code — auto-capture (logs auto-delete after ~30d, so we capture promptly)

Recommended: install the bundled **plugin** — its `Stop` hook self-registers, so your
`settings.json` is left untouched:

- add this repo as a plugin marketplace, or copy [`integrations/claude-plugin/`](./integrations/claude-plugin) into your Claude Code plugins.

Or wire your own settings (strictly additive, backed up to `settings.json.loomlog.bak`, idempotent):

```bash
loomlog init --wire-claude
```

Or, without the plugin, copy the commands into a namespaced folder:

```bash
mkdir -p ~/.claude/commands/loomlog
cp integrations/claude-plugin/commands/report.md ~/.claude/commands/loomlog/
cp integrations/claude-plugin/commands/weekly.md ~/.claude/commands/loomlog/
```

Either way you get **`/loomlog:report`** (today) and **`/loomlog:weekly`** inside Claude Code.

### Codex — no auto-delete, so a lazy scan suffices (no hook needed)

```bash
mkdir -p ~/.codex/prompts
cp integrations/codex/prompts/loomlog.md ~/.codex/prompts/loomlog.md
```

Run **`/loomlog`** in Codex, or `loomlog scan codex && loomlog report` anytime.

### Gemini CLI — experimental (logs auto-delete by default → capture via scan)

```bash
mkdir -p ~/.gemini/commands/loomlog
cp integrations/gemini/commands/loomlog/report.toml ~/.gemini/commands/loomlog/report.toml
loomlog scan gemini        # ingest current Gemini sessions
```

Run **`/loomlog:report`** in Gemini.

Gemini's `logs.json` records **prompts only** (no file/command detail), and Gemini
auto-deletes old sessions — so schedule a daily scan to avoid losing history, e.g. cron:

```cron
0 22 * * *  loomlog scan all --vault ~/loomlog
```

Treat Gemini support as best-effort.

## Data model

A vault is just Markdown:

```
<vault>/
  Daily/2026-06-07.md      # one note per day, sections per project
  Projects/<name>.md       # auto-maintained project index (MOC)
  .obsidian/graph.json     # graph view config (written by `init`)
  .loomlog/                # source-of-truth JSON; the Markdown is a projection
```

Capture granularity is deliberately conservative: prompt intent (first line), file
**paths** (never contents), command **counts by category** (never full args), tools
used, and error counts — all run through a secret redactor first.

## License

[MIT](./LICENSE) © 2026 Gaku1031

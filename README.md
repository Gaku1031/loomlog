# loomlog

> Local, cross-agent dev journal for **Claude Code**, **Codex**, and **Gemini CLI**.
> Passively weaves the sessions your AI tools already log into an Obsidian-compatible
> vault — then gives you a daily/weekly report on demand. No API key. Token-cheap.

`loom` = the three agents' threads, woven into one log + knowledge graph.

> ⚠️ **Status: early v1, in development.** Claude Code capture works today. Codex and
> Gemini adapters are landing next. See [`grill-loomlog-20260607.md`](./grill-loomlog-20260607.md)
> for the full locked design.

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

## Install (per agent)

> Coming with `loomlog init`. Each agent gets a thin integration; the core engine is shared.

### Claude Code
_TODO: plugin (Stop hook + `/report`, `/weekly`)._

### Codex
_TODO: `~/.codex/prompts/report.md` + lazy scan._

### Gemini CLI
_TODO: custom command + daily scan (experimental)._

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

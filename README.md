# loomlog

> Local, cross-agent dev journal for **Claude Code**, **Codex**, and **Gemini CLI**.
> Passively weaves the sessions your AI tools already log into an Obsidian-compatible vault,
> then lets you **recall** any day ("what did I do?") and **reflect** with research-backed
> frameworks. No API key. Token-cheap.

`loom` = the three agents' threads, woven into one log + knowledge graph.

> **Status: published on [npm](https://www.npmjs.com/package/loomlog).** Claude Code
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

## Recall — "what did I do?"

Forgot what you worked on? Ask loomlog. The first arg is a query (mechanical, 0 tokens,
works in a plain terminal):

```bash
loomlog 2026-06-08        # a specific day        loomlog today | yesterday
loomlog week              # last 7 days           loomlog month        # last 30
loomlog <project>         # one project's history loomlog patterns     # what work you do most
```

`patterns` answers "what kind of work do I do?" — your command-type mix, time split across
projects, agent usage, busiest days, and recent **commits** (loomlog reads your `git commit`
messages straight from the logs — your own "what I shipped" log, 0 tokens).

## Reflect — structured retrospection, grounded in the research

Recall is *what*; reflection is *so what / now what*. Reflection runs **inside your AI agent**
(Claude Code / Codex / Gemini) as a slash command — because the back-and-forth needs a model,
and loomlog's rule is *the host model does it, no API key*. loomlog mechanically fills the
factual layer; the agent walks you through a real reflective-practice framework; the result is
saved to `Reflections/<date>.md` (a folder capture never overwrites).

**How a daily reflection actually goes** — in Claude Code, after a day of work, you type:

```
/loomlog:reflect
```

and the agent:

1. pulls today's facts (`loomlog reflect --json` under the hood),
2. shows you **What** you did — per project: intent, key files, work type, and the
   **commits** you shipped,
3. asks you the **So What** questions one at a time — *"今日いちばん重要だった作業は？"*,
   *"詰まったのはなぜ？"*, *"新しく分かった/決めたことは？"* — you answer in the chat,
4. asks the **Now What** — *"次にやること/変えることは？"*,
5. writes the finished reflection to `~/loomlog/Reflections/2026-06-09.md` and links it back to
   that day's note (so it shows up in your Obsidian graph).

```
/loomlog:reflect          # daily   — What / So What / Now What (Borton→Driscoll)
/loomlog:weekly           # weekly  — Gibbs Reflective Cycle (1988)
```

Pick a different framework with an argument: `/loomlog:reflect aar` (After-Action Review, good
when the day was blocker-heavy), `kpt`, or `ywt`. Under the hood it's just
`loomlog reflect --template <t> --json` → you answer → `loomlog reflect-save` (≈0 extra tokens,
no API key). In a bare terminal without an agent, use the **Recall** commands above instead —
`loomlog reflect` alone only prints the model-facing JSON.

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

Recommended: install the bundled **plugin** — its `Stop` hook self-registers (so your
`settings.json` is left untouched) and it ships `/loomlog:report`, `/loomlog:reflect`, and
`/loomlog:weekly`. Inside Claude Code:

```
/plugin marketplace add Gaku1031/loomlog
/plugin install loomlog@loomlog
```

(The plugin calls the `loomlog` CLI, so make sure `npm i -g loomlog` is done too.)

Or wire your own settings (strictly additive, backed up to `settings.json.loomlog.bak`, idempotent):

```bash
loomlog init --wire-claude
```

Or, without the plugin, copy the commands into a namespaced folder:

```bash
mkdir -p ~/.claude/commands/loomlog
cp integrations/claude-plugin/commands/*.md ~/.claude/commands/loomlog/
```

Either way you get **`/loomlog:report`** (today), **`/loomlog:reflect`** (daily reflection),
and **`/loomlog:weekly`** (Gibbs weekly) inside Claude Code.

### Codex — no auto-delete, so a lazy scan suffices (no hook needed)

```bash
mkdir -p ~/.codex/prompts
cp integrations/codex/prompts/loomlog.md ~/.codex/prompts/loomlog.md
cp integrations/codex/prompts/loomlog-reflect.md ~/.codex/prompts/loomlog-reflect.md
```

Run **`/loomlog`** (report) or **`/loomlog-reflect`** (reflection) in Codex, or
`loomlog scan codex && loomlog report` anytime.

### Gemini CLI — experimental (logs auto-delete by default → capture via scan)

```bash
mkdir -p ~/.gemini/commands/loomlog
cp integrations/gemini/commands/loomlog/*.toml ~/.gemini/commands/loomlog/
loomlog scan gemini        # ingest current Gemini sessions
```

Run **`/loomlog:report`** or **`/loomlog:reflect`** in Gemini.

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
  Reflections/<date>.md    # saved reflections (capture never overwrites these)
  .obsidian/graph.json     # graph view config (written by `init`)
  .loomlog/                # source-of-truth JSON; the Markdown is a projection
```

Capture granularity is deliberately conservative: prompt intent (first line), file
**paths** (never contents), command **counts by category** (never full args), tools
used, and error counts — all run through a secret redactor first.

## License

[MIT](./LICENSE) © 2026 Gaku1031

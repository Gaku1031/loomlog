#!/usr/bin/env node
import { captureFile, captureHook } from "./capture.ts";
import { scanCodex, scanGemini, type ScanSummary } from "./scan.ts";
import { buildReport, renderText } from "./report.ts";
import { initVault, wireClaudeHook } from "./init.ts";
import { resolveVault } from "./util.ts";
import type { AgentId } from "./types.ts";

const USAGE = `loomlog — local, cross-agent dev journal

Usage:
  loomlog init [--vault <dir>] [--skip-obsidian] [--wire-claude]
      Scaffold the vault, write the Obsidian graph config, register it with
      Obsidian, and report which agents were detected. --wire-claude also adds a
      Stop hook to ~/.claude/settings.json (additive, backed up, idempotent).

  loomlog capture <session-log-path> [--vault <dir>] [--agent <claude-code|codex|gemini>]
  loomlog capture --hook [--vault <dir>]
      Parse one agent session log into the vault (mechanical, no LLM).
      --hook reads a Claude Stop-hook payload (transcript_path) from stdin.

  loomlog scan [codex|gemini|all] [--vault <dir>] [--since <YYYY-MM-DD>]
      Ingest sessions from Codex (~/.codex/sessions) and/or Gemini (~/.gemini/tmp).
      Lazy + idempotent. Default agent: all.

  loomlog report [--date <YYYY-MM-DD>] [-w|--week] [--since <d>] [--until <d>]
                 [--project <name>] [--json] [--vault <dir>]
      Summarize the vault over a date range. Default: today, human-readable.
      --json emits compact JSON for a host model to format into a report.

Options:
  --vault <dir>   Vault directory (default: $LOOMLOG_VAULT or ~/loomlog)
  --agent <id>    Force the source agent (default: auto-detect from path)
  --since <date>  Only include sessions on/after this date
  --until <date>  (report) End of range (default: today)
  --date <date>   (report) Single day (default: today)
  -w, --week      (report) Last 7 days ending at --date/today
  --project <p>   (report) Filter to one project
  --json          (report) Machine-readable output

More commands (init) coming next.`;

const BOOLEAN_FLAGS = new Set(["json", "week", "hook", "skip-obsidian", "wire-claude"]);

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "-w") {
      flags.week = "true";
    } else if (a.startsWith("--")) {
      const name = a.slice(2);
      const next = args[i + 1];
      if (BOOLEAN_FLAGS.has(name) || next === undefined || next.startsWith("-")) {
        flags[name] = "true";
      } else {
        flags[name] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseFlags(rest);

  switch (cmd) {
    case "capture": {
      const vault = resolveVault(flags.vault);
      if (flags.hook === "true") {
        // Stop-hook mode: never fail loudly — must not block the agent.
        const res = await captureHook(vault);
        if (res) console.log(`✓ captured ${res.project} → ${res.date}`);
        break;
      }
      const path = positional[0];
      if (!path) {
        console.error("error: capture needs a <session-log-path> (or --hook)\n");
        console.error(USAGE);
        process.exit(1);
      }
      const res = await captureFile(path, vault, flags.agent as AgentId | undefined);
      if (!res) {
        console.error(`no session data found in ${path}`);
        process.exit(1);
      }
      const verb = res.alreadyIngested ? "re-captured" : "captured";
      console.log(`✓ ${verb} ${res.project} → ${res.date}`);
      console.log(`  ${res.dailyPath}`);
      break;
    }
    case "init": {
      const vault = resolveVault(flags.vault);
      const r = initVault(vault, {
        obsidianConfig: flags["obsidian-config"],
        skipObsidian: flags["skip-obsidian"] === "true",
      });
      console.log(`✓ vault ready: ${r.vault}`);
      console.log(`  dirs: ${r.createdDirs.length ? r.createdDirs.join(", ") : "(all present)"}`);
      console.log(`  graph.json: ${r.graphWritten ? "written" : "kept existing"}`);
      const reg = { added: "registered with Obsidian", exists: "already in Obsidian", "no-config": "Obsidian not registered (no config / skipped)" }[r.register];
      console.log(`  obsidian: ${reg}`);
      const detected = Object.entries({ "claude-code": r.agents.claudeCode, codex: r.agents.codex, gemini: r.agents.gemini })
        .filter(([, v]) => v)
        .map(([k]) => k);
      console.log(`  agents detected: ${detected.join(", ") || "none"}`);

      if (flags["wire-claude"] === "true") {
        const w = wireClaudeHook(flags["claude-settings"], vault);
        const msg = { added: "Stop hook added (backup at settings.json.loomlog.bak)", exists: "Stop hook already present", "no-file": "~/.claude/settings.json not found" }[w];
        console.log(`  claude wiring: ${msg}`);
      }

      console.log("");
      console.log("next:");
      console.log(`  export LOOMLOG_VAULT="${vault}"`);
      if (r.agents.claudeCode) console.log("  • Claude Code: install the plugin (integrations/claude-plugin) or run: loomlog init --wire-claude");
      if (r.agents.codex) console.log("  • Codex: copy integrations/codex/prompts/report.md → ~/.codex/prompts/ ; capture via `loomlog scan codex`");
      if (r.agents.gemini) console.log("  • Gemini: copy integrations/gemini/commands/report.toml → ~/.gemini/commands/ (experimental)");
      break;
    }
    case "scan": {
      const agent = positional[0] ?? "all";
      if (!["codex", "gemini", "all"].includes(agent)) {
        console.error(`scan supports: codex | gemini | all (got "${agent}")`);
        process.exit(1);
      }
      const vault = resolveVault(flags.vault);
      const line = (name: string, s: ScanSummary) =>
        console.log(`✓ ${name} scan: ${s.captured} captured, ${s.skipped} skipped, ${s.errors} errors (${s.found} found)`);
      if (agent === "codex" || agent === "all") line("codex", await scanCodex(vault, { since: flags.since }));
      if (agent === "gemini" || agent === "all") line("gemini", scanGemini(vault, { since: flags.since }));
      console.log(`  vault: ${vault}`);
      break;
    }
    case "report": {
      const vault = resolveVault(flags.vault);
      const data = buildReport(vault, {
        date: flags.date,
        week: flags.week === "true",
        since: flags.since,
        until: flags.until,
        project: flags.project,
      });
      console.log(flags.json === "true" ? JSON.stringify(data) : renderText(data));
      break;
    }
    case undefined:
    case "-h":
    case "--help":
      console.log(USAGE);
      break;
    default:
      console.error(`unknown command: ${cmd}\n`);
      console.error(USAGE);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

#!/usr/bin/env node
import { captureFile, captureHook } from "./capture.ts";
import { scanCodex, scanGemini, type ScanSummary } from "./scan.ts";
import { buildReport, renderText, buildPatterns, renderPatterns, type ReportOptions } from "./report.ts";
import { buildReflection, saveReflection, isTemplate, FRAMEWORKS, type Template } from "./reflect.ts";
import { initVault, wireClaudeHook } from "./init.ts";
import { parseFlags, validateDateFlags } from "./args.ts";
import { addDays, isValidDate, resolveVault, todayLocal } from "./util.ts";
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

  loomlog <query>            Quick recall — answers "what did I do?":
      loomlog 2026-06-08       a specific day        loomlog today | yesterday
      loomlog week | month     last 7 / 30 days      loomlog <project>   that project
      loomlog patterns         what kind of work you do most (+ --since/--until)

  loomlog reflect [--template wsn|gibbs|aar|kpt|ywt] [--date|-w|--since/--until]
                  [--project <name>] [--vault <dir>]
      Emit a reflection context (facts + an academic reflection framework's stages)
      as JSON for the host model to facilitate interactively. Templates:
        wsn (default, daily) · gibbs (weekly) · aar (blocker-heavy) · kpt · ywt
  loomlog reflect-save --date <d> --template <t> [--weekly] [--vault <dir>]
      Append a finished reflection (read from stdin) to Reflections/<date>.md.

Options:
  --vault <dir>   Vault directory (default: $LOOMLOG_VAULT or ~/loomlog)
  --agent <id>    Force the source agent (default: auto-detect from path)
  --since <date>  Only include sessions on/after this date
  --until <date>  (report) End of range (default: today)
  --date <date>   (report) Single day (default: today)
  -w, --week      (report) Last 7 days ending at --date/today
  --project <p>   (report) Filter to one project
  --json          (report) Machine-readable output

Options shared above accept either "--flag value" or "--flag=value".`;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const SUBCOMMANDS = new Set(["capture", "scan", "init", "report", "reflect", "reflect-save"]);

/**
 * Quick-recall dispatch: a first arg that isn't a subcommand is treated as a query —
 * a date, a range keyword (today/yesterday/week/month), `patterns`, or a project name.
 */
function runQuery(token: string, flags: Record<string, string>): void {
  const vault = resolveVault(flags.vault);
  const emit = (text: string, data: unknown) => console.log(flags.json === "true" ? JSON.stringify(data) : text);

  if (token === "patterns" || token === "stats") {
    validateDateFlags(flags);
    const opts: ReportOptions = { since: flags.since ?? addDays(todayLocal(), -29), until: flags.until, project: flags.project };
    const data = buildPatterns(vault, opts);
    emit(renderPatterns(data), data);
    return;
  }

  let opts: ReportOptions;
  if (isValidDate(token)) opts = { date: token };
  else if (token === "today") opts = { date: todayLocal() };
  else if (token === "yesterday") opts = { date: addDays(todayLocal(), -1) };
  else if (token === "week" || token === "7d") opts = { week: true };
  else if (token === "month" || token === "30d") opts = { since: addDays(todayLocal(), -29) };
  else if (/^\d{4}-\d{2}-\d{2}$/.test(token)) {
    throw new Error(`not a real date: ${token}`);
  } else {
    // Treat as a project name; default to the last 90 days unless a range is given.
    opts = { project: token, since: flags.since ?? addDays(todayLocal(), -89), until: flags.until };
  }
  const data = buildReport(vault, opts);
  emit(renderText(data), data);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseFlags(rest);

  if (cmd && cmd !== "-h" && cmd !== "--help" && !SUBCOMMANDS.has(cmd)) {
    runQuery(cmd, flags);
    return;
  }

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
      if (r.agents.codex) console.log("  • Codex: copy integrations/codex/prompts/loomlog.md → ~/.codex/prompts/ ; capture via `loomlog scan codex`");
      if (r.agents.gemini) console.log("  • Gemini: copy integrations/gemini/commands/report.toml → ~/.gemini/commands/ (experimental)");
      break;
    }
    case "scan": {
      const agent = positional[0] ?? "all";
      if (!["codex", "gemini", "all"].includes(agent)) {
        console.error(`scan supports: codex | gemini | all (got "${agent}")`);
        process.exit(1);
      }
      validateDateFlags(flags);
      const vault = resolveVault(flags.vault);
      const line = (name: string, s: ScanSummary) =>
        console.log(`✓ ${name} scan: ${s.captured} captured, ${s.skipped} skipped, ${s.errors} errors (${s.found} found)`);
      if (agent === "codex" || agent === "all") line("codex", await scanCodex(vault, { since: flags.since }));
      if (agent === "gemini" || agent === "all") line("gemini", scanGemini(vault, { since: flags.since }));
      console.log(`  vault: ${vault}`);
      break;
    }
    case "report": {
      validateDateFlags(flags);
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
    case "reflect": {
      validateDateFlags(flags);
      const tmpl = flags.template ?? "wsn";
      if (!isTemplate(tmpl)) {
        console.error(`reflect --template must be one of: ${Object.keys(FRAMEWORKS).join(" | ")} (got "${tmpl}")`);
        process.exit(1);
      }
      const vault = resolveVault(flags.vault);
      const ctx = buildReflection(vault, tmpl, {
        date: flags.date,
        week: flags.week === "true",
        since: flags.since,
        until: flags.until,
        project: flags.project,
      });
      // reflect is for the host model to facilitate → JSON is the primary output.
      console.log(JSON.stringify(ctx));
      break;
    }
    case "reflect-save": {
      validateDateFlags(flags);
      const tmpl = flags.template ?? "wsn";
      if (!isTemplate(tmpl)) {
        console.error(`reflect-save --template must be one of: ${Object.keys(FRAMEWORKS).join(" | ")}`);
        process.exit(1);
      }
      const date = flags.date ?? todayLocal();
      const vault = resolveVault(flags.vault);
      const body = await readStdin();
      if (!body.trim()) {
        console.error("reflect-save: no reflection text on stdin");
        process.exit(1);
      }
      const projects = flags.project ? [flags.project] : undefined;
      const file = saveReflection(vault, { date, template: tmpl as Template, weekly: flags.weekly === "true", body, projects });
      console.log(`✓ saved reflection → ${file}`);
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

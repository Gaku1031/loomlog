#!/usr/bin/env node
import { captureFile, captureHook } from "./capture.ts";
import { scanClaude, scanCodex, scanGemini, type ScanSummary } from "./scan.ts";
import {
  buildReport,
  renderText,
  renderMarkdown,
  buildPatterns,
  renderPatterns,
  renderMarkdownPatterns,
  type ReportOptions,
} from "./report.ts";
import { copyToClipboard, mdToHtml, type ClipboardPayload } from "./clipboard.ts";
import { buildReflection, saveReflection, isTemplate, FRAMEWORKS, type Template } from "./reflect.ts";
import { initVault, wireClaudeHook } from "./init.ts";
import { rerenderVault } from "./store.ts";
import { scheduleScan, unscheduleScan, DEFAULT_SCAN_AT, type ScheduleResult, type UnscheduleResult } from "./schedule.ts";
import { parseFlags, validateDateFlags } from "./args.ts";
import { addDays, isValidDate, resolveVault, todayLocal } from "./util.ts";
import type { AgentId } from "./types.ts";

const USAGE = `loomlog — local, cross-agent dev journal

Usage:
  loomlog init [--vault <dir>] [--skip-obsidian] [--wire-claude]
               [--schedule-scan [--scan-at HH:MM]] [--unschedule-scan]
      Scaffold the vault, write the Obsidian graph config, register it with
      Obsidian, and report which agents were detected. --wire-claude also adds a
      Stop hook to ~/.claude/settings.json (additive, backed up, idempotent).
      --schedule-scan installs a daily "loomlog scan all" (macOS launchd /
      Windows Task Scheduler / Linux cron) so Codex & Gemini sessions are
      captured even when you don't run a command — Gemini auto-deletes old
      sessions, so an unscanned one is lost for good. Default time ${DEFAULT_SCAN_AT}
      (override with --scan-at); --unschedule-scan removes it.

  loomlog capture <session-log-path> [--vault <dir>] [--agent <claude-code|codex|gemini>]
  loomlog capture --hook [--vault <dir>]
      Parse one agent session log into the vault (mechanical, no LLM).
      --hook reads a Claude Stop-hook payload (transcript_path) from stdin.

  loomlog scan [claude|codex|gemini|all] [--vault <dir>] [--since <YYYY-MM-DD>]
      Ingest sessions from Claude (~/.claude/projects), Codex (~/.codex/sessions),
      and/or Gemini (~/.gemini/tmp).
      Lazy + idempotent. Default agent: all.

  loomlog rerender [--vault <dir>]
      Re-render every Daily note and Project MOC from the store (no log re-parsing).
      Use after upgrading to apply rendering changes (e.g. topic tags) to past notes.

  loomlog report [--date <YYYY-MM-DD>] [-w|--week] [--since <d>] [--until <d>]
                 [--project <name>] [--md] [-c|--copy] [--json] [--vault <dir>]
      Summarize the vault over a date range. Default: today, human-readable.
      --md  emits clean Markdown (no terminal indent — pastes without nesting).
      --copy sends it to the clipboard as rich text so it pastes formatted into
            Notion/Slack/Docs (macOS RTF via textutil; plain elsewhere). Combine
            with --md to copy plain Markdown, or --json for JSON.
      --json emits compact JSON for a host model to format into a report.

  loomlog <query>            Quick recall — answers "what did I do?":
      loomlog 2026-06-08       a specific day        loomlog today | yesterday
      loomlog week | month     last 7 / 30 days      loomlog <project>   that project
      loomlog patterns         what kind of work you do most (+ --since/--until)
      Add --copy (or --md) to any of these to send it to the clipboard / as Markdown.

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
  --md            (report/query) Clean Markdown output (pastes without indent drift)
  -c, --copy      (report/query) Copy to clipboard — rich text on macOS
  --json          (report) Machine-readable output

Options shared above accept either "--flag value" or "--flag=value".`;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const SUBCOMMANDS = new Set(["capture", "scan", "init", "report", "reflect", "reflect-save", "rerender"]);

/** Compact "from" / "from .. to" label for confirmation lines. */
function spanOf(range: { from: string; to: string }): string {
  return range.from === range.to ? range.from : `${range.from} .. ${range.to}`;
}

interface Renderers {
  json: () => string;
  text: () => string;
  md: () => string;
}

/**
 * Route a human report/patterns to stdout or the clipboard per --json / --md / --copy.
 * Default stdout is the terminal layout; --md emits clean Markdown; --copy sends it to the
 * clipboard preferring rich text (RTF/HTML) so it pastes formatted into Notion. --copy --md
 * forces plain Markdown, --copy --json forces JSON. If no clipboard tool exists, prints instead.
 */
function emit(flags: Record<string, string>, label: string, span: string, r: Renderers): void {
  const asJson = flags.json === "true";
  const asMd = flags.md === "true";

  if (flags.copy !== "true") {
    console.log(asJson ? r.json() : asMd ? r.md() : r.text());
    return;
  }

  let payload: ClipboardPayload;
  let format: string;
  if (asJson) {
    payload = { plain: r.json() };
    format = "json";
  } else if (asMd) {
    payload = { plain: r.md() }; // explicit --md → plain Markdown only
    format = "markdown";
  } else {
    const md = r.md();
    payload = { plain: md, html: mdToHtml(md) }; // default → rich where the platform supports it
    format = "markdown";
  }

  const res = copyToClipboard(payload);
  if (!res.ok) {
    console.error(`⚠ no clipboard tool available — printing ${label} below`);
    console.log(payload.plain);
    return;
  }
  const kind = res.rich ? "rich" : format;
  const hint = res.rich ? " — paste into Notion" : "";
  console.log(`✓ copied ${label} (${kind} · ${span}) → clipboard${hint}`);
}

/**
 * Quick-recall dispatch: a first arg that isn't a subcommand is treated as a query —
 * a date, a range keyword (today/yesterday/week/month), `patterns`, or a project name.
 */
function runQuery(token: string, flags: Record<string, string>): void {
  const vault = resolveVault(flags.vault);

  if (token === "patterns" || token === "stats") {
    validateDateFlags(flags);
    const opts: ReportOptions = { since: flags.since ?? addDays(todayLocal(), -29), until: flags.until, project: flags.project };
    const data = buildPatterns(vault, opts);
    emit(flags, "patterns", spanOf(data.range), {
      json: () => JSON.stringify(data),
      text: () => renderPatterns(data),
      md: () => renderMarkdownPatterns(data),
    });
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
  emit(flags, "report", spanOf(data.range), {
    json: () => JSON.stringify(data),
    text: () => renderText(data),
    md: () => renderMarkdown(data),
  });
}

/** One-line summary of a schedule-scan attempt for the init output. */
function describeSchedule(r: ScheduleResult): string {
  const login = r.platform === "darwin" ? " + at login" : "";
  switch (r.status) {
    case "added":
      return `${r.mechanism} job installed → daily at ${r.at}${login} (${r.target})${r.detail ? ` — ${r.detail}` : ""}`;
    case "updated":
      return `${r.mechanism} job updated → daily at ${r.at}${login}`;
    case "exists":
      return `${r.mechanism} job already set for ${r.at} (unchanged)`;
    case "no-binary":
      return "couldn't resolve the loomlog binary — run this from the globally installed CLI";
    case "unsupported":
      return `no auto-scheduler for ${r.platform} — see the README scheduled-scan recipe`;
    case "error":
      return `failed (${r.detail ?? "unknown error"}) — see the README scheduled-scan recipe`;
  }
}

function describeUnschedule(r: UnscheduleResult): string {
  switch (r.status) {
    case "removed":
      return `${r.mechanism} job removed`;
    case "absent":
      return "no scheduled scan was installed";
    case "unsupported":
      return `no auto-scheduler for ${r.platform}`;
    case "error":
      return `removal failed (${r.detail ?? "unknown error"})`;
  }
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
      const graphMsg = { written: "written", merged: "updated (showTags + colors; backup .loomlog.bak)", unchanged: "already configured" }[r.graph];
      console.log(`  graph.json: ${graphMsg}`);
      console.log(`  graph snippet: ${r.snippet === "applied" ? "installed + enabled (#topic nodes → orange)" : "already enabled"}`);
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

      if (flags["schedule-scan"] === "true") {
        console.log(`  scheduled scan: ${describeSchedule(scheduleScan(vault, { at: flags["scan-at"] }))}`);
      }
      if (flags["unschedule-scan"] === "true") {
        console.log(`  scheduled scan: ${describeUnschedule(unscheduleScan())}`);
      }

      console.log("");
      console.log("next:");
      console.log(`  export LOOMLOG_VAULT="${vault}"`);
      if (r.agents.claudeCode) console.log("  • Claude Code: install the plugin (integrations/claude-plugin) or run: loomlog init --wire-claude");
      if (r.agents.codex) console.log("  • Codex: copy integrations/codex/skills/loomlog → ~/.codex/skills/loomlog ; invoke with `$loomlog` or plain language");
      if (r.agents.gemini) console.log("  • Gemini: copy integrations/gemini/commands/loomlog/*.toml → ~/.gemini/commands/loomlog/ (experimental)");
      break;
    }
    case "scan": {
      const agent = positional[0] ?? "all";
      if (!["claude", "codex", "gemini", "all"].includes(agent)) {
        console.error(`scan supports: claude | codex | gemini | all (got "${agent}")`);
        process.exit(1);
      }
      validateDateFlags(flags);
      const vault = resolveVault(flags.vault);
      const line = (name: string, s: ScanSummary) =>
        console.log(`✓ ${name} scan: ${s.captured} captured, ${s.skipped} skipped, ${s.errors} errors (${s.found} found)`);
      if (agent === "claude" || agent === "all") line("claude", await scanClaude(vault, { since: flags.since }));
      if (agent === "codex" || agent === "all") line("codex", await scanCodex(vault, { since: flags.since }));
      if (agent === "gemini" || agent === "all") line("gemini", scanGemini(vault, { since: flags.since }));
      console.log(`  vault: ${vault}`);
      break;
    }
    case "rerender": {
      const vault = resolveVault(flags.vault);
      const r = rerenderVault(vault);
      console.log(`✓ rerendered ${r.days} day note(s), ${r.projects} project MOC(s)`);
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
      emit(flags, "report", spanOf(data.range), {
        json: () => JSON.stringify(data),
        text: () => renderText(data),
        md: () => renderMarkdown(data),
      });
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

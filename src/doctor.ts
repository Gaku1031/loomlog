import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import type { DayFile } from "./types.ts";
import { homeShorten, rangeDates, resolveVault, todayLocal } from "./util.ts";

/**
 * `loomlog doctor` — a read-only setup diagnosis. Nothing here mutates the vault or config; it
 * exists to make the silent failure modes loud: a CLI that isn't on PATH (so hooks/scheduled
 * scans can't find it), an uninitialized vault, a Stop hook that never fired, and — the most
 * accident-prone one for a *cross-agent* tool — captures scattered across more than one vault.
 */

export type Health = "ok" | "warn" | "fail" | "info";

export interface Check {
  label: string;
  status: Health;
  detail: string;
  /** Actionable next step, shown only for non-ok checks. */
  hint?: string;
}

export interface VaultInfo {
  path: string;
  initialized: boolean;
  sessions: number;
  /** Most recent day note date (YYYY-MM-DD), or null if empty. */
  lastDate: string | null;
}

export interface DoctorReport {
  vault: string;
  checks: Check[];
  /** Initialized vaults discovered across the likely default locations. */
  vaults: VaultInfo[];
  ok: boolean; // no failing checks
}

/** First directory on PATH holding an executable named `bin` (handles Windows npm shims). */
function findOnPath(bin: string): string | null {
  const exts = process.platform === "win32" ? ["", ".cmd", ".exe", ".ps1", ".bat"] : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const p = join(dir, bin + ext);
      try {
        if (statSync(p).isFile()) return p;
      } catch {
        /* not here */
      }
    }
  }
  return null;
}

/** Summarize a vault's capture store without touching it. Safe on a non-existent path. */
export function inspectVault(vault: string): VaultInfo {
  const daysDir = join(vault, ".loomlog", "days");
  const info: VaultInfo = {
    path: vault,
    initialized: existsSync(join(vault, ".loomlog")),
    sessions: 0,
    lastDate: null,
  };
  if (!existsSync(daysDir)) return info;
  let lastDate = "";
  for (const f of readdirSync(daysDir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const day = JSON.parse(readFileSync(join(daysDir, f), "utf8")) as DayFile;
      info.sessions += Object.keys(day.sessions).length;
      if (day.date > lastDate) lastDate = day.date;
    } catch {
      /* skip a corrupt day file */
    }
  }
  info.lastDate = lastDate || null;
  return info;
}

/**
 * The vaults loomlog might be writing to: the active one (env/flag/default), the hard default
 * `~/loomlog` (Claude plugin + CLI), and `./.loomlog-vault` (the Codex skill's sandbox default).
 * Deduped by resolved path. Only initialized ones are returned — those are real, on-disk vaults.
 */
function discoverVaults(active: string): VaultInfo[] {
  const seen = new Set<string>();
  const out: VaultInfo[] = [];
  for (const p of [active, join(homedir(), "loomlog"), resolve(".loomlog-vault")]) {
    const key = resolve(p);
    if (seen.has(key)) continue;
    seen.add(key);
    const info = inspectVault(key);
    if (info.initialized) out.push(info);
  }
  return out;
}

/** Day gap from `date` to today (0 = today). Clamps future dates (clock skew) to 0. */
function daysAgo(date: string): number {
  const today = todayLocal();
  if (date >= today) return 0;
  return rangeDates(date, today).length - 1;
}

/** Does the home dir for an agent exist? (loomlog only ever captures installed agents' logs.) */
function agentInstalled(dir: string): boolean {
  return existsSync(join(homedir(), dir));
}

/** Is a loomlog Stop hook wired into ~/.claude/settings.json? */
function claudeSettingsHasHook(): boolean {
  const settings = join(homedir(), ".claude", "settings.json");
  if (!existsSync(settings)) return false;
  try {
    const data = JSON.parse(readFileSync(settings, "utf8"));
    return JSON.stringify(data?.hooks?.Stop ?? "").includes("loomlog");
  } catch {
    return false;
  }
}

/** Best-effort: is the loomlog Claude *plugin* installed (which ships its own Stop hook)? */
function claudePluginInstalled(): boolean {
  const dir = join(homedir(), ".claude", "plugins");
  if (!existsSync(dir)) return false;
  try {
    // The plugin's hook is provided by the marketplace install, not settings.json. We can't rely
    // on a stable layout across Claude versions, so scan two levels of names for "loomlog".
    for (const a of readdirSync(dir, { withFileTypes: true })) {
      if (a.name.includes("loomlog")) return true;
      if (!a.isDirectory()) continue;
      for (const b of readdirSync(join(dir, a.name))) if (b.includes("loomlog")) return true;
    }
  } catch {
    /* unreadable → fall through */
  }
  return false;
}

/** Run all checks. Pure read; never throws. */
export function runDoctor(opts: { vault?: string } = {}): DoctorReport {
  const checks: Check[] = [];
  const envVault = process.env.LOOMLOG_VAULT?.trim() || "";
  const vault = resolveVault(opts.vault);
  const codex = agentInstalled(".codex");
  const gemini = agentInstalled(".gemini");
  const claude = agentInstalled(".claude");

  // 1) CLI reachable on PATH — hooks and scheduled scans resolve the bare name `loomlog`.
  const onPath = findOnPath("loomlog");
  checks.push(
    onPath
      ? { label: "loomlog on PATH", status: "ok", detail: homeShorten(onPath) }
      : {
          label: "loomlog on PATH",
          status: "fail",
          detail: "not found in PATH",
          hint: "npm install -g loomlog — the Stop hook and scheduled scan call `loomlog` by name",
        },
  );

  // 2) LOOMLOG_VAULT — the single setting that keeps every agent pointed at one vault.
  checks.push(
    envVault
      ? { label: "LOOMLOG_VAULT", status: "ok", detail: homeShorten(resolve(envVault.replace(/^~(?=$|\/)/, homedir()))) }
      : {
          label: "LOOMLOG_VAULT",
          status: "warn",
          detail: "unset — defaulting to ~/loomlog",
          hint: 'export LOOMLOG_VAULT="$HOME/loomlog" so the CLI, Claude, Codex & scheduled scans all agree',
        },
  );

  // 3) Active vault initialized.
  const active = inspectVault(vault);
  checks.push(
    active.initialized
      ? { label: "vault", status: "ok", detail: `${homeShorten(vault)} — ${active.sessions} session(s)` }
      : { label: "vault", status: "fail", detail: `${homeShorten(vault)} not initialized`, hint: "loomlog init" },
  );

  // 4) Last capture freshness — a stale vault while agents are installed means captures stopped.
  if (!active.initialized) {
    /* already reported as a fail above */
  } else if (!active.lastDate) {
    checks.push({
      label: "last capture",
      status: "info",
      detail: "no sessions captured yet",
      hint: "run an agent session, then `loomlog scan all` (or rely on the Stop hook)",
    });
  } else {
    const gap = daysAgo(active.lastDate);
    const when = gap === 0 ? "today" : gap === 1 ? "yesterday" : `${active.lastDate} (${gap}d ago)`;
    checks.push(
      gap <= 7
        ? { label: "last capture", status: "ok", detail: when }
        : {
            label: "last capture",
            status: "warn",
            detail: `${when} — captures may have stopped`,
            hint: "check the Stop hook / scheduled scan, then `loomlog scan all`",
          },
    );
  }

  // 5) Vault split — the headline failure mode for a cross-agent tool.
  const vaults = discoverVaults(vault);
  const withData = vaults.filter((v) => v.sessions > 0);
  if (withData.length > 1) {
    checks.push({
      label: "vault split",
      status: "warn",
      detail: withData.map((v) => `${homeShorten(v.path)} (${v.sessions})`).join(", "),
      hint: "captures are spread across multiple vaults — set LOOMLOG_VAULT everywhere and merge/remove the extras",
    });
  } else {
    checks.push({ label: "vault split", status: "ok", detail: "single active vault" });
  }

  // 6) Codex-specific split risk: with no env var, the Codex skill writes a per-directory
  // ./.loomlog-vault, diverging from Claude/CLI's ~/loomlog. Precise warning, only when relevant.
  if (codex && !envVault) {
    checks.push({
      label: "codex vault",
      status: "warn",
      detail: "LOOMLOG_VAULT unset → the Codex skill writes ./.loomlog-vault per directory",
      hint: "set LOOMLOG_VAULT to unify Codex captures with Claude/CLI",
    });
  }

  // 7) Claude Stop hook — wired via settings.json or provided by the installed plugin.
  if (!claude) {
    checks.push({ label: "claude stop hook", status: "info", detail: "Claude Code not detected" });
  } else if (claudeSettingsHasHook()) {
    checks.push({ label: "claude stop hook", status: "ok", detail: "wired in ~/.claude/settings.json" });
  } else if (claudePluginInstalled()) {
    checks.push({ label: "claude stop hook", status: "ok", detail: "provided by the installed plugin" });
  } else {
    checks.push({
      label: "claude stop hook",
      status: "warn",
      detail: "no loomlog Stop hook found",
      hint: "install the plugin (/plugin install loomlog@loomlog) or run `loomlog init --wire-claude`",
    });
  }

  // 8) Codex skill.
  if (!codex) {
    checks.push({ label: "codex skill", status: "info", detail: "Codex not detected" });
  } else if (existsSync(join(homedir(), ".codex", "skills", "loomlog", "SKILL.md"))) {
    checks.push({ label: "codex skill", status: "ok", detail: "~/.codex/skills/loomlog" });
  } else {
    checks.push({
      label: "codex skill",
      status: "warn",
      detail: "not installed",
      hint: 'cp -r "$(npm root -g)/loomlog/integrations/codex/skills/loomlog" ~/.codex/skills/',
    });
  }

  // 9) Gemini commands (experimental).
  const geminiCmds = join(homedir(), ".gemini", "commands", "loomlog");
  if (!gemini) {
    checks.push({ label: "gemini commands", status: "info", detail: "Gemini CLI not detected" });
  } else if (existsSync(geminiCmds) && readdirSync(geminiCmds).some((f) => f.endsWith(".toml"))) {
    checks.push({ label: "gemini commands", status: "ok", detail: "~/.gemini/commands/loomlog" });
  } else {
    checks.push({
      label: "gemini commands",
      status: "warn",
      detail: "not installed (experimental)",
      hint: 'cp "$(npm root -g)/loomlog/integrations/gemini/commands/loomlog/"*.toml ~/.gemini/commands/loomlog/',
    });
  }

  // 10) Stop-hook error log — capture --hook records its own failures here so they aren't silent.
  const hookLog = join(vault, ".loomlog", "hook.log");
  if (existsSync(hookLog)) {
    try {
      const lines = readFileSync(hookLog, "utf8").trimEnd().split("\n").filter(Boolean);
      if (lines.length) {
        checks.push({
          label: "hook errors",
          status: "warn",
          detail: `${lines.length} logged — last: ${lines[lines.length - 1]!.slice(0, 120)}`,
          hint: `see ${homeShorten(hookLog)}`,
        });
      }
    } catch {
      /* ignore */
    }
  }

  return { vault, checks, vaults, ok: !checks.some((c) => c.status === "fail") };
}

const ICON: Record<Health, string> = { ok: "✓", warn: "⚠", fail: "✗", info: "·" };

/** Render the report as a human checklist. */
export function renderDoctor(r: DoctorReport): string {
  const lines = ["loomlog doctor", ""];
  for (const c of r.checks) {
    lines.push(`${ICON[c.status]} ${c.label}: ${c.detail}`);
    if (c.hint && c.status !== "ok") lines.push(`    ↳ ${c.hint}`);
  }
  const fails = r.checks.filter((c) => c.status === "fail").length;
  const warns = r.checks.filter((c) => c.status === "warn").length;
  lines.push("");
  lines.push(fails ? `${fails} problem(s), ${warns} warning(s)` : warns ? `looks good — ${warns} warning(s)` : "all good ✨");
  return lines.join("\n");
}

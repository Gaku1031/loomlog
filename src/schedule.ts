import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

/**
 * Scheduled `loomlog scan all` — the safety net for agents with no live capture hook.
 *
 * Claude Code captures live via its Stop hook, but Codex and (especially) Gemini have no
 * always-on hook: their sessions only land in the vault when a scan runs. Gemini also
 * auto-deletes old sessions, so a session that is never scanned before its purge is lost
 * for good. A scheduled daily scan closes that window.
 *
 * Per-OS mechanism is chosen for one property above all: does it catch up a run the machine
 * slept through? On a laptop a fixed clock time is routinely missed.
 *   - macOS  → launchd `StartCalendarInterval` + `RunAtLoad` → catches up on next wake AND
 *              runs at every login. The strongest option, hence the default platform.
 *   - Windows→ Task Scheduler `-StartWhenAvailable` → catches up a missed start.
 *   - Linux/other unix → cron. cron does NOT catch up a slept-through run, so a daytime
 *              default matters there (a server/WSL is usually always-on regardless).
 *
 * The node binary + cli.js are baked in as absolute paths because launchd and cron run with
 * a minimal PATH that won't resolve `node` from a `#!/usr/bin/env node` shebang. Mirrors how
 * wireClaudeHook() bakes the vault into the hook command so it's independent of the shell env.
 */

export const LAUNCHD_LABEL = "com.loomlog.scan";
const LAUNCHD_PLIST = `${LAUNCHD_LABEL}.plist`;
export const TASK_NAME = "loomlog-scan";
/** Trailing comment marker on the cron line so we can find/replace/remove it idempotently. */
export const CRON_MARKER = "# loomlog-scan";

export const DEFAULT_SCAN_AT = "13:00";

export type Platform = NodeJS.Platform;
export type ScheduleStatus = "added" | "updated" | "exists" | "unsupported" | "no-binary" | "error";
export type UnscheduleStatus = "removed" | "absent" | "unsupported" | "error";

export interface ScheduleSpec {
  /** Absolute path to the node executable that will run loomlog. */
  node: string;
  /** Absolute path to the loomlog cli entry (dist/cli.js). */
  script: string;
  /** Absolute vault directory (baked in so the job is env-independent). */
  vault: string;
  hour: number;
  minute: number;
}

export interface ScheduleResult {
  platform: Platform;
  mechanism: "launchd" | "cron" | "task-scheduler" | "";
  status: ScheduleStatus;
  at: string;
  /** plist path / task name, when installed. */
  target?: string;
  /** error text or a note (e.g. reload failed but plist written). */
  detail?: string;
}

export interface UnscheduleResult {
  platform: Platform;
  mechanism: "launchd" | "cron" | "task-scheduler" | "";
  status: UnscheduleStatus;
  detail?: string;
}

// ---------- pure helpers (unit-tested) ----------

/** Parse "HH:MM" (24h) into {hour, minute}; throws on anything else. */
export function parseTimeOfDay(s: string): { hour: number; minute: number } {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s.trim());
  if (!m) throw new Error(`--scan-at must be HH:MM in 24-hour form (got "${s}")`);
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/** "HH:MM" zero-padded, for display + the Task Scheduler -At value. */
export function fmtTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Prefer Volta's *stable* node shim over the resolved binary, so the path we bake survives a
 * node upgrade/GC. `process.execPath` resolves to the concrete image
 * (e.g. ~/.volta/tools/image/node/22.15.0/bin/node), which vanishes when that version is
 * removed; the shim (~/.volta/bin/node) is version-independent and is a real binary callable
 * by absolute path with no shell hook, so launchd/cron can invoke it directly.
 *
 * Only Volta is special-cased: nvm/fnm expose no stable single-node shim (their `node` lives
 * on a per-version path or behind a shell function), so those keep the version-pinned path —
 * re-run `--schedule-scan` after upgrading Node. Pure + fully injectable for tests.
 */
export function preferVoltaShim(
  execPath: string,
  opts: { env?: NodeJS.ProcessEnv; home?: string; platform?: NodeJS.Platform; exists?: (p: string) => boolean } = {},
): string {
  const env = opts.env ?? process.env;
  const home = opts.home ?? homedir();
  const platform = opts.platform ?? process.platform;
  const exists = opts.exists ?? existsSync;
  const win = platform === "win32";
  const voltaHome =
    env.VOLTA_HOME ||
    (win ? join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "Volta") : join(home, ".volta"));
  const imageRoot = join(voltaHome, "tools", "image", "node");
  if (execPath.startsWith(imageRoot + sep)) {
    const shim = join(voltaHome, "bin", win ? "node.exe" : "node");
    if (exists(shim)) return shim;
  }
  return execPath;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** macOS LaunchAgent plist: daily at HH:MM, catch-up on wake, plus a run at every login. */
export function buildLaunchdPlist(spec: ScheduleSpec): string {
  const nodeDir = dirname(spec.node);
  const logOut = join(spec.vault, ".loomlog", "scan.log");
  const logErr = join(spec.vault, ".loomlog", "scan.err.log");
  const argv = [spec.node, spec.script, "scan", "all", "--vault", spec.vault];
  const args = argv.map((a) => `    <string>${xmlEscape(a)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${spec.hour}</integer>
    <key>Minute</key>
    <integer>${spec.minute}</integer>
  </dict>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xmlEscape(nodeDir)}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>LOOMLOG_VAULT</key>
    <string>${xmlEscape(spec.vault)}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${xmlEscape(logOut)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(logErr)}</string>
</dict>
</plist>
`;
}

/** A single crontab line (no newline), tagged with CRON_MARKER for idempotent upsert. */
export function buildCronLine(spec: ScheduleSpec): string {
  const log = join(spec.vault, ".loomlog", "scan.log");
  const q = (s: string) => `"${s}"`;
  return `${spec.minute} ${spec.hour} * * * ${q(spec.node)} ${q(spec.script)} scan all --vault ${q(spec.vault)} >> ${q(log)} 2>&1  ${CRON_MARKER}`;
}

/**
 * Replace any existing loomlog cron line with `newLine`, preserving every other line.
 * Returns `exists` when the sole loomlog line is already identical (so we can skip writing).
 */
export function upsertCronLines(
  existing: string[],
  newLine: string,
  marker = CRON_MARKER,
): { lines: string[]; changed: "added" | "updated" | "exists" } {
  const removed = existing.filter((l) => l.includes(marker));
  const without = existing.filter((l) => !l.includes(marker));
  if (removed.length === 1 && removed[0] === newLine) return { lines: existing, changed: "exists" };
  return { lines: [...without, newLine], changed: removed.length ? "updated" : "added" };
}

function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`; // PowerShell single-quote: double an embedded quote
}

/** PowerShell one-liner to register/replace the daily task (catches up missed starts). */
export function buildScheduledTaskPS(spec: ScheduleSpec): string {
  const at = fmtTime(spec.hour, spec.minute);
  const argument = `"${spec.script}" scan all --vault "${spec.vault}"`;
  return [
    `$a = New-ScheduledTaskAction -Execute ${psQuote(spec.node)} -Argument ${psQuote(argument)}`,
    `$t = New-ScheduledTaskTrigger -Daily -At ${psQuote(at)}`,
    `$s = New-ScheduledTaskSettingsSet -StartWhenAvailable`,
    `Register-ScheduledTask -TaskName ${psQuote(TASK_NAME)} -Action $a -Trigger $t -Settings $s -Force -Description 'loomlog daily cross-agent scan'`,
  ].join("; ");
}

// ---------- side-effecting apply layer (best-effort) ----------

interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function run(cmd: string, args: string[], input?: string): RunResult {
  const r = spawnSync(cmd, args, { input, encoding: "utf8" });
  return { ok: !r.error && r.status === 0, stdout: r.stdout ?? "", stderr: (r.stderr ?? "") || (r.error?.message ?? "") };
}

/** Resolve the node binary + the real cli.js path of the loomlog being run. */
function loomlogEntry(): { node: string; script: string } | null {
  const argv1 = process.argv[1];
  if (!argv1) return null;
  let script: string;
  try {
    script = realpathSync(argv1);
  } catch {
    script = resolve(argv1);
  }
  return { node: preferVoltaShim(process.execPath), script };
}

function plistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", LAUNCHD_PLIST);
}

/** Reload a LaunchAgent: modern bootout/bootstrap, falling back to legacy unload/load. */
function launchctlReload(path: string): boolean {
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const domain = `gui/${uid}`;
  run("launchctl", ["bootout", domain, path]); // ignore failure (not currently loaded)
  if (run("launchctl", ["bootstrap", domain, path]).ok) return true;
  run("launchctl", ["unload", path]);
  return run("launchctl", ["load", "-w", path]).ok;
}

function applyLaunchd(spec: ScheduleSpec, at: string): ScheduleResult {
  const base: ScheduleResult = { platform: "darwin", mechanism: "launchd", status: "added", at };
  const path = plistPath();
  const content = buildLaunchdPlist(spec);
  const existed = existsSync(path);
  const same = existed && safeRead(path) === content;
  if (same) return { ...base, status: "exists", target: path };
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  } catch (e) {
    return { ...base, status: "error", detail: errText(e) };
  }
  const loaded = launchctlReload(path);
  return {
    ...base,
    status: existed ? "updated" : "added",
    target: path,
    detail: loaded ? undefined : "plist written but launchctl reload failed — it will load at next login",
  };
}

function applyCron(spec: ScheduleSpec, at: string): ScheduleResult {
  const base: ScheduleResult = { platform: process.platform, mechanism: "cron", status: "added", at };
  const listed = run("crontab", ["-l"]);
  // `crontab -l` exits non-zero when there is no crontab yet — treat as empty.
  const existing = listed.ok && listed.stdout.trim() ? listed.stdout.replace(/\n+$/, "").split("\n") : [];
  const { lines, changed } = upsertCronLines(existing, buildCronLine(spec));
  if (changed === "exists") return { ...base, status: "exists", target: "crontab" };
  const wrote = run("crontab", ["-"], lines.join("\n") + "\n");
  if (!wrote.ok) return { ...base, status: "error", detail: wrote.stderr.trim() || "crontab write failed" };
  return { ...base, status: changed, target: "crontab" };
}

function applyTaskScheduler(spec: ScheduleSpec, at: string): ScheduleResult {
  const base: ScheduleResult = { platform: "win32", mechanism: "task-scheduler", status: "added", at };
  const existed = run("schtasks", ["/query", "/tn", TASK_NAME]).ok;
  const r = run("powershell", ["-NoProfile", "-Command", buildScheduledTaskPS(spec)]);
  if (!r.ok) return { ...base, status: "error", detail: r.stderr.trim() || "Register-ScheduledTask failed" };
  return { ...base, status: existed ? "updated" : "added", target: TASK_NAME };
}

/**
 * Install (or update) a daily `loomlog scan all`. Run only on explicit `--schedule-scan`,
 * since it writes to the user's system (LaunchAgents / crontab / Task Scheduler).
 */
export function scheduleScan(vault: string, opts: { at?: string } = {}): ScheduleResult {
  const { hour, minute } = parseTimeOfDay(opts.at ?? DEFAULT_SCAN_AT);
  const at = fmtTime(hour, minute);
  const entry = loomlogEntry();
  if (!entry) return { platform: process.platform, mechanism: "", status: "no-binary", at };
  const spec: ScheduleSpec = { ...entry, vault: resolve(vault), hour, minute };
  if (process.platform === "darwin") return applyLaunchd(spec, at);
  if (process.platform === "win32") return applyTaskScheduler(spec, at);
  return applyCron(spec, at); // linux + other unix
}

/** Remove the scheduled scan, if present. Best-effort + idempotent. */
export function unscheduleScan(): UnscheduleResult {
  if (process.platform === "darwin") {
    const path = plistPath();
    if (!existsSync(path)) return { platform: "darwin", mechanism: "launchd", status: "absent" };
    const uid = typeof process.getuid === "function" ? process.getuid() : 0;
    run("launchctl", ["bootout", `gui/${uid}`, path]);
    run("launchctl", ["unload", path]);
    try {
      rmSync(path);
    } catch (e) {
      return { platform: "darwin", mechanism: "launchd", status: "error", detail: errText(e) };
    }
    return { platform: "darwin", mechanism: "launchd", status: "removed" };
  }
  if (process.platform === "win32") {
    const existed = run("schtasks", ["/query", "/tn", TASK_NAME]).ok;
    if (!existed) return { platform: "win32", mechanism: "task-scheduler", status: "absent" };
    const r = run("schtasks", ["/delete", "/tn", TASK_NAME, "/f"]);
    return r.ok
      ? { platform: "win32", mechanism: "task-scheduler", status: "removed" }
      : { platform: "win32", mechanism: "task-scheduler", status: "error", detail: r.stderr.trim() };
  }
  const listed = run("crontab", ["-l"]);
  const existing = listed.ok && listed.stdout.trim() ? listed.stdout.replace(/\n+$/, "").split("\n") : [];
  const without = existing.filter((l) => !l.includes(CRON_MARKER));
  if (without.length === existing.length) return { platform: process.platform, mechanism: "cron", status: "absent" };
  const wrote = run("crontab", ["-"], without.length ? without.join("\n") + "\n" : "");
  return wrote.ok
    ? { platform: process.platform, mechanism: "cron", status: "removed" }
    : { platform: process.platform, mechanism: "cron", status: "error", detail: wrote.stderr.trim() };
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

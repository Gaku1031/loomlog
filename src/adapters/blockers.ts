import type { Blocker } from "../types.ts";
import { blockerSignature } from "../util.ts";
import { redactClip } from "../redact.ts";

/** What a tool call was doing, recorded so a later failure can be attributed to it. */
export interface PendingCall {
  tool?: string;
  command?: string;
  file?: string;
}

// Failures of these are NOT 詰まり — navigation, file probing, trivial IO, or interactive tools
// "fail" all the time (a missing path, a cancelled question) without ever being a sticking point.
// Keeping them out is what makes the recurring-failure signal trustworthy on real logs.
const NOISE_COMMANDS = new Set([
  "cd", "ls", "cat", "echo", "pwd", "rm", "mkdir", "mv", "cp", "touch", "find", "grep", "rg", "fd",
  "which", "head", "tail", "sed", "awk", "export", "source", "chmod", "chown", "sleep", "open",
  "kill", "true", "false", "test", "[", "set", "unset", "alias", "printf", "tee", "xargs", "env",
  "basename", "dirname", "wc", "sort", "uniq", "cut", "tr", "date", "clear", "code", "cursor",
  "tree", "stat", "du", "df", "ps", "jq", "cd..", "exit",
]);
const NOISE_TOOLS = new Set([
  "Read", "Glob", "Grep", "LS", "AskUserQuestion", "TodoWrite", "WebSearch", "NotebookRead",
  "BashOutput", "KillShell", "KillBash", "SlashCommand", "Task", "ExitPlanMode",
]);
const READONLY_GIT = new Set(["status", "diff", "log", "show", "branch", "remote", "config", "stash"]);

/** True for failure signatures that are ambient noise rather than a real sticking point. */
export function isNoiseSignature(sig: string): boolean {
  if (!sig || sig === "?") return true;
  const [a, b] = sig.split(" ");
  if (a === "git" && b && READONLY_GIT.has(b)) return true; // a read-only git command "failing" isn't a blocker
  if (NOISE_COMMANDS.has(a!)) return true;
  if (NOISE_TOOLS.has(sig)) return true; // a tool-only signature (no command) for a probe/interactive tool
  return false;
}

// Lines that signal *why* something failed — surfaced so a blocker says more than "go test failed".
const ERROR_HINT =
  /(error|fail|cannot|can'?t|undefined|not found|no such|exception|panic|fatal|denied|refused|time(?:d)? ?out|expected|\bgot\b|\bwant\b|missing|unresolved|assert|✗|✘)/i;
// Stack-frame / traceback lines — noise, never the human-readable reason.
const STACK_FRAME = /^(at |node_modules|goroutine \d|Traceback \(|File "|\s*\.{3}|--> )/;

/**
 * The most informative line of a failure output (the "why"), ANSI-stripped. Prefers the *last*
 * matching signal line (usually the assertion — "got X, want Y" — rather than the framework's
 * "--- FAIL" wrapper) and skips stack frames.
 */
export function errorExcerpt(text: string): string {
  if (!text) return "";
  const lines = text
    .replace(/\x1b\[[0-9;]*m/g, "") // strip ANSI colour codes
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^exit code:/i.test(l) && !STACK_FRAME.test(l));
  let best = "";
  for (const l of lines) if (ERROR_HINT.test(l)) best = l; // keep the last (most specific) match
  return best || lines[0] || "";
}

/**
 * Accumulates a session's failed tool calls, grouped by a normalized signature, so the report
 * layer can flag a *recurring* failure as a 詰まり. Per-session counts include one-offs; the
 * "recurring" judgment (count >= 2) is applied later across the whole range, so a signature that
 * fails once on several different days still surfaces.
 */
export class BlockerCollector {
  private map = new Map<string, { sample: string; count: number; endedOk: boolean; detail: string }>();

  /**
   * Record one tool-call outcome. Pass `ok=false` with the failure output to log a failure (and
   * capture the "why"); pass `ok=true` to mark that the same signature later succeeded (recovery).
   * Successes for a signature that never failed are ignored, so this only ever tracks real friction.
   */
  record(call: PendingCall | undefined, ok: boolean, errorText?: string): void {
    const { sig, sample } = blockerSignature(call ?? {});
    if (isNoiseSignature(sig)) return; // not a sticking point — keep the signal trustworthy
    if (ok) {
      const cur = this.map.get(sig);
      if (cur && cur.count > 0) cur.endedOk = true; // recovered after earlier failure(s)
      return;
    }
    const cur = this.map.get(sig) ?? { sample, count: 0, endedOk: true, detail: "" };
    cur.count++;
    cur.endedOk = false;
    if (errorText) cur.detail = errorExcerpt(errorText) || cur.detail; // keep the latest useful "why"
    this.map.set(sig, cur);
  }

  /** Redacted, capped blocker list, most-failed first — with the "why" and whether it was resolved. */
  build(): Blocker[] {
    return [...this.map.entries()]
      .filter(([, v]) => v.count > 0)
      .map(([sig, v]) => ({
        sig,
        sample: redactClip(v.sample, 80),
        detail: v.detail ? redactClip(v.detail, 100) : undefined,
        count: v.count,
        resolved: v.endedOk,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
  }
}

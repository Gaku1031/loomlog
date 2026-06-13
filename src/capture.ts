import { appendFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { AgentId } from "./types.ts";
import { parseClaudeTranscript } from "./adapters/claude.ts";
import { parseCodexRollout } from "./adapters/codex.ts";
import { parseGeminiLogs } from "./adapters/gemini.ts";
import { captureSession, type CaptureResult } from "./store.ts";
import { isPathWithin } from "./util.ts";

/** Guess which agent produced a session log from its path. */
export function detectAgent(path: string): AgentId {
  if (path.includes("/.codex/") || basename(path).startsWith("rollout-")) return "codex";
  if (path.includes("/.gemini/")) return "gemini";
  return "claude-code";
}

/** Capture a single session log file into the vault. */
export async function captureFile(
  path: string,
  vault: string,
  agent: AgentId = detectAgent(path),
): Promise<CaptureResult | null> {
  // Gemini's logs.json holds many sessions in one file — capture each, return the last.
  if (agent === "gemini") {
    let last: CaptureResult | null = null;
    for (const rec of parseGeminiLogs(path)) last = captureSession(vault, rec);
    return last;
  }

  const rec = agent === "codex" ? await parseCodexRollout(path) : await parseClaudeTranscript(path);
  if (!rec) return null;
  return captureSession(vault, rec);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Append a one-line, timestamped error to `<vault>/.loomlog/hook.log` so a Stop hook that fails
 * (the command runs as `... 2>/dev/null || true`, swallowing stderr) is still diagnosable —
 * `loomlog doctor` surfaces the tail. Best-effort: never throws, and self-truncates so a stuck
 * hook can't grow the log without bound.
 */
function logHookError(vault: string, err: unknown): void {
  try {
    const dir = join(vault, ".loomlog");
    mkdirSync(dir, { recursive: true });
    const log = join(dir, "hook.log");
    try {
      if (statSync(log).size > 64_000) writeFileSync(log, ""); // cap runaway logs
    } catch {
      /* no log yet */
    }
    const msg = err instanceof Error ? err.message : String(err);
    appendFileSync(log, `${new Date().toISOString()} capture --hook failed: ${msg.replace(/\s+/g, " ").trim()}\n`);
  } catch {
    /* logging must never break the hook */
  }
}

/**
 * Capture driven by a Claude Code Stop hook: the hook delivers JSON on stdin
 * containing `transcript_path`. Always resolves (never throws) so it can't block the agent;
 * any failure is recorded to the vault's hook.log instead of vanishing.
 */
export async function captureHook(vault: string): Promise<CaptureResult | null> {
  try {
    let payload: any;
    try {
      payload = JSON.parse(await readStdin());
    } catch {
      return null;
    }
    const path: unknown = payload?.transcript_path;
    if (typeof path !== "string" || !path) return null;
    // `transcript_path` arrives over untrusted hook stdin. Only ingest a real file under
    // ~/.claude/projects so a crafted payload can't make us read an arbitrary local file.
    if (!isPathWithin(join(homedir(), ".claude", "projects"), path)) return null;
    return await captureFile(path, vault, "claude-code");
  } catch (err) {
    logHookError(vault, err);
    return null;
  }
}

import { basename } from "node:path";
import type { AgentId } from "./types.ts";
import { parseClaudeTranscript } from "./adapters/claude.ts";
import { parseCodexRollout } from "./adapters/codex.ts";
import { captureSession, type CaptureResult } from "./store.ts";

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
  let rec;
  switch (agent) {
    case "claude-code":
      rec = await parseClaudeTranscript(path);
      break;
    case "codex":
      rec = await parseCodexRollout(path);
      break;
    default:
      throw new Error(`adapter for "${agent}" not implemented yet (v1 supports claude-code, codex)`);
  }
  if (!rec) return null;
  return captureSession(vault, rec);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Capture driven by a Claude Code Stop hook: the hook delivers JSON on stdin
 * containing `transcript_path`. Always exits cleanly so it never blocks the agent.
 */
export async function captureHook(vault: string): Promise<CaptureResult | null> {
  let payload: any;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    return null;
  }
  const path: unknown = payload?.transcript_path;
  if (typeof path !== "string" || !path) return null;
  return captureFile(path, vault, "claude-code");
}

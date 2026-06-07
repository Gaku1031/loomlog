import { basename } from "node:path";
import type { AgentId } from "./types.ts";
import { parseClaudeTranscript } from "./adapters/claude.ts";
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
    default:
      throw new Error(`adapter for "${agent}" not implemented yet (v1 supports claude-code; codex next)`);
  }
  if (!rec) return null;
  return captureSession(vault, rec);
}

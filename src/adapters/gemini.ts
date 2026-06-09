import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { SessionRecord } from "../types.ts";
import { redact } from "../redact.ts";
import { activeMinutes, localDate } from "../util.ts";

interface GeminiEntry {
  sessionId?: string;
  messageId?: number;
  type?: string;
  message?: string;
  timestamp?: string;
}

/**
 * Parse a Gemini CLI logs.json (~/.gemini/tmp/<dir>/logs.json) into SessionRecords.
 *
 * Note: this file is a flat history of USER prompts only (grouped by sessionId), so
 * one file yields MANY sessions and we can only extract intent / time / project —
 * not files/commands/tools. Gemini support is best-effort (experimental).
 */
export function parseGeminiLogs(path: string): SessionRecord[] {
  let entries: GeminiEntry[];
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(data)) return [];
    entries = data;
  } catch {
    return [];
  }

  // Resolve the real project path from the sibling .project_root marker.
  const rootMarker = join(dirname(path), ".project_root");
  let cwd = "";
  if (existsSync(rootMarker)) {
    try {
      cwd = readFileSync(rootMarker, "utf8").trim();
    } catch {
      /* ignore */
    }
  }
  if (!cwd) cwd = basename(dirname(path));
  const project = basename(cwd) || "unknown";

  // Group entries by session.
  const bySession = new Map<string, GeminiEntry[]>();
  for (const e of entries) {
    if (!e || !e.sessionId || !e.timestamp) continue;
    const arr = bySession.get(e.sessionId) ?? [];
    arr.push(e);
    bySession.set(e.sessionId, arr);
  }

  const records: SessionRecord[] = [];
  for (const [id, group] of bySession) {
    group.sort((a, b) => (a.timestamp! < b.timestamp! ? -1 : 1));
    const timestamps = group.map((e) => e.timestamp!).sort();
    const start = timestamps[0]!;
    const end = timestamps[timestamps.length - 1]!;
    const firstMsg = group.find((e) => typeof e.message === "string" && e.message.trim())?.message ?? "";
    records.push({
      id,
      agent: "gemini",
      project,
      cwd,
      date: localDate(start),
      start,
      end,
      activeMin: activeMinutes(timestamps),
      intent: firstMsg ? redact(firstMsg.trim().replace(/\s+/g, " ").slice(0, 120)) : "(no prompt captured)",
      files: [],
      commandCount: 0,
      commandCats: {},
      tools: [],
      errorCount: 0,
      sourcePath: path,
    });
  }
  return records;
}

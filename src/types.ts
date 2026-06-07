export type AgentId = "claude-code" | "codex" | "gemini";

/**
 * One captured agent session, normalized across agents.
 * This is the durable unit written to the store. Capture is purely mechanical
 * (no LLM) — every field is extracted from the agent's on-disk session log.
 */
export interface SessionRecord {
  /** Stable session id (used for idempotent re-capture). */
  id: string;
  agent: AgentId;
  /** Project name = basename of the working directory. */
  project: string;
  /** Absolute working directory the session ran in. */
  cwd: string;
  /** Local date (YYYY-MM-DD) of the session start. Determines the daily note. */
  date: string;
  /** ISO timestamp of first event. */
  start: string;
  /** ISO timestamp of last event. */
  end: string;
  /** Active minutes (sum of inter-event gaps <= 5min). Avoids overnight-idle inflation. */
  activeMin: number;
  /** First genuine human prompt, truncated + redacted. The session's "intent". */
  intent: string;
  /** Files written/edited (paths only, never contents), redacted. */
  files: string[];
  /** Total shell commands run. */
  commandCount: number;
  /** Command count by leading command name (e.g. { git: 3, npm: 2 }). */
  commandCats: Record<string, number>;
  /** Distinct tool names used. */
  tools: string[];
  /** Number of failed tool calls — proxy for "詰まり" (#blocker). */
  errorCount: number;
  /** Origin log file (for provenance / debugging). */
  sourcePath: string;
}

export interface DayFile {
  date: string;
  /** Sessions keyed by id for idempotent upsert. */
  sessions: Record<string, SessionRecord>;
}

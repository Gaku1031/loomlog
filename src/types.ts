export type AgentId = "claude-code" | "codex" | "gemini";

/** Bumped when the SessionRecord shape changes, so future versions can migrate the store. */
export const SCHEMA_VERSION = 3;

/**
 * A failed-tool-call signal within a session, grouped by a normalized signature. Recurrence of a
 * signature (count >= 2, here or across sessions) is what loomlog treats as a 詰まり / sticking
 * point. `sample` keeps the actual (redacted) command/target so the judgment is verifiable.
 */
export interface Blocker {
  /** Recurrence key, e.g. "go test", "npm run build", "edit applePay.ts". */
  sig: string;
  /** Redacted, clipped sample of the failing command/target — evidence the user can check. */
  sample: string;
  /** Redacted excerpt of the failure output — the key error line (the "why"). */
  detail?: string;
  /** Times this signature failed in the session. */
  count: number;
  /** True if the same signature later succeeded in this session (you got past it). */
  resolved?: boolean;
}

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
  /** Genuine human prompts in chronological order, truncated + redacted. */
  prompts?: string[];
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
  /** Failed tool calls grouped by signature (for recurring-blocker detection). Optional for v2 records. */
  blockers?: Blocker[];
  /** git commit subjects made during the session (the dev's own "what I shipped" log), redacted. */
  commits: string[];
  /** Origin log file (for provenance / debugging). */
  sourcePath: string;
  /** Store schema version this record was written with. */
  schemaVersion: number;
}

export interface DayFile {
  date: string;
  /** Sessions keyed by id for idempotent upsert. */
  sessions: Record<string, SessionRecord>;
}

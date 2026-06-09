import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { parseCodexRollout } from "./adapters/codex.ts";
import { parseGeminiLogs } from "./adapters/gemini.ts";
import { captureSession } from "./store.ts";

export interface ScanSummary {
  found: number;
  captured: number;
  skipped: number;
  errors: number;
}

const codexSessionsDir = () => join(homedir(), ".codex", "sessions");
const geminiTmpDir = () => join(homedir(), ".gemini", "tmp");

/** All rollout-*.jsonl under ~/.codex/sessions (recursive). */
function listCodexRollouts(): string[] {
  const root = codexSessionsDir();
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true })
    .map(String)
    .filter((p) => {
      const b = basename(p);
      return b.startsWith("rollout-") && b.endsWith(".jsonl");
    })
    .map((p) => join(root, p));
}

/** All logs.json under ~/.gemini/tmp/<dir>/. */
function listGeminiLogs(): string[] {
  const root = geminiTmpDir();
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(root, d.name, "logs.json"))
    .filter((p) => existsSync(p));
}

/** Extract YYYY-MM-DD from the .../sessions/YYYY/MM/DD/... codex path layout. */
function datePartOf(path: string): string | null {
  const m = path.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function loadScanned(statePath: string): Record<string, number> {
  if (!existsSync(statePath)) return {};
  try {
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    return {};
  }
}

function saveScanned(statePath: string, data: Record<string, number>): void {
  mkdirSync(join(statePath, ".."), { recursive: true });
  writeFileSync(statePath, JSON.stringify(data, null, 2) + "\n");
}

/**
 * Lazy scan of Codex sessions. Codex never auto-deletes logs, so we ingest on
 * demand. Dedup is by file mtime (one rollout == one session); a still-growing
 * session re-captures idempotently (upsert keyed by session id).
 */
export async function scanCodex(vault: string, opts: { since?: string } = {}): Promise<ScanSummary> {
  const statePath = join(vault, ".loomlog", "scanned.json");
  const scanned = loadScanned(statePath);
  const summary: ScanSummary = { found: 0, captured: 0, skipped: 0, errors: 0 };

  for (const path of listCodexRollouts()) {
    if (opts.since) {
      const d = datePartOf(path);
      if (d && d < opts.since) continue;
    }
    summary.found++;
    let mtimeMs: number;
    try {
      mtimeMs = statSync(path).mtimeMs;
    } catch {
      summary.errors++;
      continue;
    }
    if (scanned[path] === mtimeMs) {
      summary.skipped++;
      continue;
    }
    try {
      const rec = await parseCodexRollout(path);
      if (rec) {
        captureSession(vault, rec);
        summary.captured++;
      } else {
        summary.skipped++;
      }
      scanned[path] = mtimeMs;
    } catch {
      summary.errors++;
    }
  }

  saveScanned(statePath, scanned);
  return summary;
}

/**
 * Lazy scan of Gemini sessions. Gemini auto-deletes old sessions by default, so a
 * scheduled daily scan is the recommended capture path. logs.json files are small
 * (user prompts only), so we parse all of them every time and upsert idempotently.
 * `found` counts logs.json files; `captured` counts session records.
 */
export function scanGemini(vault: string, opts: { since?: string } = {}): ScanSummary {
  const summary: ScanSummary = { found: 0, captured: 0, skipped: 0, errors: 0 };

  for (const path of listGeminiLogs()) {
    summary.found++;
    try {
      for (const rec of parseGeminiLogs(path)) {
        if (opts.since && rec.date < opts.since) {
          summary.skipped++;
          continue;
        }
        captureSession(vault, rec);
        summary.captured++;
      }
    } catch {
      summary.errors++;
    }
  }
  return summary;
}

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { parseCodexRollout } from "./adapters/codex.ts";
import { captureSession } from "./store.ts";

export interface ScanSummary {
  found: number;
  captured: number;
  skipped: number;
  errors: number;
}

const codexSessionsDir = () => join(homedir(), ".codex", "sessions");

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

/** Extract YYYY-MM-DD from the .../sessions/YYYY/MM/DD/... path layout. */
function datePartOf(path: string): string | null {
  const m = path.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Lazy scan of Codex sessions. Codex never auto-deletes logs, so we can ingest
 * on demand. Dedup is by file mtime (one rollout == one session); a still-growing
 * session re-captures idempotently (upsert keyed by session id).
 */
export async function scanCodex(vault: string, opts: { since?: string } = {}): Promise<ScanSummary> {
  const statePath = join(vault, ".loomlog", "scanned.json");
  let scanned: Record<string, number> = {};
  if (existsSync(statePath)) {
    try {
      scanned = JSON.parse(readFileSync(statePath, "utf8"));
    } catch {
      scanned = {};
    }
  }

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

  mkdirSync(join(statePath, ".."), { recursive: true });
  writeFileSync(statePath, JSON.stringify(scanned, null, 2) + "\n");
  return summary;
}

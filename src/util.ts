import { homedir } from "node:os";
import { resolve } from "node:path";

/** Local YYYY-MM-DD for an ISO timestamp (uses the machine's timezone). */
export function localDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Active minutes: sum of inter-event gaps, ignoring gaps longer than `maxGapMin`. */
export function activeMinutes(isoTimestamps: string[], maxGapMin = 5): number {
  const ts = isoTimestamps
    .map((t) => Date.parse(t))
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);
  let ms = 0;
  const cap = maxGapMin * 60_000;
  for (let i = 1; i < ts.length; i++) {
    const delta = ts[i]! - ts[i - 1]!;
    if (delta > 0 && delta <= cap) ms += delta;
  }
  return Math.round(ms / 60_000);
}

/** Resolve the vault directory: explicit flag > env > default ~/loomlog. */
export function resolveVault(explicit?: string): string {
  const v = explicit || process.env.LOOMLOG_VAULT || `${homedir()}/loomlog`;
  return resolve(v.replace(/^~(?=$|\/)/, homedir()));
}

/** Tally an array of strings into a count map. */
export function tally(items: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) out[it] = (out[it] ?? 0) + 1;
  return out;
}

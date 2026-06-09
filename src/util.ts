import { homedir } from "node:os";
import { resolve } from "node:path";

/** Replace a leading $HOME with `~` so stored paths don't leak the username. */
export function homeShorten(p: string): string {
  const h = homedir();
  if (p === h) return "~";
  return p.startsWith(h + "/") ? "~" + p.slice(h.length) : p;
}

/** True for a real calendar date in strict YYYY-MM-DD form (e.g. rejects 2026-13-40). */
export function isValidDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

/** Local YYYY-MM-DD for an ISO timestamp (uses the machine's timezone). */
export function localDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Today's local date (YYYY-MM-DD). */
export function todayLocal(): string {
  return localDate(new Date().toISOString());
}

/** Add `n` days to a YYYY-MM-DD date, returning YYYY-MM-DD (timezone-safe). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d! + n);
  return localDate(dt.toISOString());
}

/** Inclusive list of YYYY-MM-DD dates from `from` to `to`. */
export function rangeDates(from: string, to: string): string[] {
  const out: string[] = [];
  for (let cur = from; cur <= to; cur = addDays(cur, 1)) out.push(cur);
  return out;
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

/** Leading command name from a shell command line (strips env-assignments / sudo / path). */
export function commandCategory(cmd: string): string {
  for (let tok of cmd.trim().split(/\s+/)) {
    if (!tok || tok === "sudo" || tok === "\\") continue; // skip blanks, sudo, line-continuation
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) continue; // FOO=bar
    tok = tok.replace(/^.*\//, "").replace(/[;|&].*$/, ""); // basename, drop trailing operators
    return tok.toLowerCase();
  }
  return "?";
}

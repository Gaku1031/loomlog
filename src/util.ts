import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve, sep } from "node:path";

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

/**
 * Sanitize a string for safe use as a single path segment (filename).
 * Strips path separators and `..` traversal so a crafted log-derived value can never
 * escape the vault. `basename()` already removes separators upstream; this keeps the
 * "everything stays under the vault" invariant explicit and defended at the write sink.
 */
export function safeFilename(s: string): string {
  const cleaned = s.replace(/[/\\]/g, "_").replace(/\.{2,}/g, "_").trim();
  return cleaned || "unknown";
}

/**
 * True iff `target` resolves to a path inside `root` (symlinks resolved on both sides).
 * Both must exist on disk. Used to confine hook/scan file reads to the intended log trees
 * so untrusted input (e.g. a hook payload's `transcript_path`) can't read arbitrary files.
 */
export function isPathWithin(root: string, target: string): boolean {
  try {
    const r = realpathSync(resolve(root));
    const t = realpathSync(resolve(target));
    return t === r || t.startsWith(r + sep);
  } catch {
    return false;
  }
}

/**
 * Neutralize the Markdown / Obsidian constructs loomlog renders structurally, so captured
 * (untrusted) text can't forge a `[[wikilink]]` or break out of an inline-code span when it
 * lands in the vault. Deliberately minimal — full Markdown escaping would make the journal
 * unreadable, and the host-model prompt-injection fence in the integration commands is the
 * primary control. A zero-width space splits `[[`/`]]` invisibly (readable, but not a link).
 */
export function mdSafe(s: string): string {
  const ZWSP = "\u200b"; // zero-width space: invisible to readers, breaks [[ / ]] parsing
  return s.replace(/`/g, "'").replace(/\[\[/g, `[${ZWSP}[`).replace(/\]\]/g, `]${ZWSP}]`);
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

/**
 * Extract git commit subject lines from a shell command string (0-token, mechanical).
 * Handles `-m "..."`, `-m '...'`, `-m $'...'`, and heredoc bodies
 * (`git commit -m "$(cat <<'EOF' ... EOF)"` / `git commit -F - <<EOF ... EOF`).
 * Returns the first line of each commit message found.
 *
 * Only fires on a real `git … commit` *invocation* at a command boundary, so that a
 * literal "git commit" inside another command's quoted string (e.g. `echo "git commit -m x"`
 * or a test/grep argument) is not mistaken for a commit.
 */
export function extractCommits(cmd: string): string[] {
  const invocation = /(?:^|[\n;&|(])\s*(?:[A-Za-z_]\w*=\S+\s+)*(?:sudo\s+)?git\b[^\n;|&]*?\bcommit\b/.exec(cmd);
  if (!invocation) return [];
  // Focus extraction on the part from the `git … commit` token onward.
  cmd = cmd.slice(invocation.index);
  const firstLine = (s: string): string => s.split(/\r?\n/).map((x) => x.trim()).find(Boolean) ?? "";
  const out: string[] = [];

  // 1) heredoc bodies (most common for multi-line messages from agents)
  const heredoc = /<<-?\s*(['"]?)([A-Za-z_]\w*)\1\r?\n([\s\S]*?)\r?\n[ \t]*\2(?!\w)/g;
  let h: RegExpExecArray | null;
  while ((h = heredoc.exec(cmd))) {
    const s = firstLine(h[3]!);
    if (s) out.push(s);
  }
  if (out.length) return out;

  // The -m flag may be combined (-am, -sm) or spelled out (--message).
  // 2) ... $'...' (ANSI-C quoting)
  for (const m of cmd.matchAll(/(?:--message|-[A-Za-z]*m)[=\s]+\$'((?:[^'\\]|\\.)*)'/g)) {
    const s = firstLine(m[1]!.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\'/g, "'"));
    if (s) out.push(s);
  }
  if (out.length) return out;

  // 3) ... "..." / ... '...'
  for (const m of cmd.matchAll(/(?:--message|-[A-Za-z]*m)[=\s]+(["'])((?:(?!\1)[\s\S])*)\1/g)) {
    const s = firstLine(m[2]!);
    if (s) out.push(s);
  }
  if (out.length) return out;

  // 4) ... bareword (single unquoted token)
  const bare = cmd.match(/(?:--message|-[A-Za-z]*m)[=\s]+(\S+)/);
  if (bare) {
    const s = firstLine(bare[1]!);
    if (s) out.push(s);
  }
  return out;
}

// Tools whose meaningful action is the *second* word (script/subcommand runners), so
// `npm run build` and `cargo test` keep that word in their failure signature.
const SUBCOMMAND_RUNNERS = new Set([
  "npm", "pnpm", "yarn", "bun", "npx", "go", "cargo", "deno", "dotnet", "mvn", "gradle",
  "make", "just", "task", "rake", "poetry", "uv", "pdm", "composer", "bundle", "pip", "docker",
]);

// Navigation / env segments that merely precede the real work in a chain like `cd x && npm build`.
const PEEL_PREFIXES = new Set(["cd", "pushd", "popd", "export", "source", ".", "set", "unset", "alias", "env"]);

/** The command base (lowercased basename) of one shell segment, skipping env-assignments / sudo. */
function segmentBase(seg: string): string {
  const toks = seg.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < toks.length && (toks[i] === "sudo" || toks[i] === "\\" || /^[A-Za-z_]\w*=/.test(toks[i]!))) i++;
  return (toks[i] ?? "").replace(/^.*\//, "").replace(/[;|&].*$/, "").toLowerCase();
}

/**
 * Stable signature for a shell command — the key for detecting a *recurring* failure (詰まり).
 * Peels leading navigation/env segments so `cd x && npm run build` signs as "npm run build", then
 * keeps the command plus a leading sub-word or two and drops flags, paths, and arguments: so
 * `go test ./internal -run X` and `go test ./pkg` collapse to one signature ("go test") while
 * `npm run build` and `npm run test` stay distinct. Returns "?" when nothing usable is found.
 */
export function commandSignature(cmd: string): string {
  // Reach past `cd … &&` / `export … ;` to the first segment that actually does work.
  const segs = cmd.split(/&&|\n|;/).map((s) => s.trim()).filter(Boolean);
  let target = segs[0] ?? cmd;
  for (const seg of segs) {
    if (!PEEL_PREFIXES.has(segmentBase(seg))) { target = seg; break; }
  }

  const toks = target.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < toks.length && (toks[i] === "sudo" || toks[i] === "\\" || /^[A-Za-z_]\w*=/.test(toks[i]!))) i++;
  if (i >= toks.length) return "?";
  const base = toks[i]!.replace(/^.*\//, "").replace(/[;|&].*$/, "").toLowerCase();
  if (!base) return "?";
  const maxParts = SUBCOMMAND_RUNNERS.has(base) ? 3 : 2; // command + 1 (or +2 for runners)
  const parts = [base];
  for (let j = i + 1; j < toks.length && parts.length < maxParts; j++) {
    const t = toks[j]!;
    if (t.startsWith("-")) break; // first flag ends the subcommand
    if (!/^[A-Za-z][\w:.-]*$/.test(t)) break; // path / quote / operator / arg → stop
    parts.push(t.toLowerCase());
  }
  return parts.join(" ");
}

/**
 * Normalize a failed tool call into a (signature, evidence-sample) pair. The signature is the
 * recurrence key; the sample is the actual command/target kept for the user to verify against.
 */
export function blockerSignature(o: { command?: string; file?: string; tool?: string }): { sig: string; sample: string } {
  if (o.command && o.command.trim()) return { sig: commandSignature(o.command), sample: o.command.trim() };
  if (o.file && o.file.trim()) return { sig: `edit ${basename(o.file.trim())}`, sample: o.file.trim() };
  const t = o.tool?.trim() || "?";
  return { sig: t, sample: t };
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

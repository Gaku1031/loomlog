import { isValidDate } from "./util.ts";

/** Flags that are presence-only (no value). */
const BOOLEAN_FLAGS = new Set(["json", "week", "hook", "skip-obsidian", "wire-claude"]);
/** Flags that require a value. Anything else (with `--`) is an unknown-flag error. */
const VALUE_FLAGS = new Set(["vault", "agent", "since", "until", "date", "project", "obsidian-config", "claude-settings"]);

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string>;
}

/**
 * Parse `--flag value`, `--flag=value`, boolean `--flag`, and `-w`/`-h` shorthands.
 * Unlike a permissive parser, this *errors* on a value-flag with no value
 * (so `loomlog report --date --json` can't silently set date="--json") and on
 * unknown flags (catching typos like `--weak`).
 */
export function parseFlags(args: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "-w") {
      flags.week = "true";
      continue;
    }
    if (a === "-h" || a === "--help") {
      flags.help = "true";
      continue;
    }
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }

    let name = a.slice(2);
    let inlineVal: string | undefined;
    const eq = name.indexOf("=");
    if (eq >= 0) {
      inlineVal = name.slice(eq + 1);
      name = name.slice(0, eq);
    }

    if (BOOLEAN_FLAGS.has(name)) {
      if (inlineVal !== undefined && inlineVal !== "true" && inlineVal !== "false") {
        throw new Error(`flag --${name} does not take a value`);
      }
      flags[name] = inlineVal === "false" ? "false" : "true";
    } else if (VALUE_FLAGS.has(name)) {
      let val = inlineVal;
      if (val === undefined) {
        const next = args[i + 1];
        if (next === undefined || next.startsWith("-")) {
          throw new Error(`flag --${name} needs a value`);
        }
        val = next;
        i++;
      }
      flags[name] = val;
    } else {
      throw new Error(`unknown flag --${name}`);
    }
  }

  return { positional, flags };
}

/** Throw if a present date flag isn't a real YYYY-MM-DD date, or if a since/until range is inverted. */
export function validateDateFlags(flags: Record<string, string>): void {
  for (const name of ["date", "since", "until"]) {
    const v = flags[name];
    if (v !== undefined && !isValidDate(v)) {
      throw new Error(`--${name} must be a real YYYY-MM-DD date (got "${v}")`);
    }
  }
  if (flags.since && flags.until && flags.since > flags.until) {
    throw new Error(`--since (${flags.since}) is after --until (${flags.until})`);
  }
}

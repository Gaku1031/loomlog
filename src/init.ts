import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { applyGraphConfig, applyGraphSnippet, registerVault, type GraphResult, type RegisterResult } from "./obsidian.ts";

export interface DetectedAgents {
  claudeCode: boolean;
  codex: boolean;
  gemini: boolean;
}

export interface InitResult {
  vault: string;
  createdDirs: string[];
  graph: GraphResult;
  snippet: "applied" | "unchanged";
  register: RegisterResult;
  agents: DetectedAgents;
}

/** Which agents are installed (by presence of their home dirs). */
export function detectAgents(): DetectedAgents {
  const home = homedir();
  return {
    claudeCode: existsSync(join(home, ".claude")),
    codex: existsSync(join(home, ".codex")),
    gemini: existsSync(join(home, ".gemini")),
  };
}

/** Scaffold a vault: dirs + Obsidian graph config, then register it with Obsidian. */
export function initVault(
  vault: string,
  opts: { obsidianConfig?: string; skipObsidian?: boolean } = {},
): InitResult {
  const createdDirs: string[] = [];
  for (const sub of ["", "Daily", "Projects", "Reflections", ".loomlog/days", ".obsidian"]) {
    const dir = sub ? join(vault, sub) : vault;
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      createdDirs.push(sub || ".");
    }
  }

  // Merge loomlog's required graph settings (showTags + color groups) into graph.json. Unlike
  // a one-time write, this repairs vaults where Obsidian has since reset showTags to false —
  // the exact reason topic nodes can silently fail to appear. Preserves user layout & groups.
  const graph = applyGraphConfig(join(vault, ".obsidian", "graph.json"));
  // Color the #topic/* tag nodes — graph.json colorGroups only reach file nodes, so without
  // this CSS snippet the topic nodes render green and vanish into the Projects nodes.
  const snippet = applyGraphSnippet(join(vault, ".obsidian"));

  const register: RegisterResult = opts.skipObsidian
    ? "no-config"
    : registerVault(vault, opts.obsidianConfig);

  return { vault, createdDirs, graph, snippet, register, agents: detectAgents() };
}

export type WireResult = "added" | "exists" | "no-file";

/**
 * POSIX single-quote a string for safe embedding in a shell command. Single quotes disable all
 * shell expansion, so a vault path containing `$`, backticks, spaces, `;`, or `'` cannot break
 * out of the argument or trigger command substitution. (The hook command is already POSIX-shaped
 * — `2>/dev/null || true` — so single-quoting is the correct, consistent escape here.)
 */
function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Safely add a loomlog Stop hook to Claude Code's settings.json.
 * Strictly additive + idempotent + backed up — preserves all existing hooks.
 * (The recommended public path is the plugin, whose hook self-registers; this is
 *  for users who prefer wiring their own settings directly.)
 */
export function wireClaudeHook(
  settingsPath = join(homedir(), ".claude", "settings.json"),
  vault?: string,
): WireResult {
  if (!existsSync(settingsPath)) return "no-file";
  const data: any = JSON.parse(readFileSync(settingsPath, "utf8"));
  data.hooks ??= {};
  const stop: any[] = Array.isArray(data.hooks.Stop) ? data.hooks.Stop : (data.hooks.Stop = []);

  const already = JSON.stringify(stop).includes("loomlog");
  if (already) return "exists";

  const bak = `${settingsPath}.loomlog.bak`;
  if (!existsSync(bak)) copyFileSync(settingsPath, bak);

  // Bake the vault into the command so the hook is independent of the shell env. Single-quote the
  // path: a vault containing `$`, a space, or a backtick must not be re-interpreted by the shell.
  const command = vault
    ? `loomlog capture --hook --vault ${shellSingleQuote(vault)} 2>/dev/null || true`
    : "loomlog capture --hook 2>/dev/null || true";
  stop.push({ matcher: "", hooks: [{ type: "command", command }] });
  writeFileSync(settingsPath, JSON.stringify(data, null, 2));
  return "added";
}

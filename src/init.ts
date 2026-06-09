import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GRAPH_JSON, registerVault, type RegisterResult } from "./obsidian.ts";

export interface DetectedAgents {
  claudeCode: boolean;
  codex: boolean;
  gemini: boolean;
}

export interface InitResult {
  vault: string;
  createdDirs: string[];
  graphWritten: boolean;
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
  for (const sub of ["", "Daily", "Projects", ".loomlog/days", ".obsidian"]) {
    const dir = sub ? join(vault, sub) : vault;
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      createdDirs.push(sub || ".");
    }
  }

  // Write graph config only if absent (never clobber user customization).
  const graphPath = join(vault, ".obsidian", "graph.json");
  let graphWritten = false;
  if (!existsSync(graphPath)) {
    writeFileSync(graphPath, JSON.stringify(GRAPH_JSON, null, 2));
    graphWritten = true;
  }

  const register: RegisterResult = opts.skipObsidian
    ? "no-config"
    : registerVault(vault, opts.obsidianConfig);

  return { vault, createdDirs, graphWritten, register, agents: detectAgents() };
}

export type WireResult = "added" | "exists" | "no-file";

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

  // Bake the vault into the command so the hook is independent of the shell env.
  const command = vault
    ? `loomlog capture --hook --vault ${JSON.stringify(vault)} 2>/dev/null || true`
    : "loomlog capture --hook 2>/dev/null || true";
  stop.push({ matcher: "", hooks: [{ type: "command", command }] });
  writeFileSync(settingsPath, JSON.stringify(data, null, 2));
  return "added";
}

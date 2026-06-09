import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Obsidian graph-view config: color Daily / Projects / blockers distinctly. */
export const GRAPH_JSON = {
  collapseFilter: true,
  search: "",
  showTags: true,
  showAttachments: false,
  hideUnresolved: false,
  showOrphans: true,
  collapseColorGroups: false,
  colorGroups: [
    { query: "path:Daily", color: { a: 1, rgb: 4895977 } }, // blue
    { query: "path:Projects", color: { a: 1, rgb: 5757197 } }, // green
    { query: "path:Reflections", color: { a: 1, rgb: 11030239 } }, // purple
    { query: "tag:#blocker", color: { a: 1, rgb: 14431557 } }, // red
  ],
  collapseDisplay: false,
  showArrow: false,
  textFadeMultiplier: 0,
  nodeSizeMultiplier: 1,
  lineSizeMultiplier: 1,
  collapseForces: false,
  centerStrength: 0.5,
  repelStrength: 10,
  linkStrength: 1,
  linkDistance: 250,
  scale: 1,
  close: false,
};

/** Default Obsidian global config path per platform. */
export function defaultObsidianConfig(): string {
  const home = homedir();
  if (process.platform === "darwin") return join(home, "Library", "Application Support", "obsidian", "obsidian.json");
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "obsidian", "obsidian.json");
  return join(home, ".config", "obsidian", "obsidian.json");
}

function backupOnce(path: string): void {
  const bak = `${path}.loomlog.bak`;
  if (!existsSync(bak)) copyFileSync(path, bak);
}

export type RegisterResult = "added" | "exists" | "no-config";

/**
 * Register a vault in Obsidian's global config so it shows up in the vault switcher.
 * Strictly additive + idempotent + backed up — never removes or rewrites existing vaults.
 */
export function registerVault(vaultPath: string, configPath = defaultObsidianConfig()): RegisterResult {
  if (!existsSync(configPath)) return "no-config";
  let data: { vaults?: Record<string, { path: string; ts: number }> };
  try {
    data = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return "no-config";
  }
  data.vaults ??= {};
  const target = resolve(vaultPath);
  for (const v of Object.values(data.vaults)) {
    if (v && resolve(v.path) === target) return "exists";
  }
  backupOnce(configPath);
  const id = randomBytes(8).toString("hex");
  data.vaults[id] = { path: target, ts: Date.now() };
  writeFileSync(configPath, JSON.stringify(data));
  return "added";
}

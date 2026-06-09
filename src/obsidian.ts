import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Obsidian graph-view config: color Daily / Projects / Topics / blockers distinctly. */
export const GRAPH_JSON = {
  // NOTE: Obsidian uses kebab-case for the collapse-* keys ("collapse-filter", not
  // "collapseFilter"). camelCase variants are silently ignored and reset to defaults, so the
  // key names here must match Obsidian's schema exactly or the settings won't take effect.
  "collapse-filter": true,
  search: "",
  showTags: true,
  showAttachments: false,
  hideUnresolved: false,
  showOrphans: true,
  "collapse-color-groups": false,
  colorGroups: [
    { query: "path:Daily", color: { a: 1, rgb: 4895977 } }, // blue
    { query: "path:Projects", color: { a: 1, rgb: 5757197 } }, // green
    { query: "path:Reflections", color: { a: 1, rgb: 11030239 } }, // purple
    { query: "tag:#topic", color: { a: 1, rgb: 15244080 } }, // orange — concept nodes that bridge projects
    { query: "tag:#blocker", color: { a: 1, rgb: 14431557 } }, // red
  ],
  "collapse-display": false,
  showArrow: false,
  textFadeMultiplier: 0,
  nodeSizeMultiplier: 1,
  lineSizeMultiplier: 1,
  "collapse-forces": false,
  centerStrength: 0.5,
  repelStrength: 10,
  linkStrength: 1,
  linkDistance: 250,
  scale: 1,
  close: false,
};

export type GraphResult = "written" | "merged" | "unchanged";

/**
 * Ensure a vault's `.obsidian/graph.json` carries loomlog's required graph-view settings:
 * `showTags: true` (otherwise the #topic/#blocker tag nodes are simply not drawn) and the
 * color groups that distinguish each node type. Obsidian *owns* this file and rewrites it on
 * any graph interaction — frequently resetting `showTags` to its default of false — so writing
 * once at init isn't enough. This merges into whatever is there: it forces `showTags` on, adds
 * only the color groups whose `query` is missing (preserving the user's own groups and their
 * layout/zoom), backs up once, and writes only when something actually changed (idempotent).
 */
export function applyGraphConfig(graphPath: string): GraphResult {
  const backup = (): void => {
    const bak = `${graphPath}.loomlog.bak`;
    if (!existsSync(bak)) copyFileSync(graphPath, bak);
  };

  if (!existsSync(graphPath)) {
    writeFileSync(graphPath, JSON.stringify(GRAPH_JSON, null, 2));
    return "written";
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(readFileSync(graphPath, "utf8")) as Record<string, unknown>;
  } catch {
    // Corrupt/unparseable — preserve it as a backup, then drop in our known-good config.
    backup();
    writeFileSync(graphPath, JSON.stringify(GRAPH_JSON, null, 2));
    return "written";
  }

  let changed = false;
  if (data.showTags !== true) {
    data.showTags = true;
    changed = true;
  }
  if (!Array.isArray(data.colorGroups)) {
    data.colorGroups = [];
    changed = true;
  }
  const groups = data.colorGroups as Array<{ query?: string }>;
  const present = new Set(groups.map((g) => g?.query));
  for (const g of GRAPH_JSON.colorGroups) {
    if (!present.has(g.query)) {
      groups.push(g);
      changed = true;
    }
  }

  if (!changed) return "unchanged";
  backup();
  writeFileSync(graphPath, JSON.stringify(data, null, 2));
  return "merged";
}

/** Filename (without extension) of the graph tag-color CSS snippet. */
export const GRAPH_SNIPPET_NAME = "loomlog-graph-tags";

/**
 * CSS that colors graph *tag* nodes (incl. every `#topic/*`) orange. Obsidian colors *file*
 * nodes from graph.json `colorGroups`, but tag nodes take their color only from the
 * `--graph-node-tag` CSS variable — which defaults to green, making the topic nodes blend
 * invisibly into the green Projects nodes. #E89B30 matches the `tag:#topic` colorGroup.
 */
const GRAPH_TAG_SNIPPET = `/* loomlog — color tag nodes (#topic/*) in the graph view.
 * graph.json colorGroups only affect FILE nodes; tag-node color comes from this variable,
 * which otherwise defaults to green and blends with the Projects nodes. */
.graph-view.color-fill-tag {
  color: rgb(232, 155, 48);
}
`;

/**
 * Install + enable the graph tag-color snippet in a vault's `.obsidian` dir. Without it the
 * #topic/* tag nodes render green (indistinguishable from Projects). Writes the snippet file and
 * adds it to `appearance.json`'s `enabledCssSnippets` — merged, backed up, idempotent, since
 * Obsidian owns appearance.json. Returns whether anything changed.
 */
export function applyGraphSnippet(obsidianDir: string): "applied" | "unchanged" {
  let changed = false;

  const snippetDir = join(obsidianDir, "snippets");
  const snippetPath = join(snippetDir, `${GRAPH_SNIPPET_NAME}.css`);
  if (!existsSync(snippetPath) || readFileSync(snippetPath, "utf8") !== GRAPH_TAG_SNIPPET) {
    mkdirSync(snippetDir, { recursive: true });
    writeFileSync(snippetPath, GRAPH_TAG_SNIPPET);
    changed = true;
  }

  const appearancePath = join(obsidianDir, "appearance.json");
  const hadFile = existsSync(appearancePath);
  let appearance: Record<string, unknown> = {};
  if (hadFile) {
    try {
      appearance = JSON.parse(readFileSync(appearancePath, "utf8")) as Record<string, unknown>;
    } catch {
      appearance = {};
    }
  }
  const enabled = Array.isArray(appearance.enabledCssSnippets)
    ? (appearance.enabledCssSnippets as string[])
    : [];
  if (!enabled.includes(GRAPH_SNIPPET_NAME)) {
    if (hadFile) {
      const bak = `${appearancePath}.loomlog.bak`;
      if (!existsSync(bak)) copyFileSync(appearancePath, bak);
    }
    appearance.enabledCssSnippets = [...enabled, GRAPH_SNIPPET_NAME];
    writeFileSync(appearancePath, JSON.stringify(appearance, null, 2));
    changed = true;
  }

  return changed ? "applied" : "unchanged";
}

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

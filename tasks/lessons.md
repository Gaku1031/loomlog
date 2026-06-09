# Lessons

## Obsidian graph tag nodes are GREEN by default — colorGroups don't touch them (2026-06-09)

**Symptom:** After adding `#topic/*` tags, the user saw "only blue and green" in the graph and
"nothing changed" — through frontmatter-only, then inline tags, then full restarts.

**Two wrong turns I took before the real cause:**
1. Guessed showTags was reset → fixed graph.json (real but not sufficient).
2. Guessed "frontmatter tags never graph, only inline do" → added inline `#topic/*`. Plausible,
   but NOT the actual blocker.

**Actual root cause (Codex read Obsidian's app.js/app.css directly to confirm):** The tag nodes
WERE being created (showTags:true adds `type:"tag"` nodes). They were invisible because:
- tag-node color comes from the CSS var `--graph-node-tag`, which **defaults to green** — the same
  green as the `path:Projects` file nodes, so topic nodes blended in.
- `graph.json` `colorGroups` only color **file** nodes; they do NOT apply to tag nodes.
- the graph label shows only the leaf (`#topic/docs` → `docs`), so they didn't read as "topic".

**Fix:** A CSS snippet is the ONLY way to recolor graph tag nodes:
`.graph-view.color-fill-tag { color: rgb(232,155,48); }`, enabled via
`appearance.json` → `enabledCssSnippets`. Shipped in `applyGraphSnippet()` (obsidian.ts), wired
into `loomlog init` (merge + backup + idempotent, since Obsidian owns appearance.json).

**Rules for next time:**
- Obsidian graph node color: **file nodes** ← graph.json colorGroups; **tag/attachment/unresolved
  nodes** ← CSS vars only (`.graph-view.color-fill-tag` etc.). Don't expect colorGroups to color tags.
- "Node not visible" ≠ "node not created." Distinguish absence from camouflage before changing the
  data layer. (We changed the renderer — harmless, keeps topics readable in the note body — but the
  real fix was pure CSS.) The clinching diagnostic was reading the host app's bundled JS/CSS.

## Obsidian owns .obsidian/graph.json and resets showTags (2026-06-09)

**Mistake:** `init` wrote graph.json only when absent. The user's vault had `showTags: false` and
`colorGroups: []` because Obsidian rewrites graph.json on every graph interaction, resetting
showTags to its default (false).

**Fix:** `applyGraphConfig()` merges our required settings (force `showTags: true`, add missing
color groups) into the existing file, backed up + idempotent — so re-running `loomlog init` repairs
a clobbered graph.json. Also: Obsidian uses kebab-case keys (`collapse-filter`, not
`collapseFilter`); camelCase variants are silently ignored.

**Rule for next time:** Config files owned by a host app (Obsidian, VS Code, etc.) must be merged,
not written-once — assume the app will rewrite them and reset anything it doesn't recognize.

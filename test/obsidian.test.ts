import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyGraphConfig, applyGraphSnippet, GRAPH_JSON, GRAPH_SNIPPET_NAME } from "../src/obsidian.ts";

function graphPath(): string {
  return join(mkdtempSync(join(tmpdir(), "loomlog-graph-")), "graph.json");
}

function obsidianDir(): string {
  return mkdtempSync(join(tmpdir(), "loomlog-obs-"));
}

const TOPIC_GROUPS = GRAPH_JSON.colorGroups.map((g) => g.query);

test("writes a fresh graph.json when absent", () => {
  const p = graphPath();
  assert.equal(applyGraphConfig(p), "written");
  const data = JSON.parse(readFileSync(p, "utf8"));
  assert.equal(data.showTags, true);
  assert.deepEqual(data.colorGroups.map((g: { query: string }) => g.query), TOPIC_GROUPS);
});

test("merges into an Obsidian-reset graph.json (showTags off, no groups)", () => {
  const p = graphPath();
  // Simulate what Obsidian leaves behind: showTags false, empty groups, user layout tweaks.
  writeFileSync(p, JSON.stringify({ showTags: false, colorGroups: [], scale: 0.31, "collapse-forces": true }));

  assert.equal(applyGraphConfig(p), "merged");
  const data = JSON.parse(readFileSync(p, "utf8"));
  assert.equal(data.showTags, true, "showTags forced on");
  for (const q of TOPIC_GROUPS) {
    assert.ok(data.colorGroups.some((g: { query: string }) => g.query === q), `group ${q} added`);
  }
  assert.equal(data.scale, 0.31, "user layout preserved");
  assert.ok(existsSync(`${p}.loomlog.bak`), "backup created before write");
});

test("preserves the user's own color groups while adding ours", () => {
  const p = graphPath();
  const custom = { query: "tag:#custom", color: { a: 1, rgb: 123456 } };
  writeFileSync(p, JSON.stringify({ showTags: true, colorGroups: [custom] }));

  assert.equal(applyGraphConfig(p), "merged");
  const data = JSON.parse(readFileSync(p, "utf8"));
  assert.ok(data.colorGroups.some((g: { query: string }) => g.query === "tag:#custom"), "custom group kept");
  assert.ok(data.colorGroups.some((g: { query: string }) => g.query === "tag:#topic"), "topic group added");
});

test("idempotent: a fully-configured graph.json is left unchanged", () => {
  const p = graphPath();
  applyGraphConfig(p); // written
  assert.equal(applyGraphConfig(p), "unchanged");
});

test("installs and enables the graph tag-color snippet", () => {
  const dir = obsidianDir();
  assert.equal(applyGraphSnippet(dir), "applied");

  const css = readFileSync(join(dir, "snippets", `${GRAPH_SNIPPET_NAME}.css`), "utf8");
  assert.match(css, /\.graph-view\.color-fill-tag/);
  assert.match(css, /232, 155, 48/); // #E89B30 orange

  const appearance = JSON.parse(readFileSync(join(dir, "appearance.json"), "utf8"));
  assert.deepEqual(appearance.enabledCssSnippets, [GRAPH_SNIPPET_NAME]);
});

test("snippet enable is idempotent and preserves other appearance settings", () => {
  const dir = obsidianDir();
  writeFileSync(join(dir, "appearance.json"), JSON.stringify({ theme: "obsidian", enabledCssSnippets: ["my-snippet"] }));

  assert.equal(applyGraphSnippet(dir), "applied");
  const appearance = JSON.parse(readFileSync(join(dir, "appearance.json"), "utf8"));
  assert.deepEqual(appearance.enabledCssSnippets, ["my-snippet", GRAPH_SNIPPET_NAME], "appended, user snippet kept");
  assert.equal(appearance.theme, "obsidian", "other settings preserved");
  assert.ok(existsSync(join(dir, "appearance.json.loomlog.bak")), "backed up");

  assert.equal(applyGraphSnippet(dir), "unchanged", "second run is a no-op");
});

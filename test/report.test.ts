import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown, renderMarkdownPatterns, type ReportData, type PatternsData } from "../src/report.ts";

const REPORT: ReportData = {
  range: { from: "2026-06-09", to: "2026-06-09" },
  totals: { sessions: 3, activeMin: 42, agents: { "claude-code": 2, codex: 1 }, projects: ["loomlog"] },
  projects: [
    {
      project: "loomlog",
      activeMin: 42,
      sessions: 3,
      agents: ["claude-code", "codex"],
      files: ["src/cli.ts", "src/report.ts"],
      commands: { npm: 5, git: 2 },
      tools: ["Bash", "Edit"],
      blockers: 0,
      intents: ["クリップボード機能を設計", "テストを追加"],
      commits: ["feat: --copy", "test: clipboard"],
    },
  ],
  days: [{ date: "2026-06-09", sessions: 3, activeMin: 42, projects: ["loomlog"] }],
};

const PATTERNS: PatternsData = {
  range: { from: "2026-05-11", to: "2026-06-09" },
  totals: { sessions: 30, activeMin: 600, blockers: 4, commits: 12, days: 10 },
  workTypes: [["npm", 40], ["git", 22]],
  projectsByTime: [{ project: "loomlog", activeMin: 400, pct: 67 }],
  agents: [{ agent: "claude-code", activeMin: 400, sessions: 20 }],
  busiestDays: [{ date: "2026-06-09", activeMin: 120 }],
  recentCommits: ["feat: --copy"],
};

/** The whole point of renderMarkdown: NO leading-space gutter (the paste-nesting bug). */
function noLineStartsWithSpace(md: string): boolean {
  return md.split("\n").every((l) => !/^[ \t]/.test(l));
}

test("renderMarkdown emits an H1 title and H2 project headings", () => {
  const md = renderMarkdown(REPORT);
  assert.match(md, /^# loomlog report — 2026-06-09\n/);
  assert.match(md, /\n## loomlog — 42m · 3 sessions \[claude-code, codex\]\n/);
});

test("renderMarkdown has no indented bullets (regression: line 2+ nesting)", () => {
  const md = renderMarkdown(REPORT);
  assert.ok(noLineStartsWithSpace(md), `unexpected leading whitespace:\n${md}`);
  assert.match(md, /\n- 意図: クリップボード機能を設計\n/);
  assert.match(md, /\n- files: src\/cli\.ts, src\/report\.ts\n/);
  assert.match(md, /\n- 成果: feat: --copy \/ test: clipboard\n/);
});

test("renderMarkdown puts a blank line after each heading", () => {
  const md = renderMarkdown(REPORT);
  const lines = md.split("\n");
  lines.forEach((l, i) => {
    if (l.startsWith("#")) assert.equal(lines[i + 1], "", `no blank line after heading: ${l}`);
  });
});

test("renderMarkdown handles the empty range", () => {
  const md = renderMarkdown({ ...REPORT, totals: { ...REPORT.totals, sessions: 0 }, projects: [] });
  assert.match(md, /# loomlog report/);
  assert.match(md, /\(no sessions captured in this range\)/);
});

test("renderMarkdownPatterns has no indent gutter and uses column-0 bullets", () => {
  const md = renderMarkdownPatterns(PATTERNS);
  assert.match(md, /^# loomlog patterns — 2026-05-11 \.\. 2026-06-09\n/);
  assert.ok(noLineStartsWithSpace(md), `unexpected leading whitespace:\n${md}`);
  assert.match(md, /\n- loomlog: 400m \(67%\)\n/);
});

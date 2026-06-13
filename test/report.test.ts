import { test } from "node:test";
import assert from "node:assert/strict";
import { renderText, renderMarkdown, renderPatterns, renderMarkdownPatterns, type ReportData, type PatternsData } from "../src/report.ts";

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
  totals: { sessions: 30, activeMin: 600, blockers: 9, commits: 4, days: 10 },
  workTypes: [["git", 40], ["npm", 22], ["go", 10]],
  projectsByTime: [
    { project: "loomlog", activeMin: 400, pct: 67 },
    { project: "infra", activeMin: 200, pct: 33 },
  ],
  agents: [
    { agent: "claude-code", activeMin: 400, sessions: 20 },
    { agent: "codex", activeMin: 200, sessions: 10 },
  ],
  agentProfiles: [
    { agent: "claude-code", activeMin: 400, sessions: 20, profile: "新機能・修正" },
    { agent: "codex", activeMin: 200, sessions: 10, profile: "テスト・リファクタ" },
  ],
  busiestDays: [{ date: "2026-06-09", activeMin: 120 }],
  recentCommits: ["feat: --copy", "fix: nesting", "test: clipboard", "refactor: report"],
  blockers: [
    { sig: "go test", sample: "go test ./...", detail: "FAIL: TestFoo — undefined: bar", intent: "テストを直す", count: 4, sessions: 2, projects: ["loomlog"], resolved: false },
    { sig: "npm run build", sample: "npm run build", detail: "error TS2322: type mismatch", intent: "ビルドを通す", count: 2, sessions: 1, projects: ["infra"], resolved: true },
  ],
  shipping: {
    shipped: 21,
    total: 30,
    commitMix: [["新機能", 1], ["修正", 1], ["テスト", 1], ["リファクタ", 1]],
    heaviest: { date: "2026-06-08", fails: 6 },
  },
  trend: {
    prevActiveMin: 480,
    deltaPct: 25,
    byProject: { loomlog: { deltaMin: 90, status: "up" }, infra: { deltaMin: -40, status: "down" } },
    gone: ["old-proj"],
  },
};

/** The whole point of renderMarkdown: NO leading-space gutter (the paste-nesting bug). */
function noLineStartsWithSpace(md: string): boolean {
  return md.split("\n").every((l) => !/^[ \t]/.test(l));
}

test("renderMarkdown emits an H1 title and H2 project headings", () => {
  const md = renderMarkdown(REPORT);
  assert.match(md, /^# loomlog report — 2026-06-09\n/);
  assert.match(md, /\n## loomlog — 42m · 3 sessions · claude-code, codex\n/);
});

test("renderMarkdown has no indented bullets (regression: line 2+ nesting)", () => {
  const md = renderMarkdown(REPORT);
  assert.ok(noLineStartsWithSpace(md), `unexpected leading whitespace:\n${md}`);
  // Each session's intent is a bare bullet (= what was done); commits become the 成果 bullet.
  assert.match(md, /\n- クリップボード機能を設計\n/);
  assert.match(md, /\n- 成果: feat: --copy \/ test: clipboard\n/);
});

test("renderMarkdown keeps raw files/commands out of the daily report (they live in --json)", () => {
  const md = renderMarkdown(REPORT);
  assert.ok(!/\bfiles:/.test(md), `report should not dump raw files:\n${md}`);
  assert.ok(!/\bcommands:/.test(md), `report should not dump raw command counts:\n${md}`);
  assert.ok(!/意図:/.test(md), `intent bullets should be bare, not prefixed:\n${md}`);
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

test("renderText is a journal-style digest: bare intent bullets + ↳ 成果, no stats dump", () => {
  const txt = renderText(REPORT);
  assert.match(txt, /^loomlog report — 2026-06-09\n/);
  assert.match(txt, /\n## loomlog — 42m · 3 sessions · claude-code, codex\n/);
  assert.match(txt, /\n {2}- クリップボード機能を設計\n/);
  assert.match(txt, /\n {2}↳ 成果: feat: --copy \/ test: clipboard\n/);
  assert.ok(!/\bfiles:/.test(txt) && !/\bcommands:/.test(txt), `should not dump files/commands:\n${txt}`);
});

test("renderPatterns draws aligned Unicode bar charts (leader fills, smaller is shorter)", () => {
  const txt = renderPatterns(PATTERNS);
  assert.match(txt, /█/); // has bars at all
  const lines = txt.split("\n");
  const blocks = (s: string | undefined) => (s?.match(/█/g) ?? []).length;
  const leader = lines.find((l) => l.includes("loomlog") && l.includes("█")); // 400m → full bar
  const smaller = lines.find((l) => l.includes("infra") && l.includes("█")); // 200m → ~half
  assert.ok(leader && smaller, "expected bar rows for both projects");
  assert.ok(blocks(leader) > blocks(smaller), `leader bar should be longer:\n${leader}\n${smaller}`);
});

test("renderMarkdownPatterns has no indent gutter and uses column-0 bullets", () => {
  const md = renderMarkdownPatterns(PATTERNS);
  assert.match(md, /^# loomlog patterns — 2026-05-11 \.\. 2026-06-09\n/);
  assert.ok(noLineStartsWithSpace(md), `unexpected leading whitespace:\n${md}`);
  assert.match(md, /\n- loomlog: 400m \(67%\) ▲\+90m\n/); // project row + inline trend mover
});

test("patterns surfaces #1 trend, #2 agent-fit, #3 shipping, #4 blockers — all 0-token", () => {
  for (const out of [renderPatterns(PATTERNS), renderMarkdownPatterns(PATTERNS)]) {
    // #1 trend headline + per-project movers
    assert.match(out, /前期間比 \+25% \(480m→600m\)/);
    assert.match(out, /▲\+90m/); // loomlog rose
    assert.match(out, /▼-40m/); // infra fell
    assert.match(out, /old-proj/); // worked on last period, not this one
    // #2 agent fit — what each agent is used for
    assert.match(out, /claude-code が主軸。codex は補助的。/);
    assert.match(out, /テスト・リファクタ/); // codex's profile
    // #3 shipping — output volume + friction, no misleading per-session rate
    assert.match(out, /4 コミット \/ 10 稼働日、詰まりの重い日 2026-06-08 \(失敗6回\)。/);
    assert.doesNotMatch(out, /出荷率/); // the granularity-sensitive % was intentionally dropped
    // #4 recurring blockers — overview is compact (count + state + command); prose is in --blockers
    assert.match(out, /未解決 1件 \/ 解消 1件。/); // count summary lead
    assert.match(out, /×4/); // failure count
    assert.match(out, /go test/); // the command that failed
    assert.match(out, /未解決/); // unresolved state
    assert.match(out, /解消/); // resolved state (npm run build)
    // existing leads still present
    assert.match(out, /loomlog が最多 \(67%\)、上位2件で 100%。/);
    assert.match(out, /2026-06-09 が最多 \(120分\)、稼働 10日。/);
  }
});

test("--blockers focused view: plain-language sentence (intent + what failed + status) + error", () => {
  for (const out of [renderPatterns(PATTERNS, { blockersOnly: true }), renderMarkdownPatterns(PATTERNS, { blockersOnly: true })]) {
    assert.match(out, /## 詰まり/);
    // reads like a journal line, framed by what the user was doing
    assert.match(out, /「テストを直す」中に go test が 4回失敗、未解決のまま。/);
    assert.match(out, /「ビルドを通す」中に npm run build が 2回失敗、その後解消。/);
    assert.match(out, /FAIL: TestFoo — undefined: bar/); // the error as evidence
    // only the 詰まり section
    assert.doesNotMatch(out, /エージェント使い分け/);
    assert.doesNotMatch(out, /プロジェクト別/);
    assert.doesNotMatch(out, /ペース/);
  }
});

test("patterns flags a blocker only when it recurs (>= 2), never a one-off", () => {
  // a single failure must not be reported as a 詰まり
  const oneOff: PatternsData = { ...PATTERNS, blockers: [{ sig: "rm", sample: "rm -rf x", intent: "掃除", count: 1, sessions: 1, projects: ["loomlog"], resolved: false }].filter((b) => b.count >= 2) };
  const out = renderPatterns(oneOff);
  assert.doesNotMatch(out, /rm/);
  assert.match(out, /再発した失敗はなし。/); // all-clear lead
});

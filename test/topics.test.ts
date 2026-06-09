import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTopics } from "../src/topics.ts";
import type { SessionRecord } from "../src/types.ts";

function rec(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "s1",
    agent: "claude-code",
    project: "proj",
    cwd: "~/proj",
    date: "2026-06-08",
    start: "2026-06-08T12:00:00.000Z",
    end: "2026-06-08T12:30:00.000Z",
    activeMin: 30,
    intent: "",
    files: [],
    commandCount: 0,
    commandCats: {},
    tools: [],
    errorCount: 0,
    commits: [],
    sourcePath: "~/.claude/x.jsonl",
    schemaVersion: 2,
    ...over,
  };
}

test("concept keyword (English) from intent", () => {
  assert.ok(extractTopics(rec({ intent: "set up the MCP server" })).includes("mcp"));
});

test("concept keyword (Japanese) from intent", () => {
  assert.ok(extractTopics(rec({ intent: "認証まわりを実装する" })).includes("auth"));
});

test("language/stack from file extension", () => {
  assert.ok(extractTopics(rec({ files: ["app/main.py"] })).includes("python"));
  assert.ok(extractTopics(rec({ files: ["src/store.ts"] })).includes("typescript"));
});

test("well-known filenames map to stack/infra", () => {
  assert.ok(extractTopics(rec({ files: ["Dockerfile"] })).includes("docker"));
  assert.ok(extractTopics(rec({ files: [".github/workflows/ci.yml"] })).includes("ci"));
});

test("tooling from command categories", () => {
  assert.ok(extractTopics(rec({ commandCats: { docker: 2 } })).includes("docker"));
});

test("concept keywords from commit subjects", () => {
  const t = extractTopics(rec({ commits: ["fix: redact tokens before write"] }));
  assert.ok(t.includes("bug"), "fix → bug");
  assert.ok(t.includes("security"), "redact → security");
});

test("short ASCII terms respect word boundaries (no false positives)", () => {
  // "decide" must not trigger #ci; "guidance" must not trigger #ui.
  assert.deepEqual(extractTopics(rec({ intent: "decide guidance later" })), []);
});

test("common no-signal commands (git) do not become topics", () => {
  assert.deepEqual(extractTopics(rec({ commandCats: { git: 5, ls: 2 } })), []);
});

test("results are de-duplicated and capped at 6", () => {
  const t = extractTopics(
    rec({
      intent: "mcp auth api docker kubernetes ci test refactor performance security design",
      files: ["a.py", "b.rs"],
    }),
  );
  assert.ok(t.length <= 6, `expected <= 6, got ${t.length}`);
  assert.equal(new Set(t).size, t.length, "no duplicates");
});

test("no recognizable signal yields no topics", () => {
  assert.deepEqual(extractTopics(rec({ intent: "do a thing" })), []);
});

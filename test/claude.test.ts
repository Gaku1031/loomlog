import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseClaudeTranscript } from "../src/adapters/claude.ts";

function fixture(lines: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), "loomlog-claude-"));
  const path = join(dir, "session.jsonl");
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return path;
}

test("claude adapter: intent, commands, files, tools, blockers", async () => {
  const path = fixture([
    // system-reminder pseudo-prompt — must be skipped
    { type: "user", timestamp: "2026-06-08T12:00:00.000Z", sessionId: "s1", cwd: "/home/u/proj", message: { role: "user", content: "<system-reminder>noise</system-reminder>" } },
    // genuine prompt
    { type: "user", timestamp: "2026-06-08T12:00:01.000Z", sessionId: "s1", cwd: "/home/u/proj", message: { role: "user", content: "add unit tests" } },
    // follow-up prompt in the same transcript
    { type: "user", timestamp: "2026-06-08T12:00:01.500Z", sessionId: "s1", cwd: "/home/u/proj", message: { role: "user", content: "cover the edge case too" } },
    { type: "assistant", timestamp: "2026-06-08T12:00:02.000Z", message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command: "npm test" } }] } },
    { type: "assistant", timestamp: "2026-06-08T12:00:03.000Z", message: { role: "assistant", content: [{ type: "tool_use", name: "Edit", input: { file_path: "/home/u/proj/src/x.ts" } }] } },
    { type: "assistant", timestamp: "2026-06-08T12:00:03.500Z", message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command: 'git commit -m "test: add unit tests"' } }] } },
    // failed tool result → one blocker
    { type: "user", timestamp: "2026-06-08T12:00:04.000Z", message: { role: "user", content: [{ type: "tool_result", is_error: true, content: "boom" }] } },
  ]);

  const rec = await parseClaudeTranscript(path);
  assert.ok(rec);
  assert.equal(rec!.agent, "claude-code");
  assert.equal(rec!.project, "proj");
  assert.equal(rec!.intent, "add unit tests");
  assert.deepEqual(rec!.prompts, ["add unit tests", "cover the edge case too"]);
  assert.equal(rec!.commandCount, 2);
  assert.equal(rec!.commandCats.npm, 1);
  assert.equal(rec!.commandCats.git, 1);
  assert.deepEqual(rec!.commits, ["test: add unit tests"]);
  assert.deepEqual(rec!.files, ["src/x.ts"]);
  assert.deepEqual(rec!.tools, ["Bash", "Edit"]);
  assert.equal(rec!.errorCount, 1);
  assert.equal(rec!.id, "s1");
});

test("claude adapter: groups repeated failures into a signed blocker with evidence", async () => {
  const t = (s: string) => `2026-06-08T12:00:${s}.000Z`;
  const path = fixture([
    { type: "user", timestamp: t("00"), sessionId: "s2", cwd: "/home/u/proj", message: { role: "user", content: "fix the build" } },
    // `go test` fails twice (different paths → same signature) = a recurring blocker
    { type: "assistant", timestamp: t("01"), message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "go test ./internal/..." } }] } },
    { type: "user", timestamp: t("02"), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "FAIL" }] } },
    { type: "assistant", timestamp: t("03"), message: { role: "assistant", content: [{ type: "tool_use", id: "t2", name: "Bash", input: { command: "go test ./pkg/foo -run TestX" } }] } },
    { type: "user", timestamp: t("04"), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", is_error: true, content: "FAIL" }] } },
    // a one-off failure of a different command
    { type: "assistant", timestamp: t("05"), message: { role: "assistant", content: [{ type: "tool_use", id: "t3", name: "Bash", input: { command: "npm ci" } }] } },
    { type: "user", timestamp: t("06"), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t3", is_error: true, content: "err" }] } },
  ]);

  const rec = await parseClaudeTranscript(path);
  assert.ok(rec);
  assert.equal(rec!.errorCount, 3);
  const goTest = rec!.blockers!.find((b) => b.sig === "go test");
  assert.ok(goTest, `expected a "go test" blocker in ${JSON.stringify(rec!.blockers)}`);
  assert.equal(goTest!.count, 2); // both go-test runs failed → recurs
  assert.match(goTest!.sample, /go test/); // evidence preserved for verification
  assert.equal(rec!.blockers!.find((b) => b.sig === "npm ci")!.count, 1); // one-off captured (recurrence judged later)
  assert.equal(rec!.blockers![0]!.sig, "go test"); // most-failed first
});

test("claude adapter: failures of navigation / probe / interactive tools are NOT blockers", async () => {
  const t = (s: string) => `2026-06-08T12:00:${s}.000Z`;
  const path = fixture([
    { type: "user", timestamp: t("00"), sessionId: "s3", cwd: "/home/u/proj", message: { role: "user", content: "look around" } },
    // a Read that errored (file not found while exploring) — noise, not a 詰まり
    { type: "assistant", timestamp: t("01"), message: { role: "assistant", content: [{ type: "tool_use", id: "r1", name: "Read", input: { file_path: "/home/u/proj/missing.ts" } }] } },
    { type: "user", timestamp: t("02"), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "r1", is_error: true, content: "not found" }] } },
    // a `cd` that failed — noise
    { type: "assistant", timestamp: t("03"), message: { role: "assistant", content: [{ type: "tool_use", id: "c1", name: "Bash", input: { command: "cd nope" } }] } },
    { type: "user", timestamp: t("04"), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", is_error: true, content: "no such dir" }] } },
    // a real build failure — IS a blocker
    { type: "assistant", timestamp: t("05"), message: { role: "assistant", content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command: "npm run build" } }] } },
    { type: "user", timestamp: t("06"), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "b1", is_error: true, content: "build failed" }] } },
  ]);

  const rec = await parseClaudeTranscript(path);
  assert.ok(rec);
  assert.equal(rec!.errorCount, 3); // all three count as raw errors
  const sigs = rec!.blockers!.map((b) => b.sig);
  assert.deepEqual(sigs, ["npm run build"]); // only the real build failure is a blocker
});

test("claude adapter: captures the error excerpt and marks a fail→pass as resolved", async () => {
  const t = (s: string) => `2026-06-08T12:00:${s}.000Z`;
  const path = fixture([
    { type: "user", timestamp: t("00"), sessionId: "s4", cwd: "/home/u/proj", message: { role: "user", content: "fix tests" } },
    // go test fails twice, then passes → recurring but resolved, with the error captured
    { type: "assistant", timestamp: t("01"), message: { role: "assistant", content: [{ type: "tool_use", id: "g1", name: "Bash", input: { command: "go test ./..." } }] } },
    { type: "user", timestamp: t("02"), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "g1", is_error: true, content: "--- FAIL: TestX\n  undefined: dedupe" }] } },
    { type: "assistant", timestamp: t("03"), message: { role: "assistant", content: [{ type: "tool_use", id: "g2", name: "Bash", input: { command: "go test ./..." } }] } },
    { type: "user", timestamp: t("04"), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "g2", is_error: true, content: "--- FAIL: TestX\n  still undefined: dedupe" }] } },
    { type: "assistant", timestamp: t("05"), message: { role: "assistant", content: [{ type: "tool_use", id: "g3", name: "Bash", input: { command: "go test ./..." } }] } },
    { type: "user", timestamp: t("06"), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "g3", content: "ok  proj  0.2s" }] } }, // success (no is_error)
  ]);

  const rec = await parseClaudeTranscript(path);
  const b = rec!.blockers!.find((x) => x.sig === "go test")!;
  assert.equal(b.count, 2); // two failures
  assert.equal(b.resolved, true); // it passed afterwards
  assert.match(b.detail!, /undefined: dedupe/); // the "why" — most-specific (last) error line
});

test("claude adapter: returns null when there are no timestamps", async () => {
  const path = fixture([{ type: "summary", summary: "x" }]);
  assert.equal(await parseClaudeTranscript(path), null);
});

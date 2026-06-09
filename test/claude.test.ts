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

test("claude adapter: returns null when there are no timestamps", async () => {
  const path = fixture([{ type: "summary", summary: "x" }]);
  assert.equal(await parseClaudeTranscript(path), null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCodexRollout } from "../src/adapters/codex.ts";

function fixture(lines: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), "loomlog-codex-"));
  const path = join(dir, "rollout-test.jsonl");
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return path;
}

test("codex adapter: counts shell_command, detects Exit-code errors, extracts apply_patch files", async () => {
  const path = fixture([
    { type: "session_meta", timestamp: "2026-06-08T12:00:00.000Z", payload: { id: "abc", cwd: "/home/u/proj" } },
    // synthetic preamble — must be skipped, not used as intent
    { type: "response_item", timestamp: "2026-06-08T12:00:01.000Z", payload: { type: "message", role: "user", content: "<user_instructions>be nice</user_instructions>" } },
    // real request — content is an array of text blocks
    { type: "response_item", timestamp: "2026-06-08T12:00:02.000Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "fix the auth bug" }] } },
    // newer shell_command form (command is a plain string)
    { type: "response_item", timestamp: "2026-06-08T12:00:03.000Z", payload: { type: "function_call", name: "shell_command", arguments: JSON.stringify({ command: "git status", workdir: "/home/u/proj" }) } },
    // older shell form (command is an argv array)
    { type: "response_item", timestamp: "2026-06-08T12:00:04.000Z", payload: { type: "function_call", name: "shell", arguments: JSON.stringify({ command: ["npm", "test"] }) } },
    // a commit — its subject must be captured
    { type: "response_item", timestamp: "2026-06-08T12:00:04.500Z", payload: { type: "function_call", name: "shell_command", arguments: JSON.stringify({ command: 'git commit -m "fix: auth bug"' }) } },
    // newer plain-text failure output
    { type: "response_item", timestamp: "2026-06-08T12:00:05.000Z", payload: { type: "function_call_output", output: "Exit code: 1\nWall time: 0.2 seconds\nOutput:\nboom" } },
    // older structured success output (must NOT count as error)
    { type: "response_item", timestamp: "2026-06-08T12:00:06.000Z", payload: { type: "function_call_output", output: JSON.stringify({ metadata: { exit_code: 0 } }) } },
    // apply_patch as custom_tool_call (the real-world shape)
    { type: "response_item", timestamp: "2026-06-08T12:00:07.000Z", payload: { type: "custom_tool_call", name: "apply_patch", input: "*** Begin Patch\n*** Update File: src/auth.ts\n@@\n-old\n+new\n*** End Patch" } },
  ]);

  const rec = await parseCodexRollout(path);
  assert.ok(rec);
  assert.equal(rec!.agent, "codex");
  assert.equal(rec!.project, "proj");
  assert.equal(rec!.intent, "fix the auth bug");
  assert.equal(rec!.commandCount, 3);
  assert.equal(rec!.commandCats.git, 2); // git status + git commit
  assert.equal(rec!.commandCats.npm, 1);
  assert.equal(rec!.errorCount, 1); // only the Exit code: 1, not the exit_code: 0
  assert.deepEqual(rec!.commits, ["fix: auth bug"]);
  assert.deepEqual(rec!.files, ["src/auth.ts"]);
  assert.ok(rec!.tools.includes("apply_patch"));
  assert.ok(rec!.tools.includes("shell_command"));
  assert.ok(rec!.cwd.startsWith("/home/u/proj") || rec!.cwd.startsWith("~")); // homeShorten only if under $HOME
});

test("codex adapter: returns null for an empty log", async () => {
  const path = fixture([]);
  assert.equal(await parseCodexRollout(path), null);
});

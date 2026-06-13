import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wireClaudeHook } from "../src/init.ts";

function settingsFile(initial: unknown = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "loomlog-init-"));
  const path = join(dir, "settings.json");
  writeFileSync(path, JSON.stringify(initial));
  return path;
}

function stopCommand(path: string): string {
  const data = JSON.parse(readFileSync(path, "utf8"));
  return data.hooks.Stop.at(-1).hooks[0].command;
}

test("wireClaudeHook single-quotes the vault path (no shell injection via $/backtick)", () => {
  const path = settingsFile();
  const r = wireClaudeHook(path, "/weird/$(touch pwned)/`x`/'q");
  assert.equal(r, "added");
  const cmd = stopCommand(path);
  // Single-quoted form, never the old JSON double-quoted form.
  assert.ok(cmd.startsWith("loomlog capture --hook --vault '"), cmd);
  assert.ok(!cmd.includes('--vault "'), cmd);
  // The embedded single quote is POSIX-escaped as '\'' so it can't terminate the argument early.
  assert.ok(cmd.includes(`'\\''q'`), cmd);
  assert.ok(cmd.endsWith("2>/dev/null || true"), cmd);
});

test("wireClaudeHook is idempotent and preserves existing Stop hooks", () => {
  const path = settingsFile({ hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: "echo keep" }] }] } });
  assert.equal(wireClaudeHook(path, "/vault"), "added");
  assert.equal(wireClaudeHook(path, "/vault"), "exists");
  const data = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(data.hooks.Stop.length, 2);
  assert.ok(JSON.stringify(data.hooks.Stop).includes("echo keep"));
});

test("wireClaudeHook reports a missing settings file", () => {
  assert.equal(wireClaudeHook(join(tmpdir(), "does-not-exist-loomlog", "settings.json")), "no-file");
});

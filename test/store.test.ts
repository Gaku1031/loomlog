import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureSession } from "../src/store.ts";
import type { SessionRecord } from "../src/types.ts";

function vault(): string {
  return mkdtempSync(join(tmpdir(), "loomlog-store-"));
}

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
    intent: "do a thing",
    files: ["src/a.ts"],
    commandCount: 2,
    commandCats: { git: 2 },
    tools: ["Bash"],
    errorCount: 0,
    commits: [],
    sourcePath: "~/.claude/x.jsonl",
    schemaVersion: 1,
    ...over,
  };
}

test("captureSession is idempotent (same session re-captured stays single)", () => {
  const v = vault();
  const first = captureSession(v, rec());
  assert.equal(first.alreadyIngested, false);
  const second = captureSession(v, rec({ activeMin: 45 }));
  assert.equal(second.alreadyIngested, true);

  const day = JSON.parse(readFileSync(join(v, ".loomlog", "days", "2026-06-08.json"), "utf8"));
  assert.equal(Object.keys(day.sessions).length, 1);
  assert.equal(day.sessions["claude-code:s1"].activeMin, 45); // upsert applied
});

test("same id across different agents does not overwrite (agent-namespaced key)", () => {
  const v = vault();
  captureSession(v, rec({ id: "dup", agent: "claude-code" }));
  captureSession(v, rec({ id: "dup", agent: "codex" }));

  const day = JSON.parse(readFileSync(join(v, ".loomlog", "days", "2026-06-08.json"), "utf8"));
  assert.deepEqual(Object.keys(day.sessions).sort(), ["claude-code:dup", "codex:dup"]);
});

test("renders Daily and Projects markdown", () => {
  const v = vault();
  captureSession(v, rec());
  assert.ok(existsSync(join(v, "Daily", "2026-06-08.md")));
  const proj = readFileSync(join(v, "Projects", "proj.md"), "utf8");
  assert.match(proj, /# proj/);
  const daily = readFileSync(join(v, "Daily", "2026-06-08.md"), "utf8");
  assert.match(daily, /意図: do a thing/);
});

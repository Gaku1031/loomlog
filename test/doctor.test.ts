import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectVault, runDoctor, renderDoctor } from "../src/doctor.ts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "loomlog-doctor-"));
}

/** Write a minimal day file so a vault counts as "initialized with N sessions". */
function seedVault(vault: string, date: string, sessionIds: string[]): void {
  const days = join(vault, ".loomlog", "days");
  mkdirSync(days, { recursive: true });
  const sessions: Record<string, unknown> = {};
  for (const id of sessionIds) sessions[`claude-code:${id}`] = { id, date };
  writeFileSync(join(days, `${date}.json`), JSON.stringify({ date, sessions }));
}

test("inspectVault: empty path is uninitialized with no sessions", () => {
  const info = inspectVault(join(tmp(), "nope"));
  assert.equal(info.initialized, false);
  assert.equal(info.sessions, 0);
  assert.equal(info.lastDate, null);
});

test("inspectVault: counts sessions and finds the latest date", () => {
  const v = tmp();
  seedVault(v, "2026-06-01", ["a", "b"]);
  seedVault(v, "2026-06-10", ["c"]);
  const info = inspectVault(v);
  assert.equal(info.initialized, true);
  assert.equal(info.sessions, 3);
  assert.equal(info.lastDate, "2026-06-10");
});

test("runDoctor: uninitialized active vault is a hard failure", () => {
  const v = join(tmp(), "missing");
  const r = runDoctor({ vault: v });
  const vaultCheck = r.checks.find((c) => c.label === "vault");
  assert.equal(vaultCheck?.status, "fail");
  assert.equal(r.ok, false);
});

test("runDoctor: a populated vault passes the vault check", () => {
  const v = tmp();
  seedVault(v, "2026-06-10", ["a"]);
  const r = runDoctor({ vault: v });
  assert.equal(r.checks.find((c) => c.label === "vault")?.status, "ok");
});

test("runDoctor: surfaces a logged Stop-hook error as a warning", () => {
  const v = tmp();
  seedVault(v, "2026-06-10", ["a"]);
  writeFileSync(join(v, ".loomlog", "hook.log"), "2026-06-10T00:00:00.000Z capture --hook failed: boom\n");
  const r = runDoctor({ vault: v });
  assert.equal(r.checks.find((c) => c.label === "hook errors")?.status, "warn");
});

test("renderDoctor: shows hints for non-ok checks only", () => {
  const v = join(tmp(), "missing");
  const out = renderDoctor(runDoctor({ vault: v }));
  assert.match(out, /loomlog doctor/);
  assert.match(out, /✗ vault:/);
  assert.match(out, /loomlog init/); // the fail hint is rendered
});

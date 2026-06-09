import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, rangeDates, activeMinutes, commandCategory, homeShorten, isValidDate } from "../src/util.ts";
import { homedir } from "node:os";

test("addDays crosses month/year boundaries", () => {
  assert.equal(addDays("2026-01-31", 1), "2026-02-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("rangeDates is inclusive and ordered", () => {
  assert.deepEqual(rangeDates("2026-06-06", "2026-06-08"), ["2026-06-06", "2026-06-07", "2026-06-08"]);
  assert.deepEqual(rangeDates("2026-06-08", "2026-06-08"), ["2026-06-08"]);
});

test("activeMinutes ignores idle gaps over the cap", () => {
  const base = Date.parse("2026-06-08T00:00:00.000Z");
  const ts = [0, 60_000, 120_000, 3_600_000].map((d) => new Date(base + d).toISOString());
  // gaps: 1m, 1m, (59m ignored) → 2m active
  assert.equal(activeMinutes(ts), 2);
  assert.equal(activeMinutes([]), 0);
  assert.equal(activeMinutes([new Date(base).toISOString()]), 0);
});

test("commandCategory strips env/sudo/path and operators", () => {
  assert.equal(commandCategory("FOO=bar sudo /usr/bin/git commit"), "git");
  assert.equal(commandCategory("npm install"), "npm");
  assert.equal(commandCategory("ls -la; rm x"), "ls");
  assert.equal(commandCategory("   "), "?");
});

test("homeShorten replaces $HOME with ~", () => {
  assert.equal(homeShorten(homedir() + "/proj/x"), "~/proj/x");
  assert.equal(homeShorten(homedir()), "~");
  assert.equal(homeShorten("/etc/passwd"), "/etc/passwd");
});

test("isValidDate rejects impossible dates", () => {
  assert.ok(isValidDate("2026-06-08"));
  assert.ok(!isValidDate("2026-13-01"));
  assert.ok(!isValidDate("2026-02-30"));
  assert.ok(!isValidDate("2026-6-8"));
  assert.ok(!isValidDate("yesterday"));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCronLine,
  buildLaunchdPlist,
  buildScheduledTaskPS,
  CRON_MARKER,
  fmtTime,
  LAUNCHD_LABEL,
  parseTimeOfDay,
  preferVoltaShim,
  TASK_NAME,
  upsertCronLines,
  type ScheduleSpec,
} from "../src/schedule.ts";

function spec(over: Partial<ScheduleSpec> = {}): ScheduleSpec {
  return {
    node: "/usr/local/bin/node",
    script: "/opt/loomlog/dist/cli.js",
    vault: "/Users/me/loomlog",
    hour: 13,
    minute: 0,
    ...over,
  };
}

test("parseTimeOfDay accepts valid 24h times and zero-pads on format", () => {
  assert.deepEqual(parseTimeOfDay("13:00"), { hour: 13, minute: 0 });
  assert.deepEqual(parseTimeOfDay("00:05"), { hour: 0, minute: 5 });
  assert.deepEqual(parseTimeOfDay("9:30"), { hour: 9, minute: 30 });
  assert.deepEqual(parseTimeOfDay("23:59"), { hour: 23, minute: 59 });
  assert.equal(fmtTime(9, 5), "09:05");
});

test("parseTimeOfDay rejects junk and out-of-range values", () => {
  for (const bad of ["24:00", "13:60", "noon", "13", "13:0", "-1:00", "13:5"]) {
    assert.throws(() => parseTimeOfDay(bad), /HH:MM/, `should reject "${bad}"`);
  }
});

test("buildLaunchdPlist bakes node+script+vault and the catch-up keys", () => {
  const p = buildLaunchdPlist(spec());
  assert.match(p, new RegExp(`<string>${LAUNCHD_LABEL}</string>`));
  // ProgramArguments, in order: node, script, scan, all, --vault, vault
  for (const a of ["/usr/local/bin/node", "/opt/loomlog/dist/cli.js", "scan", "all", "--vault", "/Users/me/loomlog"]) {
    assert.match(p, new RegExp(`<string>${a.replace(/[/.]/g, "\\$&")}</string>`));
  }
  assert.match(p, /<key>RunAtLoad<\/key>\s*<true\/>/); // runs at login too
  assert.match(p, /<key>Hour<\/key>\s*<integer>13<\/integer>/);
  assert.match(p, /<key>Minute<\/key>\s*<integer>0<\/integer>/);
  assert.match(p, /LOOMLOG_VAULT/);
  // node's dir leads PATH so a child `env node` resolves without a login shell
  assert.match(p, /<string>\/usr\/local\/bin:/);
});

test("buildLaunchdPlist XML-escapes paths containing special chars", () => {
  const p = buildLaunchdPlist(spec({ vault: "/tmp/a & b/<vault>" }));
  assert.match(p, /\/tmp\/a &amp; b\/&lt;vault&gt;/);
  assert.doesNotMatch(p, /a & b/); // raw ampersand would be invalid XML
});

test("buildCronLine is a single line: schedule, absolute node+script, vault, marker", () => {
  const line = buildCronLine(spec({ hour: 13, minute: 5 }));
  assert.ok(!line.includes("\n"), "must be one line");
  assert.match(line, /^5 13 \* \* \* /); // minute hour * * *
  assert.match(line, /"\/usr\/local\/bin\/node" "\/opt\/loomlog\/dist\/cli\.js" scan all --vault "\/Users\/me\/loomlog"/);
  assert.ok(line.endsWith(CRON_MARKER), "tagged with the marker for idempotent upsert");
});

test("upsertCronLines: added when empty, preserves unrelated lines", () => {
  const line = buildCronLine(spec());
  const { lines, changed } = upsertCronLines(["0 * * * * other-job"], line);
  assert.equal(changed, "added");
  assert.deepEqual(lines, ["0 * * * * other-job", line]);
});

test("upsertCronLines: exists when identical loomlog line already present", () => {
  const line = buildCronLine(spec());
  const { lines, changed } = upsertCronLines(["x", line], line);
  assert.equal(changed, "exists");
  assert.deepEqual(lines, ["x", line]); // unchanged → caller skips writing
});

test("upsertCronLines: updated replaces a differing loomlog line, keeps the rest", () => {
  const oldLine = buildCronLine(spec({ hour: 22 }));
  const newLine = buildCronLine(spec({ hour: 13 }));
  const { lines, changed } = upsertCronLines(["keep-me", oldLine, "keep-me-2"], newLine);
  assert.equal(changed, "updated");
  assert.deepEqual(lines, ["keep-me", "keep-me-2", newLine]);
});

test("buildScheduledTaskPS registers a daily catch-up task with node+script", () => {
  const ps = buildScheduledTaskPS(spec({ hour: 13, minute: 0 }));
  assert.match(ps, /Register-ScheduledTask/);
  assert.match(ps, new RegExp(`-TaskName '${TASK_NAME}'`));
  assert.match(ps, /-StartWhenAvailable/); // catches up a missed start
  assert.match(ps, /New-ScheduledTaskTrigger -Daily -At '13:00'/);
  assert.match(ps, /-Execute '\/usr\/local\/bin\/node'/);
  assert.match(ps, /scan all --vault/);
  assert.match(ps, /-Force/); // idempotent re-register
});

test("buildScheduledTaskPS doubles embedded single quotes (PowerShell escaping)", () => {
  const ps = buildScheduledTaskPS(spec({ vault: "/tmp/o'brien" }));
  assert.match(ps, /o''brien/);
});

test("preferVoltaShim swaps a Volta image path for the version-independent shim", () => {
  const home = "/Users/me";
  const image = "/Users/me/.volta/tools/image/node/22.15.0/bin/node";
  const shim = "/Users/me/.volta/bin/node";
  const got = preferVoltaShim(image, { home, platform: "darwin", env: {}, exists: (p) => p === shim });
  assert.equal(got, shim);
});

test("preferVoltaShim falls back to execPath when the shim is missing", () => {
  const image = "/Users/me/.volta/tools/image/node/22.15.0/bin/node";
  const got = preferVoltaShim(image, { home: "/Users/me", platform: "darwin", env: {}, exists: () => false });
  assert.equal(got, image, "no shim on disk → keep the resolved binary");
});

test("preferVoltaShim leaves a non-Volta node path untouched (e.g. nvm/system)", () => {
  for (const p of ["/usr/local/bin/node", "/Users/me/.nvm/versions/node/v20.11.0/bin/node"]) {
    const got = preferVoltaShim(p, { home: "/Users/me", platform: "darwin", env: {}, exists: () => true });
    assert.equal(got, p);
  }
});

test("preferVoltaShim honors VOLTA_HOME override", () => {
  const image = "/opt/volta/tools/image/node/22.15.0/bin/node";
  const shim = "/opt/volta/bin/node";
  const got = preferVoltaShim(image, { home: "/Users/me", platform: "linux", env: { VOLTA_HOME: "/opt/volta" }, exists: (p) => p === shim });
  assert.equal(got, shim);
});
// (The win32 branch — node.exe under %LOCALAPPDATA%\Volta — is correct on real Windows but not
//  unit-testable here: node:path uses posix join/sep on the macOS test host.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, rangeDates, activeMinutes, commandCategory, homeShorten, isValidDate, extractCommits } from "../src/util.ts";
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

test("extractCommits pulls subject lines from every quoting form", () => {
  assert.deepEqual(extractCommits('git commit -m "feat: add X"'), ["feat: add X"]);
  assert.deepEqual(extractCommits("git commit -am 'fix: Y'"), ["fix: Y"]);
  assert.deepEqual(extractCommits("git commit -m $'chore: z\\nbody'"), ["chore: z"]);
  // heredoc with a multi-line body → first line only
  assert.deepEqual(
    extractCommits("git commit -m \"$(cat <<'EOF'\nfeat: heredoc subject\n\nlong body\nEOF\n)\""),
    ["feat: heredoc subject"],
  );
  // not a commit / no message
  assert.deepEqual(extractCommits("git status"), []);
  assert.deepEqual(extractCommits("npm test"), []);
  // a literal "git commit" inside another command's quoted arg is NOT an invocation
  assert.deepEqual(extractCommits('echo "git commit -m x"'), []);
  assert.deepEqual(extractCommits('grep -n "git commit" file'), []);
  assert.deepEqual(extractCommits('rg "git commit -m" .'), []);
  // a real invocation at a command boundary (after &&, with an env prefix) still fires
  assert.deepEqual(extractCommits('cd /foo && git commit -m "real"'), ["real"]);
  assert.deepEqual(extractCommits('GIT_AUTHOR=x git commit -m "env prefix"'), ["env prefix"]);
});

test("isValidDate rejects impossible dates", () => {
  assert.ok(isValidDate("2026-06-08"));
  assert.ok(!isValidDate("2026-13-01"));
  assert.ok(!isValidDate("2026-02-30"));
  assert.ok(!isValidDate("2026-6-8"));
  assert.ok(!isValidDate("yesterday"));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFlags, validateDateFlags } from "../src/args.ts";

test("parses positionals, value flags, and booleans", () => {
  const { positional, flags } = parseFlags(["codex", "--vault", "/v", "--json", "-w"]);
  assert.deepEqual(positional, ["codex"]);
  assert.equal(flags.vault, "/v");
  assert.equal(flags.json, "true");
  assert.equal(flags.week, "true");
});

test("supports --flag=value form", () => {
  const { flags } = parseFlags(["--date=2026-06-08", "--project=loomlog"]);
  assert.equal(flags.date, "2026-06-08");
  assert.equal(flags.project, "loomlog");
});

test("errors when a value flag is missing its value", () => {
  assert.throws(() => parseFlags(["--date", "--json"]), /--date needs a value/);
  assert.throws(() => parseFlags(["--vault"]), /--vault needs a value/);
});

test("errors on unknown flags (typos)", () => {
  assert.throws(() => parseFlags(["--weak"]), /unknown flag --weak/);
});

test("validateDateFlags rejects bad dates and inverted ranges", () => {
  assert.throws(() => validateDateFlags({ date: "2026-13-01" }), /real YYYY-MM-DD/);
  assert.throws(() => validateDateFlags({ since: "2026-06-09", until: "2026-06-01" }), /after --until/);
  assert.doesNotThrow(() => validateDateFlags({ since: "2026-06-01", until: "2026-06-09" }));
  assert.doesNotThrow(() => validateDateFlags({}));
});

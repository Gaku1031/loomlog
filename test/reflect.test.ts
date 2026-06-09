import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureSession } from "../src/store.ts";
import { buildPatterns, buildReport } from "../src/report.ts";
import { buildReflection, saveReflection, isTemplate, FRAMEWORKS } from "../src/reflect.ts";
import type { SessionRecord } from "../src/types.ts";

function seedVault(): string {
  const v = mkdtempSync(join(tmpdir(), "loomlog-reflect-"));
  const base: SessionRecord = {
    id: "s1", agent: "codex", project: "proj", cwd: "~/proj",
    date: "2026-06-08", start: "2026-06-08T01:00:00.000Z", end: "2026-06-08T03:00:00.000Z",
    activeMin: 120, intent: "build the thing", files: ["src/a.ts"],
    prompts: ["build the thing", "review the thing", "ship the thing"],
    commandCount: 10, commandCats: { git: 3, npm: 5, rg: 2 }, tools: ["shell_command"],
    errorCount: 4, commits: ["feat: ship the thing"], sourcePath: "~/.codex/x.jsonl", schemaVersion: 1,
  };
  captureSession(v, base);
  captureSession(v, { ...base, id: "s2", agent: "claude-code", project: "proj2", activeMin: 30, commandCats: { ls: 1 }, errorCount: 0, commits: [] });
  return v;
}

test("isTemplate guards the five framework ids", () => {
  for (const t of ["wsn", "gibbs", "aar", "kpt", "ywt"]) assert.ok(isTemplate(t));
  assert.ok(!isTemplate("nope"));
});

test("buildPatterns aggregates work types, time split, and commits", () => {
  const v = seedVault();
  const p = buildPatterns(v, { since: "2026-06-01", until: "2026-06-30" });
  assert.equal(p.totals.sessions, 2);
  assert.equal(p.totals.activeMin, 150);
  assert.equal(p.totals.blockers, 4);
  assert.equal(p.totals.commits, 1);
  // npm is the most-frequent command category
  assert.equal(p.workTypes[0]![0], "npm");
  // proj (120m) ranks above proj2 (30m)
  assert.equal(p.projectsByTime[0]!.project, "proj");
  assert.equal(p.projectsByTime[0]!.pct, 80);
  assert.deepEqual(p.agents.map((a) => a.agent).sort(), ["claude-code", "codex"]);
});

test("tolerates legacy records captured before the commits field existed", () => {
  // A day file written by loomlog 0.1/0.2 — no `commits`, no `schemaVersion`.
  const v = mkdtempSync(join(tmpdir(), "loomlog-legacy-"));
  mkdirSync(join(v, ".loomlog", "days"), { recursive: true });
  const legacy = {
    date: "2026-06-08",
    sessions: {
      "codex:old": {
        id: "old", agent: "codex", project: "proj", cwd: "~/proj",
        date: "2026-06-08", start: "2026-06-08T01:00:00.000Z", end: "2026-06-08T02:00:00.000Z",
        activeMin: 60, intent: "legacy", files: [], commandCount: 1, commandCats: { git: 1 },
        tools: ["shell"], errorCount: 0, sourcePath: "~/.codex/x.jsonl",
      },
    },
  };
  writeFileSync(join(v, ".loomlog", "days", "2026-06-08.json"), JSON.stringify(legacy));
  assert.doesNotThrow(() => buildReport(v, { date: "2026-06-08" }));
  assert.doesNotThrow(() => buildPatterns(v, { since: "2026-06-01", until: "2026-06-30" }));
  const rep = buildReport(v, { date: "2026-06-08" });
  assert.deepEqual(rep.projects[0]!.commits, []);
});

test("buildReport includes follow-up prompts within a session", () => {
  const v = seedVault();
  const rep = buildReport(v, { date: "2026-06-08", project: "proj" });
  assert.deepEqual(rep.projects[0]!.intents, ["build the thing", "review the thing", "ship the thing"]);
});

test("buildReflection returns facts + the framework's stages", () => {
  const v = seedVault();
  const ctx = buildReflection(v, "wsn", { date: "2026-06-08" });
  assert.equal(ctx.template.id, "wsn");
  assert.match(ctx.template.source, /Borton|Driscoll/);
  assert.ok(ctx.stages.some((s) => s.key === "so_what" && Array.isArray(s.ask)));
  assert.equal(ctx.facts.report.totals.sessions, 2);
  assert.match(ctx.save.command, /reflect-save --date 2026-06-08 --template wsn/);
});

test("gibbs defaults to a weekly scope", () => {
  const v = seedVault();
  const ctx = buildReflection(v, "gibbs", {}); // no explicit scope
  assert.notEqual(ctx.scope.from, ctx.scope.to); // a range, not a single day
  assert.equal(ctx.stages.length, 6);
});

test("saveReflection writes a backlinked note and appends on re-run", () => {
  const v = seedVault();
  const f1 = saveReflection(v, { date: "2026-06-08", template: "wsn", body: "first reflection", projects: ["proj"] });
  assert.ok(existsSync(f1));
  let md = readFileSync(f1, "utf8");
  assert.match(md, /\[\[2026-06-08\]\]/); // backlink to the Daily note
  assert.match(md, /\[\[proj\]\]/);
  assert.match(md, new RegExp(FRAMEWORKS.wsn.name.replace(/[/]/g, ".")));
  assert.match(md, /first reflection/);

  const f2 = saveReflection(v, { date: "2026-06-08", template: "kpt", body: "second reflection" });
  assert.equal(f1, f2); // same date → same file
  md = readFileSync(f2, "utf8");
  assert.match(md, /first reflection/);
  assert.match(md, /second reflection/); // appended, not overwritten
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { redact, redactClip } from "../src/redact.ts";
import { withinRoot } from "../src/scan.ts";
import { isPathWithin, mdSafe, safeFilename } from "../src/util.ts";

test("redacts additional provider secrets and presigned-URL signatures", () => {
  assert.match(redact("sb_secret_" + "a".repeat(24)), /«supabase-secret»/);
  assert.match(redact("sbp_" + "a".repeat(40)), /«supabase-token»/);
  assert.match(redact("lin_api_" + "a".repeat(40)), /«linear-key»/);

  const amz = redact("https://b.s3.amazonaws.com/k?X-Amz-Signature=" + "f".repeat(64) + "&X-Amz-Expires=900");
  assert.match(amz, /X-Amz-Signature=«redacted»/);
  assert.ok(!amz.includes("f".repeat(64)), amz);

  const sas = redact("https://x.blob.core.windows.net/c/f?sv=2024&sig=" + "Z".repeat(43) + "%3D&se=2026");
  assert.match(sas, /[?&]sig=«redacted»/);
  assert.ok(!sas.includes("Z".repeat(43)), sas);

  // A bare `sig=` in prose (not a query param) must not be touched — avoids over-redaction.
  assert.equal(redact("the sig=field was empty"), "the sig=field was empty");
});

test("redactClip catches a secret obfuscated across a newline", () => {
  // Neither line matches on its own (prefix has <16 body chars; body has no prefix);
  // only the de-wrapped join "sk-ant-aaaa…" trips the rule.
  const split = "paste this: sk-ant-\n" + "a".repeat(32) + " — thanks";
  const out = redactClip(split, 200);
  assert.match(out, /«anthropic-key»/, out);
  assert.ok(!/a{16}/.test(out), `secret body leaked: ${out}`);
  // Plain wrapped prose must survive (no false redaction from the de-wrap).
  assert.equal(redactClip("the quick\nbrown fox"), "the quickbrown fox");
});

test("scan containment drops symlinks that escape the log tree", () => {
  const base = mkdtempSync(join(tmpdir(), "loomlog-sec-"));
  try {
    const root = join(base, "root");
    const outside = join(base, "outside");
    mkdirSync(root);
    mkdirSync(outside);
    const real = join(root, "rollout-real.jsonl");
    writeFileSync(real, "{}");
    const target = join(outside, "target.jsonl");
    writeFileSync(target, "{}");
    const escaping = join(root, "rollout-escape.jsonl");
    symlinkSync(target, escaping); // lives in root, points outside it
    assert.deepEqual(withinRoot(root, [real, escaping]), [real]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("safeFilename strips path separators and traversal", () => {
  assert.equal(safeFilename("normal-project"), "normal-project");
  assert.equal(safeFilename(".github"), ".github"); // a single leading dot is fine
  assert.equal(safeFilename(""), "unknown");
  assert.equal(safeFilename("   "), "unknown");
  // No surviving separator or `..` traversal token in the output, whatever goes in.
  for (const evil of ["../../etc/passwd", "..\\..\\windows", "../x", "a/b", "a\\b", "....//x"]) {
    const out = safeFilename(evil);
    assert.ok(!out.includes("/") && !out.includes("\\"), out);
    assert.ok(!out.includes(".."), out);
  }
});

test("mdSafe neutralizes wikilinks and inline-code breakout", () => {
  const out = mdSafe("see [[secret-note]] and `code`");
  assert.ok(!/\[\[/.test(out), out); // no parseable [[ opener survives
  assert.ok(!/\]\]/.test(out), out);
  assert.ok(!out.includes("`"), out); // backticks gone → can't break an inline-code span
  // Readable text is otherwise preserved (zero-width split is invisible).
  assert.ok(out.includes("secret-note") && out.includes("code"), out);
});

test("isPathWithin confines reads to a root (symlinks resolved)", () => {
  const home = homedir();
  const cwd = process.cwd();
  assert.equal(isPathWithin(home, cwd), cwd.startsWith(home)); // cwd is under $HOME in this repo
  assert.equal(isPathWithin(cwd, home), false); // parent is not within child
  // Traversal that escapes the declared root resolves outside it → rejected.
  assert.equal(isPathWithin(join(cwd, "src"), join(cwd, "src", "..", "package.json")), false);
  assert.equal(isPathWithin(cwd, join(cwd, "package.json")), true);
  assert.equal(isPathWithin(cwd, "/no/such/path/here"), false); // non-existent target → false
});

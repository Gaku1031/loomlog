import { test } from "node:test";
import assert from "node:assert/strict";
import { redact, redactClip } from "../src/redact.ts";

test("redacts common provider secrets", () => {
  assert.match(redact("key sk-ant-" + "a".repeat(32)), /«anthropic-key»/);
  assert.match(redact("key sk-" + "a".repeat(32)), /«openai-key»/);
  assert.match(redact("ghp_" + "a".repeat(36)), /«github-token»/);
  assert.match(redact("github_pat_" + "a".repeat(30)), /«github-pat»/);
  assert.match(redact("glpat-" + "a".repeat(20)), /«gitlab-token»/);
  assert.match(redact("npm_" + "a".repeat(36)), /«npm-token»/);
  assert.match(redact("AKIA" + "1234567890ABCDEF"), /«aws-key»/);
  assert.match(redact("ASIA" + "1234567890ABCDEF"), /«aws-key»/);
  assert.match(redact("sk_live_" + "a".repeat(24)), /«stripe-key»/);
  assert.match(redact("hf_" + "a".repeat(34)), /«hf-token»/);
  assert.match(redact("ya29." + "a".repeat(40)), /«google-oauth»/);
});

test("redacts URL-embedded credentials and bearer tokens", () => {
  assert.match(redact("postgres://user:s3cr3tpass@db:5432/x"), /postgres:\/\/user:«redacted»@/);
  assert.match(redact("Authorization: Bearer abcdef0123456789"), /Authorization: Bearer «redacted»/);
});

test("masks the value of sensitive key=value pairs, keeps the key", () => {
  assert.equal(redact("API_KEY=supersecretvalue"), "API_KEY=«redacted»");
  const json = redact('"password": "hunter2"');
  assert.ok(!json.includes("hunter2"), json);
  assert.match(json, /«redacted»/);
});

test("redactClip redacts BEFORE truncating (no leak at the boundary)", () => {
  // Secret straddles the 120-char clip boundary; clipping first would split it and leak.
  const input = "x".repeat(110) + " sk-ant-" + "z".repeat(60);
  const out = redactClip(input, 120);
  assert.ok(!out.includes("sk-"), `leaked secret: ${out}`);
  assert.ok(out.length <= 120);
});

test("redactClip collapses whitespace", () => {
  assert.equal(redactClip("a\n\n  b\tc"), "a b c");
});

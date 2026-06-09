import { test } from "node:test";
import assert from "node:assert/strict";
import { mdToHtml } from "../src/clipboard.ts";

test("mdToHtml maps ATX headings to <hN>", () => {
  const html = mdToHtml("# Title\n\n## Section");
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<h2>Section<\/h2>/);
});

test("mdToHtml groups consecutive bullets into a single <ul>", () => {
  const html = mdToHtml("- one\n- two\n- three");
  assert.equal((html.match(/<ul>/g) ?? []).length, 1);
  assert.equal((html.match(/<\/ul>/g) ?? []).length, 1);
  assert.equal((html.match(/<li>/g) ?? []).length, 3);
});

test("mdToHtml closes the list on a blank line between groups", () => {
  const html = mdToHtml("- a\n\n- b");
  assert.equal((html.match(/<ul>/g) ?? []).length, 2);
});

test("mdToHtml HTML-escapes free text (no markup injection)", () => {
  const html = mdToHtml("- files: <a> && b > c");
  assert.match(html, /<li>files: &lt;a&gt; &amp;&amp; b &gt; c<\/li>/);
  // the escaped angle brackets must not leak a raw tag
  assert.doesNotMatch(html, /<li>files: <a>/);
});

test("mdToHtml does not re-parse inline markdown in content", () => {
  const html = mdToHtml("- 意図: fix *thing* and `code`");
  // literal asterisks/backticks preserved, not turned into <em>/<code>
  assert.match(html, /\*thing\*/);
  assert.match(html, /`code`/);
});

test("mdToHtml emits a UTF-8 charset and preserves Japanese", () => {
  const html = mdToHtml("## 意図\n\n- 日本語のテキスト");
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /意図/);
  assert.match(html, /日本語のテキスト/);
});

test("mdToHtml wraps plain lines in <p>", () => {
  const html = mdToHtml("3 sessions · 42m active");
  assert.match(html, /<p>3 sessions · 42m active<\/p>/);
});

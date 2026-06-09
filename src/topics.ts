import type { SessionRecord } from "./types.ts";

/**
 * Topic extraction — turns one captured session into a small set of `topic/<slug>` strings,
 * mechanically and with zero LLM tokens. The caller renders these as `#topic/<slug>` tags on
 * the daily note and the project MOC; Obsidian draws each tag as a graph node, giving the
 * graph a *third* node type (besides Daily and Project). That is what lets a concept bridge
 * across projects ("mcp shows up in three repos") and turns a Daily↔Project bipartite hairball
 * into something closer to a concept map.
 *
 * Three deterministic signal sources, in descending cross-project bridging value:
 *  1. Concept keywords matched against intent / prompts / commit subjects. Bilingual (EN + JA/
 *     katakana) because intents here are often Japanese while technical tokens stay English.
 *     These recur across unrelated projects, so they are the real bridges.
 *  2. Language / stack inferred from file extensions and a few well-known filenames. Stable
 *     within a project (mild signal) but bridges polyglot work across projects.
 *  3. Tooling / infra inferred from the leading command names (commandCats).
 *
 * The dictionary is intentionally small and curated — it is the natural knob for tuning signal
 * vs. noise. Every slug must be Obsidian-tag-safe: [a-z0-9_-], no spaces, no leading digit.
 */

interface ConceptDef {
  slug: string;
  /** Authored lowercase. ASCII terms match on word boundaries; terms with non-ASCII
   *  characters (Japanese/katakana) match as substrings (CJK has no word boundaries). */
  terms: string[];
}

const CONCEPTS: ConceptDef[] = [
  { slug: "mcp", terms: ["mcp", "model context protocol"] },
  { slug: "agent", terms: ["agent", "subagent", "エージェント", "サブエージェント"] },
  { slug: "llm", terms: ["llm", "prompt", "embedding", "rag", "anthropic", "openai", "claude", "gpt", "gemini", "プロンプト", "トークン"] },
  { slug: "auth", terms: ["auth", "oauth", "login", "jwt", "session token", "認証", "認可", "ログイン", "サインイン"] },
  { slug: "api", terms: ["api", "rest", "graphql", "endpoint", "openapi", "webhook", "エンドポイント"] },
  { slug: "ui", terms: ["frontend", "tailwind", "react", "vue", "svelte", "component", "コンポーネント", "フロントエンド"] },
  { slug: "db", terms: ["postgres", "postgresql", "mysql", "sqlite", "redis", "mongodb", "migration", "schema", "データベース", "マイグレーション", "スキーマ"] },
  { slug: "docker", terms: ["docker", "dockerfile", "compose", "container", "コンテナ"] },
  { slug: "kubernetes", terms: ["kubernetes", "k8s", "kubectl", "helm"] },
  { slug: "ci", terms: ["ci", "cd", "github actions", "workflow", "pipeline", "deploy", "release", "デプロイ", "リリース"] },
  { slug: "test", terms: ["test", "testing", "tdd", "vitest", "jest", "pytest", "playwright", "テスト"] },
  { slug: "refactor", terms: ["refactor", "リファクタ", "リファクタリング"] },
  { slug: "bug", terms: ["bug", "fix", "hotfix", "regression", "バグ", "不具合", "修正"] },
  { slug: "perf", terms: ["performance", "perf", "latency", "optimize", "optimization", "最適化", "レイテンシ", "高速化"] },
  { slug: "security", terms: ["security", "redact", "secret", "credential", "vulnerab", "cve", "脆弱", "秘匿", "セキュリティ"] },
  { slug: "design", terms: ["architecture", "design doc", "設計", "アーキテクチャ", "壁打ち"] },
  { slug: "docs", terms: ["readme", "documentation", "ドキュメント", "ドキュメンテーション"] },
  { slug: "data", terms: ["pandas", "numpy", "dataframe", "analysis", "解析", "データ解析"] },
  { slug: "aws", terms: ["aws", "lambda", "dynamodb", "cloudformation", "cdk", "s3 bucket"] },
  { slug: "obsidian", terms: ["obsidian", "wikilink", "graph view"] },
];

/** Extension → language/stack slug. */
const EXT_TOPIC: Record<string, string> = {
  ts: "typescript", tsx: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python", rs: "rust", go: "go", rb: "ruby", java: "java", kt: "kotlin",
  swift: "swift", c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp", cs: "csharp",
  php: "php", sql: "sql", tf: "terraform", sh: "shell", bash: "shell", zsh: "shell",
  md: "docs", mdx: "docs", css: "css", scss: "css", html: "html", vue: "vue",
};

/** Leading command name → tooling/infra slug. Common, no-signal commands (git, make, cd, ls,
 *  grep, find …) are deliberately absent so they don't become mega-hubs like #area/dev. */
const CMD_TOPIC: Record<string, string> = {
  docker: "docker", "docker-compose": "docker", podman: "docker",
  kubectl: "kubernetes", helm: "kubernetes",
  terraform: "terraform",
  pytest: "test", jest: "test", vitest: "test", mocha: "test", playwright: "test",
  cargo: "rust", go: "go",
  npm: "node", pnpm: "node", yarn: "node", bun: "node", node: "node",
  pip: "python", pip3: "python", poetry: "python", uv: "python", python: "python", python3: "python",
  psql: "db", mysql: "db", "redis-cli": "db", sqlite3: "db", mongo: "db",
};

/** Cap per session so one sprawling prompt can't explode a note into a tag cloud. */
const MAX_TOPICS = 6;

/** True iff `term` occurs in already-lowercased `hay` (word-boundary for ASCII, substring for CJK). */
function termMatches(hay: string, term: string): boolean {
  if (/[^\x00-\x7f]/.test(term)) return hay.includes(term);
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Custom boundaries instead of \b so terms like "ci"/"cd" don't fire inside "decide".
  return new RegExp(`(?:^|[^a-z0-9])${esc}(?:[^a-z0-9]|$)`).test(hay);
}

/** Map a single file path to a language/stack slug (extension + well-known filenames). */
function fileTopic(path: string): string | undefined {
  const lower = path.toLowerCase();
  const base = lower.replace(/^.*\//, "");
  if (lower.includes(".github/workflows")) return "ci";
  if (base === "dockerfile" || base.startsWith("docker-compose")) return "docker";
  if (base === "cargo.toml") return "rust";
  if (base === "pyproject.toml" || base === "requirements.txt" || base === "setup.py") return "python";
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : "";
  return EXT_TOPIC[ext];
}

/**
 * Derive topic slugs for one session. Pure and deterministic: results are ordered by signal
 * source (concepts → stack → tooling), de-duplicated, and capped. No `topic/` prefix here —
 * the renderers add it when forming tags.
 */
export function extractTopics(rec: SessionRecord): string[] {
  const ordered: string[] = [];
  const add = (s: string | undefined): void => {
    if (s && !ordered.includes(s)) ordered.push(s);
  };

  const hay = [rec.intent, ...(rec.prompts ?? []), ...(rec.commits ?? [])].join("\n").toLowerCase();
  for (const c of CONCEPTS) if (c.terms.some((t) => termMatches(hay, t))) add(c.slug);
  for (const f of rec.files) add(fileTopic(f));
  for (const cmd of Object.keys(rec.commandCats)) add(CMD_TOPIC[cmd]);

  return ordered.slice(0, MAX_TOPICS);
}

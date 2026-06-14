/**
 * Seed a demo vault with synthetic, privacy-safe sessions so the README GIFs can be regenerated
 * any time (no real project data ever ends up in a public asset).
 *
 *   LOOMLOG_VAULT=/tmp/loomlog-demo npx tsx docs/demo/seed.ts
 *
 * Dates are RELATIVE to today (`day` = day offset, `at` = start hour). There are two blocks:
 * a rich CURRENT period (this week, with a couple of recurring failures for the 詰まり view) and
 * a lighter PRIOR period (~6 weeks back) so `loomlog patterns` has a previous period to trend
 * against — including one project ("legacy-cms") that only appears back then, to show "gone".
 */
import { rmSync } from "node:fs";
import { captureSession } from "../../src/store.ts";
import type { Blocker, SessionRecord } from "../../src/types.ts";
import { addDays, todayLocal } from "../../src/util.ts";

const vault = process.env.LOOMLOG_VAULT ?? "/tmp/loomlog-demo";
rmSync(vault, { recursive: true, force: true }); // fresh every run

type Seed = Partial<SessionRecord> & {
  project: string;
  agent: SessionRecord["agent"];
  day: number;
  at: number;
  intent: string;
  blockers?: Blocker[];
};

function rec(s: Seed): SessionRecord {
  const date = addDays(todayLocal(), s.day);
  const hh = String(s.at).padStart(2, "0");
  return {
    id: `${s.agent}-${s.project}-${date}-${hh}`,
    cwd: `~/code/${s.project}`,
    date,
    start: `${date}T${hh}:00:00.000Z`,
    end: `${date}T${hh}:45:00.000Z`,
    activeMin: 40,
    files: [],
    commandCount: 0,
    commandCats: {},
    tools: [],
    errorCount: 0,
    blockers: [],
    commits: [],
    prompts: [s.intent],
    sourcePath: `~/.demo/${s.project}.jsonl`,
    schemaVersion: 3,
    ...s,
  };
}

const seeds: Seed[] = [
  // ---- current period (this week) ----
  { project: "acme-web", agent: "claude-code", day: 0, at: 9, activeMin: 58,
    intent: "checkout フローに Apple Pay を追加", files: ["src/checkout/applePay.ts", "src/checkout/index.tsx"],
    commandCount: 41, commandCats: { npm: 18, git: 9, node: 8, ls: 6 }, tools: ["Edit", "Bash", "Read"],
    commits: ["feat: Apple Pay in checkout"] },
  { project: "acme-web", agent: "codex", day: 0, at: 11, activeMin: 47,
    intent: "Apple Pay の e2e テストが flaky なので安定化", files: ["e2e/checkout.spec.ts"],
    commandCount: 33, commandCats: { npm: 20, git: 7, npx: 6 }, tools: ["Edit", "Bash"], errorCount: 4,
    blockers: [{ sig: "npm run e2e", sample: "npm run e2e -- --headed", detail: 'TimeoutError: waiting for selector "#apple-pay-button"', count: 2, resolved: true }],
    commits: ["test: stabilize Apple Pay e2e"] },
  { project: "billing-api", agent: "claude-code", day: 0, at: 13, activeMin: 63,
    intent: "二重請求のバグを調査(Stripe webhook の冪等性)", files: ["src/webhooks/stripe.ts", "src/db/charges.ts"],
    commandCount: 52, commandCats: { git: 14, go: 12, psql: 9, curl: 7 }, tools: ["Read", "Bash", "Grep"], errorCount: 6,
    blockers: [{ sig: "go test", sample: "go test ./webhooks/...", detail: "FAIL: TestDuplicateCharge — got 2 charges, want 1", count: 3, resolved: false }],
    commits: ["fix: dedupe Stripe charge.succeeded by event id"] },
  { project: "billing-api", agent: "gemini", day: 0, at: 14, activeMin: 18,
    intent: "請求金額の丸め処理の仕様を確認したい" },
  { project: "billing-api", agent: "codex", day: 0, at: 15, activeMin: 42,
    intent: "二重請求修正のリグレッションテストを追加", files: ["src/webhooks/stripe_test.go"],
    commandCount: 27, commandCats: { go: 18, git: 9 }, tools: ["Edit", "Bash"], errorCount: 2,
    blockers: [{ sig: "go test", sample: "go test ./webhooks/stripe_test.go", detail: "FAIL: TestDuplicateCharge — got 2 charges, want 1", count: 2, resolved: false }],
    commits: ["test: regression for duplicate charge guard"] },
  { project: "acme-web", agent: "claude-code", day: 0, at: 16, activeMin: 51,
    intent: "checkout のエラーハンドリングを共通化してリファクタ", files: ["src/checkout/applePay.ts", "src/lib/errors.ts"],
    commandCount: 36, commandCats: { npm: 14, git: 13, node: 9 }, tools: ["Edit", "Bash", "Read"],
    commits: ["refactor: centralize checkout error handling"] },
  { project: "infra", agent: "codex", day: 0, at: 17, activeMin: 26,
    intent: "本番の CDN キャッシュ設定を Terraform に移行", files: ["infra/cdn.tf", "infra/variables.tf"],
    commandCount: 29, commandCats: { terraform: 16, git: 8, aws: 5 }, tools: ["Edit", "Bash"],
    commits: ["chore: manage CDN cache rules in terraform"] },
  { project: "acme-web", agent: "claude-code", day: -1, at: 10, activeMin: 44,
    intent: "決済ページの表示速度改善(画像の遅延読み込み)", files: ["src/components/Hero.tsx", "next.config.js"],
    commandCount: 38, commandCats: { npm: 15, git: 11, node: 7 }, tools: ["Edit", "Bash"],
    commits: ["perf: lazy-load hero imagery"] },
  { project: "billing-api", agent: "codex", day: -2, at: 14, activeMin: 33,
    intent: "請求書PDFのレイアウト崩れを修正", files: ["src/pdf/invoice.ts"],
    commandCount: 22, commandCats: { go: 10, git: 8 }, tools: ["Edit", "Bash"],
    commits: ["fix: invoice PDF layout regression"] },
  { project: "infra", agent: "codex", day: -3, at: 11, activeMin: 29,
    intent: "CI のキャッシュ設定を最適化", files: [".github/workflows/ci.yml"],
    commandCount: 18, commandCats: { git: 9, gh: 5 }, tools: ["Edit", "Bash"],
    commits: ["ci: cache node_modules in workflow"] },

  // ---- prior period (~6 weeks back) — the baseline `patterns` trends against ----
  { project: "acme-web", agent: "claude-code", day: -38, at: 10, activeMin: 60,
    intent: "認証フローをリファクタ", files: ["src/auth/session.ts"],
    commandCount: 30, commandCats: { npm: 12, git: 10 }, tools: ["Edit", "Bash"],
    commits: ["refactor: auth flow"] },
  { project: "billing-api", agent: "codex", day: -42, at: 15, activeMin: 50,
    intent: "請求書テンプレートを修正", files: ["src/pdf/template.ts"],
    commandCount: 24, commandCats: { go: 9, git: 7 }, tools: ["Edit", "Bash"],
    commits: ["fix: invoice template spacing"] },
  { project: "legacy-cms", agent: "claude-code", day: -45, at: 13, activeMin: 40,
    intent: "旧CMSの記事表示バグを修正", files: ["cms/render.php"],
    commandCount: 16, commandCats: { git: 8, php: 6 }, tools: ["Edit", "Bash"],
    commits: ["fix: legacy cms article render"] },
];

let n = 0;
for (const s of seeds) {
  captureSession(vault, rec(s));
  n++;
}
console.log(`seeded ${n} sessions → ${vault}`);

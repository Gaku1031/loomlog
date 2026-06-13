import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DayFile, SessionRecord } from "./types.ts";
import { addDays, rangeDates, todayLocal } from "./util.ts";

export interface ReportOptions {
  date?: string;
  week?: boolean;
  since?: string;
  until?: string;
  project?: string;
}

export interface ProjectReport {
  project: string;
  activeMin: number;
  sessions: number;
  agents: string[];
  files: string[];
  commands: Record<string, number>;
  tools: string[];
  blockers: number;
  intents: string[];
  commits: string[];
}

export interface ReportData {
  range: { from: string; to: string };
  totals: {
    sessions: number;
    activeMin: number;
    agents: Record<string, number>;
    projects: string[];
  };
  projects: ProjectReport[];
  days: { date: string; sessions: number; activeMin: number; projects: string[] }[];
}

function resolveRange(opts: ReportOptions): { from: string; to: string } {
  if (opts.since) return { from: opts.since, to: opts.until ?? todayLocal() };
  const anchor = opts.date ?? todayLocal();
  if (opts.week) return { from: addDays(anchor, -6), to: anchor };
  return { from: anchor, to: anchor };
}

function readDay(vault: string, date: string): SessionRecord[] {
  const path = join(vault, ".loomlog", "days", `${date}.json`);
  if (!existsSync(path)) return [];
  try {
    const day = JSON.parse(readFileSync(path, "utf8")) as DayFile;
    return Object.values(day.sessions);
  } catch {
    return [];
  }
}

function sessionPrompts(s: SessionRecord): string[] {
  const prompts = s.prompts?.length ? s.prompts : [s.intent];
  return prompts.filter((p) => p && p !== "(no prompt captured)");
}

/** Aggregate the store into a report over the chosen range. */
export function buildReport(vault: string, opts: ReportOptions): ReportData {
  const range = resolveRange(opts);
  let sessions: SessionRecord[] = [];
  const days: ReportData["days"] = [];

  for (const date of rangeDates(range.from, range.to)) {
    let recs = readDay(vault, date);
    if (opts.project) recs = recs.filter((r) => r.project === opts.project);
    if (recs.length === 0) continue;
    sessions.push(...recs);
    days.push({
      date,
      sessions: recs.length,
      activeMin: recs.reduce((a, r) => a + r.activeMin, 0),
      projects: [...new Set(recs.map((r) => r.project))],
    });
  }

  const agents: Record<string, number> = {};
  for (const s of sessions) agents[s.agent] = (agents[s.agent] ?? 0) + 1;

  // Group by project.
  const byProject = new Map<string, SessionRecord[]>();
  for (const s of sessions) {
    const arr = byProject.get(s.project) ?? [];
    arr.push(s);
    byProject.set(s.project, arr);
  }

  const projects: ProjectReport[] = [...byProject.entries()]
    .map(([project, recs]) => {
      const commands: Record<string, number> = {};
      for (const r of recs)
        for (const [k, n] of Object.entries(r.commandCats)) commands[k] = (commands[k] ?? 0) + n;
      return {
        project,
        activeMin: recs.reduce((a, r) => a + r.activeMin, 0),
        sessions: recs.length,
        agents: [...new Set(recs.map((r) => r.agent))].sort(),
        files: [...new Set(recs.flatMap((r) => r.files))].slice(0, 20),
        commands,
        tools: [...new Set(recs.flatMap((r) => r.tools))].sort(),
        blockers: recs.reduce((a, r) => a + r.errorCount, 0),
        intents: recs
          .sort((a, b) => a.start.localeCompare(b.start))
          .flatMap((r) => sessionPrompts(r))
          .slice(0, 24),
        commits: [...new Set(recs.flatMap((r) => r.commits ?? []))].slice(0, 15),
      };
    })
    .sort((a, b) => b.activeMin - a.activeMin);

  return {
    range,
    totals: {
      sessions: sessions.length,
      activeMin: sessions.reduce((a, s) => a + s.activeMin, 0),
      agents,
      projects: [...byProject.keys()],
    },
    projects,
    days,
  };
}

/**
 * Human-readable daily report for the terminal — a mechanical (0-token, no LLM) digest you can
 * read as-is. Each project lists what you set out to do (one bullet per session's intent) and
 * what you shipped (`↳ 成果:` = commits). Raw file lists and command-count tallies are kept out
 * of this view (they live in --json, the Daily note, and `loomlog patterns`) so the report reads
 * like a journal entry, not a stats dump. The host model (--json) is only needed for prose.
 */
export function renderText(r: ReportData): string {
  const out: string[] = [];
  const span = r.range.from === r.range.to ? r.range.from : `${r.range.from} .. ${r.range.to}`;
  const agentStr = Object.entries(r.totals.agents)
    .map(([a, c]) => `${a}×${c}`)
    .join(", ");
  out.push(`loomlog report — ${span}`);
  if (r.totals.sessions === 0) {
    out.push("(no sessions captured in this range)");
    return out.join("\n");
  }
  out.push(`${r.totals.sessions} sessions · ${r.totals.activeMin}m active · ${agentStr}`);
  out.push("");
  for (const p of r.projects) {
    out.push(`## ${p.project} — ${p.activeMin}m · ${p.sessions} session${p.sessions === 1 ? "" : "s"} · ${p.agents.join(", ")}`);
    for (const intent of p.intents) out.push(`  - ${intent}`);
    if (p.commits.length) out.push(`  ↳ 成果: ${p.commits.join(" / ")}`);
    out.push("");
  }
  return out.join("\n");
}

function spanText(range: { from: string; to: string }): string {
  return range.from === range.to ? range.from : `${range.from} .. ${range.to}`;
}

/**
 * Clean GitHub-flavored Markdown for pasting (Notion / Slack / docs), in contrast to
 * renderText's terminal layout. The key difference is *no leading indent* on bullets:
 * renderText's `  - ` 2-space gutter looks tidy in a terminal but Markdown parsers read it
 * as one level of list nesting — which is exactly the "line 2+ jumps inward" paste bug.
 * Bullets sit at column 0 and headings get a trailing blank line.
 */
export function renderMarkdown(r: ReportData): string {
  const out: string[] = [`# loomlog report — ${spanText(r.range)}`, ""];
  if (r.totals.sessions === 0) {
    out.push("(no sessions captured in this range)");
    return out.join("\n") + "\n";
  }
  const agentStr = Object.entries(r.totals.agents)
    .map(([a, c]) => `${a}×${c}`)
    .join(", ");
  out.push(`${r.totals.sessions} sessions · ${r.totals.activeMin}m active · ${agentStr}`, "");
  for (const p of r.projects) {
    out.push(`## ${p.project} — ${p.activeMin}m · ${p.sessions} session${p.sessions === 1 ? "" : "s"} · ${p.agents.join(", ")}`, "");
    for (const intent of p.intents) out.push(`- ${intent}`);
    if (p.commits.length) out.push(`- 成果: ${p.commits.join(" / ")}`);
    out.push("");
  }
  return out.join("\n").trimEnd() + "\n";
}

// ---------- patterns: "what's the shape of my work, and where is it stuck?" ----------

export interface AgentProfile {
  agent: string;
  activeMin: number;
  sessions: number;
  /** What this agent is used for, e.g. "テスト・リファクタ" (from its commit-type mix / work types). */
  profile: string;
}

/** A failure signature that recurred across the range — loomlog's definition of a 詰まり. */
export interface BlockerStat {
  sig: string;
  /** Redacted sample of the actual failing command/target — evidence to verify the judgment. */
  sample: string;
  /** The key error line (why it failed), from the most recent occurrence. */
  detail?: string;
  /** What the user was trying to do when it bit (the session intent) — the natural-language frame. */
  intent: string;
  count: number; // total failures across the range (>= 2 to be reported)
  sessions: number; // distinct sessions it bit
  projects: string[];
  /** Did the most recent session with this blocker end with the command succeeding? */
  resolved: boolean;
}

export interface PatternsData {
  range: { from: string; to: string };
  totals: { sessions: number; activeMin: number; blockers: number; commits: number; days: number };
  workTypes: [string, number][]; // command category → count, desc
  projectsByTime: { project: string; activeMin: number; pct: number }[];
  agents: { agent: string; activeMin: number; sessions: number }[];
  agentProfiles: AgentProfile[]; // #2 — what each agent is used for
  busiestDays: { date: string; activeMin: number }[];
  recentCommits: string[];
  /** #4 — recurring failures (the trustworthy 詰まり signal), most-failed first. */
  blockers: BlockerStat[];
  /** #3 — did sessions convert to shipped output, or dissolve into friction? */
  shipping: { shipped: number; total: number; commitMix: [string, number][]; heaviest: { date: string; fails: number } | null };
  /** #1 — how this period compares to the immediately preceding one of equal length. */
  trend: {
    prevActiveMin: number;
    deltaPct: number | null; // null when the previous period had no activity
    byProject: Record<string, { deltaMin: number; status: "new" | "up" | "down" | "flat" }>;
    gone: string[]; // projects worked on last period but not this one
  };
}

/** Friendly work-type for a command basename. */
const WORK_LABEL: Record<string, string> = {
  git: "Git", gh: "GitHub",
  npm: "パッケージ管理", npx: "パッケージ管理", yarn: "パッケージ管理", pnpm: "パッケージ管理",
  node: "JS/TS", tsc: "TypeScript", deno: "JS/TS", bun: "JS/TS", vite: "フロントビルド",
  go: "Go", cargo: "Rust", rustc: "Rust",
  python: "Python", python3: "Python", pip: "Python", uv: "Python", pytest: "テスト",
  terraform: "インフラ(IaC)", ansible: "インフラ(IaC)", aws: "AWS", gcloud: "GCP",
  kubectl: "Kubernetes", helm: "Kubernetes", docker: "コンテナ",
  psql: "DB", mysql: "DB", sqlite3: "DB", "redis-cli": "DB",
  make: "ビルド", cmake: "ビルド", curl: "HTTP", wget: "HTTP",
  rg: "コード検索", grep: "コード検索", find: "ファイル検索",
};

/** Conventional-commit type → readable label. */
const COMMIT_TYPE: Record<string, string> = {
  feat: "新機能", fix: "修正", test: "テスト", refactor: "リファクタ", perf: "高速化",
  chore: "雑務", docs: "ドキュメント", ci: "CI", build: "ビルド", style: "整形", revert: "差し戻し",
};

function sessionsLabel(n: number): string {
  return `${n} session${n === 1 ? "" : "s"}`;
}

/** Commit subjects → [label, count] by conventional-commit type, most first. */
function commitMix(commits: string[]): [string, number][] {
  const counts: Record<string, number> = {};
  for (const c of commits) {
    const m = /^(\w+)(?:\([^)]*\))?!?:/.exec(c);
    counts[m && COMMIT_TYPE[m[1]!] ? COMMIT_TYPE[m[1]!]! : "その他"] = (counts[m && COMMIT_TYPE[m[1]!] ? COMMIT_TYPE[m[1]!]! : "その他"] ?? 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

/** Total active minutes per project over a date range (used for the previous-period trend). */
function rangeProjectMin(vault: string, from: string, to: string, project?: string): { total: number; byProject: Record<string, number> } {
  const byProject: Record<string, number> = {};
  let total = 0;
  for (const date of rangeDates(from, to)) {
    let recs = readDay(vault, date);
    if (project) recs = recs.filter((r) => r.project === project);
    for (const r of recs) {
      byProject[r.project] = (byProject[r.project] ?? 0) + r.activeMin;
      total += r.activeMin;
    }
  }
  return { total, byProject };
}

/** Aggregate cross-cutting patterns: time split, agent fit, recurring blockers, shipping, trend. */
export function buildPatterns(vault: string, opts: ReportOptions): PatternsData {
  const range = resolveRange(opts);
  const sessions: SessionRecord[] = [];
  const dayMin = new Map<string, number>();
  const dayFails = new Map<string, number>();

  for (const date of rangeDates(range.from, range.to)) {
    let recs = readDay(vault, date);
    if (opts.project) recs = recs.filter((r) => r.project === opts.project);
    if (recs.length === 0) continue;
    sessions.push(...recs);
    dayMin.set(date, recs.reduce((a, r) => a + r.activeMin, 0));
    // Friction = *meaningful* recurring-failure signatures, not raw errorCount (which is dominated
    // by navigation/probe noise). This is what the "heaviest day" should reflect.
    dayFails.set(date, recs.reduce((a, r) => a + (r.blockers ?? []).reduce((x, b) => x + b.count, 0), 0));
  }

  const totalMin = sessions.reduce((a, s) => a + s.activeMin, 0);
  const cmd: Record<string, number> = {};
  const projMin: Record<string, number> = {};
  const agentMin: Record<string, number> = {};
  const agentSessions: Record<string, number> = {};
  const agentCmd: Record<string, Record<string, number>> = {};
  const agentCommits: Record<string, string[]> = {};
  const commits: string[] = [];
  // #4: aggregate blockers across sessions by signature (keep the latest "why" + intent + resolution).
  const blk = new Map<string, { sample: string; detail?: string; intent: string; count: number; sessions: number; projects: Set<string>; latestDate: string; resolved: boolean }>();

  for (const s of sessions) {
    for (const [k, n] of Object.entries(s.commandCats)) {
      cmd[k] = (cmd[k] ?? 0) + n;
      (agentCmd[s.agent] ??= {})[k] = ((agentCmd[s.agent] ??= {})[k] ?? 0) + n;
    }
    projMin[s.project] = (projMin[s.project] ?? 0) + s.activeMin;
    agentMin[s.agent] = (agentMin[s.agent] ?? 0) + s.activeMin;
    agentSessions[s.agent] = (agentSessions[s.agent] ?? 0) + 1;
    (agentCommits[s.agent] ??= []).push(...(s.commits ?? []));
    commits.push(...(s.commits ?? []));
    for (const b of s.blockers ?? []) {
      const cur = blk.get(b.sig) ?? { sample: b.sample, detail: b.detail, intent: s.intent, count: 0, sessions: 0, projects: new Set<string>(), latestDate: "", resolved: b.resolved ?? false };
      cur.count += b.count;
      cur.sessions += 1;
      cur.projects.add(s.project);
      // The most recent occurrence decides "are you still stuck?" and supplies the shown error + intent.
      if (s.date >= cur.latestDate) {
        cur.latestDate = s.date;
        cur.resolved = b.resolved ?? false;
        cur.intent = s.intent;
        if (b.detail) cur.detail = b.detail;
      }
      blk.set(b.sig, cur);
    }
  }

  // #2: per-agent "what is it used for" — its commit-type mix, falling back to its work types.
  const agentProfiles: AgentProfile[] = Object.entries(agentMin)
    .sort((a, b) => b[1] - a[1])
    .map(([agent, activeMin]) => {
      const mix = commitMix(agentCommits[agent] ?? []).filter(([k]) => k !== "その他");
      const works: string[] = [];
      for (const [c] of Object.entries(agentCmd[agent] ?? {}).sort((a, b) => b[1] - a[1])) {
        const label = WORK_LABEL[c];
        if (label && !works.includes(label)) works.push(label);
        if (works.length >= 3) break;
      }
      const profile = mix.length ? mix.slice(0, 3).map(([k]) => k).join("・") : works.length ? works.join("・") : "—";
      return { agent, activeMin, sessions: agentSessions[agent] ?? 0, profile };
    });

  // #4: keep only signatures that recurred (>= 2 failures) — the conservative 詰まり threshold.
  const blockers: BlockerStat[] = [...blk.entries()]
    .map(([sig, v]) => ({ sig, sample: v.sample, detail: v.detail, intent: v.intent, count: v.count, sessions: v.sessions, projects: [...v.projects], resolved: v.resolved }))
    .filter((b) => b.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  // #3: shipping — how many sessions ended in a commit, and the heaviest-friction day.
  const shipped = sessions.filter((s) => (s.commits?.length ?? 0) > 0).length;
  const heaviestEntry = [...dayFails.entries()].filter(([, f]) => f > 0).sort((a, b) => b[1] - a[1])[0];

  // #1: trend vs the immediately preceding period of equal length.
  const len = rangeDates(range.from, range.to).length;
  const prev = rangeProjectMin(vault, addDays(range.from, -len), addDays(range.from, -1), opts.project);
  const byProject: PatternsData["trend"]["byProject"] = {};
  for (const [project, m] of Object.entries(projMin)) {
    const d = m - (prev.byProject[project] ?? 0);
    byProject[project] = { deltaMin: d, status: prev.byProject[project] ? (Math.abs(d) < 10 ? "flat" : d > 0 ? "up" : "down") : "new" };
  }
  const gone = Object.keys(prev.byProject).filter((p) => !projMin[p]);

  return {
    range,
    totals: { sessions: sessions.length, activeMin: totalMin, blockers: sessions.reduce((a, s) => a + s.errorCount, 0), commits: commits.length, days: dayMin.size },
    workTypes: Object.entries(cmd).sort((a, b) => b[1] - a[1]).slice(0, 12),
    projectsByTime: Object.entries(projMin)
      .sort((a, b) => b[1] - a[1])
      .map(([project, activeMin]) => ({ project, activeMin, pct: totalMin ? Math.round((activeMin / totalMin) * 100) : 0 })),
    agents: Object.entries(agentMin).sort((a, b) => b[1] - a[1]).map(([agent, activeMin]) => ({ agent, activeMin, sessions: agentSessions[agent] ?? 0 })),
    agentProfiles,
    busiestDays: [...dayMin.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([date, activeMin]) => ({ date, activeMin })),
    recentCommits: commits.slice(-12).reverse(),
    blockers,
    shipping: { shipped, total: sessions.length, commitMix: commitMix(commits), heaviest: heaviestEntry ? { date: heaviestEntry[0], fails: heaviestEntry[1] } : null },
    trend: { prevActiveMin: prev.total, deltaPct: prev.total > 0 ? Math.round(((totalMin - prev.total) / prev.total) * 100) : null, byProject, gone },
  };
}

// ---------- patterns leads: a takeaway sentence per section, computed from the numbers (0 tokens) ----------

/** "前期間比 +37% (300m→411m)" headline, or "" when there's no comparable previous period. */
function trendHeadline(t: PatternsData["trend"], activeMin: number): string {
  if (t.deltaPct === null) return "";
  const arrow = t.deltaPct > 0 ? "▲" : t.deltaPct < 0 ? "▼" : "→";
  return `${arrow} 前期間比 ${t.deltaPct >= 0 ? "+" : ""}${t.deltaPct}% (${t.prevActiveMin}m→${activeMin}m)`;
}

/** "acme-web が最多 (49%)、上位2件で 87%" — where the time concentrates. */
function projectLead(ps: PatternsData["projectsByTime"]): string {
  if (ps.length === 0) return "";
  const top = ps[0]!;
  if (ps.length === 1) return `${top.project} に集中 (${top.pct}%)。`;
  return `${top.project} が最多 (${top.pct}%)、上位2件で ${top.pct + ps[1]!.pct}%。`;
}

/** "claude-code と codex をほぼ同等に、gemini は補助的" — agent division of labor by time. */
function agentLead(as: PatternsData["agents"]): string {
  if (as.length === 0) return "";
  if (as.length === 1) return `${as[0]!.agent} のみ。`;
  const [primary, second] = as;
  const close = second!.activeMin >= primary!.activeMin * 0.6;
  const rest = as.slice(2).map((x) => x.agent);
  let s = close ? `${primary!.agent} と ${second!.agent} をほぼ同等に。` : `${primary!.agent} が主軸。`;
  const light = close ? rest : [second!.agent, ...rest];
  if (light.length) s += `${light.join("・")} は補助的。`;
  return s;
}

/** "2026-06-14 が突出 (305分)、稼働 4日" — the work rhythm. */
function rhythmLead(busiest: PatternsData["busiestDays"], days: number): string {
  if (busiest.length === 0) return "";
  const top = busiest[0]!;
  return `${top.date} が最多 (${top.activeMin}分)、稼働 ${days}日。`;
}

/** "未解決 2件 / 解消 1件。…" — count summary; the per-row state carries the rest. */
function blockerLead(bs: PatternsData["blockers"]): string {
  if (bs.length === 0) return "再発した失敗はなし。詰まらず進めている。";
  const unresolved = bs.filter((b) => !b.resolved).length;
  const resolved = bs.length - unresolved;
  const parts: string[] = [];
  if (unresolved) parts.push(`未解決 ${unresolved}件`);
  if (resolved) parts.push(`解消 ${resolved}件`);
  return `${parts.join(" / ")}。同じ失敗が2回以上のものだけ。`;
}

/**
 * "9 コミット / 4 稼働日、詰まりの重い日 ..." — output volume and where friction clustered.
 * Deliberately not a per-session "shipping rate" %: session granularity varies wildly across
 * agents (many tiny continuation transcripts), so that % swings from 90% to 4% on the same person
 * and misleads. Commit count, cadence, and the friction day are stable, honest signals.
 */
function shippingLead(p: PatternsData): string {
  const parts = [`${p.totals.commits} コミット / ${p.totals.days} 稼働日`];
  if (p.shipping.heaviest) parts.push(`詰まりの重い日 ${p.shipping.heaviest.date} (失敗${p.shipping.heaviest.fails}回)`);
  return parts.join("、") + "。";
}

/** Inline trend tag for a project row: "▲+90m" / "▼-40m" / "＋新規". "" when flat. */
function moverTag(t: { deltaMin: number; status: "new" | "up" | "down" | "flat" } | undefined): string {
  if (!t) return "";
  if (t.status === "new") return "＋新規";
  if (t.status === "flat") return "";
  return `${t.deltaMin > 0 ? "▲+" : "▼"}${t.deltaMin}m`;
}

// ---------- terminal bar charts (0-token, Unicode blocks; CJK-aware alignment) ----------

const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"] as const;

/** A `width`-cell Unicode block bar for value/max (eighth-cell precision). */
function bar(value: number, max: number, width: number): string {
  if (width <= 0) return "";
  if (max <= 0 || value <= 0) return " ".repeat(width);
  const eighths = Math.round((Math.min(value, max) / max) * width * 8);
  const body = "█".repeat(Math.floor(eighths / 8)) + (eighths % 8 ? EIGHTHS[eighths % 8] : "");
  return body + " ".repeat(Math.max(0, width - body.length));
}

/** Terminal display cells of a string (CJK / full-width counts as 2). */
function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    const wide =
      (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6);
    w += wide ? 2 : 1;
  }
  return w;
}

/** Right-pad to `target` display cells (CJK-aware), for aligned bar labels. */
function padTo(s: string, target: number): string {
  return s + " ".repeat(Math.max(0, target - displayWidth(s)));
}

/** Left-pad an ASCII token (numbers) to `w` for right alignment. */
function rpad(s: string, w: number): string {
  return " ".repeat(Math.max(0, w - s.length)) + s;
}

const BAR_W = 22;

/** Trim the intent for a one-line sentence; fall back to the project when no prompt was captured. */
function blockerContext(b: BlockerStat): string {
  const i = b.intent && b.intent !== "(no prompt captured)" ? b.intent : `${b.projects[0] ?? "?"} の作業`;
  return i.length > 36 ? i.slice(0, 36) + "…" : i;
}

/**
 * One plain-language sentence per 詰まり, framed by what the user was doing (the intent) so it
 * reads like a journal line, not a raw error: 「<intent>」中に <command> が <N>回失敗、<status>.
 */
function blockerSentence(b: BlockerStat): string {
  const icon = b.resolved ? "✓" : "✗";
  const status = b.resolved ? "その後解消" : "未解決のまま";
  return `${icon} 「${blockerContext(b)}」中に ${b.sig} が ${b.count}回失敗、${status}。`;
}

/**
 * The 詰まり (recurring-failure) section. `prose` (the focused `--blockers` view) renders each
 * entry as a sentence framed by the intent + the error beneath as evidence; otherwise (the dense
 * overview) a compact one-liner per blocker that won't wrap.
 */
function renderBlockerSection(p: PatternsData, push: (s: string) => void, prose: boolean): void {
  push("");
  push("## 詰まり (再発した失敗)");
  push(blockerLead(p.blockers));
  if (prose) {
    for (const b of p.blockers) {
      push("");
      push(`  ${blockerSentence(b)}`);
      push(`      ${b.detail ? `${b.detail}  ` : ""}(${b.projects.join("・")})`);
    }
  } else {
    for (const b of p.blockers) {
      const icon = b.resolved ? "✓" : "✗";
      push(`  ${icon} ${padTo(b.resolved ? "解消" : "未解決", 6)} ×${b.count}  ${b.sig}  ·  ${b.projects.join("・")}`);
    }
  }
}

/**
 * Human-readable patterns digest. Leads with the insights that change behavior — what's trending,
 * where you're stuck (詰まり), whether work shipped, and which agent does what — each with a
 * takeaway + a bar chart. All mechanical (0 tokens); the agent path is only for prose.
 * With `{ blockersOnly: true }` it renders just the 詰まり section (the focused "where am I stuck").
 */
export function renderPatterns(p: PatternsData, opts: { blockersOnly?: boolean } = {}): string {
  const span = p.range.from === p.range.to ? p.range.from : `${p.range.from} .. ${p.range.to}`;
  const out: string[] = [`loomlog patterns — ${span}`];
  if (p.totals.sessions === 0) {
    out.push("(no sessions captured in this range)");
    return out.join("\n");
  }
  if (opts.blockersOnly) {
    renderBlockerSection(p, (s) => out.push(s), true); // focused view → full prose
    return out.join("\n");
  }
  const trend = trendHeadline(p.trend, p.totals.activeMin);
  out.push(`${p.totals.sessions} sessions · ${p.totals.activeMin}m active · ${p.totals.days} active days · ${p.totals.commits} commits${trend ? `   ${trend}` : ""}`);
  const head = (title: string, lead: string) => {
    out.push("", `## ${title}`);
    if (lead) out.push(lead);
  };
  const labelW = (labels: string[]) => Math.min(20, Math.max(0, ...labels.map(displayWidth)));

  // #4 — recurring failures (compact in the overview; `--blockers` gives the full prose view).
  renderBlockerSection(p, (s) => out.push(s), false);

  // #3 — output volume + where friction clustered (no misleading per-session rate).
  head("出荷とフロー", shippingLead(p));
  if (p.shipping.commitMix.length) out.push(`  内訳  ${p.shipping.commitMix.map(([k, n]) => `${k}${n}`).join("・")}`);

  // #2 — what each agent is used for (bar by minutes + its work profile).
  head("エージェント使い分け", agentLead(p.agents));
  {
    const lw = labelW(p.agentProfiles.map((a) => a.agent));
    const max = p.agentProfiles[0]?.activeMin ?? 0;
    for (const a of p.agentProfiles)
      out.push(`  ${padTo(a.agent, lw)}  ${bar(a.activeMin, max, BAR_W)}  ${rpad(`${a.activeMin}m`, 5)} · ${a.profile}`);
  }

  // Time split, with the #1 trend delta inline per project.
  head("プロジェクト別の時間配分", projectLead(p.projectsByTime));
  {
    const lw = labelW(p.projectsByTime.map((x) => x.project));
    const max = p.projectsByTime[0]?.activeMin ?? 0;
    const hasPrev = p.trend.prevActiveMin > 0; // only show movers when there's a real prior period
    for (const x of p.projectsByTime) {
      const tag = hasPrev ? moverTag(p.trend.byProject[x.project]) : "";
      out.push(`  ${padTo(x.project, lw)}  ${bar(x.activeMin, max, BAR_W)}  ${rpad(`${x.activeMin}m`, 5)} ${rpad(`${x.pct}%`, 4)}${tag ? `  ${tag}` : ""}`);
    }
    if (hasPrev && p.trend.gone.length) out.push(`  (前期間のみ: ${p.trend.gone.join("・")})`);
  }

  // Rhythm — a bar per busiest day.
  head("ペース", rhythmLead(p.busiestDays, p.totals.days));
  {
    const lw = labelW(p.busiestDays.map((d) => d.date));
    const max = p.busiestDays[0]?.activeMin ?? 0;
    for (const d of p.busiestDays) out.push(`  ${padTo(d.date, lw)}  ${bar(d.activeMin, max, BAR_W)}  ${rpad(`${d.activeMin}m`, 5)}`);
  }
  return out.join("\n");
}

/** Markdown rows for the 詰まり section — prose sentence (focused) or a compact one-liner. */
function markdownBlockerRows(p: PatternsData, prose: boolean): string[] {
  if (prose) {
    return p.blockers.map((b) => `- ${blockerSentence(b)}${b.detail ? ` — ${b.detail}` : ""} (${b.projects.join("・")})`);
  }
  return p.blockers.map((b) => `- ${b.resolved ? "✓ 解消" : "✗ 未解決"} ×${b.count} ${b.sig} · ${b.projects.join("・")}`);
}

/** Clean GFM patterns digest for pasting — same insights as renderPatterns, text-only (bars need
 * a monospace font). See renderMarkdown for the no-indent-gutter rule. */
export function renderMarkdownPatterns(p: PatternsData, opts: { blockersOnly?: boolean } = {}): string {
  const out: string[] = [`# loomlog patterns — ${spanText(p.range)}`, ""];
  if (p.totals.sessions === 0) {
    out.push("(no sessions captured in this range)");
    return out.join("\n") + "\n";
  }
  const section = (title: string, lead: string, rows: string[]) => {
    out.push("", `## ${title}`, "");
    if (lead) out.push(lead, "");
    out.push(...rows);
  };
  if (opts.blockersOnly) {
    section("詰まり (再発した失敗)", blockerLead(p.blockers), markdownBlockerRows(p, true));
    return out.join("\n").trimEnd() + "\n";
  }
  const trend = trendHeadline(p.trend, p.totals.activeMin);
  out.push(`${p.totals.sessions} sessions · ${p.totals.activeMin}m active · ${p.totals.days} active days · ${p.totals.commits} commits${trend ? ` — ${trend}` : ""}`);
  section("詰まり (再発した失敗)", blockerLead(p.blockers), markdownBlockerRows(p, false));
  const ship: string[] = [];
  if (p.shipping.commitMix.length) ship.push(`- 内訳: ${p.shipping.commitMix.map(([k, n]) => `${k}${n}`).join("・")}`);
  section("出荷とフロー", shippingLead(p), ship);
  section("エージェント使い分け", agentLead(p.agents), p.agentProfiles.map((a) => `- ${a.agent}: ${a.activeMin}m · ${sessionsLabel(a.sessions)} · ${a.profile}`));
  const hasPrev = p.trend.prevActiveMin > 0;
  const projRows = p.projectsByTime.map((x) => {
    const tag = hasPrev ? moverTag(p.trend.byProject[x.project]) : "";
    return `- ${x.project}: ${x.activeMin}m (${x.pct}%)${tag ? ` ${tag}` : ""}`;
  });
  if (hasPrev && p.trend.gone.length) projRows.push(`- (前期間のみ: ${p.trend.gone.join("・")})`);
  section("プロジェクト別の時間配分", projectLead(p.projectsByTime), projRows);
  section("ペース", rhythmLead(p.busiestDays, p.totals.days), p.busiestDays.map((d) => `- ${d.date}: ${d.activeMin}m`));
  return out.join("\n").trimEnd() + "\n";
}

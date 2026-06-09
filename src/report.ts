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

function topCommands(commands: Record<string, number>, n = 6): string {
  return Object.entries(commands)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, c]) => `${k}×${c}`)
    .join(", ");
}

/** Human-readable digest for terminal use (the host model uses --json instead). */
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
    out.push(`## ${p.project} — ${p.activeMin}m · ${p.sessions} sessions [${p.agents.join(", ")}]`);
    for (const intent of p.intents) out.push(`  - 意図: ${intent}`);
    if (p.files.length) out.push(`  - files: ${p.files.join(", ")}`);
    const cmds = topCommands(p.commands);
    if (cmds) out.push(`  - commands: ${cmds}`);
    if (p.commits.length) out.push(`  - 成果: ${p.commits.join(" / ")}`);
    out.push("");
  }
  return out.join("\n");
}

// ---------- patterns: "what kind of work do I do?" ----------

export interface PatternsData {
  range: { from: string; to: string };
  totals: { sessions: number; activeMin: number; blockers: number; commits: number; days: number };
  workTypes: [string, number][]; // command category → count, desc
  projectsByTime: { project: string; activeMin: number; pct: number }[];
  agents: { agent: string; activeMin: number; sessions: number }[];
  busiestDays: { date: string; activeMin: number }[];
  recentCommits: string[];
}

/** Aggregate cross-cutting patterns over a range: work types, time split, busiest days, output. */
export function buildPatterns(vault: string, opts: ReportOptions): PatternsData {
  const range = resolveRange(opts);
  const sessions: SessionRecord[] = [];
  const dayMin = new Map<string, number>();

  for (const date of rangeDates(range.from, range.to)) {
    let recs = readDay(vault, date);
    if (opts.project) recs = recs.filter((r) => r.project === opts.project);
    if (recs.length === 0) continue;
    sessions.push(...recs);
    dayMin.set(date, recs.reduce((a, r) => a + r.activeMin, 0));
  }

  const totalMin = sessions.reduce((a, s) => a + s.activeMin, 0);
  const cmd: Record<string, number> = {};
  const projMin: Record<string, number> = {};
  const agentMin: Record<string, number> = {};
  const agentSessions: Record<string, number> = {};
  const commits: string[] = [];
  for (const s of sessions) {
    for (const [k, n] of Object.entries(s.commandCats)) cmd[k] = (cmd[k] ?? 0) + n;
    projMin[s.project] = (projMin[s.project] ?? 0) + s.activeMin;
    agentMin[s.agent] = (agentMin[s.agent] ?? 0) + s.activeMin;
    agentSessions[s.agent] = (agentSessions[s.agent] ?? 0) + 1;
    commits.push(...(s.commits ?? []));
  }

  return {
    range,
    totals: {
      sessions: sessions.length,
      activeMin: totalMin,
      blockers: sessions.reduce((a, s) => a + s.errorCount, 0),
      commits: commits.length,
      days: dayMin.size,
    },
    workTypes: Object.entries(cmd).sort((a, b) => b[1] - a[1]).slice(0, 12),
    projectsByTime: Object.entries(projMin)
      .sort((a, b) => b[1] - a[1])
      .map(([project, activeMin]) => ({ project, activeMin, pct: totalMin ? Math.round((activeMin / totalMin) * 100) : 0 })),
    agents: Object.entries(agentMin)
      .sort((a, b) => b[1] - a[1])
      .map(([agent, activeMin]) => ({ agent, activeMin, sessions: agentSessions[agent] ?? 0 })),
    busiestDays: [...dayMin.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([date, activeMin]) => ({ date, activeMin })),
    recentCommits: commits.slice(-12).reverse(),
  };
}

/** Human-readable patterns digest. */
export function renderPatterns(p: PatternsData): string {
  const span = p.range.from === p.range.to ? p.range.from : `${p.range.from} .. ${p.range.to}`;
  const out: string[] = [`loomlog patterns — ${span}`];
  if (p.totals.sessions === 0) {
    out.push("(no sessions captured in this range)");
    return out.join("\n");
  }
  out.push(`${p.totals.sessions} sessions · ${p.totals.activeMin}m active · ${p.totals.days} active days · ${p.totals.commits} commits`);
  out.push("");
  out.push("## どういう作業が多いか (command categories)");
  out.push("  " + p.workTypes.map(([k, n]) => `${k}×${n}`).join(", "));
  out.push("");
  out.push("## プロジェクト別の時間配分");
  for (const x of p.projectsByTime) out.push(`  - ${x.project}: ${x.activeMin}m (${x.pct}%)`);
  out.push("");
  out.push("## エージェント使い分け");
  for (const a of p.agents) out.push(`  - ${a.agent}: ${a.activeMin}m · ${a.sessions} sessions`);
  out.push("");
  out.push("## 多忙だった日");
  for (const d of p.busiestDays) out.push(`  - ${d.date}: ${d.activeMin}m`);
  if (p.recentCommits.length) {
    out.push("");
    out.push("## 最近の成果 (commits)");
    for (const c of p.recentCommits) out.push(`  - ${c}`);
  }
  return out.join("\n");
}

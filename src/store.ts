import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DayFile, SessionRecord } from "./types.ts";

/**
 * The store is the single source of truth. Markdown notes are a pure *projection*
 * of the JSON data under `.loomlog/`, re-rendered on every capture. This makes
 * idempotency and aggregation trivial and avoids fragile in-place Markdown editing.
 */

interface ProjectStat {
  firstSeen: string;
  lastActive: string;
  byDate: Record<string, { min: number; sessions: number; sample: string }>;
}
type ProjectIndex = Record<string, ProjectStat>;

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/**
 * Atomic write: write to a temp file then rename over the target. rename(2) is
 * atomic within a filesystem, so a concurrent Stop-hook capture + scan can never
 * observe a half-written (corrupt) JSON/Markdown file. The pid in the temp name
 * keeps two writers from clobbering each other's temp file.
 */
function writeAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

function writeJson(path: string, data: unknown): void {
  writeAtomic(path, JSON.stringify(data, null, 2) + "\n");
}

/** Storage key for a session — namespaced by agent so ids can never collide across agents. */
function sessionKey(rec: SessionRecord): string {
  return `${rec.agent}:${rec.id}`;
}

function paths(vault: string) {
  const data = join(vault, ".loomlog");
  return {
    data,
    days: join(data, "days"),
    ingested: join(data, "ingested.json"),
    projects: join(data, "projects.json"),
    dailyDir: join(vault, "Daily"),
    projectsDir: join(vault, "Projects"),
  };
}

/** Result of a capture, for CLI output. */
export interface CaptureResult {
  alreadyIngested: boolean;
  date: string;
  project: string;
  dailyPath: string;
}

export function captureSession(vault: string, rec: SessionRecord): CaptureResult {
  const p = paths(vault);
  const key = sessionKey(rec);
  const ingested = readJson<Record<string, string>>(p.ingested, {});
  const already = key in ingested || rec.id in ingested;

  // 1) Upsert into the day file (keyed by agent:id → idempotent).
  const dayPath = join(p.days, `${rec.date}.json`);
  const day = readJson<DayFile>(dayPath, { date: rec.date, sessions: {} });
  if (key !== rec.id) delete day.sessions[rec.id]; // migrate pre-namespacing bare-id entries
  day.sessions[key] = rec;
  writeJson(dayPath, day);

  // 2) Mark ingested.
  if (key !== rec.id) delete ingested[rec.id];
  ingested[key] = rec.sourcePath;
  writeJson(p.ingested, ingested);

  // 3) Recompute this project's bucket for this date from the day file.
  const index = readJson<ProjectIndex>(p.projects, {});
  recomputeProjectDate(index, rec.project, rec.date, day);
  writeJson(p.projects, index);

  // 4) Re-render the affected daily note + project MOC.
  renderDaily(vault, day);
  renderProject(vault, rec.project, index[rec.project]!);

  return { alreadyIngested: already, date: rec.date, project: rec.project, dailyPath: join(p.dailyDir, `${rec.date}.md`) };
}

function recomputeProjectDate(index: ProjectIndex, project: string, date: string, day: DayFile): void {
  const recs = Object.values(day.sessions).filter((s) => s.project === project);
  const stat: ProjectStat = index[project] ?? { firstSeen: date, lastActive: date, byDate: {} };
  if (recs.length === 0) {
    delete stat.byDate[date];
  } else {
    stat.byDate[date] = {
      min: recs.reduce((a, s) => a + s.activeMin, 0),
      sessions: recs.length,
      sample: recs.sort((a, b) => a.start.localeCompare(b.start))[0]!.intent,
    };
  }
  const dates = Object.keys(stat.byDate).sort();
  stat.firstSeen = dates[0] ?? date;
  stat.lastActive = dates[dates.length - 1] ?? date;
  index[project] = stat;
}

// ---------- Markdown rendering ----------

function fmList(items: string[]): string {
  return `[${items.join(", ")}]`;
}

function renderDaily(vault: string, day: DayFile): void {
  const p = paths(vault);
  const recs = Object.values(day.sessions).sort((a, b) => a.start.localeCompare(b.start));
  const agents = [...new Set(recs.map((r) => r.agent))].sort();
  const projects = [...new Set(recs.map((r) => r.project))];
  const tools = [...new Set(recs.flatMap((r) => r.tools))].sort();
  const activeMin = recs.reduce((a, r) => a + r.activeMin, 0);

  const fm = [
    "---",
    `date: ${day.date}`,
    `agents: ${fmList(agents)}`,
    `projects: ${fmList(projects.map((x) => `"[[${x}]]"`))}`,
    `tools: ${fmList(tools)}`,
    `sessions: ${recs.length}`,
    `active_min: ${activeMin}`,
    `tags: [area/dev]`,
    "---",
    "",
    `# ${day.date}`,
    "",
  ];

  const body: string[] = [];
  for (const r of recs) {
    body.push(`## [[${r.project}]] · ${r.agent} · ${r.activeMin}m`);
    body.push(`- 意図: ${r.intent}`);
    if (r.files.length) body.push(`- 変更ファイル: ${r.files.join(", ")}`);
    if (r.commandCount > 0) {
      const cats = Object.entries(r.commandCats)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([k]) => k);
      body.push(`- コマンド: ${r.commandCount}回 (${cats.join(", ")})`);
    }
    // errorCount is kept in the store but not surfaced as a bare count (low signal);
    // a meaningful "recurring blocker" view is planned via error fingerprints (v0.4).
    if (r.commits?.length) body.push(`- 成果: ${r.commits.map((c) => `\`${c}\``).join(" / ")}`);
    body.push("");
  }

  writeAtomic(join(p.dailyDir, `${day.date}.md`), fm.concat(body).join("\n"));
}

function renderProject(vault: string, project: string, stat: ProjectStat): void {
  const p = paths(vault);
  const totalMin = Object.values(stat.byDate).reduce((a, d) => a + d.min, 0);
  const dates = Object.keys(stat.byDate).sort((a, b) => b.localeCompare(a)); // desc

  const out = [
    "---",
    "type: project",
    `first_seen: ${stat.firstSeen}`,
    `last_active: ${stat.lastActive}`,
    `total_min: ${totalMin}`,
    "---",
    "",
    `# ${project}`,
    "",
    "## ログ",
    ...dates.map((d) => {
      const e = stat.byDate[d]!;
      return `- [[${d}]] — ${e.min}m · ${e.sample}`;
    }),
    "",
  ];

  writeAtomic(join(p.projectsDir, `${project}.md`), out.join("\n"));
}

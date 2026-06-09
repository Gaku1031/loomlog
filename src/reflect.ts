import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildReport, buildPatterns, type ReportOptions } from "./report.ts";

/**
 * Reflection templates grounded in established reflective-practice frameworks.
 * loomlog mechanically fills the factual stage ("What" / Description / Objective);
 * the host model facilitates the interpretive stages with the user, then the result
 * is saved back into the vault under Reflections/ (which capture never overwrites).
 */
export type Template = "wsn" | "gibbs" | "aar" | "kpt" | "ywt";

interface Stage {
  key: string;
  label: string;
  /** When true, loomlog's facts fill this stage; otherwise the model asks the user. */
  fromFacts?: boolean;
  /** Questions the host model should ask the user (interactive reflection). */
  ask?: string[];
}

interface Framework {
  id: Template;
  name: string;
  source: string;
  scope: "day" | "week";
  intro: string;
  stages: Stage[];
}

export const FRAMEWORKS: Record<Template, Framework> = {
  wsn: {
    id: "wsn",
    name: "What / So What / Now What",
    source: "Borton 1970 → Driscoll 1994 / Rolfe et al. 2001",
    scope: "day",
    intro: "最小摩擦の3段の振り返り。事実→意味→次の一手。",
    stages: [
      { key: "what", label: "What — 何をしたか", fromFacts: true },
      {
        key: "so_what",
        label: "So What — それにどんな意味があったか",
        ask: ["今日の中で一番重要だった作業は？", "詰まったとしたら、その原因は何だった？", "新しく分かったこと・決めたことは？"],
      },
      { key: "now_what", label: "Now What — 次にどうするか", ask: ["次にやること、または変えることは？"] },
    ],
  },
  gibbs: {
    id: "gibbs",
    name: "Gibbs Reflective Cycle",
    source: "Gibbs 1988, Learning by Doing",
    scope: "week",
    intro: "6段の深い振り返り。週次/月次向き。",
    stages: [
      { key: "description", label: "Description — 何が起きたか", fromFacts: true },
      { key: "feelings", label: "Feelings — どう感じたか", ask: ["この期間の手応え・フラストレーションは？"] },
      { key: "evaluation", label: "Evaluation — 良かった点/悪かった点", ask: ["うまくいったことは？ うまくいかなかったことは？"] },
      { key: "analysis", label: "Analysis — なぜそうなったか", ask: ["詰まりや停滞の根っこは何？ 繰り返し現れた問題は？", "宣言した意図と実際の時間配分はズレていた？"] },
      { key: "conclusion", label: "Conclusion — 学び", ask: ["他にできたことは？ 何を学んだ？"] },
      { key: "action_plan", label: "Action plan — 行動計画", ask: ["来週、具体的に何を変える/やる？"] },
    ],
  },
  aar: {
    id: "aar",
    name: "After-Action Review",
    source: "U.S. Army AAR (Reach, Touch, and Teach lineage)",
    scope: "day",
    intro: "「やる気だったこと vs 実際」を4問で詰める。詰まりの多い期間向き。",
    stages: [
      { key: "expected", label: "What was expected — 何をするつもりだったか", fromFacts: true },
      { key: "actual", label: "What actually happened — 実際に何が起きたか", fromFacts: true },
      { key: "difference", label: "Why the difference — 差分の原因", ask: ["期待と実際の差はどこ？ なぜ生まれた？", "同じ失敗を繰り返していない？"] },
      { key: "learn", label: "What to change — 次への学び", ask: ["次に維持すること・変えることは？"] },
    ],
  },
  kpt: {
    id: "kpt",
    name: "KPT (Keep / Problem / Try)",
    source: "Cockburn Reflection Workshop 系 (アジャイル実践)",
    scope: "day",
    intro: "軽量。続けること・問題・次に試すこと。",
    stages: [
      { key: "keep", label: "Keep — 続けたいこと", fromFacts: true, ask: ["うまくいって続けたいことは？(成果commitが候補)"] },
      { key: "problem", label: "Problem — 問題点", fromFacts: true, ask: ["問題だったことは？(詰まりが候補)"] },
      { key: "try", label: "Try — 次に試すこと", ask: ["次に試すことは？"] },
    ],
  },
  ywt: {
    id: "ywt",
    name: "YWT (やったこと / わかったこと / つぎにやること)",
    source: "日本創造学会 経験学習モデル",
    scope: "day",
    intro: "軽量。経験学習の型。",
    stages: [
      { key: "yatta", label: "やったこと", fromFacts: true },
      { key: "wakatta", label: "わかったこと", ask: ["この作業から分かったこと・気づいたことは？"] },
      { key: "tsugi", label: "つぎにやること", ask: ["次にやることは？"] },
    ],
  },
};

export function isTemplate(s: string): s is Template {
  return s === "wsn" || s === "gibbs" || s === "aar" || s === "kpt" || s === "ywt";
}

/** Build the reflection context (facts + framework stages) for the host model to facilitate. */
export function buildReflection(vault: string, template: Template, opts: ReportOptions) {
  const fw = FRAMEWORKS[template];
  // Default the scope to the framework's natural one if the caller didn't specify.
  const scoped: ReportOptions = { ...opts };
  if (!opts.week && !opts.since && !opts.date && fw.scope === "week") scoped.week = true;

  const report = buildReport(vault, scoped);
  const patterns = buildPatterns(vault, scoped);
  return {
    template: { id: fw.id, name: fw.name, source: fw.source, intro: fw.intro },
    scope: report.range,
    facts: { report, patterns },
    stages: fw.stages,
    save: {
      hint: "内省が終わったら、組み立てた markdown を stdin で渡して保存してください。",
      command: `loomlog reflect-save --date ${report.range.to} --template ${fw.id}${fw.scope === "week" ? " --weekly" : ""}`,
    },
  };
}

/** Append a finished reflection to Reflections/<date>[-weekly].md (capture never touches this dir). */
export function saveReflection(
  vault: string,
  o: { date: string; template: Template; weekly?: boolean; body: string; projects?: string[] },
): string {
  const dir = join(vault, "Reflections");
  mkdirSync(dir, { recursive: true });
  const fw = FRAMEWORKS[o.template];
  const file = join(dir, `${o.date}${o.weekly ? "-weekly" : ""}.md`);
  const links = [`[[${o.date}]]`, ...(o.projects ?? []).map((p) => `[[${p}]]`)].join(" · ");

  if (!existsSync(file)) {
    const header = [
      "---",
      "type: reflection",
      `template: ${o.template}`,
      `date: ${o.date}`,
      "---",
      "",
      `# 振り返り — ${o.date}${o.weekly ? " (週次)" : ""}`,
      "",
      `> related: ${links}`,
      "",
    ].join("\n");
    writeFileSync(file, header);
  }
  appendFileSync(file, `\n## ${fw.name}\n\n${o.body.trim()}\n`);
  return file;
}

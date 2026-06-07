import { createReadStream } from "node:fs";
import { basename, relative } from "node:path";
import { createInterface } from "node:readline";
import type { SessionRecord } from "../types.ts";
import { redact } from "../redact.ts";
import { activeMinutes, commandCategory, localDate, tally } from "../util.ts";

const PATCH_FILE_RE = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm;

/** Skip Codex's injected synthetic first messages (AGENTS.md / environment / instructions blocks). */
function isHumanPrompt(text: string): boolean {
  const t = text.trimStart();
  if (!t) return false;
  if (t.startsWith("#") && t.includes("AGENTS.md")) return false;
  if (t.startsWith("<environment_context>") || t.startsWith("<user_instructions>")) return false;
  if (t.startsWith("<INSTRUCTIONS>")) return false;
  return true;
}

/** Pull readable text out of a Codex message content array. */
function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b: any) => (typeof b?.text === "string" ? b.text : ""))
    .join(" ")
    .trim();
}

/** Extract the shell command string from an exec_command / shell function_call. */
function execCommand(name: string, args: unknown): string | null {
  if (typeof args !== "string") return null;
  let parsed: any;
  try {
    parsed = JSON.parse(args);
  } catch {
    return null;
  }
  if (name === "exec_command" && typeof parsed?.cmd === "string") return parsed.cmd;
  if (name === "shell") {
    const c = parsed?.command;
    if (Array.isArray(c)) return c.join(" ");
    if (typeof c === "string") return c;
  }
  return null;
}

/**
 * Parse one Codex rollout file (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl)
 * into a normalized SessionRecord. Streams line-by-line (rollouts can reach GBs).
 */
export async function parseCodexRollout(path: string): Promise<SessionRecord | null> {
  const timestamps: string[] = [];
  const files = new Set<string>();
  const commandCatList: string[] = [];
  const tools = new Set<string>();
  let commandCount = 0;
  let errorCount = 0;
  let id: string | undefined;
  let cwd: string | undefined;
  let intent: string | undefined;

  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.timestamp) timestamps.push(o.timestamp);

    if (o.type === "session_meta") {
      id = o.payload?.id ?? id;
      cwd = o.payload?.cwd ?? cwd;
      continue;
    }
    if (o.type !== "response_item") continue;
    const p = o.payload ?? {};

    if (p.type === "message" && p.role === "user" && !intent) {
      const text = messageText(p.content);
      if (isHumanPrompt(text)) intent = text.trim().replace(/\s+/g, " ").slice(0, 120);
    } else if (p.type === "function_call") {
      tools.add(p.name ?? "function_call");
      const cmd = execCommand(p.name, p.arguments);
      if (cmd !== null) {
        commandCount++;
        commandCatList.push(commandCategory(cmd));
      }
    } else if (p.name === "apply_patch" || p.type === "apply_patch") {
      tools.add("apply_patch");
      const patch: string = p.input ?? p.arguments ?? "";
      for (const m of patch.matchAll(PATCH_FILE_RE)) files.add(m[1]!.trim());
    } else if (p.type === "custom_tool_call") {
      tools.add(p.name ?? "custom_tool_call");
    } else if (p.type === "function_call_output") {
      // Best-effort blocker detection: non-zero exit code in the tool output.
      try {
        const out = typeof p.output === "string" ? JSON.parse(p.output) : p.output;
        if (out?.metadata?.exit_code && out.metadata.exit_code !== 0) errorCount++;
      } catch {
        /* output not structured — skip */
      }
    }
  }

  if (timestamps.length === 0) return null;
  timestamps.sort();
  const start = timestamps[0]!;
  const end = timestamps[timestamps.length - 1]!;
  const wd = cwd ?? process.cwd();

  const fileList = [...files]
    .map((f) => {
      const rel = relative(wd, f);
      return redact(rel.startsWith("..") ? basename(f) : rel);
    })
    .slice(0, 40);

  return {
    id: id ?? basename(path).replace(/^rollout-/, "").replace(/\.jsonl$/, ""),
    agent: "codex",
    project: basename(wd) || "unknown",
    cwd: wd,
    date: localDate(start),
    start,
    end,
    activeMin: activeMinutes(timestamps),
    intent: intent ? redact(intent) : "(no prompt captured)",
    files: fileList,
    commandCount,
    commandCats: tally(commandCatList),
    tools: [...tools].sort(),
    errorCount,
    sourcePath: path,
  };
}

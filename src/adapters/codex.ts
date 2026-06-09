import { createReadStream } from "node:fs";
import { basename, isAbsolute, normalize, relative } from "node:path";
import { createInterface } from "node:readline";
import { SCHEMA_VERSION, type SessionRecord } from "../types.ts";
import { redactClip } from "../redact.ts";
import { activeMinutes, commandCategory, extractCommits, homeShorten, localDate, tally } from "../util.ts";

const PATCH_FILE_RE = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm;

/**
 * Strip Codex's injected synthetic blocks (AGENTS.md / environment / instructions)
 * and return the residual real request, or "" if nothing real remains. Codex often
 * delivers the synthetic preamble and the real prompt as separate user messages, but
 * sometimes bundles them — stripping (rather than dropping the whole message) keeps
 * the intent in both shapes.
 */
function cleanIntent(text: string): string {
  let t = text
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, " ")
    .replace(/<user_instructions>[\s\S]*?<\/user_instructions>/gi, " ")
    .replace(/<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>/gi, " ")
    .replace(/^#\s*AGENTS\.md[^\n]*$/gim, " ");
  t = t.trim();
  // A bare AGENTS.md header with nothing else is not a real prompt.
  if (/^#\s*AGENTS\.md/i.test(text.trimStart()) && !t) return "";
  return t;
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

/**
 * Extract the shell command string from a function_call.
 * Codex has used several names over time: `exec_command` ({cmd}), `shell` and the
 * newer `shell_command` ({command} as a string or an argv array).
 */
function execCommand(name: string | undefined, args: unknown): string | null {
  if (typeof args !== "string") return null;
  let parsed: any;
  try {
    parsed = JSON.parse(args);
  } catch {
    return null;
  }
  const raw = name === "exec_command" ? parsed?.cmd : parsed?.command;
  if (Array.isArray(raw)) return raw.join(" ");
  if (typeof raw === "string") return raw;
  return null;
}

/** Get the raw patch body from an apply_patch call (custom_tool_call `input` or function_call `arguments`). */
function patchBody(raw: unknown): string {
  if (typeof raw !== "string") return "";
  if (raw.includes("*** Begin Patch") || /^\*\*\* (?:Update|Add|Delete) File:/m.test(raw)) return raw;
  try {
    const j = JSON.parse(raw);
    if (typeof j?.input === "string") return j.input;
    if (typeof j?.patch === "string") return j.patch;
  } catch {
    /* not JSON — treat as raw */
  }
  return raw;
}

/** Best-effort "this tool call failed" signal from a tool output (string or structured). */
function isFailureOutput(output: unknown): boolean {
  if (typeof output === "string") {
    const m = output.match(/^Exit code:\s*(-?\d+)/m); // newer plain-text shell output
    if (m) return Number(m[1]) !== 0;
    try {
      const j = JSON.parse(output); // older structured output
      const c = j?.metadata?.exit_code;
      if (typeof c === "number") return c !== 0;
    } catch {
      /* not JSON */
    }
    // apply_patch failures surface as a leading "...failed" line.
    if (/^apply_patch[\s\S]*?\bfailed\b/i.test(output)) return true;
    return false;
  }
  if (output && typeof output === "object") {
    const c = (output as any)?.metadata?.exit_code;
    if (typeof c === "number") return c !== 0;
  }
  return false;
}

/**
 * Parse one Codex rollout file (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl)
 * into a normalized SessionRecord. Streams line-by-line (rollouts can reach GBs).
 */
export async function parseCodexRollout(path: string): Promise<SessionRecord | null> {
  const timestamps: string[] = [];
  const files = new Set<string>();
  const commandCatList: string[] = [];
  const commits = new Set<string>();
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
    const ptype: string | undefined = p.type;
    const name: string | undefined = p.name;

    if (ptype === "message" && p.role === "user" && !intent) {
      const text = cleanIntent(messageText(p.content));
      if (text) intent = text;
    } else if ((ptype === "function_call" || ptype === "custom_tool_call") && name === "apply_patch") {
      // apply_patch shows up as a custom_tool_call (input=patch) or a function_call (arguments JSON).
      tools.add("apply_patch");
      for (const m of patchBody(p.input ?? p.arguments).matchAll(PATCH_FILE_RE)) files.add(m[1]!.trim());
    } else if (ptype === "function_call") {
      tools.add(name ?? "function_call");
      const cmd = execCommand(name, p.arguments);
      if (cmd !== null) {
        commandCount++;
        commandCatList.push(commandCategory(cmd));
        for (const c of extractCommits(cmd)) commits.add(c);
      }
    } else if (ptype === "custom_tool_call") {
      tools.add(name ?? "custom_tool_call");
    } else if (ptype === "apply_patch") {
      // Legacy standalone form.
      tools.add("apply_patch");
      for (const m of patchBody(p.input ?? p.arguments).matchAll(PATCH_FILE_RE)) files.add(m[1]!.trim());
    } else if (ptype === "function_call_output" || ptype === "custom_tool_call_output") {
      if (isFailureOutput(p.output)) errorCount++;
    }
  }

  if (timestamps.length === 0) return null;
  timestamps.sort();
  const start = timestamps[0]!;
  const end = timestamps[timestamps.length - 1]!;
  const wd = cwd ?? process.cwd();

  const fileList = [...files]
    .map((f) => redactClip(isAbsolute(f) ? (relative(wd, f).startsWith("..") ? basename(f) : relative(wd, f)) : normalize(f), 200))
    .slice(0, 40);

  return {
    id: id ?? basename(path).replace(/^rollout-/, "").replace(/\.jsonl$/, ""),
    agent: "codex",
    project: basename(wd) || "unknown",
    cwd: homeShorten(wd),
    date: localDate(start),
    start,
    end,
    activeMin: activeMinutes(timestamps),
    intent: intent ? redactClip(intent) : "(no prompt captured)",
    files: fileList,
    commandCount,
    commandCats: tally(commandCatList),
    tools: [...tools].sort(),
    errorCount,
    commits: [...commits].map((c) => redactClip(c, 140)).slice(0, 20),
    sourcePath: homeShorten(path),
    schemaVersion: SCHEMA_VERSION,
  };
}

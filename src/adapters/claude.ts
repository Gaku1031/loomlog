import { createReadStream } from "node:fs";
import { basename, isAbsolute, normalize, relative } from "node:path";
import { createInterface } from "node:readline";
import { SCHEMA_VERSION, type SessionRecord } from "../types.ts";
import { redact, redactClip } from "../redact.ts";
import { activeMinutes, commandCategory, extractCommits, homeShorten, localDate, tally } from "../util.ts";

const FILE_TOOLS = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit"]);

/** Skip pseudo-prompts (system reminders, slash-command echoes, caveats, interrupts). */
function isHumanPrompt(text: string): boolean {
  const t = text.trimStart();
  if (!t) return false;
  if (t.startsWith("<")) return false; // <system-reminder>, <command-name>, ...
  if (t.startsWith("Caveat:")) return false;
  if (t.startsWith("[Request interrupted")) return false;
  if (t.includes("command-name") || t.includes("local-command")) return false;
  return true;
}

/**
 * Parse one Claude Code transcript (.jsonl) into a normalized SessionRecord.
 * Streams line-by-line so large transcripts never load fully into memory.
 */
export async function parseClaudeTranscript(path: string): Promise<SessionRecord | null> {
  const timestamps: string[] = [];
  const cwdCounts = new Map<string, number>();
  const files = new Set<string>();
  const commandCatList: string[] = [];
  const commits = new Set<string>();
  const tools = new Set<string>();
  const prompts: string[] = [];
  let commandCount = 0;
  let errorCount = 0;
  let sessionId: string | undefined;

  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.sessionId) sessionId = o.sessionId;
    if (o.timestamp) timestamps.push(o.timestamp);
    if (o.cwd) cwdCounts.set(o.cwd, (cwdCounts.get(o.cwd) ?? 0) + 1);

    const msg = o.message;
    if (!msg || !msg.role) continue;

    // Prompts: genuine human string turns. Keep full text here; redaction + clipping
    // happen at record build (redact-before-truncate).
    if (o.type === "user" && typeof msg.content === "string" && isHumanPrompt(msg.content)) {
      prompts.push(msg.content.trim());
    }

    if (Array.isArray(msg.content)) {
      for (const b of msg.content) {
        if (b.type === "tool_use") {
          tools.add(b.name);
          if (FILE_TOOLS.has(b.name) && b.input?.file_path) files.add(b.input.file_path);
          if (b.name === "Bash" && typeof b.input?.command === "string") {
            commandCount++;
            commandCatList.push(commandCategory(b.input.command));
            for (const c of extractCommits(b.input.command)) commits.add(c);
          }
        } else if (b.type === "tool_result" && b.is_error) {
          errorCount++;
        }
      }
    }
  }

  if (timestamps.length === 0) return null;
  timestamps.sort();
  const start = timestamps[0]!;
  const end = timestamps[timestamps.length - 1]!;

  // Most-frequent cwd wins as the session's project.
  let cwd = process.cwd();
  let best = -1;
  for (const [c, n] of cwdCounts) if (n > best) ((best = n), (cwd = c));
  const project = basename(cwd) || "unknown";

  // Files: relative to cwd when the path is absolute, normalized otherwise; redacted; capped.
  const fileList = [...files]
    .map((f) => {
      if (!isAbsolute(f)) return redactClip(normalize(f), 200);
      const rel = relative(cwd, f);
      return redactClip(rel.startsWith("..") ? basename(f) : rel, 200);
    })
    .slice(0, 40);
  const promptList = prompts.map((p) => redactClip(p, 180)).filter(Boolean).slice(0, 24);
  const intent = promptList[0];

  return {
    id: sessionId ?? basename(path).replace(/\.jsonl$/, ""),
    agent: "claude-code",
    project: redact(project),
    cwd: redact(homeShorten(cwd)),
    date: localDate(start),
    start,
    end,
    activeMin: activeMinutes(timestamps),
    intent: intent ?? "(no prompt captured)",
    prompts: promptList,
    files: fileList,
    commandCount,
    commandCats: tally(commandCatList),
    tools: [...tools].sort(),
    errorCount,
    commits: [...commits].map((c) => redactClip(c, 140)).slice(0, 20),
    sourcePath: redact(homeShorten(path)),
    schemaVersion: SCHEMA_VERSION,
  };
}

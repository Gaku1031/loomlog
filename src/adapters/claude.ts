import { createReadStream } from "node:fs";
import { basename, relative } from "node:path";
import { createInterface } from "node:readline";
import type { SessionRecord } from "../types.ts";
import { redact } from "../redact.ts";
import { activeMinutes, localDate, tally } from "../util.ts";

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

/** Leading command name from a shell command line (strips env-assignments / sudo / path). */
function commandCategory(cmd: string): string {
  for (let tok of cmd.trim().split(/\s+/)) {
    if (!tok || tok === "sudo" || tok === "\\") continue; // skip blanks, sudo, line-continuation
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) continue; // FOO=bar
    tok = tok.replace(/^.*\//, "").replace(/[;|&].*$/, ""); // basename, drop trailing operators
    return tok.toLowerCase();
  }
  return "?";
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
  const tools = new Set<string>();
  let commandCount = 0;
  let errorCount = 0;
  let sessionId: string | undefined;
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
    if (o.sessionId) sessionId = o.sessionId;
    if (o.timestamp) timestamps.push(o.timestamp);
    if (o.cwd) cwdCounts.set(o.cwd, (cwdCounts.get(o.cwd) ?? 0) + 1);

    const msg = o.message;
    if (!msg || !msg.role) continue;

    // Intent: first genuine human prompt (string content on a user turn).
    if (o.type === "user" && typeof msg.content === "string" && !intent && isHumanPrompt(msg.content)) {
      intent = msg.content.trim().replace(/\s+/g, " ").slice(0, 120);
    }

    if (Array.isArray(msg.content)) {
      for (const b of msg.content) {
        if (b.type === "tool_use") {
          tools.add(b.name);
          if (FILE_TOOLS.has(b.name) && b.input?.file_path) files.add(b.input.file_path);
          if (b.name === "Bash" && typeof b.input?.command === "string") {
            commandCount++;
            commandCatList.push(commandCategory(b.input.command));
          }
        } else if (b.type === "tool_result" && b.is_error) {
          errorCount++;
        }
      }
    }
    if (o.toolUseResult?.is_error) errorCount++;
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

  // Files: relative to cwd when possible, basename otherwise; redacted; capped.
  const fileList = [...files]
    .map((f) => {
      const rel = relative(cwd, f);
      return redact(rel.startsWith("..") ? basename(f) : rel);
    })
    .slice(0, 40);

  return {
    id: sessionId ?? basename(path).replace(/\.jsonl$/, ""),
    agent: "claude-code",
    project,
    cwd,
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

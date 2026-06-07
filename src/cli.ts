#!/usr/bin/env node
import { captureFile } from "./capture.ts";
import { resolveVault } from "./util.ts";
import type { AgentId } from "./types.ts";

const USAGE = `loomlog — local, cross-agent dev journal

Usage:
  loomlog capture <session-log-path> [--vault <dir>] [--agent <claude-code|codex|gemini>]
      Parse one agent session log into the vault (mechanical, no LLM).

Options:
  --vault <dir>   Vault directory (default: $LOOMLOG_VAULT or ~/loomlog)
  --agent <id>    Force the source agent (default: auto-detect from path)

More commands (scan/init/report) coming as adapters land.`;

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      flags[a.slice(2)] = args[++i] ?? "";
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseFlags(rest);

  switch (cmd) {
    case "capture": {
      const path = positional[0];
      if (!path) {
        console.error("error: capture needs a <session-log-path>\n");
        console.error(USAGE);
        process.exit(1);
      }
      const vault = resolveVault(flags.vault);
      const res = await captureFile(path, vault, flags.agent as AgentId | undefined);
      if (!res) {
        console.error(`no session data found in ${path}`);
        process.exit(1);
      }
      const verb = res.alreadyIngested ? "re-captured" : "captured";
      console.log(`✓ ${verb} ${res.project} → ${res.date}`);
      console.log(`  ${res.dailyPath}`);
      break;
    }
    case undefined:
    case "-h":
    case "--help":
      console.log(USAGE);
      break;
    default:
      console.error(`unknown command: ${cmd}\n`);
      console.error(USAGE);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

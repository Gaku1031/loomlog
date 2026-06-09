import { spawnSync } from "node:child_process";
import { platform } from "node:os";

export interface CopyResult {
  ok: boolean;
  /** Which tool succeeded ("pbcopy+rtf", "pbcopy", "wl-copy", "xclip", "xsel", "clip", "none"). */
  mechanism: string;
  /** True when a rich-text flavor (RTF / text/html) landed on the clipboard, not just plain text. */
  rich: boolean;
}

export interface ClipboardPayload {
  /** Plain-text fallback (always set). For paste targets without a rich handler. */
  plain: string;
  /** HTML document (charset-tagged). When present and the platform supports it, copied as rich text. */
  html?: string;
}

const NONE: CopyResult = { ok: false, mechanism: "none", rich: false };

/** Run a clipboard tool, feeding `input` on stdin. Never throws — a missing binary returns false. */
function feed(cmd: string, args: string[], input: string | Buffer): boolean {
  try {
    const r = spawnSync(cmd, args, { input, stdio: ["pipe", "ignore", "ignore"] });
    return !r.error && r.status === 0;
  } catch {
    return false;
  }
}

/** macOS only: convert an HTML document to RTF bytes via the built-in `textutil`. */
function htmlToRtf(html: string): Buffer | null {
  try {
    const r = spawnSync("textutil", ["-stdin", "-format", "html", "-convert", "rtf", "-stdout"], {
      input: html,
      stdio: ["pipe", "pipe", "ignore"],
    });
    if (!r.error && r.status === 0 && r.stdout && r.stdout.length) return r.stdout;
  } catch {
    /* fall through to plain */
  }
  return null;
}

/**
 * Put `payload` on the system clipboard, preferring a rich flavor so it renders (not as raw
 * text) when pasted into Notion / Slack / Docs. macOS: HTML → RTF via `textutil` → `pbcopy`
 * (both built in, no extra deps). Linux: `wl-copy`/`xclip` with a `text/html` target if present,
 * else plain. Windows: `clip` (plain only). Falls back to plain text everywhere, and reports
 * `ok:false` if no clipboard tool is available so the caller can print instead.
 *
 * Decoupled from rendering: pass `html` to opt into rich, omit it to force plain.
 */
export function copyToClipboard(payload: ClipboardPayload): CopyResult {
  const os = platform();

  if (os === "darwin") {
    if (payload.html) {
      const rtf = htmlToRtf(payload.html);
      if (rtf && feed("pbcopy", [], rtf)) return { ok: true, mechanism: "pbcopy+rtf", rich: true };
    }
    return feed("pbcopy", [], payload.plain) ? { ok: true, mechanism: "pbcopy", rich: false } : NONE;
  }

  if (os === "win32") {
    return feed("clip", [], payload.plain) ? { ok: true, mechanism: "clip", rich: false } : NONE;
  }

  // Linux / other Unix. Wayland (wl-copy) first, then X11 (xclip, xsel).
  if (payload.html) {
    if (feed("wl-copy", ["--type", "text/html"], payload.html)) return { ok: true, mechanism: "wl-copy", rich: true };
    if (feed("xclip", ["-selection", "clipboard", "-t", "text/html"], payload.html))
      return { ok: true, mechanism: "xclip", rich: true };
  }
  if (feed("wl-copy", [], payload.plain)) return { ok: true, mechanism: "wl-copy", rich: false };
  if (feed("xclip", ["-selection", "clipboard"], payload.plain)) return { ok: true, mechanism: "xclip", rich: false };
  if (feed("xsel", ["--clipboard", "--input"], payload.plain)) return { ok: true, mechanism: "xsel", rich: false };
  return NONE;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Convert the *subset* of Markdown that loomlog's renderMarkdown emits — ATX headings (`#`..`######`),
 * column-0 `- ` bullets, and plain paragraphs — into a complete, UTF-8-tagged HTML document.
 * Block-level only by design: free text (prompts, paths, commits) is HTML-escaped and never
 * re-parsed for inline `*`/`` ` `` markers, so journal content is never silently restyled or
 * able to inject markup. The `<meta charset>` is required — without it `textutil` mangles 日本語.
 */
export function mdToHtml(md: string): string {
  const body: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      body.push("</ul>");
      inList = false;
    }
  };

  for (const raw of md.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1]!.length;
      body.push(`<h${level}>${escapeHtml(heading[2]!)}</h${level}>`);
      continue;
    }
    const bullet = /^- (.*)$/.exec(line);
    if (bullet) {
      if (!inList) {
        body.push("<ul>");
        inList = true;
      }
      body.push(`<li>${escapeHtml(bullet[1]!)}</li>`);
      continue;
    }
    closeList();
    if (line.trim() !== "") body.push(`<p>${escapeHtml(line)}</p>`);
  }
  closeList();

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>\n${body.join("\n")}\n</body></html>`;
}

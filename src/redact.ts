/**
 * Secret redaction — runs on every string before it is written to the vault.
 * This is the trust lifeline of a public tool: it reads people's repos & prompts,
 * so we must never persist credentials. Defense in depth, not a guarantee.
 */

type Rule = { re: RegExp; replace: string | ((m: string, ...g: string[]) => string) };

const RULES: Rule[] = [
  // PEM private keys
  {
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: "«private-key redacted»",
  },
  // Provider API keys / tokens
  { re: /sk-[A-Za-z0-9_-]{16,}/g, replace: "«openai-key»" },
  { re: /sk-ant-[A-Za-z0-9_-]{16,}/g, replace: "«anthropic-key»" },
  { re: /gh[pousr]_[A-Za-z0-9]{20,}/g, replace: "«github-token»" },
  { re: /xox[baprs]-[A-Za-z0-9-]{10,}/g, replace: "«slack-token»" },
  { re: /AKIA[0-9A-Z]{16}/g, replace: "«aws-key»" },
  { re: /AIza[0-9A-Za-z_-]{30,}/g, replace: "«google-key»" },
  // JWT
  {
    re: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    replace: "«jwt»",
  },
  // KEY=VALUE / "key": "value" for sensitive-looking keys — keep the key, mask the value
  {
    re: /\b([A-Za-z0-9_]*(?:secret|token|password|passwd|api[_-]?key|access[_-]?key)[A-Za-z0-9_]*)\b(\s*[:=]\s*)["']?[^\s"',}]+/gi,
    replace: (_m, key: string, sep: string) => `${key}${sep}«redacted»`,
  },
];

export function redact(input: string): string {
  let out = input;
  for (const { re, replace } of RULES) {
    out = out.replace(re, replace as string);
  }
  return out;
}

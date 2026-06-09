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
  // Provider API keys / tokens (most-specific prefixes first)
  { re: /sk-ant-[A-Za-z0-9_-]{16,}/g, replace: "«anthropic-key»" },
  { re: /sk-[A-Za-z0-9_-]{16,}/g, replace: "«openai-key»" },
  { re: /github_pat_[A-Za-z0-9_]{20,}/g, replace: "«github-pat»" },
  { re: /gh[pousr]_[A-Za-z0-9]{20,}/g, replace: "«github-token»" },
  { re: /glpat-[A-Za-z0-9_-]{20,}/g, replace: "«gitlab-token»" },
  { re: /npm_[A-Za-z0-9]{36}/g, replace: "«npm-token»" },
  { re: /\b[sr]k_live_[A-Za-z0-9]{16,}/g, replace: "«stripe-key»" },
  { re: /\bsecret_[A-Za-z0-9]{32,}/g, replace: "«notion-secret»" },
  { re: /\bhf_[A-Za-z0-9]{32,}/g, replace: "«hf-token»" },
  { re: /xox[baprs]-[A-Za-z0-9-]{10,}/g, replace: "«slack-token»" },
  { re: /\bya29\.[A-Za-z0-9_-]+/g, replace: "«google-oauth»" },
  { re: /AIza[0-9A-Za-z_-]{30,}/g, replace: "«google-key»" },
  { re: /\b(?:AKIA|ASIA|AROA|AIDA)[0-9A-Z]{16}\b/g, replace: "«aws-key»" },
  { re: /\bsb_secret_[A-Za-z0-9_-]{16,}/g, replace: "«supabase-secret»" },
  { re: /\bsbp_[A-Za-z0-9]{20,}/g, replace: "«supabase-token»" },
  { re: /\blin_api_[A-Za-z0-9]{20,}/g, replace: "«linear-key»" },
  // Presigned-URL signatures: AWS SigV4 query params and Azure SAS `sig=` (only inside a query string)
  {
    re: /([?&](?:X-Amz-Signature|X-Amz-Credential|sig)=)[^&\s"'<>]+/gi,
    replace: (_m, k: string) => `${k}«redacted»`,
  },
  // Slack / Discord incoming-webhook URLs
  { re: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9\/]+/g, replace: "«slack-webhook»" },
  { re: /https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+/g, replace: "«discord-webhook»" },
  // Bearer tokens in an Authorization header
  { re: /\b(Authorization\s*:\s*Bearer)\s+[A-Za-z0-9._~+/=-]{12,}/gi, replace: (_m, k: string) => `${k} «redacted»` },
  // Credentials embedded in a URL: scheme://user:pass@host
  { re: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):[^\s:/@]+@/gi, replace: (_m, head: string) => `${head}:«redacted»@` },
  // JWT
  {
    re: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    replace: "«jwt»",
  },
  // KEY=VALUE / "key": "value" for sensitive-looking keys — keep the key, mask the value.
  // The optional quotes around the separator cover JSON ("password": "x") as well as
  // shell/env (PASSWORD=x) forms.
  {
    re: /\b([A-Za-z0-9_]*(?:secret|token|password|passwd|api[_-]?key|access[_-]?key)[A-Za-z0-9_]*)\b["']?(\s*[:=]\s*)["']?[^\s"',}]+/gi,
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

/**
 * Re-join tokens that were wrapped across a line break, so a secret split over a
 * newline (e.g. "sk-ant-\nAAAA…", a pasted key that word-wrapped) can't slip past the
 * prefix rules whose character classes don't cross "\n". Only joins across an actual
 * line break flanked by token characters — normal prose separated by spaces is untouched,
 * and a chance join like "quick\nbrown" → "quickbrown" matches no secret rule, so it's inert.
 */
function dewrap(input: string): string {
  return input.replace(/([A-Za-z0-9_+/=-])[ \t]*\r?\n[ \t]*(?=[A-Za-z0-9_+/=-])/g, "$1");
}

/**
 * Redact, collapse whitespace, THEN clip to `max` chars.
 * Order matters: clipping first could split a secret across the boundary and
 * defeat the redaction regex, so redaction always runs on the full string.
 * `dewrap` first defeats newline-obfuscated secrets; safe because this function
 * discards formatting anyway (whitespace is collapsed just below).
 */
export function redactClip(input: string, max = 120): string {
  return redact(dewrap(input)).replace(/\s+/g, " ").trim().slice(0, max);
}

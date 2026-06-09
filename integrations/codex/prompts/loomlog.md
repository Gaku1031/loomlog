Run `loomlog scan all --since $(date +%F) --vault "${LOOMLOG_VAULT:-./.loomlog-vault}"` to refresh today's sessions, then run `loomlog report --json --vault "${LOOMLOG_VAULT:-./.loomlog-vault}"`. From the returned JSON, write today's cross-agent work report in Japanese:

- per project: what was worked on (意図), key changes, and 成果 (commits) if any
- concise — no filler, no raw stats dumps
- end with 2–3 short reflective questions

Assumes `loomlog` is installed globally. If `LOOMLOG_VAULT` is unset, Codex uses `./.loomlog-vault` so the sandbox can write the vault.

Run `loomlog scan all --since $(date +%F) --vault "${LOOMLOG_VAULT:-./.loomlog-vault}"`, then `loomlog reflect --template ${1:-wsn} --json --vault "${LOOMLOG_VAULT:-./.loomlog-vault}"`.

Facilitate an interactive reflection grounded in an academic reflective-practice framework
(default: What / So What / Now What — Borton→Driscoll). From the returned JSON:

1. Present the factual "What" stages (those with `fromFacts: true`) from `facts.report`,
   per project: intent, key changes, work type, and 成果 (commits). Be concise.
2. For each stage that has `ask`, put those questions to the user ONE STAGE AT A TIME and
   wait for their answer — don't fill the reflection in for them.
3. When every stage is answered, compose the reflection in the `template.name` structure and
   save it by piping the markdown to the JSON's `save.command`, e.g.:
   `printf '%s' "<reflection>" | loomlog reflect-save --date <range.to> --template <id>`
4. Report the saved path (Reflections/<date>.md — never overwritten by capture).

Assumes `loomlog` is installed globally. If `LOOMLOG_VAULT` is unset, Codex uses `./.loomlog-vault` so the sandbox can write the vault.
Templates: wsn (daily) · gibbs (weekly) · aar (blocker-heavy) · kpt · ywt.

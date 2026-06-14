# Regenerate (from the repo root):
#   vhs docs/demo/blockers.tape
# A focused, large-font GIF of `loomlog patterns --blockers` — the 詰まり view — so "what failed,
# why, and whether you got past it" actually lands (the full patterns GIF is too dense for this).
# Same synthetic vault + built CLI as the others (no LLM). Output: docs/blockers.gif
Output docs/blockers.gif

Set Shell zsh
Set FontFamily "JetBrains Mono, Noto Sans JP"
Set FontSize 20
Set Width 1600
Set Height 460
Set Padding 28
Set Theme "Catppuccin Mocha"
Set TypingSpeed 55ms

# --- hidden setup: build the CLI + seed a synthetic vault; run the built CLI as `loomlog` ---
Hide
Type 'export PATH="$HOME/.volta/bin:$PATH"'
Enter
Type 'export LOOMLOG_VAULT=/tmp/loomlog-demo'
Enter
Type 'npm run build >/dev/null 2>&1 && npx tsx docs/demo/seed.ts >/dev/null 2>&1'
Enter
Sleep 10s
Type 'loomlog() { node dist/cli.js "$@"; }'
Enter
Type "export PROMPT='%F{green}❯%f '"
Enter
Type 'clear'
Enter
Sleep 600ms
Show

# --- the focused view: where am I stuck, why, and did I get past it? ---
Type 'loomlog patterns --blockers'
Sleep 700ms
Enter
Sleep 4s

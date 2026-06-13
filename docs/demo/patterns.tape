# Regenerate (from the repo root):
#   vhs docs/demo/patterns.tape
# Companion to report.tape — shows the real, 0-token `loomlog patterns`: what kind of work you
# do, how you split agents, your busiest days, and recent commits. Same synthetic vault + built
# CLI as report.tape (no LLM). Output: docs/patterns.gif
Output docs/patterns.gif

Set Shell zsh
Set FontFamily "JetBrains Mono, Noto Sans JP"
Set FontSize 16
Set Width 1120
Set Height 940
Set Padding 26
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
Sleep 500ms
Show

# --- the real, 0-token command: what kind of work you do, across agents ---
Type 'loomlog patterns'
Sleep 500ms
Enter
Sleep 3200ms

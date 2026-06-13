# Regenerate the README GIF (run from the repo root):
#   vhs docs/demo/report.tape
#
# Shows the real, 0-token command `loomlog today` printing your cross-agent daily report — no
# LLM, no API cost. The tape (hidden) builds the working-tree CLI and seeds a synthetic,
# privacy-safe vault (docs/demo/seed.ts), runs the built CLI as `loomlog` (fast startup, so the
# output appears instantly), then ends promptly. Output: docs/report.gif
Output docs/report.gif

Set Shell zsh
Set FontFamily "JetBrains Mono, Noto Sans JP"
Set FontSize 16
Set Width 1120
Set Height 560
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

# --- the real, 0-token command: your whole cross-agent day, no LLM. Ends as soon as it prints. ---
Type 'loomlog today'
Sleep 500ms
Enter
Sleep 2200ms

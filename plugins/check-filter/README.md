# check-filter

Long output from `rails test`, `rubocop`, `i18n-tasks`, `bundle-audit` and `brakeman` (over 60 lines) reaches Claude as:
exact Failure/Error blocks (5 whole, one line per remaining failure), the summary line, exit code, and the path to the
full output in `~/.claude/mods-logs/check-filter/` (files older than 7 days are deleted). A run that dies before its
summary (boot error, pending migration) gets head + the app's backtrace frames + tail. Deterministic: no model call.
Short or unrecognised output passes whole.

Commands: `/check-filter` (status), `/check-filter full` (next output whole), `/check-filter off|on` (this chat).
Switch: `"check-filter": false` in `~/.claude/mods/switches.json` turns it off everywhere.

## Install on another computer

1. `mkdir -p ~/.claude/local-marketplaces && unzip claude-mods.zip -d ~/.claude/local-marketplaces/`
   (the path must contain `/.claude/`).
2. `claude plugin marketplace add ~/.claude/local-marketplaces/claude-mods`
3. `claude plugin install check-filter@claude-mods`

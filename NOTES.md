# Notas de desarrollo y gotchas

Contexto que Claude necesita antes de tocar un mod. `~/.claude/CLAUDE.md` apunta aquí (ver repo `gmcamposano/claude-config`).

Marketplace `token-saving-mods` (11 plugins: input-router, effort-optimizer, model-router, cache-clock, handoff, research-router, efficient-browser-use, mods, savings-proof, check-filter, prompt-coach) is a directory source at `~/.claude/local-marketplaces/token-saving-mods` (moved from ~/Downloads 2026-11-13). Plugins are read live from that folder; don't delete it.

The mods derive `home` by splitting their plugin root at `/.claude/`, so the folder must stay under a path containing `/.claude/`, otherwise logs land inside the plugin folder instead of `~/.claude/mods-logs/`.

Linux fixes (2026-11-13): `~/.local/bin/sips` is a Pillow shim; efficient-browser-use `register.ts` patched `base64 -D` → `base64 --decode` (original in `register.ts.orig`). Re-apply both if the marketplace is re-downloaded. firecrawl intentionally not installed (optional fallback, needs paid account).

check-filter (own mod, 2026-11-15): deterministic filter for long `rails test`/rubocop/i18n-tasks/bundle-audit/brakeman output (>60 lines) → failures + summary, full output in `~/.claude/mods-logs/check-filter/`. Fills the gap input-router leaves on purpose (it never touches test runners). `/check-filter full` passes next output whole. Not part of upstream Ben AI pack: re-add it if the marketplace is re-downloaded.

- 2026-11-17: folder is now a git repo pushed to PRIVATE github gmcamposano/token-saving-mods (main). Edit here, commit+push; other machines: `claude plugin marketplace update token-saving-mods`.

2026-11-17: aligned with Anthropic's model guide (commit 194e23d): model-router knows Fable, fast tier is read-only, effort-optimizer caps at high. Also `~/.claude/agents/Explore.md` overrides built-in Explore with `model: haiku` (outside the repo); switch to sonnet if searches miss things.

Gotcha (2026-11-17): `$.model.complete` Haiku thinks even at effort low, thinking counts against `maxTokens`, and a cut reply returns `isAnswered: true` with no stop reason. Small caps silently truncate (fixed with tests+eval: input-router 0.4.0, research-router 0.4.0; also always pass effort low, default is medium). Mod tests: `claude plugin test` can't call a model, so each judge mod has `judge-eval/*.ts` run via `node --experimental-strip-types` + `claude -p --setting-sources ""` (not `--bare`: no keychain auth).

Gotcha (2026-11-17): `claude plugin test` sandbox can't start processes (no child_process, no dynamic import). Mods with shell scripts keep them in an import-free `hooks/scripts.ts` and check them for real via `node --experimental-strip-types <mod>/shrink-check/*.ts` (efficient-browser-use 0.3.0). efficient-browser-use now picks sips (macOS) or Pillow (else); the old `~/.local/bin/sips` Pillow shim is no longer used on Linux.

Gotcha (2026-11-18): `$.model.fork` without `effort` runs at the session's effort (a high-effort chat thinks over each fork). Passing a different `effort` can make the fork rewrite the whole chat to the cache when the model has no per-message effort, so ask for haste in the prompt instead ("no tools, answer straight away without thinking"), as cache-clock 0.3.1's keep-warm ping does. Tests: import `'./register'` with no extension; `'./register.ts(x)'` gives a TS5097 warning in `claude plugin validate`.

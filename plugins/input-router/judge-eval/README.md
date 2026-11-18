# input-router tests

Two layers, because `claude plugin test` cannot reach a model (the test kit stands in for the engine).

1. **Unit** — `claude plugin test .` (from the input-router folder):
   - `hooks/notes.test.ts`: line cutting, chunking, head+tail fit, the word budget and output cap, the cut notice, the prompt Haiku reads.
   - `hooks/guards.test.ts`: which shell commands are reads (`isReader`), Guard B (instruction files pass word for word), Guard C (listing/counting greps), `catFile`, `rangeIn`, `diskTargets`, `mentions`, `parsePages`.
2. **Real notes** — `node --experimental-strip-types judge-eval/notes-eval.ts [--runs 3] [--case log] [-j 3]` builds each shell-output hand-off exactly as `bashPart` does (`hooks/notes.ts`), sends every part to Haiku through `claude -p` on your login, and checks the notes Claude would get: facts the task needs (`must`), claims the output does not support (`mustNot`), and whether a part used more output tokens than the cap (the real call would stop mid-notes, silently). Five deterministic synthetic outputs: a production log with counted errors, a multi-part log with one fatal line late, an exact locale string, pending plan items, and a grep that shows one judge's model and not the other's.

## History

- 2026-11-17, first run: no fact missing and no unsupported claim, but 7 of 10 hand-offs over the output cap. Haiku thinks even at effort low (up to 3,647 thinking tokens on one part) and that counts against `maxTokens`; the cap was `words * 2 + 300` (900 to 1,500). `$.model.complete` does not report a cut, so those notes reached Claude empty or cut mid-sentence (seen in a real session the same day).
- Fix: cap `words * 3 + 6000` (billed only when used) and `maybeCut` adds a notice under any part that used the whole cap.
- After: 15/15 clean over 3 runs, highest part 4,474 of 7,125 tokens, $0.04 a run of 3.

- 2026-11-18: word budget now follows the text size (`noteWords(parts, chars)`, about chars / 32, 150 to 600 a part) and two small cases (`small-code`, `small-diff`, ~7k characters, just over the Bash bar) were added; `--case 'small*'` runs a prefix. Before (600 words): notes 1,242-2,964 characters on those two; after (218-238 words): 941-1,166, 6/6 clean over 3 runs. The big cases are unchanged (7/7 clean, $0.017).

Not covered yet: the connector path (`CONNECTOR_SYSTEM`, JSON and MCP results, cap `HELPER_MAX_TOKENS`) and PDFs.
Re-run the real eval after changing the prompt, the caps, the chunk sizes or the helper model.

# model-router tests

Two layers, because `claude plugin test` cannot reach a model (the test kit stands in for the engine).

1. **Unit** — `claude plugin test .` (from the model-router folder) runs `hooks/policy.test.ts`: the rubric, the judge prompt, answer parsing, `rankOf` (Fable included), `route()` thresholds and risk forcing, effort ladder and list prices. No model call.
2. **Real judge** — `node --experimental-strip-types judge-eval/judge-eval.ts [--models haiku,sonnet] [--runs 3] [-j 4]` sends `JUDGE_SYSTEM` + `judgePrompt` from `hooks/policy.ts` through `claude -p` on your login, routes each answer the way a subagent spawn does (effort dropped, parent on Opus, default thresholds) and grades the tier it lands on, for the 22 tasks in `cases.json`.
   Exits 1 when the first model is under 80% or has a severe miss: a file edit or a deep task landing on fast, or a risky task landing below deep.

## History

- 2026-11-17, first run: Haiku sent a locale typo and a README edit to fast (rubric said "code edit"). The fast tier was rewritten to "Changes no file at all … if the task writes or edits any file … it is not fast".
- The one-line typo case accepts fast (cheap to spot in the diff), by owner decision.
- After: Haiku 66/66 over 3 runs ($0.004), Sonnet 66/66 ($0.10).

Re-run the real eval after changing the rubric, the judge model, the thresholds or `cases.json`.

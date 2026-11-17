# effort-optimizer tests

Two layers, because `claude plugin test` cannot reach a model (the test kit stands in for the engine).

1. **Unit** — `claude plugin test .` (from the effort-optimizer folder) runs `hooks/framework.test.ts`: the judge model, the prompt, answer parsing and the `high` cap. No model call.
2. **Real judge** — `node --experimental-strip-types judge-eval/judge-eval.ts [--models haiku,sonnet] [--runs 3] [-j 4]` sends the exact judge prompt from `hooks/framework.ts` through `claude -p` on your login, against the 24 labelled prompts in `cases.json`. Exits 1 when the first model is under 80% or picks a level two steps off (low for a high case or the reverse).

Results on 2026-11-17: Haiku 24/24 ($0.008), 72/72 over 3 runs ($0.005); Sonnet 24/24 ($0.13).

Re-run the real eval after changing the judge model, its prompt, or `cases.json`.

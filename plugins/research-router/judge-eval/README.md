# research-router tests

Two layers, because `claude plugin test` cannot reach a model (the test kit stands in for the engine).

1. **Unit** — `claude plugin test .` (from the research-router folder) runs `hooks/prompts.test.ts`: every parser and its fallback on a cut answer (`parsePlan`, `parseKeep`, `parseWriteUp`, `parseJoin`), the prompts' budgets, the caps, efforts and `wasCut`.
2. **Real worker** — `node --experimental-strip-types judge-eval/worker-eval.ts [--runs 3] [--case plan-deep] [-j 4]` sends the exact prompts of the five Haiku calls (plan, relevant, writeUp, join, shorten) from `hooks/prompts.ts` through `claude -p` on your login with each call's effort, reads each answer with the mod's own parser, and checks: the cap (a reply at its cap is cut, silently, in the real call), the parse (a plan, a keep list, closed tags, not the fallback), and facts and claims. Pages are about a made-up product (Tidepool DB 4.2, plus a surf app with the same name as a decoy), so nothing comes from memory.

Not covered: `partPrompt` (deep-mode subagents run on the session's tools, not one Haiku call) and the Firecrawl path.

## History

- 2026-11-17, first run with the caps then (400, 200, 2500, 1200, 700) and no effort on four calls (Haiku's default, medium): 6 of 12 calls cut. The planner cut every deep plan, so deep mode fell back to quick; the relevance check cut every list, so every page was kept, the decoy too. Content was right where the answer was whole.
- Fix: effort low on every call; caps 4000, 3000, 8000, 6000, 4000 (billed only when used); a reply at its cap is logged, and in auto mode a cut summary keeps the original result instead of replacing it.
- After: 18/18 clean over 3 runs; highest use 1,065 of 4,000 (plan-deep); $0.006 for 18 calls, against $0.008 for 12 before (low effort thinks less).

Re-run the real eval after changing a prompt, a cap, an effort or the helper model.

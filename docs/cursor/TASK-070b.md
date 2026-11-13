# TASK-070b — Finish TASK-070: directors, live check, shot editing, learning

**Who:** Cursor, model `grok-4.7-xhigh` (cross-package, LLM director, learning data: hard). **Order:** now. It runs beside TASK-076 (Cursor, pipeline/worker), TASK-084 (Cursor, originality) and Fable's template polish (`apps/server/assets/compose/**`). **No DB change**: if you think you need one, stop that part and say so in the report.

Read first: `docs/cursor/README.md`, `docs/cursor/TASK-070.md` (the full spec), `docs/tasks/TASK-070.report.md` (what part 1 did and left), `docs/compose/templates-070.md`.

## Why now

Part 1 wired the 4 new graphic kinds (map, compare, quote_full, list_full) and **made `compose` the default engine**. But the directors still emit only still, footage, kinetic text and chart, `pickDirector` still returns the baseline, there is no shot editing, and learning does not see compose stats. And no full project video has been rendered with compose yet. Since every new project now uses compose, the live check is the most urgent part.

## What to do

Do these sections of `docs/cursor/TASK-070.md`, in this order:

1. **§0, the live check first** (render a new test project 45–90 s at 1280×720 as `legacy` and as `compose`, never `56374fb2-54cf-48ff-9441-2e6c653295d4`). Report the numbers §0 asks for and look at 3 frames per engine. If compose is clearly worse (freezes, black frames, broken graphics, render time over 3× legacy), **switch the default back** to `legacy` in `resolveEditEngine`, keep the setting selectable, and say so at the top of the report.
2. **§0, the wiring:** `pickDirector` uses `ruleDirector` and `createLlmDirector(llm)`, plus every 067b-part3 suggestion listed there.
3. **New:** teach `ruleDirector` and the LLM director prompt the 4 new kinds. Use the contract in `templates-070.md` and the rules part 1 already wrote (the 30% graphic cap, `fitGraphicPayload` fallback, the LLM codes `m`/`v`/`q`/`l`). Rule hints: map when the scene names a country/province; compare when the narration contrasts two things; quote_full for a quoted sentence with an author; list_full for an enumerated list of 3–6 items. Tests with fixture scenes for each, plus a scene that matches none.
4. **§2, shot editing** (API + "Cảnh quay" panel).
5. **§3, learning loop** (features `engine`, `shotsPerMin`, `stillShare`, `graphicShare`, `beatCutPct`, `hookShotKind`, `kindEntropyBits`, null for legacy).
6. **§4, user guide**, featureMap, changelog; add the new kinds to `EVAL.md`.

## Rules

- No commit or push. No new npm dependency. No migration.
- Do not touch `.env`, `.claude/`, `data/` (except the normal app data a test render writes), `scripts/`.
- **Do not edit `apps/server/assets/compose/**`**: Fable is polishing those templates now. If a template bug blocks you, note it in the report.
- Do not edit TASK-076's area (`apps/server/src/pipeline/**`, `apps/server/src/jobs/**`, `apps/server/src/lib/config.ts`) or TASK-084's (`**/originality/**`, `apps/server/src/publishing/**`, `apps/server/src/guidelines/**`). Before editing any shared file (`app.ts`, user guide, featureMap, `db/schema.ts`), re-read it and make a small edit.
- Tests: no network, no real LLM. The live check is the only place that may call real providers, and it must never print keys.

## Done

`npm run typecheck`, `npm test` in every workspace, and the eval harness (`VG_COMPOSE_EVAL=1`). Failures in the other agents' areas: list them with the file, do not fix them. Write `docs/tasks/TASK-070b.report.md` (live check table first), then create the empty `docs/tasks/TASK-070b.done`.

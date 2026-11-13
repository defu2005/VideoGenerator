# TASK-050 report

## What changed

- `packages/shared/src/pipeline/stageTimeouts.ts` — baseline ceilings, clamp, hash, LLM merge, user rows kept.
- `packages/shared/src/budget/modes.ts`, `schemas/llm.ts`, `providerIntel/routing.ts` — task `stageTimeouts`, on in every preset, one call while research is still open and the hash is stale.
- `packages/shared/src/schemas/project.ts` — `settings.stageTimeouts`.
- `apps/server/src/pipeline/stageTimeoutPlan.ts` — one plan before a job. A model failure stores the baseline and the stage continues.
- `apps/server/src/jobs/worker.ts` — the stage timer uses the plan, then the baseline, then `STAGE_TIMEOUT_MS`.
- `apps/server/src/publishing/publishService.ts` — the extra aspect render uses the RENDER ceiling.
- `apps/server/src/api/stageTimeouts.ts` — **Tính lại** and one override. A running job is refused.
- `apps/server/src/providers/llm/mock.ts` — `StageTimeouts` returns the baseline seconds.
- Web: `StageTimeoutPanel` on the project overview. Brief CUSTOM toggles include the new call.
- User guide: `du-an-va-quy-trinh.md`, `che-do-ngan-sach.md`, `nhat-ky-thay-doi.md`, feature summary for the project overview.

## Tests

- `packages/shared`: stage timeouts (slower narration raises script and voice, 9:16 raises render, a missing stage uses the baseline), budget (ECO counts one `stageTimeouts` call until the stored plan hash matches, then zero), llm, formats, motion.
- A second `npx drizzle-kit generate` in `apps/server` printed `No schema changes, nothing to migrate`.
- `apps/server`: worker (a 10 ms stored plan times out with that message while `STAGE_TIMEOUT_MS` is 600000), `stageTimeoutPlan.test.ts` (fresh hash skips the model, a new duration calls once, a model error stores the baseline and the stage still finishes, a user row survives **Tính lại**), budget estimate.
- `apps/web`: stage-timeout panel posts an override and then shows **Bạn chọn**; project overview and pipeline budget strings.
- `tsc -p apps/server` passes.
- Full `npm test --workspaces` was not re-run.

## Deviations

- A stage with no stored row uses the code baseline. The floor is 60 seconds, so the worker test stores a 10 ms plan instead of waiting for the floor.
- The browser was not clicked. The panel test posts the override and checks the minutes and the **AI** chip.
- No throwaway project was created for the live **Tính lại** check.

## Not done

- Live **Tính lại** was not clicked on a throwaway project. The browser was not used.
- `npm test --workspaces` passed at 23:20 (Asia/Bangkok): shared 334, mcp 14, server 649 passed and 1 skipped, web 149.

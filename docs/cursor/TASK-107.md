# TASK-107 — Originality: never block a step on recheck, and count graphic time right

**Who:** Cursor, model `composer-2.5` (small, clear, tests check it). **Size:** XS. **Order:** now. TASK-106 (Fable) runs at the same time in `packages/shared/src/style/` and `apps/server/src/style/`; do not touch those folders. **No DB change.**

Read first: `docs/cursor/README.md`, `docs/tasks/TASK-084.report.md`.

## Why

TASK-084 added the originality check. Two weak points remain:

1. **A recheck error can fail the step.** `new OriginalityService(this.sqlite).recheck(...)` is called with no guard at:
   - `apps/server/src/services/renderService.ts` about line 720 (render reused): no guard.
   - `renderService.ts` about line 1013: it catches only `isBusyError` and rethrows anything else.
   - `apps/server/src/services/timelineService.ts` at about lines 241, 296, 356, 375 and 395: no guard.
   - `apps/server/src/guidelines/service.ts` about line 173: check it too.

   For example, the error `no such table: source_manifests` (an app that has not run migration 0063 yet) makes the timeline or render step fail. The originality check only informs the user, so it must never stop the video.
2. **Time under a fullscreen own graphic is counted as "unknown licence".** In `packages/shared/src/originality/checks.ts`, `contributionSummary` computes `unknownLicenseShare` from every non-own asset. With no compose plan, `apps/server/src/originality/manifest.ts` adds the scene's placeholder image (often without a verified licence), and it also adds the fullscreen graphic on top (`timeline.graphics` with `layer === "fullscreen"`, kind `own_template`). The image is hidden on screen, yet its time counts as unknown licence. Above 50 %, `originalityIssues` adds `ORIG_NO_EVIDENCE` and sends graphic-heavy videos to review for no reason.

## What to do

1. **One guarded helper.** Add a small function, for example `recheckOriginalitySafely(sqlite, projectId, render?)`, in `apps/server/src/originality/` (a new file, or `service.ts`). It calls `recheck`, catches every error, logs one warning (project id plus message; no stack spam, no secrets), and returns `null`. Use it at every call site above, so they all behave the same. Keep the `applyRetention` call at line ~1013 running even when recheck fails. Today it shares the `try` block, so split them. Keep the existing `isBusyError` behaviour for `applyRetention` only if it still makes sense; explain your choice in the report.
   - Do **not** change `apps/server/src/api/originality.ts` (a manual recheck from the user should still show its error) or `apps/server/src/publishing/guardrail.ts` (publishing must stay fail-closed: if the check cannot run, do not publish). Say in the report that you left these two as they are and why.
2. **Hidden time is not unknown-licence time.** In `contributionSummary`, the unknown-licence share counts only time **not covered by an `own_template` asset**: `covered(unknown ∪ ownTemplates) − covered(ownTemplates)`, using the existing `coveredSeconds`. Do not change `ownShare`, `templateShare` or the other fields.
   - First check that a fullscreen graphic really hides the scene image (the layer is opaque in the renderer: grep `fullscreen` in `apps/server/src/services/renderService.ts`, `apps/server/src/compose/` and the graphic templates). If a fullscreen graphic can be partly transparent, stop and report it. Do not guess.
3. **Docs.** One line in the user guide's originality page (`docs/user-guide/`, find it with grep) saying that time covered by our own fullscreen graphics does not count as unknown licence.

## Rules

- No commit or push. No new npm dependency. No migration.
- Do not touch `.env`, `.claude/`, `data/`, `scripts/`, `packages/shared/src/style/**`, `apps/server/src/style/**`, `apps/server/assets/compose/**`, `apps/server/src/compose/**`, `apps/server/src/pipeline/**`, `apps/server/src/jobs/**`, `apps/server/src/publishing/**`.
- Tests: no network, no real LLM. Never render on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Done

- Tests:
  - shared `originality.test.ts`: an unknown-licence image fully under a fullscreen own graphic gives `unknownLicenseShare` 0; half covered gives the uncovered half; no graphic gives the same value as before.
  - server: recheck that throws (stub it, or drop the `source_manifests` table in a test DB) during a timeline build and a render: the step still succeeds, a warning is logged, and retention still runs.
- `npm run typecheck` at the root, `npm test` in `packages/shared` and `apps/server`. Failures outside your area: list them with the file.
- Write `docs/tasks/TASK-107.report.md` in Vietnamese (at most 30 lines: call sites changed, the opacity check, test results), then create the empty `docs/tasks/TASK-107.done`.

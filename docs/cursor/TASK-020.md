# TASK-020 — Cursor guide (AUTO never pauses + realistic token estimate)

Read `docs/cursor/README.md` first. There is no spec in `docs/tasks/`: this guide is the spec.

## Part A — AUTO runs end to end

### Goal
The user's rule: **"đã auto thì phải tự động hết"**. A project in `mode === "AUTO"` must never stop at a gate to wait for the user because of content problems. Wherever a human would be asked today, AUTO takes the best available choice **in code**, keeps going, and writes one line in an **AUTO report** that the user reads at the end.

Out of scope: `FINAL_APPROVAL` still follows `project.settings.autoRender`. If it is off, AUTO stops there as today. Real errors (failed jobs, missing timeline, crashed render) still stop as today.

### Where AUTO pauses today
1. **`apps/server/src/app.ts`**, the `autoBlock` callback passed to `PipelineOrchestrator` (~line 113). It returns a pause message when:
   - there are open MUST guideline findings (`guidelineService.openMustCount`), or
   - at VISUAL_REVIEW, some scenes are `NEEDS_ATTENTION`.
2. **`VisualService.canApproveVisualReview`** (`apps/server/src/services/visualService.ts` ~634). It fails while any scene is not `READY_FOR_RENDER` / `SKIPPED`. In AUTO, `visualSearchExecutor.ts` calls `approveAll`, but `approveAll` (~499) **skips**:
   - scenes with `visionMeta.needsAttention`;
   - scenes whose selected candidate is an unverified web candidate (`isUnverifiedWebCandidate`).

   The AUTO preselect (~1321) also filters out unverified web candidates. Scenes with no candidate at all stay `NO_VISUAL`.
3. **`MusicService.canApproveMusicReview`**: it fails when music is on and no track is approved.
4. Any other gate whose `canApprove` can fail on content (check every gate in `orchestrator.ts`).

### What to change
- **`autoBlock`**: in AUTO it returns `null` for the content reasons above. Instead of pausing, it records report entries.
  - **Open MUST findings:** the `checkAndFix` fix pass already ran in `scriptExecutor.ts`. Keep going and log each still-open MUST finding (rule id + text).
- **Visuals in AUTO** (run before the gate check, e.g. a new `VisualService.autoResolve(projectId, signal)` that `visualSearchExecutor` calls after `approveAll` when the mode is AUTO). Run this order per scene:
  1. **`NEEDS_ATTENTION`** → approve the candidate with the best vision fit, or the best code rank if there is no vision data. Log the fit score and the reason.
  2. **Only unverified web candidates** → AUTO **may** use the best unverified web candidate, **but only when the scene has no verified candidate at all**. Log the source page URL and "Chưa xác minh license".

     This replaces the TASK-007C rule "never auto-approve unverified". Keep that rule for ASSISTED/MANUAL and for the "Duyệt tất cả" button.
  3. **No candidate at all** → reuse the nearest neighbour scene's approved image (previous scene first, then next), copied as a selection for this scene. If no scene has an image, mark the scene `SKIPPED` the way the renderer already supports. Check what the renderer draws for `SKIPPED` and make sure it does not crash. Log it.

  After this step `canApproveVisualReview` must pass.
- **Music in AUTO:** when music is on and no track got approved, approve the top-ranked candidate. If there is none, set "Không dùng nhạc" (status `NONE`). Log it.
- **Render vision fails** (`FRAME_MISMATCH`, `SUBTITLE_ILLEGIBLE` from TASK-004G): do **not** re-render automatically. Add each issue to the AUTO report with the scene id.
- **The orchestrator** keeps its pause path for ASSISTED/MANUAL. Update the existing tests that expect AUTO to pause; say which ones in the report.

### AUTO report
- **Storage:** a table `auto_report_entries` (`id`, `project_id`, `stage`, `scene_id` nullable, `code`, `severity` INFO|WARN, `message` in Vietnamese, `data` JSON nullable, `created_at`). Add it in `schema.ts`, then run `npx drizzle-kit generate`.
- **Re-runs:** when a stage is re-run, clear that stage's old entries for the project so the report reflects the latest run.
- **Codes** (zod enum in shared, e.g. `packages/shared/src/schemas/autoReport.ts`):
  - `MUST_FINDING_OPEN`
  - `VISUAL_LOW_FIT`
  - `VISUAL_UNVERIFIED_LICENSE`
  - `VISUAL_REUSED_NEIGHBOUR`
  - `VISUAL_SKIPPED`
  - `MUSIC_AUTO_PICKED`
  - `MUSIC_NONE`
  - `RENDER_VISION_ISSUE`

  Add more codes if you find other auto decisions.
- **API:** `GET /api/projects/:id/auto-report` returns the entries grouped by stage.
- **Web:** a "Báo cáo AUTO" section on the render/result screen (`apps/web/src/features/render/`), shown when the project is AUTO or has entries.
  - Each WARN entry links to the scene, like the TASK-004G "Sửa scene này" links.
  - A small count badge on the project page header ("AUTO: N cảnh báo").
- **Export:** include `auto-report.json` in the TASK-013 zip export if there are entries.
- **MCP:** add a tool `get_auto_report` in `apps/mcp/src/tools.ts`.

### Tests (no network, mock LLM)
- An AUTO project where:
  - one scene ends `NEEDS_ATTENTION`;
  - one scene has only an unverified web candidate;
  - one scene has a verified candidate plus an unverified one;
  - one scene has none.

  Expected: the pipeline passes VISUAL_REVIEW without `WAITING_USER`; the verified candidate wins in the mixed scene; the report has the expected codes.
- An open MUST finding in AUTO → no pause, plus a `MUST_FINDING_OPEN` entry.
- The same setup in ASSISTED → it still pauses as before.
- Music auto-pick and music none.
- The route and the web section render.

## Part B — Realistic input-token estimate

**The bug:** `estimateBudgetTokens` in `packages/shared/src/budget/modes.ts` (~455) sets the input per call to the tokens of topic + description + a few settings. A 10-minute BALANCED video estimates about 300 input tokens in total, which is far too low. Real calls send a system prompt plus context: the research notes, the whole script, and the scene text.

**The fix** (pure code, document the constants next to them):
- Add a fixed system-prompt overhead per call, about **1,200 tokens**. Measure the real prompt builders in `apps/server/src/stages/*/` and the prompt files, and use a rounded average.
- Add stage context:
  - **SCRIPT** (review, guideline check, fact-check) and **SCENE_PLAN**, **metadata**, **review chat**: the script tokens (use the same `scriptOutput` estimate) plus the research notes (about 900) when research is on.
  - **VISUAL_SEARCH** text calls (alt queries, rerank, vision research, consistency): scene text ≈ `scriptOutput / sceneCount` plus about 300 per scene in the batch. Rerank sends the candidate list: about 60 tokens per candidate × `visualSearchBreadth`.
  - **Vision calls:** keep `VISION_IMAGE_TOKEN_ESTIMATE` per image.
  - **MUSIC_SEARCH**, **TIMELINE**, **RENDER** text calls: overhead plus a small context (about 300).
- Remove `void sceneCount;` and use it.

**Tests:** update `packages/shared/test/budget.test.ts` with sanity bounds. For a 10-minute Vietnamese video, BALANCED input must land between 15k and 80k tokens, and MAX input must be greater than QUALITY input, which must be greater than BALANCED input. Update any server or web test that snapshots exact token numbers, and say so in the report.

## Steps
1. Shared: report schema and codes, estimator fix, tests.
2. Server: table + drizzle generate, report repository, `autoResolve` for visuals, music auto-pick, `autoBlock` → log instead of pause, render vision issues → report, route, zip export, tests.
3. Web: "Báo cáo AUTO" section + header badge + tests.
4. MCP: `get_auto_report`.
5. No live check needed. If you do one, use a throwaway project only. **Never use project `56374fb2-54cf-48ff-9441-2e6c653295d4`.**
6. Run the README done checklist, then write `docs/tasks/TASK-020.report.md` and `docs/tasks/TASK-020.done`.

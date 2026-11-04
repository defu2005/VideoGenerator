# TASK-020 report — AUTO never pauses + realistic token estimate

## What changed

### Shared
- `packages/shared/src/schemas/autoReport.ts` — codes, entry/group/response schemas
- `packages/shared/src/budget/modes.ts` — realistic input-token estimate (system overhead + stage context; uses `sceneCount`; vision counted per vision task)
- `packages/shared/src/index.ts` — exports auto report schemas
- Tests: `packages/shared/test/budget.test.ts` — 10-minute Vietnamese BALANCED/QUALITY/MAX input bounds

### Server
- `apps/server/src/db/schema.ts` — `auto_report_entries` table
- Migration: `apps/server/drizzle/0020_great_mysterio.sql` (+ snapshot)
- `apps/server/src/services/autoReportService.ts` — insert / clearStage / list / grouped response
- `apps/server/src/services/visualService.ts` — `autoResolve` (NEEDS_ATTENTION, unverified-only, neighbour reuse, SKIPPED)
- `apps/server/src/stages/visuals/visualSearchExecutor.ts` — call `autoResolve` after `approveAll` in AUTO
- `apps/server/src/stages/music/musicSearchExecutor.ts` — log `MUSIC_AUTO_PICKED` / `MUSIC_NONE`
- `apps/server/src/services/renderService.ts` — log `RENDER_VISION_ISSUE` for FRAME_MISMATCH / SUBTITLE_ILLEGIBLE (no re-render)
- `apps/server/src/app.ts` — `autoBlock` returns null for content issues; logs open MUST findings
- `apps/server/src/api/autoReport.ts` — `GET /api/projects/:id/auto-report`
- `apps/server/src/api/render.ts` — include `auto-report.json` in zip export when entries exist
- Tests: `apps/server/test/autoReport.test.ts`; `guidelines.test.ts` updated (AUTO no longer pauses on MUST; ASSISTED still pauses)

### MCP
- `apps/mcp/src/apiClient.ts` — `getAutoReport`
- `apps/mcp/src/tools.ts` — `get_auto_report`
- `apps/mcp/test/tools.test.ts` — tool list updated

### Web
- `apps/web/src/services/autoReportApi.ts`
- `apps/web/src/features/render/AutoReportPanel.tsx` (+ test) — “Báo cáo AUTO” on render screen
- `apps/web/src/features/render/RenderPanel.tsx` — mounts panel
- `apps/web/src/features/projects/ProjectDetailPage.tsx` — header badge `AUTO: N cảnh báo`
- `apps/web/src/features/guidelines/GuidelineFindings.tsx` — AUTO copy updated (continues, see report)
- CSS for auto-report + badge; ProjectDetailPage fetch stubs updated

## Test counts

| Workspace | Before (TASK-019 report) | After |
|---|---|---|
| shared | 166 | **179** |
| mcp | 11 | **12** |
| server | 303 | **346** |
| web | 71 | **77** |

`npm run typecheck`, `npm run build`, `npm test --workspaces` all pass. Second `drizzle-kit generate` → “No schema changes”.

## Deviations from the spec

- **Orchestrator test kept:** `orchestrator.test.ts` still expects AUTO to pause when injected `canApprove` fails for VISUAL_REVIEW (real gate failure path). Content auto-resolve is covered in `autoReport.test.ts` instead.
- **guidelines.test.ts:** rewritten from “stops AUTO on MUST” to “AUTO continues”; added ASSISTED still waits. Real app `autoBlock` logs MUST and returns `null`.
- **approveAll unchanged:** still skips unverified web + `needsAttention` for ASSISTED/MANUAL / “Duyệt tất cả”. AUTO override lives only in `autoResolve`.
- **Token estimator:** uses per-task max calls (after `stage.tasks` are assigned). `visionCheck.max` already includes consistency batches — not double-counted with `visionConsistency`. No server/web tests had absolute token snapshots to update.
- **Music logging:** report entries written in `musicSearchExecutor` AUTO path (pick / none / download fail), not a separate music `autoResolve`.

## Not done

- Live browser check on a throwaway project (dev servers not started). Panel + badge + API covered by unit tests.
- No commit/push (per rules).

# TASK-113 report — Style 6: visual sameness feeds the originality check 👯

## Done

1. **Originality signal and look comparison:**
   - In `OriginalityService` (`apps/server/src/originality/service.ts`), after finished render looks are recorded in `video_looks`, `check()` loads the current look and earlier looks:
     - For the same channel (`profile_id`), loads the last $N$ renders ($N = \text{settings.visualSameness.window}$, default 10).
     - Across other channels in the same workspace, loads the last $M$ renders ($M = \max(50, N \times 5)$).
   - Computes `compareVisualSameness` and `visualSamenessIssues` from `packages/shared/src/style/sameness.ts`.
   - Maps the closest in-channel video to its project title, computes `parts` (`combos`, `frames`, `kinds`, `style`) and `drivingPart` (e.g. `cùng tổ hợp biến thể với 3/5 video gần nhất` or `trùng khung hình...`).
   - Appends `visualSameness` signal to `OriginalityScores` and `OriginalityReport`.
2. **Review routing & severity:**
   - Visual sameness issues (`ORIG_VISUAL_SAME_CHANNEL`, `ORIG_VISUAL_CROSS_CHANNEL`):
     - At default `warn` level (`settings.visualSameness.level === "warn"`): severity is `SHOULD`. The issue is visible in the report and review card, and does not block automated publishing.
     - At `block` level (`settings.visualSameness.level === "block"`): severity is `MUST`, setting `verdict: "REVIEW"` and opening an `operator_requests` approval (`ORIGINALITY_NEEDS_USER`) to route to manual review.
   - Any compute error during visual sameness calculation only logs a warning via `console.warn` and falls back gracefully to `visualSameness: null`, never failing timeline, render, or recheck.
3. **Settings:**
   - `VisualSamenessSettingsSchema` (thresholds `maxChannelSameness: 0.85`, `maxCrossChannelSameness: 0.7`, `window: 10`, and `level: "warn" | "block"`) is exposed directly in `OriginalitySettingsSchema` under `visualSameness` with shared defaults.
4. **UI:**
   - `apps/web/src/features/render/OriginalityCard.tsx` renders a `"Độ giống video trước"` row with the channel score percentage, closest video link, driving part reason, and a hint linking to `/profiles/:id/style` (`tab Phong cách`).
5. **Tool:**
   - `get_originality_report` tool description updated to include `độ giống hình ảnh`, and its returned `OriginalityReport` now contains the new `visualSameness` signal and `scores.visualSameness`.
6. **Execution order in render:**
   - In `apps/server/src/services/renderService.ts`, `recordFinishedLookSafely` is awaited before `recheckOriginalitySafely`, ensuring that the current render's look is stored in `video_looks` before the originality recheck runs.

## Real scores from dev DB (read-only)

Inspected `data/app.db` via read-only connection:
- `video_looks`: 1 record
  - `id`: `d9050392-b5c5-406d-a2cf-9f38b4b8a5cd`
  - `project_id`: `1ef6de1f-cf84-4552-8aed-8958f290bc0e` ("Berserk: Tuyệt Tác Dark Fantasy Và Ý Chí Bất Diệt Của Guts")
  - `render_id`: `a7f040e7-516e-418d-a4d8-fa507f17acd3`
  - `profile_id`: `null`
  - `created_at`: `2026-11-12T20:39:27.387Z`
- `renders` (DONE): 3 records
  - `a7f040e7-516e-418d-a4d8-fa507f17acd3` (project `1ef6de1f-cf84-4552-8aed-8958f290bc0e`)
  - `659df68d-3af2-4866-b0a9-3f24f94ee9ca` (project `ecd9c862-03ff-46a1-b696-4104e9db2f93`)
  - `2bfea789-372f-4567-86e0-37f75979b8e4` (project `ecd9c862-03ff-46a1-b696-4104e9db2f93`)
- Computed visual sameness for project `1ef6de1f-cf84-4552-8aed-8958f290bc0e`:
  - As this is the only render with a recorded look in `video_looks`, there are no earlier looks for comparison:
    ```json
    {
      "channelScore": null,
      "crossChannelScore": null,
      "parts": null,
      "closestVideo": null,
      "drivingPart": null,
      "comparedVideos": 0
    }
    ```
  - When subsequent renders are completed, `compareVisualSameness` will evaluate against this look.

## Files changed

- `packages/shared/src/style/sameness.ts`: added `level: z.enum(["warn", "block"]).default("warn")` to `VisualSamenessSettingsSchema`; allowed `Partial<VisualSamenessSettings>` in `compareVisualSameness` and `visualSamenessIssues`.
- `packages/shared/src/originality/settings.ts`: added `visualSameness: VisualSamenessSettingsSchema` to `OriginalitySettingsSchema`.
- `packages/shared/src/originality/schema.ts`: added `VisualSamenessSignalSchema`, `type VisualSamenessSignal`, added `visualSameness` to `OriginalityScoresSchema` and `OriginalityReportSchema`, added `profileId` to `OriginalityReportSchema`.
- `packages/shared/src/originality/checks.ts`: added `visualSameness: null` to `compareOriginality` return object.
- `packages/shared/src/features/featureMap.ts`: updated `summaryVi` for `originality` feature.
- `packages/shared/src/index.ts`: resolved ambiguous re-export for `historyBucket` / `stageTimeoutHash`.
- `apps/server/src/originality/service.ts`: added look loading, sameness scoring, driving part determination, severity mapping, error fallback, and signal population.
- `apps/server/src/originality/toolDefs.ts`: updated `get_originality_report` tool description.
- `apps/server/src/services/renderService.ts`: recorded look before originality recheck.
- `apps/server/test/originality.test.ts`: added 6 tests covering near-identical looks (warn), different looks, cross-channel similarity, missing/empty-hash looks, compute error fallback, and block level manual review.
- `apps/web/src/features/render/OriginalityCard.tsx`: added `"Độ giống video trước"` row with score, closest video link, driving part, and style tab link hint.
- `apps/web/src/features/render/OriginalityCard.test.tsx`: added test verifying the UI row, score, closest video link, and style tab link.
- `docs/user-guide/dang-bai.md`: updated originality section with visual sameness, thresholds, and routing details.
- `docs/user-guide/nhat-ky-thay-doi.md`: added `## TASK-113` changelog entry.

## Tests

- `npm run typecheck`: clean across all workspaces (`@vg/shared`, `@vg/mcp`, `@vg/server`, `@vg/web`).
- `npm run build`: built clean across all workspaces.
- `@vg/shared`: 91 test files, 741 tests passed.
- `@vg/mcp`: 1 test file, 22 tests passed.
- `@vg/web`: 75 test files, 208 tests passed (including `OriginalityCard.test.tsx`).
- `@vg/server`: `test/originality.test.ts` (10/10 passed), `test/styleStore.test.ts` (7/7 passed); 135 passed overall, 3 pre-existing failures from unrelated in-progress tasks (`agentSkillPack`, `assistant`, `workspaces`).
- User guide coverage tests: passed in `@vg/shared` and `@vg/web`.
- `drizzle-kit generate`: "No schema changes, nothing to migrate 😴".

## Deviations

None.

## Not done

None.

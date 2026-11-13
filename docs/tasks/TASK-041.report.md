# TASK-041 report

## What changed

- `packages/shared/src/edit/plan.ts` — transition types, default rhythm, motion presets, emphasis limits, edit-plan validation, xfade filter groups, subtitle gap close, karaoke/pop/callout helpers, SFX gain −14 dB.
- `packages/shared/src/subtitles/index.ts` — ASS styles clean/karaoke/pop/box plus the callout layer. Gaps under 0.6 s are closed.
- `packages/shared/src/render/plan.ts` — punch-in ease-out; optional SFX mix inputs.
- `packages/shared/src/timeline/build.ts` — fades only on the first and last scene; a fallback edit plan is stored on the timeline.
- `packages/shared/src/schemas/timeline.ts`, `project.ts`, `llm.ts`, `budget/modes.ts`, `providerIntel/routing.ts` — `editPlan` task and optional profile/project edit settings.
- `apps/server/src/edit/generateEditPlan.ts`, `api/timeline.ts`, `services/timelineService.ts` — save, regenerate, and 10-second preview window.
- `apps/server/src/providers/llm/mock.ts` — `EditPlan` fixture.
- `apps/server/assets/sfx/` — whoosh, pop, hit. Synthesized sine envelopes, CC0, no download.
- `apps/web` timeline panel, profile “Phong cách dựng” (preset, phụ đề, cỡ chữ, màu nhấn, khoảng nhấn mạnh, SFX), project override of those fields, budget checkbox, preview CSS.
- User guide: `docs/user-guide/du-an-va-quy-trinh.md`, `nhat-ky-thay-doi.md`, feature map summary.

## Tests

- `packages/shared`: edit plan, timeline, budget, llm, subtitles, render plan, user guide.
- `apps/server`: budget estimate; `tsc -p apps/server` passes.
- `apps/web`: `EditPlanPanel` (transition type and 0.25–0.8 s duration, motion per scene, click a narration word to add or remove emphasis, style preview, 10 s window) and `TimelinePanel`.

Full `npm test --workspaces` was not re-run.

## Deviations

- The 10-second control returns the excerpt window (start, end, low resolution). It does not render a file.
- The allowed project `eb02c679-26a3-4a42-8ea9-bb4e1a25288d` was not rendered, so there are no frame grabs. Project `56374fb2-54cf-48ff-9441-2e6c653295d4` was not touched.
- Khi có chuyển cảnh khác `cut`, bước ghép cuối đưa từng clip vào ffmpeg và dùng bộ lọc xfade. Không có xfade thì báo `XFADE_UNAVAILABLE` và nối cảnh thường. Cảnh toàn `cut` vẫn dùng danh sách concat.
- Điểm nhấn có thời điểm từ giọng đọc thì file `whoosh`/`pop`/`hit` được trộn vào lệnh ffmpeg.

## Not done

Dự án thử `eb02c679-26a3-4a42-8ea9-bb4e1a25288d` chưa được render. TASK-042, TASK-043 và TASK-050 đã có mã và báo cáo riêng.

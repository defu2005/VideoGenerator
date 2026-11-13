# TASK-076 · Hai làn pipeline và giới hạn render

Giọng, phụ đề và nhạc chạy khi cổng ảnh đang chờ. `RENDER_CONCURRENCY` (mặc định 1, tối đa 4) giữ số job RENDER đang chạy. `WORKER_CONCURRENCY` mặc định nâng từ 1 lên 3, trần vẫn 32. Không thêm dependency, không migration, không sửa `.env`.

## File

- `packages/shared/src/pipeline.ts` — `STAGE_DEPENDS`, `stageLane`, `jobLane`, `dependentStages`, `activeJobsBlockStage`.
- `packages/shared/src/schemas/job.ts` — `PipelineState.activeJobs` tùy chọn.
- `packages/shared/test/pipelineDeps.test.ts` — đồ thị không vòng, phụ thuộc nằm trước trong `STAGE_ORDER`, stale theo cạnh.
- `packages/shared/src/features/featureMap.ts` — tổng quan dự án, chế độ chạy, render.
- `apps/server/src/pipeline/invalidation.ts` — `markStaleFrom` chỉ đánh dấu stage phụ thuộc.
- `apps/server/src/pipeline/orchestrator.ts` — hai làn, `continueAll` theo đồ thị, slot render, hủy làn.
- `apps/server/src/jobs/jobRepository.ts` — lấy job kế theo làn, `activeJobs` trên pipeline.
- `apps/server/src/jobs/worker.ts` — bỏ qua job bị từ chối trong cùng tick.
- `apps/server/src/lib/config.ts`, `.env.example` — `RENDER_CONCURRENCY`, mặc định worker 3.
- `apps/server/src/api/health.ts`, `apps/server/src/app.ts` — `render: x/y đang chạy`.
- `apps/server/src/api/pipeline.ts` — `POST /api/projects/:id/pipeline/stages/:stage/cancel`.
- `apps/server/src/review/service.ts` — sửa lời thoại đánh stale giọng và phần phụ thuộc, không đụng ảnh.
- `apps/server/test/orchestrator.test.ts`, `worker.test.ts`, `researchScript.test.ts`, `review.test.ts`.
- `apps/web/src/features/pipeline/activeJobs.ts`, `PipelinePanel.tsx`, `StageRow.tsx`, `PipelinePanel.test.tsx`.
- `apps/web/src/services/pipelineApi.ts`, `apps/web/src/hooks/usePipeline.ts`.
- `apps/web/src/features/voice/VoicePanel.tsx`, `subtitles/SubtitlePanel.tsx`, `music/MusicPanel.tsx`, `visuals/VisualReview.tsx`, `dashboard/DashboardPage.tsx`.
- `docs/user-guide/du-an-va-quy-trinh.md`, `tu-dong-hoa.md`, `render-va-thumbnail.md`, `nhat-ky-thay-doi.md`.

Không sửa compose, originality, publishing, guidelines, `visualService`.

## Kiểm tra (12/11/2026, Asia/Bangkok)

- `npm run typecheck` xong 02:11, exit 0. Gồm build `@vg/shared` rồi typecheck shared, mcp, server, web. Lần này sau sửa `review/service.ts`.
- `npm run build` đã exit 0 trước sửa review (khoảng 01:59). Sau đó không đổi web. Typecheck server đã gồm file review.
- `npm test --workspaces --if-present` 01:59–02:05:
  - `@vg/shared`: 77 file, 597 test đạt.
  - `@vg/mcp`: 1 file, 19 test đạt.
  - `@vg/server`: 107 file đạt, 5 file lỗi, 1 bỏ qua; 950 test đạt, 6 lỗi, 4 bỏ qua. Một lỗi là `review.test.ts`, đã sửa.
  - `@vg/web`: 67 file, 185 test đạt (npm vẫn chạy web sau khi server lỗi).
- `apps/server` `test/review.test.ts` chạy lại 02:08: 7/7 đạt.

Năm lỗi còn lại, không sửa:

- `apps/server/test/composeDirector.test.ts` — `places a map, a compare, a quote and a list...` expected true, received false. Vùng TASK-070.
- `apps/server/test/composeScene.test.ts` — timeout 30s `joins two one-second testsrc shots`. Vùng TASK-070.
- `apps/server/test/antigravityCli.test.ts` — hai test timeout CLI (`omits --effort...`, `raises LLM_INVALID_OUTPUT...`).
- `apps/server/test/copilotCli.test.ts` — `EPERM` khi xóa thư mục tạm `vg-copilot-cli-test-...`.

## Lệch so với guide

- `MUSIC_SEARCH` phụ thuộc `SCENE_PLAN` và `VOICE`. `musicService.input()` đọc thời lượng `voice_tracks` (không có thì ước lượng theo cảnh) và mood cảnh. Không đọc ảnh. Mood kịch bản đi qua `SCENE_PLAN`. Chạy lại giọng làm nhạc cũ. Tìm lại ảnh không làm giọng hay nhạc cũ.
- Không có trang jobs. Chuỗi `render: x/y đang chạy` nằm ở `GET /api/health`, dashboard và panel pipeline khi chuỗi bắt đầu bằng `render:`.
- `markStaleFrom(VISUAL_REVIEW)` chỉ làm cũ timeline, duyệt cuối và render. Sửa lời thoại qua review thì tự đánh `VOICE` thành STALE rồi stale phần phụ thuộc (phụ đề, nhạc, timeline). Ảnh giữ DONE.
- Test cũ đổi vì hành vi mới: duyệt tay không còn kỳ vọng giọng PENDING (giọng có thể đã xếp hàng lúc xong kế hoạch cảnh; timeline vẫn PENDING, `runMode` null). `researchScript` hủy dự án nếu còn job rồi mới chạy lại RESEARCH. `review.test.ts` kỳ vọng `staleFrom: VISUAL_REVIEW` giữ giọng/phụ đề DONE và làm timeline STALE; `EDIT_NARRATION` qua API vẫn làm giọng và phụ đề STALE.
- `continueAll` không tự xếp lại stage FAILED. `drainUntilGate` giữ nguyên: dừng ở cổng chờ đầu tiên.
- Hủy một làn ghi message `Đã hủy làn này` (không thêm cột DB). Generate All xóa message đó trên stage PENDING/STALE. Hủy cả dự án vẫn là `POST /pipeline/cancel`.
- Không thêm BullMQ hay p-limit. Đồ thị và hai slot làn đủ; thư viện hàng đợi không đáng thêm.

## Chưa làm

- Chưa bấm trên trình duyệt. Không có server dev ổn định; không mở server mới vì agent khác đang dùng cùng checkout. Stepper và dòng render được chứng minh bằng test component.
- Không chạy lại cả `npm test --workspaces` sau khi sửa review. Suite đầy đủ vẫn đỏ vì năm lỗi ở trên.
- Không đụng `.env`. Nếu file đó đang đặt `WORKER_CONCURRENCY=1` thì app đang chạy vẫn là 1; mặc định 3 chỉ áp khi biến không được đặt.
- Không duyệt cổng và không render dự án `56374fb2-54cf-48ff-9441-2e6c653295d4`.
- Không commit, không push, không migration.

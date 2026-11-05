# TASK-037 report — Cắt Shorts/Reels từ video dài

## Việc đã làm

Video 16:9 đã render (hoặc file mp4/mov/mkv người dùng sở hữu) được đề xuất thành các clip dọc 9:16. Mỗi clip là một dự án con `kind: "clip"`, có job `CLIP` tách khỏi pipeline, rồi được đặt lịch `SCHEDULED` trên các tài khoản dọc của cùng hồ sơ.

## File thay đổi

### Shared (`packages/shared`)
- `src/clips/index.ts` — schema đề xuất, kiểm tra đoạn (bám câu, độ dài, chồng lấn, giữa ý), fallback theo mật độ từ, rút transcript, dịch phụ đề, lệnh ffmpeg center / blur-fill / smart, parse SRT/VTT, slot sau giờ đăng của video gốc, lọc tài khoản dọc
- `src/index.ts` — export clips
- `src/enums.ts` — stage `CLIP`; `isSideJobStage` gồm PUBLISH và CLIP
- `src/schemas/llm.ts` — task `clipPick` (RENDER, strong, budget `clipPick`)
- `src/schemas/project.ts` — `kind` và `parentProjectId` tùy chọn (thiếu nghĩa là video dài)
- `src/schemas/automation.ts` — `autoShorts`, `shortsPerVideo`
- `src/budget/modes.ts` — `clipPick` tắt ở ECO, bật ở BALANCED/QUALITY/MAX. Không cộng vào ước lượng số lượt của pipeline
- Tests: `test/clips.test.ts`; cập nhật `test/llm.test.ts`, `test/budget.test.ts`, `test/automation.test.ts`

### Server
- `src/db/schema.ts` — `projects.kind`, `projects.parent_project_id`, bảng `clip_sets`
- Migration `drizzle/0033_melted_ultimates.sql` (+ snapshot, journal). Lần `drizzle-kit generate` thứ hai in “No schema changes, nothing to migrate”
- `src/services/clipService.ts` — xem, đề xuất, sửa, xuất, nhập file ngoài, tự cắt sau render, chạy ffmpeg
- `src/settings/speechToText.ts` — cấu hình whisper / whisper.cpp / faster-whisper. Test không gọi CLI
- `src/api/clips.ts` — `/api/projects/:id/clips`, import, cài đặt nhận dạng giọng nói
- `src/stages/clip/clipExecutor.ts` — stage `CLIP`
- `src/app.ts`, `src/publishing/fastify.d.ts` — gắn service, route, executor
- `src/pipeline/orchestrator.ts`, `src/pipeline/executorRegistry.ts` — job CLIP không ghi `project_stages`; dự án clip không chạy pipeline
- `src/jobs/jobRepository.ts` — trả `kind` và `parentProjectId`
- `src/stages/render/renderExecutor.ts` — `maybeAutoShorts` sau render ngang thành công; lỗi thumbnail/cắt không làm hỏng render dài
- `src/providers/llm/mock.ts` — fixture `ClipPick`
- `src/assistant/tools.ts`, `src/assistant/service.ts` — `list_clips` (read), `make_shorts` (confirm)
- `src/services/projectService.ts` — trước khi xóa, gỡ `parent_project_id` của clip con
- `test/clips.test.ts`

### Web
- `src/features/render/ShortsPanel.tsx` + `ShortsPanel.test.tsx` — bảng “Tạo Shorts”
- `src/features/render/RenderPanel.tsx` — gắn bảng khi đã có render ngang và dự án không phải clip
- `src/services/clipsApi.ts`
- `src/features/projects/ImportLongVideoDialog.tsx`, `ProjectListPage.tsx` — “Nhập video dài”
- `src/features/projects/ProjectCard.tsx` — nhãn “Short”
- `src/features/projects/ProjectDetailPage.tsx` — clip chỉ có Tổng quan và Render, không có cổng duyệt kịch bản
- `src/features/profiles/AutomationTab.tsx` — “Tự cắt Shorts từ video dài”
- `src/features/projects/BriefFields.tsx` — “Chọn đoạn Shorts bằng AI (BALANCED+)”
- `src/index.css` — layout bảng Shorts và hộp nhập
- Test cập nhật: `RenderPanel.test.tsx`, `ProjectDetailPage.test.tsx`, `PublishPanel.test.tsx`, `ProfileDetailPage.test.tsx`, `InsightsTab.test.tsx`, `AutomationTopics.test.tsx`

## Số test

| Workspace | Tests |
|---|---|
| shared | 237 |
| mcp | 12 |
| server | 567 |
| web | 109 |

Cao hơn mức sàn sau TASK-017 (shared 156, mcp 11, server 295, web 70).

`npm run typecheck` và `npm run build` đều qua. Không đổi `package.json` hay lockfile. Các file mới của task không có byte NUL và là UTF-8.

## Test cũ được sửa có chủ đích

- `LLM_TASKS` từ 22 lên 23 vì thêm `clipPick`.
- Bốn preset ngân sách kỳ vọng thêm `clipPick` (ECO tắt, còn lại bật).
- Automation mặc định thêm `autoShorts: false`, `shortsPerVideo: 3`. Các fixture hồ sơ trên web thêm hai trường này.
- `RenderPanel` mock trả view Shorts rỗng khi URL chứa `/clips`.
- Fixture ước lượng ngân sách trên trang dự án thêm `clipPick: true`, vì schema tính năng giờ bắt buộc trường đó.

## Lệch so với guide

1. **Phụ đề đốt lên hình.** Hàm `shiftSubtitleCues` trừ đúng mốc `start`. File ASS dùng khi render cộng thêm 0,15 giây đầu clip, để chữ khớp đoạn đã cắt sớm hơn 0,15 giây.
2. **`targetDurationSec` của dự án con tối thiểu 30.** Schema dự án không nhận dưới 30. Độ dài thật nằm ở `duration_sec` và ở file render.
3. **`make_shorts` là risk `confirm`.** Không thêm vào `ALWAYS_CONFIRM_TOOLS`, nên chế độ xác nhận mặc định vẫn hỏi, còn test “chỉ xóa mới luôn xác nhận” giữ nguyên.
4. **Lịch clip ghi thẳng `SCHEDULED`.** Không cần tài khoản đã kết nối. Ticker không đăng ngay vì trạng thái không phải `QUEUED`.
5. **`ON DELETE SET NULL` trên SQLite.** Snapshot có `on delete set null`, nhưng `ALTER TABLE ... ADD COLUMN` do drizzle-kit sinh không gắn mệnh đề đó. `deleteProject` tự đặt `parent_project_id` của clip con về null trước khi xóa cha.
6. **File ngoài được trỏ bằng đường dẫn**, không sao chép (tối đa 4 GB).
7. **`clipPick` không nằm trong ước lượng số lượt pipeline**, giống các task ngoài pipeline khác, để các mốc đếm lượt cũ không đổi.

## Chưa làm

- Không mở trình duyệt. Phiên này không có công cụ trình duyệt. Bảng Shorts được kiểm bằng test web (đề xuất hiện, sửa được gửi, xuất tạo job), không bấm trên một dự án tạm đang chạy.
- Không chạy CLI nhận dạng giọng nói và không bấm “thử phát hiện”. Test từ chối nhập khi chưa có phụ đề và chưa cấu hình CLI.
- Không đụng dự án `56374fb2-54cf-48ff-9441-2e6c653295d4`. Không commit, không push.

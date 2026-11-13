# TASK-084 · Cổng originality và bản kê nguồn

Codex đã dựng phần lớn tính năng rồi dừng trước khi có report. Phần dưới ghi lại phần đó và phần được hoàn tất sau đó. Không commit, không push, không thêm dependency, không tạo migration mới.

## Codex đã làm

- Bảng `source_manifests` (một dòng mỗi dự án, FK cascade, `verdict` OK | REVIEW) qua `npx drizzle-kit generate`: `apps/server/drizzle/0063_giant_scream.sql` và snapshot `0063`. Unique index `source_manifests_project_uq` trên `project_id` để giữ đúng một bản kê và upsert.
- Schema zod, ngưỡng mặc định và hàm thuần trong `packages/shared/src/originality/` (`schema.ts`, `settings.ts`, `checks.ts`): shingle 5 từ, Jaccard, pHash qua `hashesMatch`, phần đóng góp theo thời gian không cộng chồng, bốn rule `ORIG_*`, checklist YouTube / TikTok / Facebook / Instagram kèm link.
- Server: `apps/server/src/originality/manifest.ts`, `service.ts`, `toolDefs.ts`, `apps/server/src/api/originality.ts`. Gắn vào timeline, render, dismiss guideline, guardrail, `ASSISTANT_TOOLS`, `auto_report` mã `ORIGINALITY_NEEDS_USER`, và `operator_requests` (Dashboard **Cần bạn xử lý**).
- UI: `OriginalityCard.tsx` trên mục Đăng, `OriginalitySettings.tsx` trên Định hướng nội dung.
- Test: `packages/shared/test/originality.test.ts`, `apps/server/test/originality.test.ts`. Bốn test server chưa chạy được vì fixture timeline còn API cũ.

Không thêm `videohash` (MIT, Python). So ảnh dùng `packages/shared/src/visuals/phash.ts` như guide.

## Phần hoàn tất sau Codex

- Fixture `apps/server/test/originality.test.ts` gọi `buildTimeline` đúng kiểu hiện tại (`visuals`, `noVisual`, `musicEnabled`) và ghi `subtitles: null`. Cột `research_notes.model` được điền vì schema bắt buộc.
- `evaluatePublishGuardrail` chỉ báo “chưa khớp timeline” khi đã có bản kê. Dự án chưa có timeline không bị ép riêng tư, nên happy path đăng bài vẫn công khai. Render đã ghi bản kê mà timeline đổi sau đó, hoặc render id khác, vẫn bị ép riêng tư.
- `OriginalityService.check` bỏ qua cổng khi chưa có timeline: xóa finding `ORIG_*` đang mở và yêu cầu **Cần bạn** của chính nó. Cổng chạy khi timeline được dựng và sau mỗi render, như guide.
- `OriginalityCard` không gọi `findings.filter` khi phản hồi chưa có `findings` (mock của `RenderPanel.test.tsx` trả timeline cho URL lạ).
- Hướng dẫn: `docs/user-guide/dang-bai.md` (`#nguon-va-tinh-nguyen-ban`), một câu trong `du-an-va-quy-trinh.md`, mục `TASK-084` trong `nhat-ky-thay-doi.md`, feature `originality` trong `packages/shared/src/features/featureMap.ts`.

Không sửa `apps/server/src/compose/**`, `packages/shared/src/compose/**`, `pipeline/orchestrator.ts`, `jobs/worker.ts`, `lib/config.ts`.

## File

Codex (giữ nguyên, chỉ `service.ts` thêm nhánh chưa có timeline):

- `packages/shared/src/originality/schema.ts`, `settings.ts`, `checks.ts`, `packages/shared/src/index.ts`, `packages/shared/src/guidelines/schema.ts`, `packages/shared/src/schemas/autoReport.ts`
- `apps/server/src/db/schema.ts`, `apps/server/drizzle/0063_giant_scream.sql`, `apps/server/drizzle/meta/0063_snapshot.json`, `apps/server/drizzle/meta/_journal.json`
- `apps/server/src/originality/manifest.ts`, `service.ts`, `toolDefs.ts`, `apps/server/src/api/originality.ts`
- `apps/server/src/app.ts`, `apps/server/src/assistant/tools.ts`, `apps/server/src/guidelines/service.ts`, `apps/server/src/guidelines/settings.ts`
- `apps/server/src/services/timelineService.ts`, `apps/server/src/services/renderService.ts`, `apps/server/src/publishing/guardrail.ts`
- `apps/web/src/features/render/OriginalityCard.tsx`, `PublishPanel.tsx`, `apps/web/src/features/guidelines/OriginalitySettings.tsx`, `GuidelineSettingsPage.tsx`, `apps/web/src/features/render/AutoReportPanel.tsx`
- `packages/shared/test/originality.test.ts`, `apps/server/test/originality.test.ts`

Sửa hoặc thêm khi hoàn tất:

- `apps/server/test/originality.test.ts`
- `apps/server/src/originality/service.ts`
- `apps/server/src/publishing/guardrail.ts`
- `apps/web/src/features/render/OriginalityCard.tsx`
- `packages/shared/src/features/featureMap.ts`
- `docs/user-guide/dang-bai.md`, `docs/user-guide/du-an-va-quy-trinh.md`, `docs/user-guide/nhat-ky-thay-doi.md`
- `docs/tasks/TASK-084.report.md`, `docs/tasks/TASK-084.done`

## Kết quả kiểm tra

Chạy 12/11/2026, khoảng 01:21–01:26 giờ Việt Nam (ICT):

- `npm run typecheck`: pass (shared, mcp, server, web)
- `npm run build`: pass
- `npm test --workspaces`:
  - shared: 76 file, 593 test, pass
  - mcp: 1 file, 19 test, pass
  - server: 112 file pass, 2 file skip; 943 test pass, 5 test skip
  - web: 67 file, 184 test, pass
- `npx drizzle-kit generate` trong `apps/server`, chạy hai lần: cả hai in `No schema changes, nothing to migrate`

Trình duyệt trên app tạm (DATA_DIR trong thư mục temp, cổng 3011 / 5188), dự án `920568eb-1c2b-4c37-9209-4cfe095f672b`, hồ sơ `f2c3714c-cb31-41bb-ad9f-973b4f7233e9`. Không đụng dự án `56374fb2-54cf-48ff-9441-2e6c653295d4`.

- Định hướng nội dung hiện ngưỡng 0,5 / 3 ảnh / 0,3 / 30 video, ô lời dẫn đang bật, ghi chú đây là ngưỡng của app. Bấm **Lưu ngưỡng hồ sơ** thì hiện **Đã lưu**. API trả đúng các số đó.
- Tab Render, mục Đăng, thẻ **Nguồn & tính nguyên bản** hiện “Chưa có bản kê” vì dự án chưa có timeline. **Kiểm tra lại tính nguyên bản** xong không báo lỗi. Checklist mở đủ bốn nền tảng và link chính sách.
- `GET /api/registry/tools` có `get_originality_report`, risk `read`.

Console chỉ 404 `render-estimate` và `compose-plan` trên dự án chưa có timeline, cùng favicon. Không phải lỗi thẻ nguồn.

## Lệch so với guide

- Index trên `projectId` là unique index, vì mỗi dự án một dòng.
- Checklist là panel trên thẻ, không ghi finding `TIP`. Guide cho chọn một trong hai.
- Dự án chưa dựng timeline không bị chặn đăng. Khi đã có bản kê, render không khớp timeline vẫn đăng riêng tư.

## Chưa làm

- Không thêm detector video bên ngoài. `videohash` (MIT, Python) vẫn chỉ là ứng viên cho sau này.
- Ảnh placeholder nằm dưới đồ hoạ fullscreen vẫn được tính là thời lượng chưa rõ giấy phép. Test tích hợp dựa vào finding đó để kiểm tra bỏ qua kèm lý do. Video có ảnh đã duyệt không đi vào nhánh này.

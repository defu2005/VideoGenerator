# TASK-039 report — Xu hướng và bản dịch đa ngôn ngữ

## Việc đã làm

Hai phần. (A) Lấy chủ đề đang nổi từ YouTube phổ biến, Wikimedia pageviews và RSS/Atom do người dùng thêm, lọc theo hướng kênh rồi đưa ý tưởng vào hàng chờ chủ đề. (B) Từ một video đã xong, tạo dự án con `kind: "translation"`: dịch kịch bản, lồng tiếng hoặc chỉ phụ đề, căn lại timeline theo giọng mới, cắt metadata theo giới hạn nền tảng.

## File thay đổi

### Shared
- `packages/shared/src/schemas/trends.ts` — `TrendItem`, cài đặt nguồn, cache 2 giờ, ngưỡng fit 60 / duyệt tự động 80
- `packages/shared/src/trends/index.ts` — User-Agent không email, lọc từ khóa, lọc nhạy cảm, `planTodaySlot` (lấy slot sớm nhất, dời chủ đề thường niên, không xóa)
- `packages/shared/src/trends/feeds.ts` — map YouTube popular, Wikimedia (bỏ trang meta), parser RSS/Atom (CDATA và entity)
- `packages/shared/src/schemas/translation.ts` — mục tiêu dịch trên hồ sơ, output LLM, view bản dịch
- `packages/shared/src/translations/index.ts` — ước lượng giây nói, rút cảnh dài, giữ id cảnh, chọn giọng, `trimMetadata`, gợi ý scope YouTube
- `packages/shared/src/schemas/llm.ts` — task `trendMatch` (fast) và `translateScript` (strong)
- `packages/shared/src/budget/modes.ts` — `trendMatch` bật mọi preset; `translateScript` tắt ở ECO, bật ở BALANCED/QUALITY/MAX
- `packages/shared/src/schemas/automation.ts` — nguồn chủ đề `trend`
- `packages/shared/src/schemas/project.ts` — `kind: "translation"`
- `packages/shared/src/schemas/profile.ts` — `trendSettings`, `translations`
- `packages/shared/src/schemas/dashboard.ts` — `trendsToday` tối đa 5
- `packages/shared/src/index.ts` — export
- Tests: `packages/shared/test/trends.test.ts`, `packages/shared/test/translation.test.ts`; cập nhật `test/llm.test.ts`, `test/budget.test.ts`

### Server
- `apps/server/src/db/schema.ts` — `profiles.trend_settings`, `profiles.translations`; bảng `trend_cache`, `trend_ideas`
- Migration `drizzle/0036_clean_makkari.sql` (+ snapshot, journal). Lần `drizzle-kit generate` thứ hai in “No schema changes, nothing to migrate”
- `apps/server/src/trends/sources.ts`, `trendService.ts` — fetch (mock được trong test), cache 2 giờ, gọi `trendMatch`, ghi log mục nhạy cảm, thêm vào hàng chờ
- `apps/server/src/api/trends.ts` — làm mới, thêm chủ đề, khóa API YouTube trong TokenVault
- `apps/server/src/translations/translationService.ts`, `youtubeExtras.ts` — dịch cảnh, một lần rút câu nếu quá dài, TTS hoặc giữ giọng gốc, timeline, phụ đề, metadata, cổng “Duyệt bản dịch”
- `apps/server/src/api/translations.ts`
- `apps/server/src/providers/llm/mock.ts` — fixture `TrendMatch`, `TranslateScript`, `TranslateMetadata`
- `apps/server/src/assistant/tools.ts`, `service.ts` — `trend_ideas` (read), `add_trend_topic` (safe), `make_translation` (confirm)
- `apps/server/src/api/dashboard.ts`, `app.ts` — widget và gắn service
- `apps/server/src/services/profileService.ts`, `clipService.ts`, `jobs/jobRepository.ts`, `modelAdvisor.ts` — giữ kind `translation` và cài đặt mới
- Tests: `apps/server/test/trends.test.ts`, `apps/server/test/translation.test.ts`

### Web
- `apps/web/src/features/profiles/TrendsSection.tsx` + test — tab “Tự động”, “Xem xu hướng ngay”, “Thêm vào hàng chờ”
- `apps/web/src/features/profiles/TranslationsSection.tsx` — mục “Đa ngôn ngữ”
- `apps/web/src/features/profiles/AutomationTab.tsx` — gắn hai mục
- `apps/web/src/features/projects/TranslationPanel.tsx` + test — “Tạo bản dịch” trên dự án đã xong
- `apps/web/src/features/projects/ProjectDetailPage.tsx` — gắn bảng bản dịch
- `apps/web/src/features/dashboard/DashboardPage.tsx` — “Xu hướng hôm nay”
- `apps/web/src/features/projects/BriefFields.tsx` — công tắc `trendMatch`, `translateScript`
- `apps/web/src/features/projects/ProjectDetailPage.test.tsx` — fixture ngân sách thêm hai cờ

## Số test

| Workspace | Tests |
|---|---|
| shared | 271 |
| mcp | 12 |
| server | 594 |
| web | 116 |

Cao hơn mức sàn sau TASK-017 (shared 156, mcp 11, server 295, web 70) và cao hơn báo cáo TASK-038 (257 / 12 / 587 / 114).

`npm run typecheck` và `npm run build` đều qua. Không đổi `package.json` hay lockfile. File đổi của task không có byte NUL và là UTF-8.

## Test cũ được sửa có chủ đích

- `LLM_TASKS` từ 24 lên 26 vì thêm `trendMatch` và `translateScript`.
- Bốn preset ngân sách kỳ vọng thêm hai cờ. `trendMatch` bật cả ở ECO. `translateScript` tắt ở ECO.
- Fixture ước lượng trên trang dự án thêm hai cờ đó.

## Lệch so với guide

1. **`trend_cache` thêm cột `cache_key`.** Cùng nguồn, vùng và ngôn ngữ vẫn phải tách feed RSS và danh mục YouTube, nếu không bản cache này đè bản kia.
2. **Id cảnh gốc không tái dùng làm khóa chính của bảng `scenes`.** Khóa đó toàn cục. Id gốc nằm trên `scripts` (section id) và `scenes.section_id`. Hàng cảnh của dự án con là UUID mới.
3. **“Xem xu hướng ngay” chỉ lưu ý tưởng vào `trend_ideas`.** Nút “Thêm vào hàng chờ” và tool `add_trend_topic` mới đưa vào hàng chờ, để bấm hai lần không tạo hai chủ đề.
4. **Khóa API YouTube là một secret toàn cục** `trends.youtubeApiKey` trong TokenVault, không phải theo từng hồ sơ. Tài khoản YouTube dùng khi có token là tài khoản YouTube `CONNECTED` đầu tiên của hồ sơ.
5. **Hướng kênh trống:** bộ lọc từ khóa coi như trùng 1, rồi lấy các mục điểm cao nhất, tối đa 40. Nếu không, kênh chưa có hướng sẽ không bao giờ thấy xu hướng.
6. **“Hướng kênh là tin tức”** nhận bằng từ khóa trên direction (`tin tức`, `thời sự`, `news`, `báo chí`, `current events`, `breaking news`), không có cờ riêng.
7. **Dự án con không chạy orchestrator.** Render FFmpeg không được gọi. Stage `RENDER` để `PENDING` với câu “Sẵn sàng render bản dịch”.
8. **Ảnh thumbnail không được đốt lại chữ.** Chữ overlay đã dịch nằm trong `thumbnail_meta`; đường dẫn ảnh copy từ dự án cha.
9. **Chế độ dự án con** là `AUTO` khi tự động hóa hồ sơ bật, còn lại `ASSISTED`. Cổng duy nhất khi tắt tự động hóa là stage `SCRIPT` trạng thái `WAITING_USER`, câu “Duyệt bản dịch”.

## Chưa làm

- Không commit, không push.
- Không mở trình duyệt. Phiên này không có công cụ trình duyệt. Bảng xu hướng và bảng bản dịch được kiểm bằng test web (làm mới rồi thêm vào hàng chờ; “Tạo bản dịch” gọi API). Không bấm trên một dự án tạm đang chạy.
- Không gọi API mạng thật, không gọi CLI LLM/TTS thật. Test dùng `fetch` giả, LLM mock và TTS mock.
- Không duyệt cổng và không bấm Render trên dự án `56374fb2-54cf-48ff-9441-2e6c653295d4`.
- Không đụng `.env`, `.claude/`, `data/`, `scripts/`.
- Chưa render file video của bản dịch và chưa burn thumbnail theo TASK-036. Người dùng vẫn bấm render trên dự án con khi stage render sẵn sàng.

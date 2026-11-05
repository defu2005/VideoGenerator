# TASK-038 report — Hộp thư bình luận

## Việc đã làm

Một hộp thư cho bình luận trên video đã đăng của chính người dùng (YouTube, Instagram, Facebook). TikTok chỉ hiện ghi chú và đường dẫn mở video. Có lọc spam bằng code, gợi ý trả lời `commentAssist`, ẩn/trả lời tự động trong giới hạn, và thông báo Telegram gom theo giờ.

## File thay đổi

### Shared
- `packages/shared/src/comments/index.ts` — schema cài đặt, lọc spam, chính sách trả lời tự động, nhịp đồng bộ, sàn quota YouTube
- `packages/shared/src/index.ts` — export
- `packages/shared/src/schemas/llm.ts` — task `commentAssist` (SETTINGS, fast, budget `commentAssist`)
- `packages/shared/src/budget/modes.ts` — `commentAssist` tắt ở ECO, bật ở BALANCED/QUALITY/MAX. Không cộng vào ước lượng lượt của pipeline
- `packages/shared/src/schemas/notifications.ts` — sự kiện `comment_attention`
- `packages/shared/src/schemas/publication.ts` — `commentsEnabled` / `commentsStatus` trên chi tiết kết nối
- `packages/shared/src/publishing/youtubeHelp.ts` — scope `youtube.force-ssl`, ghi chú quyền bình luận
- `packages/shared/src/publishing/metaHelp.ts` — `instagram_manage_comments`, `pages_read_user_content`, `pages_manage_engagement`
- `packages/shared/src/publishing/tiktokHelp.ts` — TikTok không đọc bình luận qua API
- Tests: `packages/shared/test/comments.test.ts`; cập nhật `test/llm.test.ts`, `test/budget.test.ts`

### Server
- `apps/server/src/db/schema.ts` — bảng `comments`; `comment_settings` trên hồ sơ; `comments_enabled` / `comments_status` trên tài khoản; `comments_synced_at` trên publication
- Migration `drizzle/0035_comments_inbox.sql` (+ snapshot, journal). Lần `drizzle-kit generate` thứ hai in “No schema changes, nothing to migrate”
- `apps/server/src/comments/` — fetcher YouTube / Instagram / Facebook, đồng bộ, phân loại, trả lời, ẩn, spam, xóa IG, tự động hóa
- `apps/server/src/api/comments.ts` — `/api/comments`, cài đặt hồ sơ, bật đồng bộ YouTube
- `apps/server/src/publishing/youtubePublisher.ts` — thêm `youtube.force-ssl` khi bật quản lý bình luận
- `apps/server/src/publishing/publishService.ts` — trả trạng thái bình luận trong chi tiết kết nối
- `apps/server/src/publishing/ticker.ts` — cùng nhịp với thống kê
- `apps/server/src/notifications/notificationService.ts` — câu “N bình luận cần trả lời”
- `apps/server/src/providers/llm/mock.ts` — fixture `CommentAssist`
- `apps/server/src/assistant/tools.ts`, `service.ts` — `list_comments` (read), `reply_comment` và `hide_comment` (confirm)
- `apps/server/src/app.ts` — gắn service, route, ticker, trợ lý
- `apps/server/test/comments.test.ts`

### Web
- `apps/web/src/features/comments/CommentsPage.tsx` + test — `/comments`, lọc, gửi câu đã sửa, đánh spam hàng loạt, ghi chú TikTok
- `apps/web/src/features/comments/CommentSettingsForm.tsx` — tab “Bình luận” trên hồ sơ
- `apps/web/src/services/commentsApi.ts`
- `apps/web/src/App.tsx`, `components/layout/AppLayout.tsx` — route và huy hiệu chưa đọc
- `apps/web/src/features/profiles/ProfileDetailPage.tsx` — “Quản lý bình luận YouTube” và gợi ý kết nối lại
- `apps/web/src/features/projects/BriefFields.tsx` — công tắc `commentAssist`
- `apps/web/src/index.css`
- `apps/web/src/features/projects/ProjectDetailPage.test.tsx` — fixture ngân sách thêm `commentAssist`

## Số test

| Workspace | Tests |
|---|---|
| shared | 257 |
| mcp | 12 |
| server | 587 |
| web | 114 |

Cao hơn mức sàn sau TASK-017 (shared 156, mcp 11, server 295, web 70) và cao hơn báo cáo TASK-037.

`npm run typecheck` và `npm run build` đều qua. Không đổi `package.json` hay lockfile. File đổi của task không có byte NUL và là UTF-8.

## Test cũ được sửa có chủ đích

- `LLM_TASKS` từ 23 lên 24 vì thêm `commentAssist`.
- Bốn preset ngân sách kỳ vọng thêm `commentAssist` (ECO tắt, còn lại bật).
- Fixture ước lượng trên trang dự án thêm `commentAssist: true`.

## Lệch so với guide

1. **Cột thêm trên `comments`:** `toxic`, `confidence`, `attention_notified_at`. Output LLM có cờ toxic và độ tin cậy; gom thông báo theo giờ cần biết bình luận nào đã gửi.
2. **Đồng bộ tăng dần theo thời điểm đăng**, không lưu page token giữa các lần. Page token của YouTube là offset; lần sau dùng lại sẽ bỏ bình luận mới ở đầu danh sách. Trong một lần kéo vẫn đi hết trang cho đến khi gặp bình luận cũ hơn lần fetch trước.
3. **Câu hỏi “đơn giản”** là `question` với confidence `high` và priority dưới 70. Câu hỏi priority ≥ 70 không tự trả lời; chúng vào lô Telegram cùng mọi `complaint`.
4. **YouTube là opt-in** (`comments_enabled`). Instagram và Facebook luôn kiểm tra scope mới. Thiếu scope thì `needs_reconnect` và không gọi API.
5. **Đánh spam hàng loạt:** YouTube gọi `comments.markAsSpam`. Nền tảng khác chỉ đánh dấu trong hộp thư.
6. **Sự kiện `comment_attention`.** Khóa chủ đề gồm hồ sơ và giờ, nên lô mỗi giờ không bị dedup 6 giờ của `automation_warning` nuốt mất. Câu hiển thị vẫn là “N bình luận cần trả lời”.
7. **`commentAssist` không nằm trong ước lượng số lượt pipeline**, giống các task ngoài pipeline khác.
8. **Bản sao đầu** của cùng một người không bị coi là spam; bản trùng sau đó thì có, và không gửi lên LLM.

## Chưa làm

- Không commit, không push.
- Không mở trình duyệt. Phiên này không có công cụ trình duyệt. Hộp thư được kiểm bằng test web (gửi đúng câu đã sửa, đánh spam hàng loạt, hiện ghi chú TikTok).
- Không gọi API mạng thật, không gọi CLI LLM thật.
- Không duyệt cổng và không bấm Render trên dự án `56374fb2-54cf-48ff-9441-2e6c653295d4`.

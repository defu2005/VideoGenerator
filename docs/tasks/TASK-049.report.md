# TASK-049 report

Chỉ sửa `apps/web/` và file tài liệu của task. Không commit, không push. Không đụng `.env`, `.claude/`, `data/`, `scripts/`, `apps/server`, `apps/mcp`, `packages/shared`. Không duyệt cổng, không render, không đăng, không đổi cài đặt. Không gọi project `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Đã đổi

### Design system

- `apps/web/tailwind.config.js` — token màu (primary, neutral, success, warning, danger, info), radius, shadow, spacing.
- `apps/web/src/polish.css` — biến CSS, nút, bảng, modal, toast, skeleton, sidebar nhóm, drawer, breadcrumb, stepper. Nút chính, nút nguy hiểm và vòng focus dùng biến này.
- `apps/web/src/components/ui/` — `Button`, `Card`, `PageHeader` (có chỗ `?` cho TASK-048), `Tabs`, `Badge`/`Chip`, `Table`, `Field`, `Select`, `Toggle`, `Modal`, `Toast`, `Skeleton`, `Tooltip`, `KpiCard`, `ProgressBar`, `RelativeTime`, `LoadMore`, `ElapsedTime`.
- `EmptyState`, `ErrorState`, `Spinner`, `StatusBadge`, `ConfirmDialog` giữ nguyên vai trò. `ErrorState` đổi nút thành “Thử lại”. `Spinner` thêm skeleton. `ConfirmDialog` thêm `cancelLabel` (mặc định vẫn `Cancel`).
- `apps/web/src/features/dev/UiGalleryPage.tsx` — route dev `/dev/ui`, không có trên sidebar. Build production không chứa chunk gallery.

### Điều hướng

- `apps/web/src/components/layout/nav.ts`, `AppLayout.tsx`, `Breadcrumbs.tsx`, `CommandPalette.tsx`.
- Nhóm: Tổng quan, Nội dung, Kết quả, Cài đặt. Mỗi nhóm thu gọn được.
- Dưới 768 px sidebar thành drawer, nút Menu trên top bar.
- Breadcrumb trên `/profiles/:id/:tab` và `/projects/:id/:tab`.
- `Ctrl+K` hoặc nút “Tìm nhanh” tìm trang, hồ sơ và dự án qua `getProfiles` / `getProjects`.

### Trạng thái, bảng điều khiển, tốc độ

- `apps/web/src/App.tsx` — `React.lazy` theo route, `staleTime` 30 giây, `refetchOnWindowFocus: false`, toast bọc cả app.
- `DashboardPage.tsx` — hàng KPI (giữ nút Draft/Review để test cũ), “Cần bạn xử lý”, “Sắp đăng”, “Xu hướng hôm nay”, dự án gần đây. Thời gian tương đối có tooltip giờ đầy đủ.
- `StageStepper.tsx` trong header dự án (sticky): bước hiện tại, trạng thái cổng, hành động tiếp.
- `CommentsPage`, `TopicsTab`, `AnalyticsPage`, `NotificationsPage`, `ShortsPanel` — “Tải thêm” mỗi 20 dòng.
- `usePageVisible` dừng poll của bình luận, mức dùng, render biến thể, đăng bài. `usePipeline` không refetch khi tab ẩn.
- `RenderPanel` hiện “Đã chạy m:ss” khi job render có `startedAt`.
- `FinancePage` và `UsagePage` dùng `KpiCard`. Quota dùng `ProgressBar`. Tiền trên tài chính đi qua `formatMoney` (USD 2 số lẻ, VND có phân nhóm).
- `apps/web/src/lib/format.ts`.

### Test đã sửa vì đổi nhãn

- `apps/web/src/features/projects/ProjectListPage.test.tsx` — nút lỗi từ `Retry` thành `Thử lại`.

## Bundle

Trước (một chunk):

| File | Raw | Gzip |
|---|---:|---:|
| `index-*.css` | 75,48 kB | 15,58 kB |
| `index-*.js` | 890,80 kB | 247,50 kB |

Sau:

| File | Raw | Gzip |
|---|---:|---:|
| `index-D4GuLyv6.css` | 84,36 kB | 17,45 kB |
| `index-8-NIkeK_.js` (shell) | 512,46 kB | 153,78 kB |
| `ProjectDetailPage-*.js` | 148,42 kB | 39,80 kB |
| `ProfileDetailPage-*.js` | 55,06 kB | 14,53 kB |
| các trang còn lại | tách riêng, mỗi trang tải khi mở | |

Shell giảm khoảng 378 kB raw / 94 kB gzip. CSS tăng vì style mới. Chunk shell vẫn trên 500 kB vì zod và code dùng chung nằm ở entry.

## Test

| Workspace | Kết quả |
|---|---|
| shared | 271 passed |
| mcp | 12 passed |
| web | 128 passed (45 file), gồm 12 test mới: format, component UI, sidebar/drawer/command palette |
| server | 594 test. Lần `npm test` cả monorepo bị timeout 10 giây ở `test/webImageSearch.test.ts` (“returns 503 when both keys are missing”) khi máy đang chạy song song. File đó không bị sửa. Chạy riêng: 1 passed. Năm file server từng timeout ở lần chạy đầy đầu cũng pass khi chạy riêng (62/62). |

`npm run typecheck` và `npm run build` (cả workspace) pass. Không có bảng mới, không chạy `drizzle-kit`. Không đổi `package.json` / `package-lock.json`. Không có byte NUL trong `apps/web/src`.

## Kiểm tra chạy thật

Web dev: `http://127.0.0.1:5181/` (proxy `/api` tới `127.0.0.1:3001`).

- `GET /` và `GET /dev/ui` trả 200.
- `GET /api/dashboard/stats` trả 200, có `total`, `byStatus`, `recent`, `recentErrors`, `automation`, `trendsToday`. Không có lịch đăng, `needs_token` hay OAuth.
- `GET` hồ sơ test `e6c2f6f3-3e6f-434d-94ae-77d7f4c912f0` → “Kênh Vũ Trụ (test)”.
- `GET` dự án test `eb02c679-26a3-4a42-8ea9-bb4e1a25288d` → “[TEST] Chinh phục Mặt Trăng”, stage `RENDER`, status `DRAFT`. Chỉ đọc.

Phiên này không có công cụ trình duyệt nên không chụp được ảnh trước/sau của dashboard, chi tiết dự án và cài đặt. Hành vi được kiểm bằng test component và các GET ở trên.

## Đề xuất API

`/dashboard/stats` nên thêm, để khối “Cần bạn xử lý” và “Sắp đăng” khỏi phải đoán:

- số cổng `WAITING_USER` và danh sách ngắn (project id, stage);
- phê duyệt trợ lý đang chờ;
- kết nối OmniRoute `needs_token`;
- tài khoản OAuth sắp hết hạn (id, nền tảng, lúc hết hạn);
- các publication `SCHEDULED` gần nhất (id, tiêu đề, lúc đăng, hồ sơ).

List bình luận, chủ đề, video phân tích, nhật ký thông báo và job clip nên nhận `limit` + `cursor` (hoặc `page`). Hiện “Tải thêm” chỉ cắt mảng đã tải hết.

## Lệch so với spec

- Nhãn trạng thái dự án và nhiều nút cũ giữ tiếng Anh vì test và `StatusBadge` phụ thuộc chúng. Thanh điều hướng và chữ mới là tiếng Việt.
- “Sắp đăng” là trạng thái trống có link sang lịch, vì stats không có bài sắp đăng.
- “Tải thêm” là phân trang client. Không thêm query mới.
- Chi phí LLM trên trang Mức dùng vẫn tối đa 4 số lẻ (`$0.0123`) vì test `usageFormatting` yêu cầu vậy. `formatMoney` dùng cho tài chính đúng 2 số lẻ / VND.
- Không cập nhật `featureMap` hay `docs/user-guide/`. Guide cấm sửa `packages/shared`, và nhánh này không có `docs/user-guide/`.
- Chưa chuyển mọi trang sang component mới. Trang cũ giữ markup để hành vi và test không đổi. Token và component mới được dùng ở layout, dashboard, tài chính, mức dùng, quota và gallery.
- Toast mới gắn vào tạm dừng tự động hoá và gửi trả lời bình luận. Mutation khác vẫn hiện lỗi tại chỗ.

## Chưa làm

- Chưa restyle hết CSS scene/voice/music/timeline.
- Chưa gắn toast cho mọi mutation.
- Chưa có ảnh chụp màn hình.
- Shell JS vẫn khoảng 512 kB.

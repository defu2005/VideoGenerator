# TASK-132 — Phạm vi workspace và khóa API

## Thay đổi
- Tiếp nhận phần triển khai dở trong working tree; không ghi đè các thay đổi của task khác.
- `apps/server/src/db/schema.ts`, `drizzle/0076_new_miracleman.sql`, snapshot và journal: unique key của agent và doanh thu có workspace; tri thức dùng UUID nội bộ và slug `key` theo workspace/loại.
- `apps/server/src/db/migrate.ts`, `db/client.ts`: backfill idempotent sau DDL do Drizzle sinh. Slug cũ giữ nguyên ID để lịch sử revision không đứt; placeholder cho đề xuất cũ chưa được chấp nhận; hàng chưa có workspace chuyển về workspace mặc định.
- `knowledge/service.ts`, `reports/skillReportService.ts`, `finance/youtubeRevenue.ts`: đọc/ghi và chống trùng theo workspace; đồng bộ doanh thu nền lấy workspace từ profile.
- `auth/keyWorkspace.ts`, `guard.ts`, `handler.ts`, `instance.ts`, `install.ts`, `localKey.ts`, `teamRoutes.ts`: dùng metadata của plugin Better Auth hiện có; gắn khóa mới phía server, khóa cũ chỉ dùng workspace mặc định của chủ khóa; gắn một lần qua `/api/auth/api-key/bind`; ghi audit khi từ chối workspace khác.
- Chuẩn hóa dấu `/` cuối đường dẫn tạo/sửa/gắn khóa để không bỏ qua quy tắc phía server.
- `apps/web/src/features/account/AccountPage.tsx`, `services/accountApi.ts`: hiển thị workspace, nút gắn khóa cũ và cập nhật nhãn sau thao tác; tách nhãn khỏi tên khóa, cho ID dài xuống dòng.
- Tài liệu: `docs/user-guide/khong-gian-va-quyen.md`, `nhat-ky-thay-doi.md`, `packages/shared/src/features/featureMap.ts`.

## Đối chiếu
- Dùng plugin Better Auth sẵn có, không fork, không thêm dependency hay copy mã: https://better-auth.com/docs/plugins/api-key (metadata).
- Khóa máy cục bộ mới có metadata workspace mặc định; khóa máy cũ đi qua cùng guard và bị giới hạn như khóa cũ khác.
- Join token và node token là cơ chế riêng, chỉ gọi `/api/nodes/agent/*`, được xác thực tại route theo node/lease; không dùng để gọi API người dùng hay chọn workspace bằng header. Task này giữ nguyên phạm vi node toàn instance, không chuyển worker thành API key người dùng.
- Worker hiện chạy stage bằng system actor của workspace dự án; kiểm thử doanh thu nền xác nhận hai profile/workspace không trùng khóa external dù gọi ngoài request.
- Không sửa SQL/snapshot bằng tay. Hai lần `npx drizzle-kit generate` đều báo `No schema changes` với migration nhận bàn giao.
- Migration thay đổi unique key; chỉ chạy trên fixture trong kiểm thử, chưa áp dụng lên dữ liệu thật.

## Kiểm chứng
- `npm run typecheck`: bản cuối qua cả bốn workspace.
- `npm run build`: bản cuối qua; Vite còn cảnh báo kích thước chunk và chú thích thư viện phụ thuộc.
- Server tập trung: `auth.test.ts`, `workspace132.test.ts`: 14/14 qua (bao gồm nâng cấp DB trước 132, giữ revision, khóa cũ/mới và hai workspace).
- Trình duyệt Chromium qua skill webapp-testing: trang `/account`, API giả hoàn toàn, bấm gắn khóa cũ và xác nhận nhãn workspace mới; đã kiểm tra ảnh chụp, không gọi API thật.
- Quét NUL byte các file văn bản thay đổi: không phát hiện.
- Bộ test: shared 752/752, MCP 22/22, web 216/216; server chạy lại sau sửa lỗi phủ quyền/skill đạt 1.289 qua, 6 bỏ qua (142 file qua, 2 bỏ qua). Tổng 2.279 test qua.
- Lượt `npm test --workspaces -- --reporter=dot --maxWorkers=2` đầu phát hiện đúng ba lỗi tích hợp nêu dưới; nhóm sửa 21/21 và toàn bộ server chạy lại đều qua. Không sửa kỳ vọng để bỏ qua tool hay route chưa được phủ.

## Sai khác và phần còn lại
- Kiểm thử toàn repo phát hiện ba lỗi tích hợp từ TASK-122/129b: route `/api/resources` thiếu rule quyền, trang tài nguyên máy thiếu phân loại trong hub, và skill giám sát thiếu sáu tool. Đã bổ sung rule `settings.read`, hướng dẫn và khai báo tool; không nới quyền agent.
- `auth/routePermissions.ts`, `test/workspaces.test.ts`: thêm kiểm chứng HTTP viewer bị 403, editor đọc được trạng thái tải máy; test phủ route giữ nguyên yêu cầu đủ mọi route.
- `.agents/skills/vg-supervise/SKILL.md`, `video-van-hanh-app/SKILL.md`, `test/agentSkillPack.test.ts`: chỉ bổ sung tool đang tồn tại và phân loại trang mới, giữ kiểm tra phủ tool không bỏ qua tên thiếu.
- Skill validator Python chung không chạy do máy thiếu PyYAML; parser và bộ test skill của repo kiểm tra cả hai skill, không cài thêm gói.
- API tri thức bên ngoài giữ dạng slug hiện có `get(id)`; UUID chỉ dùng nội bộ để không phá consumer hiện tại.
- Không commit/push; không tác động dự án bảo vệ hay thư mục dữ liệu thật.
- Các kiểm tra yêu cầu đã hoàn tất. TASK-123 chưa triển khai: README yêu cầu task trước được review và commit trước khi chuyển task; agent không được commit/push. Cần review đợt thay đổi đang có trước khi mở task mới.

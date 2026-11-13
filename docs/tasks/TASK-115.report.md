# TASK-115 — Không gian làm việc, vai trò, quyền theo kênh, nhật ký

Chưa commit. Migration: `apps/server/drizzle/0067_purple_iron_man.sql` (sinh bằng drizzle-kit; lần sinh thứ hai báo "No schema changes").

## Bảng gốc có `workspace_id`
profiles, projects, style_packs, video_looks, knowledge_entries, webhook_endpoints, assistant_conversations, operator_conversations, standing_orders, operator_goals, operator_preferences, revenue_entries, cost_entries, payout_thresholds, monthly_reports, agents. Thêm `channel_grants`, `audit_log`, `pending_actions.actor_user_id/workspace_id`. Plugin `organization` của Better Auth (sáu vai trò). Khởi động tạo "Không gian chính" và gán mọi dòng cũ (idempotent, có test).

## Ai hành động thay ai
| Nguồn | Actor |
| --- | --- |
| Web/phiên đăng nhập | người dùng đó, vai trò trong không gian đang chọn |
| API key + `x-workspace-id` | chủ của khoá; sai không gian → 404 |
| Trợ lý chat | người đang chat (ALS) |
| MCP | người dùng của API key |
| Operator, agent, scheduler, autopilot, tự sửa chất lượng, Telegram | actor hệ thống = chủ không gian (Telegram duyệt cũng vậy) |

## Điểm cuối đã đổi
Toàn bộ `/api/*` qua hook quyền (`auth/routePermissions.ts`, route chưa khai báo → chỉ chủ). Lọc theo không gian + kênh bằng SQL: projects, profiles, publications, comments, finance (revenue/cost/payout/reports/views), dashboard, analytics, accounts, assistant pending actions, `/api/projects/:id/events` và luồng agent events. Mới: `GET /api/me`, `GET /api/audit` (audit.read). `invokeRegistryTool` bắt buộc `actor`; `TOOL_ACTIONS` phủ đủ `ASSISTANT_TOOLS` (có test). Từ chối được ghi `refused`. Khoá cấm đổi vai trò/thành viên thêm vào `registry/policy.ts`.

## Web
Chọn không gian ở menu người dùng, menu ẩn theo quyền, nút duyệt/chạy ở StageRow ẩn theo quyền, toast 403, xử lý 409 `WORKSPACE_REQUIRED`. MCP gửi `VG_WORKSPACE_ID`.

## Kiểm tra
- Typecheck gốc sạch; build web/shared/server ổn.
- shared 721, web 185, mcp 21 test pass. Server: 1006 test, pass hết sau khi sửa 3 fixture schema tay (autopilot*, thêm cột workspace_id/organization); `tiktokPublisher` chạy riêng 18/18 pass; `render.test.ts` bỏ qua (ffmpeg/EPERM).
- Test mới `test/workspaces.test.ts` (15): ma trận vai trò, phủ công cụ và route, cô lập 404/danh sách, quyền kênh, viewer 403 chạy bước, editor không duyệt cổng, admin/operator theo cờ, SSE 404, audit, `GET /api/audit` editor 403, tool bị từ chối có dòng audit, backfill idempotent, không còn `workspace_id` NULL.
- Kiểm tay trên DATA_DIR tạm: tạo chủ → có "Không gian chính"; người xem có quyền 1 kênh thấy 1/2 dự án, chạy bước 403, chủ đọc `/api/audit` thấy dòng `denied`, người xem đọc audit 403.

## Lệch so với guide (cần biết)
- Đăng ký đang tắt nên không có API tạo người dùng thứ hai; kiểm tay chèn user/member/grant bằng SQL. Chưa có UI mời thành viên hay cấp quyền kênh.
- Chưa có test riêng cho: pending action sai vai trò/không gian (logic có ở `assertMayResolve`), API key sai `x-workspace-id` với auth thật.
- `monthly_reports` khoá chính theo `month` nên hai không gian trùng tháng sẽ đè nhau.
- Knowledge và agents registry vẫn dùng chung, chỉ đóng dấu khi tạo; `usage.getAppUsage` chưa lọc.
- Chỉ ẩn nút ở nav và StageRow; chưa trang xem audit trên web (API có).

## Cài đặt nên thành theo không gian sau này
Ngân sách/autonomy, TTS/AI provider mặc định, mốc thanh toán, cờ guideline/review, cấu hình Telegram, múi giờ và ngôn ngữ mặc định (hiện nằm trong `app_settings` toàn cục).

## File
Mới: `src/auth/{roles,instance,actor,policy,workspaces,guard,install,setup,routePermissions,permissionHook,auditLog,meRoutes,requestContext,toolActions}.ts`, `drizzle/0067_*`, `test/{testActor,workspaces}.ts`, web `services/meApi.ts`, `hooks/useCan.ts`, `docs/user-guide/khong-gian-va-quyen.md`. Sửa: schema, các service/api theo phạm vi, `registry/{invoke,audit,policy}.ts`, `assistant/{loop,service}.ts`, `api/{registry,agentEvents}.ts`, `operator/{modelRuntime,qualityRepair}.ts`, `apps/mcp/src/apiClient.ts`, web `apiClient.ts`, `nav.ts`, `AppLayout.tsx`, `StageRow.tsx`, featureMap, nhật ký thay đổi, test cũ truyền `testActor`.

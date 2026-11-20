# TASK-128b — Phân công agent, skill theo vai trò và cache ảnh

Phần §5–§8 của guide TASK-128 dựa trên protocol và bộ công cụ VISUAL_SEARCH đã kiểm ở TASK-128a.

## Sửa sau review S0 (2026-11-16)

Đánh giá fit/crop trước đây dùng lại theo bytes và chủ thể nên có thể sai khi lời dẫn đổi ngữ cảnh. `visualCache.ts` nay dùng fingerprint chung theo prompt, lời dẫn, mô tả hình, tỉ lệ, threshold và policy. `visionVerify.ts` kiểm fingerprint ở cache verdict và cache LLM; `visualToolkit.ts` ghi verdict agent theo cùng ngữ cảnh. `visualService.ts` đưa fingerprint vào search hash để không bỏ qua bước kiểm ảnh chỉ vì query không đổi. Verdict chung/legacy chỉ dùng tham khảo. Ảnh USER/APPROVED vẫn giữ nguyên.

48 test trong 5 bộ cache, schema vision, agent toolkit, reuse và MAX đạt; không đổi expectation MAX/126 có sẵn. Có regression chạy tìm ảnh hai lần, cùng SHA nhưng lời dẫn mới phải tới model; cùng context không gọi model; đổi aspect/threshold kiểm lại; quyết định người dùng vẫn giữ. Log `tmp/s0-128b-context-final-tests.log`. Server typecheck đạt `tmp/s0-128b-context-typecheck-final.log`; build toàn repo đạt `tmp/s0-task136-build.log`. Hướng dẫn, featureMap và changelog đã cập nhật, 4 test user guide đạt. UTF-8/NUL và diff check trong phạm vi sửa đạt. Không migration, dependency, commit/push hoặc thao tác dự án thật. Full suite workspace đang được kiểm lại; xem `docs/tasks/S0.review.md` để theo dõi bằng chứng và các finding còn mở của S0.

## Thay đổi

- `packages/shared/src/agents/assignments.ts`, `apps/server/src/agents/assignments.ts`, `apps/server/src/api/fleet.ts` và `stageService.ts` thêm phân công theo workspace, tên máy, vai trò, kênh, video và bước. Chỉ tài khoản người dùng có quyền sửa cài đặt được quản lý phân công. Claim áp dụng phân công cụ thể nhất, giới hạn số job và fence của TASK-118. Lease quản lý hồ sơ và lease ghi cảnh độc lập nhau.
- `apps/server/src/operator/skills.ts`, `apps/server/src/fleet/service.ts` và `.agents/skills/visual-scout/SKILL.md` thêm metadata `roles`, thứ tự ưu tiên skill trong gói theo instance và danh sách skill cần đọc trong handbook. Thư viện chung và quy trình duyệt skill draft của TASK-123 vẫn dùng cho mọi instance.
- `apps/server/src/agents/visualCache.ts`, `visualToolkit.ts`, `toolDefs.ts`, `apps/server/src/services/visualService.ts` và `visionVerify.ts` thêm cache tìm ảnh 7 ngày và verdict 90 ngày. Scout tra theo truy vấn hoặc chủ thể với phash, candidate hay URL. App đọc cache verdict trước khi gọi vision. Brave, stock providers và scout ghi kết quả tìm. Chỉ vision của app và tool ghi verdict có lease được ghi cache verdict.
- `packages/shared/src/knowledge/{schema,snapshot,catalog}.ts` và `docs/knowledge/change-catalog.md` thêm `source_note` vào nhóm nguồn ảnh D2 trong kho tri thức đã có. Scout đọc ghi chú đã xuất hiện trong kho, có thể đề xuất qua luồng tri thức hiện hành. Ghi chú nguồn không tham gia quyết định giấy phép.
- `apps/server/src/db/schema.ts` và migration **0080_sharp_guardian.sql** do Drizzle sinh, kèm snapshot và journal, thêm `agent_assignments`, `image_verdicts`, `search_query_cache`. Lần generate thứ hai báo không thay đổi schema.
- `apps/server/src/fleet/stageMetrics.ts`, `apps/web/src/features/operator/{AgentAssignmentsPanel,FleetTab}.tsx` và CSS thêm quản lý phân công, hàng đợi theo vai trò, job còn lease theo instance, trung vị giây/cảnh và gợi ý bổ sung scout. `deploy/docker/compose.hermes-scout.yml` và `deploy/README.md` cung cấp mẫu chạy N scout với Compose project, tên và volume riêng.
- `docs/user-guide/agent-nhan-stage.md`, changelog và featureMap cập nhật hướng dẫn phân công, thêm scout, cache, bản quyền và ghi chú nguồn.

## Kiểm chứng

- `npm run typecheck`, `npm run build` và `npm test --workspaces -- --maxWorkers=2` đều đạt. Shared 755, MCP 31, server 1.378 đạt và 6 skip, web 223. Log nằm trong `tmp/task128b-verified-{typecheck,build,tests}.log`. Build có cảnh báo kích thước chunk Vite.
- Bộ tích hợp kiểm phân công bắt buộc, quyền user, ưu tiên phạm vi, giới hạn hai job, lease quản lý kênh cùng lúc với lease scout, từ chối ghi vào cảnh ngoài job, số liệu hàng đợi/claim, gói role skill, TTL và workspace. Test vision xác nhận cùng tệp và chủ thể dùng cache với 0 lời gọi model, chủ thể khác gọi mock model.
- Trình duyệt React/Vite với API giả lập đã tạo và tắt phân công, kiểm thẻ Fleet ở 1440 px và 375 px. Ảnh kiểm tra nằm trong `tmp/task128b-desktop.png` và `tmp/task128b-mobile.png`.
- `docker compose config` với dữ liệu fixture xác nhận `vg-scout-2_scout-data` và `vg-scout-3_scout-data` là hai volume riêng, tên máy `Hermes-2` và `Hermes-3` tương ứng. Ví dụ dùng mẫu Compose hiện có và image Hermes đã pin. [Tài liệu skill Hermes](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)

## Quyết định cần lưu ý khi review

- App yêu cầu SHA khớp với verdict đạt để ảnh gần giống được sửa watermark không qua cổng nhờ phash. Verdict loại chỉ dùng lại cho đúng chủ thể. Cache tìm ảnh bỏ trọn URL có query hoặc fragment để tránh lưu URL đã ký. Scout vẫn ghi verdict trên ảnh đã lưu trước khi chọn.
- Vai trò ưu tiên thứ tự skill trong gói và handbook. Ví dụ cron dùng `--skill visual-scout` để preload trong Hermes. Việc khởi động gateway và chạy model thật chưa được nghiệm thu trong test fixture.
- Trung vị là trung vị của thời lượng job thành công chia số cảnh được scout chọn trong lần chạy. Mẫu là tối đa 100 job thành công gần nhất có dữ liệu lựa chọn.
- Test fixture 128a thêm phân công hợp lệ để kiểm protocol theo quy tắc mới. Kiểm tra coverage skill xóa ngoại lệ cho `list_knowledge` và `propose_knowledge_change` vì starter skill đã khai báo hai tool.
- TASK-126 và MAX vision dùng lại ảnh đã duyệt khi bytes và chủ thể khớp. Các test mô phỏng ảnh chưa từng duyệt xóa cả cache chung, còn fixture mô phỏng ảnh từ nguồn khác hoặc chủ thể khác dùng dHash hoặc mô tả riêng. Cả 19 test của hai bộ liên quan đã đạt sau thay đổi fixture.
- Tái sử dụng hợp đồng lease TASK-118/122, bộ sync TASK-123, phash và webCrawl. Không thêm npm dependency, không sao chép mã nguồn ngoài. Không commit, push, vận hành Hermes thật hay chạm dự án được bảo vệ.

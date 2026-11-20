# TASK-136 — LLM relay qua máy chủ

Trạng thái 2026-11-17: hoàn tất triển khai và tự review; không commit/push theo chỉ dẫn người dùng.

## Hành vi

- Relay chỉ phục vụ `chat/completions`, `embeddings` và `models`, qua OmniRoute của máy điều khiển. Chỉ agent API key có profile và thành viên còn quyền trong workspace, hoặc node token còn hiệu lực, được gọi. Browser session không dùng relay. API quản trị yêu cầu user session và quyền settings của auth guard.
- Grant, hàng mặc định `*`, hạn mức tốc độ, chi phí ngày, usage và lần từ chối tách theo workspace. Agent cùng tên ở hai workspace có cấu hình độc lập. Header workspace không chuyển được phạm vi API key. `x-vg-job-id` chỉ được nhận khi job cùng workspace, RUNNING và có lease đúng caller, đúng loại và còn hạn; agent lease bị preempt không được nhận.
- Trước khi fetch, một transaction giữ reservation trong `llm_relay_usage` với trạng thái `pending`, gồm trần token đầu ra và ước tính đầu vào từ toàn bộ request, kể cả tool schema. Lượt gửi ảnh cần giới hạn ngữ cảnh từ catalog. Request đồng thời không cùng tiêu phần ngân sách còn lại. Ngày ngân sách theo timezone của policy quota. Trần hữu hạn từ chối giá hoặc chi phí trong ngày chưa xác định.
- JSON và SSE ghi usage thực khi có dữ liệu hợp lệ; dữ liệu thiếu được đánh dấu ước tính và giữ mức đã dự trữ. Timeout, hủy, lỗi đọc body/stream vẫn ghi accounting; lỗi stream truyền tới client. Startup chuyển pending cũ thành lỗi có ước tính bảo thủ thay vì giải phóng tiền như chưa gọi. Finalize dùng UPDATE có fence và transaction để quota/job usage không ghi hai lần.
- Chi phí đến sau khi job kết thúc vẫn được ghi bằng tùy chọn accounting riêng của orchestrator; ghi usage thông thường vẫn chỉ áp dụng cho job đang chạy. Relay không gắn job hoặc job đã xóa được tính một lần vào AppUsage, automation budget và finance, với scope workspace cho dữ liệu relay mới.
- Header caller không được chuyển tiếp. Key máy chủ được che ở JSON, lỗi, SSE qua ranh giới chunk; model metadata nhạy cảm bị loại và grant cũ chứa key bị vô hiệu hóa. Không có key nhà cung cấp trong bundle hay response.
- Bỏ lending `llm:*`; TTS/search giữ quy tắc hiện có. Node probe dùng token máy kiểm relay và báo `llm:relay`. Gateway mới có OmniRoute sẵn sàng mặc định `only`; cấu hình đã lưu giữ nguyên.
- Hermes nhận relay URL và `${VG_API_KEY}` của chính máy. Model bundle lấy từ grant caller/workspace, không lấy model Fleet cũ ngoài allowlist. Khi không có model hợp lệ hoặc LLM bị tắt, bundle để model rỗng để skill sync/heartbeat/overview tiếp tục hoạt động; relay vẫn chặn lời gọi không được phép. MCP sync xóa model cũ và giữ provider relay.
- UI có trạng thái relay, bảng caller và editor grant; Fleet/Nodes hiện usage. Số liệu thiếu có nhãn Chưa rõ/ước tính. Bảng mobile cuộn riêng và dùng bàn phím được. Fleet dẫn tới cấu hình model trong AI thay cho field không còn tác dụng.

## Dữ liệu và tài liệu

Migration `0083_furry_strong_guy.sql` tạo grant/usage. Bản sửa `0084_milky_betty_ross.sql` giữ dữ liệu đã tồn tại và đổi unique key grant theo workspace, kể cả scope NULL legacy. Cả hai do Drizzle sinh, có snapshot/journal. Lần generate kiểm tra báo `No schema changes`. Không sửa SQL/snapshot bằng tay, không thêm dependency. Một migration bổ sung là cần thiết để sửa khóa toàn cục của 0083 mà không viết lại lịch sử đã có.

User guide `mo-hinh-ai.md#relay-llm`, featureMap, changelog, kiến trúc và deploy mô tả relay và việc bỏ `VG_HERMES_MODEL_KEY`. Hướng dẫn bổ sung reservation, unknown cost, workspace và giá chưa xác định. Nhánh 135b/c đã dừng không nằm trong nghiệm thu này.

## Kiểm chứng

- Lượt tích hợp: 11 bộ / 102 test đạt (`tmp/task136-integration-final.log`). Các delta tiếp theo: 38 test metadata/grant/Fleet và 36 test auth đạt; kiểm member removal, khóa gắn sai workspace và model metadata chứa key đều từ chối an toàn.
- Fixture tối giản của `autopilotFinish.test.ts` thêm bảng relay vì UsageService nay đọc overhead mới; giữ nguyên assertion về phí ảnh và hold. 24 test ngân sách/accounting/usage đã đạt (`tmp/task136-budget-regression.log`). Không thêm nhánh bỏ qua bảng thiếu trong production.
- Browser dùng Vite và API fixture riêng: 14/14 kiểm tra, không lỗi JS. Kiểm 1440px/375px, PUT grant đúng payload, chi phí chưa rõ, Fleet identity chuẩn, table scroll bằng bàn phím và nút sửa. `tmp/task136-browser-review.md` và các ảnh `tmp/task136-browser-*.png`. Không dùng backend thật.
- Lượt workspace cuối đạt: shared 765, MCP 32, server 1.516 đạt / 7 skip, web 227 (`tmp/task136-verified-workspaces.log`). Typecheck toàn repo đạt (`tmp/task136-verified-typecheck.log`); build sau delta cuối đạt (`tmp/task136-verified-build.log`). Identity delta đạt 27/27; workspace/accounting/Fleet delta đạt 54/54.
- Browser bổ sung dùng Fastify thật và SQLite fixture riêng: lưu grant trả 200, workspace A thay đổi chính xác và cùng caller ở B giữ nguyên; không lỗi JS hay tràn trang 375px. `tmp/task136-browser-real-review.md` ghi rõ backend dùng testActor, không kiểm đăng nhập bằng mật khẩu. Không gọi LLM hay dùng DB/app vận hành.
- Diff check đạt; 354 file văn bản thay đổi qua kiểm NUL và UTF-8. Không thay dependency hoặc đường dẫn bị cấm.
- MCP preview đang được hoàn thiện độc lập ở TASK-139; bộ MCP cập nhật đã đạt 49/49 test và typecheck (`tmp/task139-mcp-image-tests.log`). Không dùng kết quả này để tuyên bố TASK-139 hoàn tất.

Không chạy LLM/TTS CLI thật, không network/provider thật trong test, không thao tác dự án bảo vệ, không commit/push. Tái sử dụng OmniRoute và pricing/quota/usage hiện có; lấy hình dạng policy từ LiteLLM, không sao chép mã hoặc thêm dependency.

## Nhóm file thay đổi

- Server: providers/llm/{relay,relayStream,pricing,registry,gatewaySettings}.ts; api/llmRelay.ts, auth/guard.ts, app.ts, db/schema.ts; migrations 0083/0084 và metadata Drizzle.
- Tích hợp: node/{leaseSecrets,probe,agent}.ts, fleet/service.ts, pipeline/orchestrator.ts, services/usageService.ts, finance/financeService.ts và test relay/auth/accounting/Fleet/probe/lending.
- Shared/web/MCP: schema relay/job/fleet, featureMap; LlmRelaySection, FleetTab, Nodes, cấu hình lending; MCP sync và test liên quan.
- Tài liệu/deploy: docs/ARCHITECTURE.md, user guide mô hình AI và changelog; deploy/README.md, compose Hermes và hermes.env.example mẫu.

## Lệch guide và giới hạn

Rate limit dùng reservation SQLite trong cửa sổ trượt thay token bucket thuần RAM để giữ giới hạn đồng thời và sau restart. Migration bổ sung 0084 sửa scope workspace thay vì sửa lịch sử 0083. Không còn hạng mục triển khai TASK-136 chờ. Kết nối OmniRoute và container Hermes thật cần cấu hình vận hành; fixture không chứng minh các kết nối thật này. TASK-139 và finding snapshot dự án con ở S0 là công việc riêng.

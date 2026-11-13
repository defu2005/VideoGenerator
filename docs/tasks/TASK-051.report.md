# TASK-051 — Tiến độ triển khai

## Phần đã làm

- `apps/server/src/operator/agentRuntime.ts` định nghĩa hợp đồng chạy, nối phiên, nhận tiến độ, dừng và chuẩn hóa kết quả.
- `apps/server/src/operator/cursorRuntime.ts` đóng gói phát hiện Cursor, tham số CLI, kết quả tiến trình và lệnh nối phiên.
- `apps/server/src/operator/service.ts` gọi Cursor qua adapter và trả thông tin runtime, đồng thời giữ phản hồi CLI hiện có.
- `apps/server/src/api/registry.ts` thêm JSON Schema đầy đủ vào catalog. Mô tả tham số ngắn vẫn có cho client hiện tại. Tool tiếp tục được kiểm tra ở registry khi gọi.
- `apps/server/test/operator.test.ts` và `apps/server/test/registry.test.ts` kiểm tra thông tin runtime và schema công cụ.
- `docs/ARCHITECTURE.md` ghi phạm vi đã triển khai.
- Đổi nhãn thành **Agent operator** trong menu, trang operator, trợ lý, Telegram, feature map và hướng dẫn. Giữ route `/operator` và anchor hướng dẫn để liên kết hiện có vẫn dùng được.
- `apps/mcp/src/apiClient.ts` và `apps/mcp/src/tools.ts` dùng JSON Schema đầy đủ khi đăng ký công cụ động từ registry. Client vẫn đọc catalog cũ hoặc schema không chuyển đổi được qua phần mô tả gọn. `apps/mcp/test/tools.test.ts` kiểm tra công bố schema và từ chối đầu vào sai trước khi gọi API.
- `apps/server/src/operator/modelRuntime.ts` dùng provider LLM đã cấu hình, bao gồm đường Claude Code CLI, qua cầu nối JSON có giới hạn bước. Mọi lệnh đi qua registry với nguồn operator. Lượt dừng khi cần duyệt và ghi audit cùng mã lượt.
- `packages/shared/src/schemas/operator.ts`, `apps/server/src/operator/settings.ts`, `apps/server/src/operator/service.ts` và `apps/web/src/features/operator/OperatorPage.tsx` lưu và áp dụng lựa chọn runtime riêng cho web, Telegram và lịch chạy. Cầu nối dùng lịch sử cấp app. Chỉ adapter Cursor đọc hoặc ghi mã phiên Cursor.
- `apps/mcp/src/tools.ts` chỉ đăng ký catalog từ registry cho nguồn operator, gồm cả các tên từng trùng công cụ REST cũ. Các client MCP tương tác vẫn có catalog cũ. Fixture MCP kiểm tra việc loại đường gọi REST trực tiếp khỏi operator.
- `apps/server/src/providers/llm/openaiCompatible.ts`, `structured.ts`, `types.ts` và `apps/server/src/operator/modelRuntime.ts` hỗ trợ OpenAI native function calling qua hợp đồng bước dùng chung. Cầu nối dùng quan sát đã rút gọn ở mỗi lần gọi. Kiểm schema tham số và yêu cầu duyệt vẫn do registry xử lý.
- `apps/server/src/assistant/service.ts` ghi mức dùng của runtime model vào cùng báo cáo trợ lý, liên kết với mã lượt operator.
- Trang operator hiển thị lý do runtime đã chọn không khả dụng. Fixture xác nhận Claude CLI bị tắt thì từ chối lượt và giữ lựa chọn, không chuyển sang Cursor.

## Kiểm chứng

`npm run typecheck` qua cả bốn workspace. Lượt kiểm native function calling, registry và usage có 47 test server và 19 test MCP qua. Hai ca giả lập xác nhận cả native function calling và cầu JSON đều chờ duyệt khi muốn xóa. Lượt kiểm web trước đó có 5 test qua. Kiểm chứng trình duyệt và CLI thật còn mở. Không đổi schema DB hoặc dependency.

`npm run build` qua. Lượt `npm test --workspaces` trước đó có một timeout trong `orchestrator.test.ts`. Chạy riêng file này qua 11/11. Lượt kiểm lại toàn workspace với `--maxWorkers=2` qua shared 337, MCP 19, server 656 và web 149, với 1 test server bỏ qua.

## Kiểm chứng bổ sung (giả lập)

Bốn ca mới trong `apps/server/test/operator.test.ts`, đều chạy bằng provider giả hoặc `fetch` giả, không gọi mạng hay CLI thật:

- Model trả định dạng sai hai lần (sau lượt sửa có giới hạn): lượt chuyển `failed`, không có dòng audit, không gọi công cụ nào.
- Adapter model gọi `approve_pending_action`, công cụ có tham số `apiKey` và dự án bị bảo vệ: cả ba bị từ chối và ghi audit `refused`.
- Provider mất kết nối: lượt chuyển `failed`. Lượt treo bị `stopActive()` dừng và chuyển `killed`.

Ca thứ hai tìm ra lỗi thật: audit lưu nguyên tham số, kể cả khóa bí mật. `apps/server/src/registry/audit.ts` nay che giá trị dưới các khóa kiểu bí mật (`apiKey`, `*token`, `password`, `*secret`, …) trước khi ghi, cho mọi đường ghi audit. `agentRuntime.ts` ghi chú chính sách mặc định cho adapter mới: mọi lệnh đi qua registry với nguồn `operator`.

Kết quả: `operator.test.ts` 16/16 qua.

## Còn lại (chưa kiểm thật)

- Chạy bằng Cursor CLI thật chưa làm được trên máy này: Windows Application Control chặn file `tree_sitter_runtime_binding.node` của cursor-agent (ERR_DLOPEN_FAILED).
- Nghiệm thu trên trình duyệt và với Claude CLI thật vẫn còn mở.
- Các provider dùng cầu JSON tiếp tục phiên từ lịch sử app. Chưa có nối phiên native ngoài Cursor.

Phần mã và kiểm thử giả lập của TASK-051 đã xong. Các mục ở trên cần người dùng kiểm tay.

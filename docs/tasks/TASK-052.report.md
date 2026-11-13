# TASK-052 — Tiến độ triển khai

## Phần đã làm

- `apps/server/src/stages/publish/publishExecutor.ts` đối chiếu publication trước khi thực thi job được khôi phục. Lượt đã có kết quả dùng lại kết quả. Lượt chưa tải có thể tiếp tục. Lượt đang tải khi bị gián đoạn cần người dùng kiểm tra trên nền tảng.
- `apps/server/src/publishing/publishService.ts` dùng ID lượt đăng làm khóa của checkpoint. Chuyển sang UPLOADING ngay trước tác dụng phụ và chỉ nhận lượt đang xếp hàng hoặc đã lên lịch. Phản hồi 429 có thể đưa lượt về hàng đợi theo chính sách retry hiện có.
- `apps/server/test/publishing.test.ts` khởi động lại app trên SQLite tạm ở ba checkpoint và kiểm số lần mock publisher gọi upload.
- `docs/user-guide/dang-bai.md`, `docs/user-guide/nhat-ky-thay-doi.md` và `packages/shared/src/features/featureMap.ts` cập nhật cách kiểm tra bài đăng bị gián đoạn.
- `apps/server/src/operator/profileContext.ts` và `apps/server/src/assistant/tools.ts` cung cấp `search_profile_context` qua cùng registry cho MCP và runtime model. Lọc phạm vi trước khi xếp hạng, hỗ trợ tìm không dấu, giới hạn đoạn trích và trả nguồn cùng phiên bản. Dữ liệu trả về gồm guideline, kịch bản, kết quả đăng, bài học đã lưu và ghi nhớ người dùng.
- `apps/server/src/db/schema.ts`, migration `0042_elite_thunderbolt_ross.sql` và snapshot tạo bảng ghi nhớ theo hồ sơ. `apps/server/src/api/operator.ts` và tab **Ghi nhớ** hỗ trợ xem, thêm, sửa và xóa. `apps/mcp/src/tools.ts` chặn sửa ghi nhớ đã xác nhận qua `app_api`.
- `apps/server/src/operator/handbook.ts` ghi cách xử lý đoạn trích. `docs/user-guide/ho-so.md`, nhật ký thay đổi và feature map mô tả tab mới.
- `apps/server/src/operator/checkpoints.ts` lưu mã băm của thao tác đã xác thực và biên nhận theo công việc. Registry chỉ áp checkpoint cho thao tác có tác dụng phụ hoặc cần duyệt của runtime model. Lượt tiếp tục dùng lại biên nhận đã lưu, đối chiếu trạng thái duyệt và dừng nếu thao tác chưa có kết quả xác nhận.
- `apps/server/src/operator/service.ts`, `modelRuntime.ts` và `apps/server/src/api/operator.ts` giữ mã workflow khi tiếp tục từ lượt mới nhất. `apps/web/src/features/operator/OperatorPage.tsx` thêm nút **Tiếp tục**. Migration `0043_breezy_king_cobra.sql` và snapshot lưu checkpoint, mã workflow và runtime của lượt.
- Cursor chạy từ app truyền mã gọi công cụ ngắn hạn qua tiến trình MCP. API đối chiếu mã với lượt đang hoạt động để ghi audit và checkpoint cùng workflow. Workspace quản lý chỉ cho đọc nếu mở CLI thủ công mà không có mã lượt.
- `apps/server/src/providerIntel/compareModels.ts` chạy baseline và ứng viên trên cùng bộ mẫu văn bản. Chỉ chạy trong trần lượt gọi và kiểm loại quota theo cấu hình server. Lưu số đo và điểm từng mẫu trong bảng đánh giá hiện có. Báo cáo giữ baseline nếu thiếu mẫu, chất lượng dưới 80%, thấp hơn baseline hoặc tỷ lệ lỗi schema cao hơn.
- `apps/server/src/api/providerIntel.ts`, `apps/server/src/app.ts`, `apps/web/src/services/providerIntelApi.ts` và `apps/web/src/features/providers/ProvidersPage.tsx` nối API so sánh và báo cáo vào tab **Năng lực và benchmark**. Feature map và hướng dẫn mô hình mô tả thao tác.
- `apps/server/src/services/modelAdvisor.ts` yêu cầu kết quả so sánh gần đây cho đúng tác vụ, baseline và ứng viên. ECO còn kiểm chi phí so với baseline. Khi áp dụng, xác minh lại phạm vi, baseline, năng lực và quota. Đề xuất giữ nguyên không ghi đè cấu hình hoặc chuỗi dự phòng.

## Kiểm chứng và phần còn lại

26 test operator và publishing qua trong lượt kiểm có fixture restart. Typecheck và toàn workspace qua ở mốc checkpoint đăng bài (shared 337, MCP 19, server 656, web 149, một test server bỏ qua).

Ở mốc truy xuất và ghi nhớ, typecheck qua, 13 test registry/operator, 19 test MCP và 13 test web hồ sơ qua. Chạy lại 4 test registry sau khi bổ sung che credential dạng JSON cũng qua. Fixture kiểm tra hai nguồn gọi trả cùng dữ liệu, từ chối dự án chéo hồ sơ và dự án được bảo vệ, phiên bản sau chỉnh sửa, xóa ghi nhớ và truy xuất kịch bản. Lần chạy Drizzle thứ hai báo `No schema changes`. Không đổi dependency.

Ở mốc checkpoint agent, typecheck qua, 15 test server và 6 test web liên quan qua. Ca chuyển từ runtime mock sang native function calling tiếp tục từ cùng checkpoint và không tạo lại dự án khi tham số chỉ đổi thứ tự khóa. Ca chưa có biên nhận chặn tiếp tục. Ca chờ duyệt trả 409. Lần chạy Drizzle thứ hai sau migration 0043 báo `No schema changes`.

Ở mốc Cursor MCP, typecheck, 18 test server và 19 test MCP qua. Fixture tiến trình xác minh thiếu mã thì không được gọi tool ghi, mã hết hiệu lực sau khi lượt dừng, và tiếp tục bằng Cursor mới vẫn chỉ tạo một dự án. Fixture MCP kiểm header chuyển tiếp.

Ở mốc so sánh model, typecheck, 14 test server và 2 test web qua. Fixture dùng tám ca giống nhau trên mỗi model, lưu 16 kết quả và giữ baseline khi ứng viên có điểm chất lượng 50%. Không đổi migration hoặc dependency ở mốc này.

Ở mốc nối bằng chứng vào Model Advisor, typecheck và 21 test advisor/provider intelligence qua. Test kiểm giữ nguyên khi chưa có bằng chứng, mở đề xuất sau khi so sánh đạt ngưỡng và từ chối áp dụng khi baseline đã đổi.

## Kiểm chứng bổ sung

- Test registry mới kiểm đánh thức workflow qua sự kiện: một job lỗi đánh thức đúng một lượt chỉ đọc với mã xác định, gửi Telegram một lần, và không đánh thức khi tự động hóa đang tạm dừng.
- Toàn workspace được chạy lại ở bước kiểm tra cuối của đợt hàng chờ (xem TASK-056).

## Còn lại (chưa kiểm thật)

- Cursor CLI thật không chạy được trên máy này: Windows Application Control chặn `tree_sitter_runtime_binding.node` (ERR_DLOPEN_FAILED). Đường truyền mã gọi công cụ mới được kiểm bằng fixture tiến trình.
- Chưa kiểm trên trình duyệt. Báo cáo so sánh model chỉ dùng bộ mẫu văn bản.

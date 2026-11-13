# TASK-054 — Tiến độ triển khai

- `apps/server/src/operator/events.ts` đối chiếu trạng thái đã lưu để tạo sự kiện job lỗi, render hoàn tất, chờ quota và chờ duyệt. Khóa sự kiện gồm loại, mã nguồn và lần thử khi có. Khóa trùng không tạo thêm dòng. Dự án được bảo vệ bị loại khỏi việc thu thập.
- `apps/server/src/api/operator.ts` và `apps/web/src/features/operator/OperatorEvents.tsx` có danh sách và chi tiết sự kiện. Chi tiết đọc metadata job, lỗi đã lọc, model thực tế, fallback và mức dùng. Sự kiện chờ duyệt có liên kết đến thẻ operator tương ứng. Có liên kết từ job về lượt agent khi kết quả duyệt đã lưu mã job.
- Migration 0046 sinh bằng Drizzle. Lần chạy lại báo không có thay đổi schema.
- Typecheck, 19 test server và 2 test web operator qua. Chạy lại 6 test registry sau khi thêm liên kết job với lượt agent cũng qua. Fixture xác nhận đọc lặp không tạo trùng, thấy model đã dùng và che credential trong lỗi.

## Đợt hoàn thiện

- Quy tắc theo hồ sơ (`operator.event-rule.<hồ sơ>.<loại>`) chọn đánh thức agent và báo Telegram cho từng loại sự kiện. Chờ duyệt chỉ cho thông báo; bật đánh thức trả 400.
- Trạng thái giao nhận: Telegram gửi một lần nhờ `telegram_sent_at`. Lượt đánh thức dùng mã xác định `eventWakeRunId`, nên dispatch lặp không tạo lượt thứ hai.
- Chống vòng lặp: lượt đánh thức chỉ đọc và gói trong phạm vi sự kiện, không tạo job mới nên không sinh sự kiện nối tiếp. Lượt tính vào giới hạn lượt trong ngày, tôn trọng tạm dừng tự động và công tắc dừng.
- Web `OperatorEventRules.tsx` thêm bảng quy tắc theo hồ sơ trong mục Sự kiện. Hướng dẫn, nhật ký thay đổi và feature map đã cập nhật.
- Test registry mới kiểm: tạm dừng thì không đánh thức nhưng vẫn báo một lần, bỏ tạm dừng thì đánh thức đúng một lần với prompt chỉ đọc, và từ chối đánh thức cho chờ duyệt. 7 test registry qua.

## Giới hạn và phần còn lại

- Poller đọc trạng thái mới nhất. Trạng thái tạm thời đổi trước lần poll kế tiếp có thể bị bỏ lỡ.
- Chưa kiểm với Cursor/Claude thật (Cursor CLI bị Windows Application Control chặn trên máy này) và chưa kiểm trên trình duyệt.

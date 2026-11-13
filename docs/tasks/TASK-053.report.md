# TASK-053 — Tiến độ triển khai

- Agent có công cụ `propose_missing_tool` cho tool nội bộ hoặc MCP bên ngoài. Bản đề xuất lưu schema, phạm vi quyền, dữ liệu, bước xác nhận và tiêu chí kiểm thử. Registry từ chối tên đã có, gộp đề xuất đang chờ cùng tên và giới hạn số đề xuất. Web có mục xem và bỏ qua. Telegram báo theo cấu hình ghép nối.
- `operator/skillVersions.ts` lưu bản nháp, phiên bản đang dùng và bản cũ. Ba lỗi cùng dấu hiệu sinh một bản nháp tra cứu quyền và tham số, kèm mã lượt. Người dùng duyệt hoặc khôi phục tại Agent operator. Runtime model và MCP tra cứu bản đang dùng qua registry.
- Kiểm tra cấu trúc, quyền registry và dữ liệu nhạy cảm trước khi kích hoạt. Mức điểm hiện là kiểm tra tĩnh. Chưa dùng điểm đánh giá runtime để tự so sánh hiệu quả skill.
- Migration 0044 và 0045 được sinh bằng Drizzle. Lần chạy lại báo không có thay đổi schema.
- Typecheck và nhóm 20 test server, 19 test MCP, 2 test web operator qua ở mốc skill. Fixture xác nhận bản nháp không xuất hiện trước khi duyệt, cùng phiên bản cho hai nguồn gọi và có thể khôi phục.

## Đợt hoàn thiện

- `apps/server/src/operator/skillEval.ts` chấm skill trên bộ tình huống: mỗi trigger thành câu hỏi phải chọn được skill, anti-trigger và ba câu lạc đề không được chọn. Bộ định tuyến là `scoreCandidates` mà `find_skills` dùng, xếp cùng các skill có sẵn. Điểm là tỷ lệ tình huống đúng (0..100). Mọi skill có sẵn đạt 100.
- `skillVersions.ts` lưu điểm đánh giá thay cho điểm tĩnh. Kích hoạt bản dưới 80 trả 409 `SKILL_EVAL_FAILED`. Danh sách phiên bản trả kèm kết quả từng tình huống và điểm bản đang dùng.
- Học từ chỉnh sửa: `PUT /api/operator/skills/:name/draft` lưu bản sửa của người dùng thành bản nháp nguồn `user_edit`, được chấm lại và chờ duyệt. Skill có sẵn không sửa được (409), đổi tên trả 400.
- `GET /api/operator/learning-report` gom bài học của agent và theo hồ sơ, skill đang dùng, bản nháp và đề xuất công cụ đang chờ. Báo cáo chỉ đọc, tách khỏi việc kích hoạt.
- Web `SkillVersions.tsx` hiện điểm, tình huống trượt, điểm bản đang dùng, nút **Sửa** và mục **Tổng hợp tự học**. Hướng dẫn và nhật ký thay đổi đã cập nhật.
- 17 test operator qua, gồm ca bản sửa yếu bị chặn kích hoạt và báo cáo tự học. Web typecheck qua.

## Còn lại

- Chưa kiểm trên trình duyệt. Bộ tình huống sinh từ trigger nên chưa đo hiệu quả skill trên lượt chạy thật.

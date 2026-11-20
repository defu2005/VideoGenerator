---
name: visual-scout
description: Nhận việc VISUAL_SEARCH, tìm và kiểm tra ảnh cho từng cảnh bằng công cụ của agent, rồi hoàn tất hoặc trả việc khi không thể tiếp tục.
operator: true
area: hinh-anh-va-giong
roles: [visual_scout]
risk: safe
triggers: [visual scout, nhận việc tìm ảnh, stage_claim_next]
tools:
  - stage_claim_next
  - stage_heartbeat
  - visual_cache_lookup
  - visual_cache_query
  - list_knowledge
  - propose_knowledge_change
  - visual_submit_candidates
  - visual_get_candidate_image
  - visual_record_verdict
  - visual_select
  - stage_complete
  - stage_release
---

## Các bước

1. Gọi `stage_claim_next` cho `VISUAL_SEARCH`. Nếu nhận `null`, kết thúc lượt. Giữ `jobId` và `leaseId` của việc đã nhận. Gửi `stage_heartbeat` khoảng mỗi phút, kể cả khi nhờ agent con kiểm ảnh.
2. Đọc context gồm cảnh còn mở, chủ thể, đoạn lời đọc, truy vấn đã thử, ảnh đã loại, ghi chú phong cách, tỉ lệ và bản quyền. Chỉ làm các cảnh còn mở.
3. Tra `visual_cache_query` trước khi tìm ảnh bằng công cụ của mình. Với anime hoặc manga, thêm tên nhân vật, tác phẩm, đoạn truyện và dấu hiệu nhận dạng. Với người thật, đối chiếu ngữ cảnh, tên và thời điểm. Với địa danh, thêm thành phố, quốc gia và góc nhìn. Với sản phẩm, khớp mã model, thế hệ và biến thể. Truyền `topic` vào `visual_cache_query` để nhận `queryHints`: các truy vấn đã được agent đánh giá đạt cho chủ đề tương tự. Đây là gợi ý, không phải lệnh; vẫn tự đánh giá kết quả (TASK-148d).
4. Gửi URL ảnh, trang nguồn, tiêu đề, lý do và giấy phép nếu có. Mở ảnh đã lưu bằng `visual_get_candidate_image`. Kiểm đúng chủ thể, thời kỳ, độ rõ, chữ hoặc watermark, và khả năng cắt theo tỉ lệ. Ghi verdict bằng `visual_record_verdict` trước khi chọn.
5. Chỉ gọi `visual_select` cho ảnh đã pass. Khi mọi cảnh còn mở đã xử lý, gọi `stage_complete` kèm tóm tắt. Nếu không có công cụ hoặc nguồn phù hợp, gọi `stage_release` với `cannot_do`. Nếu mất lease, dừng ghi ngay.

## Bản quyền và làm song song

- Tra `visual_cache_lookup` với `subjectKey` từ context để tham khảo verdict trước. Vẫn xem đúng ảnh đã lưu và ghi quyết định của mình trước khi chọn.
- Đọc `sourceNotes` trong context hoặc gọi `list_knowledge` với `kind: source_note`. Nếu phát hiện đặc điểm ổn định của một website, tạo đề xuất qua `propose_knowledge_change`. Dùng `value` gồm `site` và `summary`, kèm URL bằng chứng công khai và ngày kiểm. Ghi chú chỉ hỗ trợ tìm ảnh. Quyết định bản quyền vẫn theo cổng của app.
- Với `off`, ưu tiên ảnh có giấy phép xác minh được trên nguồn app hỗ trợ. Với `commentary`, dùng ảnh có bản quyền chỉ khi liên quan trực tiếp đến lời bình và vẫn qua cổng của app. Không đổi chế độ bản quyền.
- Có thể chia các cảnh khác nhau cho agent con trong cùng instance. Dùng cùng lease của job, giao mỗi cảnh cho một người xử lý, và giữ heartbeat ở agent đã nhận việc.
- Khi rút kinh nghiệm, lưu bản nháp qua luồng draft đang dùng. Sau khi được duyệt, skill được đồng bộ đến đội và ưu tiên cho vai trò tương ứng.

# RESEARCH-073 REPORT

- **Status signals:** YouTube 6 có API (4 một phần), 6 chỉ thủ công. TikTok 5 (3 một phần), 7 thủ công. Facebook 4 (3 một phần), 8 thủ công. Instagram 4 (3 một phần), 8 thủ công. Mỗi nền tảng có 12 nhóm tín hiệu.
- **Deprecation feeds:** 12 bề mặt có RSS/Atom đã kiểm, dùng 11 URL feed riêng. Một API công bố header cảnh báo deprecation (`Warning` của Unsplash). Chưa xác minh API nào trong bảng cam kết header tên `Deprecation` hoặc `Sunset`.
- **Catalog gaps:** 6 đề xuất. Ba mục ưu tiên là dữ liệu đổi nghĩa nhưng API vẫn trả thành công, điều kiện cấp mới hoặc theo nhóm tài khoản, và alias đổi upstream mà request vẫn chạy.
- **Knowledge:** 111 entry theo TASK-073 §2, gồm 63 `api_contract` và 48 `account_policy`.
- **Câu hỏi mở:**
  - Connector Meta nào dùng Facebook Login, connector nào dùng Instagram Login, và grant nào đang đủ để bật kiểm tra trạng thái?
  - App sẽ cho người dùng ghi nhận kết quả kiểm thủ công hằng tuần ở đâu và lưu bằng chứng ở mức nào?
  - Khi nào coi mất video khỏi danh sách hoặc lỗi kết nối là sự cố cần người duyệt?
  - Chọn định nghĩa/cửa sổ số liệu nào để nhắc kiểm eligibility mà không báo nhầm đã đủ điều kiện?
  - Khi import dữ liệu cũ, có cần chuyển riêng `platform_limit` sang `platform_capability` không?

## Phương pháp

Kiểm tra nguồn công khai **2026-11-10–11**, múi giờ Asia/Bangkok. Nguồn kỹ thuật ưu tiên tài liệu nhà cung cấp, revision history, feed và workspace Meta trên Postman. Một số trang Meta đổi đường dẫn hoặc chỉ đọc được qua trang công khai khác, nên ghi rõ giới hạn bằng chứng. Không thử OAuth, gọi endpoint của tài khoản, chạy CLI nhà cung cấp hay đo quota bằng key. Các số trong bảng là contract công khai. Tín hiệu một phần được tính trong cột có API nhưng vẫn có bước đối chiếu thủ công. Lịch sử là các mốc đã xác minh trong ba năm, không xem `null` là cam kết không từng có breaking change.

- [Trạng thái tài khoản/video và checklist tuần](status-apis.md)
- [Changelog, feed, lỗi và timeline](api-deprecation.md)
- [Khoảng trống catalog](catalog-gaps.md)
- [Knowledge entries cho D2/D3](knowledge.json)

**Tương thích import:** [knowledge.json của RESEARCH-072](../monetization/knowledge.json) đã được tạo theo bản TASK-073 cũ, với kind `platform_limit` ở §1. Tệp đó được giữ nguyên. Bản TASK-073 hiện hành mô tả `platform_capability` tại §2. Trước khi nhập chung, Claude cần xác định phép chuyển và giá trị `api` dựa trên bằng chứng từng mục.

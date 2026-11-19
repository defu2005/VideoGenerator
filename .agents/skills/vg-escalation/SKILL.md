---
name: vg-escalation
description: >-
  Quy trình xử lý một việc chuyển giao (escalation) cụ thể từ Operator gửi lên
  Hermes: nhận việc (claim), phân tích nguyên nhân, tự khắc phục nếu thuộc thẩm
  quyền hoặc chuyển tiếp cho người dùng (forward) kèm ghi chú rõ ràng.
operator: true
area: giam-sat-operator
triggers:
  - xu ly chuyen giao
  - xử lý chuyển giao
  - vg escalation
  - xu ly escalation
  - xử lý escalation
tools:
  - escalation_list
  - escalation_claim
  - escalation_resolve
  - escalation_forward_to_user
  - repair_script
  - repair_scene
  - repair_render_stage
  - operator_enqueue
  - notify_user
risk: safe
---

# Hermes Supervisor: Xử lý việc chuyển giao (Single Escalation)

Skill này hướng dẫn Hermes xử lý từng việc chuyển giao được Operator gửi lên khi gặp sự cố mà Operator không tự giải quyết được.

## Quy trình xử lý

1. **Nhận việc (Claim):**
   - Đọc danh sách việc chuyển giao qua `escalation_list({ status: "open" })`.
   - Chọn việc cần xử lý và gọi `escalation_claim({ id: "<escalation-id>" })`.
   - Lưu ý kiểm tra thời hạn xử lý (`deadlineAt`): nếu sắp hết 30 phút, ưu tiên xử lý trước.

2. **Đánh giá thẩm quyền:**
   - **Hermes tự xử lý (Agent-solvable):**
     - `held_quality_gate`: Cổng kịch bản/ảnh/render chưa đạt. Phân tích tiêu chí bị trượt, gọi các công cụ sửa tương ứng (`repair_script`, `repair_scene`, `repair_render_stage`) hoặc giao việc cho operator qua `operator_enqueue`.
     - `repair_exhausted`: Đã sửa nhiều lần nhưng chưa đạt tiêu chuẩn. Thử đổi hướng tiếp cận (angle mới, model mạnh hơn) nếu còn hạn mức.
     - `stuck_job`: Job quá giờ. Hủy lượt chạy kẹt hoặc kích hoạt retry.
     - `publish_failure`: Kiểm tra kết nối mạng/nền tảng, xếp lại lịch nếu là lỗi tạm thời.
     - `unclear_instruction`: Đọc lại ngữ cảnh hồ sơ kênh để làm rõ prompt cho Operator.
   - **Chuyển tiếp cho người dùng (Forward to User):**
     - Chạm vào bí mật, API key, kết nối tài khoản bị mất (`reconnect_account`).
     - Chi phí, tiền bạc, vượt ngân sách.
     - Xóa vĩnh viễn (hard delete) hoặc thao tác xác nhận rủi ro cao.
     - Dự án được bảo vệ (`56374fb2-54cf-48ff-9441-2e6c653295d4`).
     - Đã chuyển qua lại 3 lần (vòng lặp 3 hops).
     - Hermes không tìm ra giải pháp tự động an toàn.

3. **Đóng việc hoặc Chuyển tiếp:**
   - Nếu đã khắc phục xong: Gọi `escalation_resolve({ id, outcome: "fixed" | "no_action" | "cannot_fix", note: "<tóm tắt cách xử lý>" })`.
   - Nếu cần người dùng quyết định: Gọi `escalation_forward_to_user({ id, note: "<lý do chuyển tiếp và tóm tắt tình trạng>" })`.

## Giới hạn an toàn

- Không bao giờ cố xử lý việc chạm vào tiền bạc, khóa bảo mật hay quyền hạn.
- Không thử sửa chữa liên tục nếu đã thất bại nhiều lần để tránh tạo vòng lặp hao phí token/chi phí.

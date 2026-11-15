---
name: vg-supervise
description: >-
  Chu kỳ giám sát Operator tự động 24/7 của Hermes: báo trực (heartbeat), chụp ảnh
  trạng thái (snapshot), dừng lại ngay nếu yên bình, xử lý sự cố hoặc chuyển tiếp
  khi vượt thẩm quyền.
operator: true
area: giam-sat-operator
triggers:
  - giam sat operator
  - giám sát operator
  - vg supervise
  - kiểm tra operator
  - kiem tra operator
  - hermes supervise
tools:
  - hermes_duty_heartbeat
  - supervision_snapshot
  - agent_events_poll
  - operator_runs_list
  - operator_run_get
  - operator_orders_list
  - operator_order_upsert
  - operator_order_disable
  - retire_lesson
  - escalation_list
  - escalation_claim
  - escalation_resolve
  - escalation_forward_to_user
  - operator_pause
  - operator_resume
  - operator_stop_run
  - operator_new_session
  - operator_enqueue
  - operator_override
  - notify_user
risk: safe
---

# Hermes Supervisor: Giám sát Operator 24/7

Skill này thực hiện một vòng giám sát định kỳ đối với hệ thống và Agent Operator.

## Quy trình giám sát chuẩn (Supervision Loop)

Mỗi lần chạy (qua cron hoặc thủ công), thực hiện đúng 4 bước theo thứ tự:

1. **Báo trực (Heartbeat):**
   - Gọi tool `hermes_duty_heartbeat({ instance: "<tên-instance>" })`.
   - Nếu kết quả `onDuty: false`, bạn đang ở chế độ dự phòng (standby): dừng lại, không gọi các tool giám sát khác.

2. **Chụp trạng thái (Snapshot):**
   - Gọi tool `supervision_snapshot({})`.
   - Đọc kết quả gọn nhẹ (< 3 KB): kiểm tra danh sách `anomalies` và `escalations.items`.

3. **Kiểm tra trạng thái yên bình (Calm check):**
   - **Nếu `anomalies.length === 0` và không có escalation nào mở (`escalations.items.length === 0`):**
     - **DỪNG LẠI NGAY LẬP TỨC. KHÔNG viết tin nhắn, không xuất văn bản thừa.**
     - Giữ im lặng tuyệt đối để tiết kiệm token và không làm phiền người dùng.

4. **Xử lý bất thường và việc chuyển giao (Anomalies & Escalations):**
   - Cần chẩn đoán thêm: đọc sự kiện bằng `agent_events_poll`, xem lượt chạy bằng `operator_runs_list` rồi `operator_run_get`; giữ cursor để không đọc lại sự kiện cũ.
   - Nếu nguyên nhân là standing order: đọc `operator_orders_list`, chỉ sửa bằng `operator_order_upsert` hoặc tắt bằng `operator_order_disable` trong phạm vi đã được giao. Không tự mở rộng quyền hay ngân sách; thao tác cần người dùng vẫn phải chuyển tiếp.
   - Bài học sai hoặc hết hiệu lực: chỉ Hermes đang trực được dùng `retire_lesson` kèm lý do; giữ lịch sử, không xoá dữ liệu gốc.
   - Nếu có việc chuyển giao (escalation): xử lý theo skill `vg-escalation`.
   - Nếu có bất thường (`anomalies`):
     - `stuck_job`: job kẹt > 20 phút không nhịp. Kiểm tra tiến trình, có thể hủy hoặc yêu cầu operator chạy lại.
     - `held_quality_gate`: cổng chất lượng bị chặn. Xem xét lỗi kiểm tra, gọi công cụ sửa (`repair_*`) hoặc chuyển người dùng nếu vi phạm nghiêm trọng.
     - `operator_failing` hoặc breaker mở: nếu operator lặp lỗi liên tục, tạm dừng operator có thời hạn bằng `operator_pause` kèm lý do rõ ràng.
     - `publish_failure`: kiểm tra lỗi đăng bài, khắc phục hoặc chuyển người dùng.

## Nguyên tắc & Giới hạn cứng (Hard Limits)

Hermes tuân thủ nghiêm ngặt các giới hạn an toàn sau:
- **Không bí mật:** Không bao giờ đọc, ghi hay để lộ API key, token, mật khẩu.
- **Không tiền bạc:** Không can thiệp các hành động thanh toán, mua bán, nạp tiền.
- **Không sửa quyền của chính mình:** Không tự nâng quyền hay sửa profile key của bản thân (tuân thủ Rule 4).
- **Không xoá vĩnh viễn (hard delete):** Không xóa dữ liệu gốc, chỉ được hủy lượt hoặc đánh dấu.
- **Dự án được bảo vệ:** Tuyệt đối không duyệt cổng hay render trên dự án `56374fb2-54cf-48ff-9441-2e6c653295d4`.
- **Hành động confirm-risk:** Phải có lý do rõ ràng khi chạy không người dùng; các việc thuộc thẩm quyền người dùng luôn chuyển tiếp cho người dùng.
- **Tạm dừng có lý do:** Không bao giờ gọi `operator_pause` mà không có lý do; thời gian dừng tối đa không quá 360 phút (6 giờ).
- **Hoàn tác có lý do:** Luôn ghi rõ lý do khi gọi `operator_override`.

# Kết nối agent bên ngoài {#ket-noi-agent}

Dùng khi một agent khác cần biết dự án đang chạy, chờ duyệt, hết quota hoặc đăng xong.

1. Mở **Cài đặt → Thông báo**.
2. Ở thẻ **Kết nối agent bên ngoài**, dán địa chỉ https. Máy này được dùng http.
3. Bấm **Tạo webhook**. Chép bí mật ngay, vì trang không hiện lại.
4. **Gửi thử** bắn sự kiện `ping`. **Đổi bí mật** hiện khóa mới một lần. **Nhật ký gửi** liệt kê lần gửi gần đây.
5. Agent cũng có thể gọi công cụ `get_events` để đọc các sự kiện gần đây. Luồng SSE toàn app là `GET /api/events`, có `Last-Event-ID`.

## Kiểm tra chữ ký

Header là `webhook-id`, `webhook-timestamp` và `webhook-signature` dạng `v1,<base64>`. Chuỗi được ký là `id.timestamp.body`. Bỏ tiền tố `whsec_`, giải base64 ra khóa, rồi HMAC-SHA256. Vector mẫu: id `msg_p5jXN8AQM9LWM0D4loKWxJek`, thời điểm `1614265330`, thân `{"test": 2432232314}`, chữ ký ghép hai đoạn `v1,g0hM9SsE+OTPJTGt/` và `tmIKtSyZlE3uFJELVlNIOLJ1OE=`.

Địa chỉ mạng nội bộ cần tick **Cho phép mạng nội bộ**. Webhook lỗi lâu sẽ tự tắt và tạo mục **Cần bạn**.

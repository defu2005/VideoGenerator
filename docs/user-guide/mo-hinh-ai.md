# Mô hình AI {#mo-hinh}

Menu: **Mô hình AI**. Hai nút đầu trang: **Định tuyến** và **Quota**. Khoá nhà cung cấp nên nằm trong OmniRoute. Video Agent chỉ nhận token bạn tự dán.

## OmniRoute {#omniroute}

Dùng làm một cổng cho nhiều model.

1. Chạy OmniRoute trên máy bạn.
2. Trong khối OmniRoute trên trang **Mô hình AI**, kiểm tra địa chỉ cổng và trạng thái.
3. Ở OmniRoute, bạn tự thêm khoá từng nhà cung cấp. Không dán khoá đó vào Video Agent.
4. Chọn provider OmniRoute trên tab **Định tuyến** nếu muốn mọi tác vụ đi qua cổng.

Mặc định ứng dụng dùng nhà cung cấp bạn đã chọn từng dòng. Cổng tắt thì các route trỏ vào đó lỗi cho đến khi bạn mở lại hoặc đổi provider. Ứng dụng không tạo tài khoản OmniRoute.

## Định tuyến {#dinh-tuyen}

Dùng để mỗi việc (viết kịch bản, trợ lý, bình luận, …) có một model.

1. Bấm **Định tuyến**.
2. Ở mỗi thẻ tác vụ, chọn nhà cung cấp và model. **Dùng mặc định** để trống lựa chọn riêng.
3. **Một model cho tất cả** hoặc **Mạnh cho viết, nhanh cho việc phụ** điền nhanh. **Dùng mặc định** trên một thẻ xoá lựa chọn đó.
4. Trong chuỗi dự phòng, đưa model lên hoặc xuống, hoặc **Xoá** một dòng.
5. Lưu trang theo nút lưu của form.

Route trống thì tác vụ không chạy được. Model **không khả dụng** vẫn hiện để bạn biết cấu hình cũ đang gãy. Đổi route không sửa video đã xong. Áp route cho cả ứng dụng. Từng dự án có thể ghi đè khi **Edit**.

## Cố vấn mô hình {#co-van}

Dùng để AI đề xuất bộ model. Cùng trang **Mô hình AI**, khối cố vấn.

1. Chọn mức ngân sách bạn muốn gợi ý theo.
2. Bấm nút đề xuất.
3. Đọc danh sách. Bấm áp dụng chỉ khi bạn đồng ý.

Đề xuất không tự ghi route. Trợ lý cũng đề xuất được và phải hỏi trước khi áp. **ECO** vẫn gọi được cố vấn, nhưng đó là một lượt gọi.

## Quota {#quota}

Dùng để khỏi vượt hạn mức miễn phí. Bấm **Quota**.

1. Xem từng model: còn lượt, sắp hết, đã hết, hoặc đang chờ.
2. **Khi hết hạn mức miễn phí**: **Chờ reset** (mặc định) hoặc **Dùng model trả phí**.
3. **Trần chi phí trả phí mỗi ngày (USD)** mặc định 1. Bấm **Lưu chính sách quota**.
4. **Thêm quy tắc** nếu một model chưa có hạn. **Sửa**, tắt, hoặc **Xoá chờ** trên từng dòng.

**Chờ reset** không gọi model trả phí. Pipeline dừng với câu `Hết quota miễn phí. Chờ đến …`. **Dùng model trả phí** chỉ chạy khi còn dưới trần, và bạn nhận thông báo. **Xoá chờ** không nạp thêm credit. Xem [Hết quota](xu-ly-su-co.md#llm-quota-wait).

## Quota OmniRoute {#quota-song}

Dùng khi bạn muốn số used/total thật, không chỉ ước tính local. Cùng tab **Quota**.

1. Nếu thấy **Cần token quản trị**, tạo token chỉ đọc trên OmniRoute.
2. Dán `<token của bạn>`, bấm **Lưu token**.
3. Bấm **Làm mới**. Thẻ **Từ OmniRoute (số thật)** hiện used, total và lúc reset.
4. Model đã định tuyến mà OmniRoute không trả quota: bấm **Thêm quy tắc** hoặc **Tạo quy tắc thủ công**.
5. **Xoá token** khi bạn không muốn ứng dụng đọc nữa.

Không có token thì trang vẫn dùng bộ đếm local. Token không hiện full. Sai quyền thì vẫn **Cần token quản trị** và câu từ chối đọc quota. Số live mới ghi đè ước tính. Số cũ hoặc mất kết nối thì quay lại bộ đếm local.

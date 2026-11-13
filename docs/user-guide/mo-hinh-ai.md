# Mô hình AI {#mo-hinh}

Menu: **Mô hình AI**. Hai nút đầu trang: **Định tuyến** và **Quota**. Khoá nhà cung cấp nên nằm trong OmniRoute. Video Agent chỉ nhận token bạn tự dán.

## OmniRoute {#omniroute}

Dùng làm một cổng cho nhiều model.

1. Chạy OmniRoute trên máy bạn.
2. Trong khối OmniRoute trên trang **Mô hình AI**, kiểm tra địa chỉ cổng và trạng thái.
3. Ở OmniRoute, bạn tự thêm khoá từng nhà cung cấp. Không dán khoá đó vào Video Agent.
4. Chọn provider OmniRoute trên tab **Định tuyến** nếu muốn mọi tác vụ đi qua cổng.

Catalog OmniRoute được đọc ngay từ bản vừa lưu (hết hạn sau 10 phút) rồi làm mới nền. Job nền chạy 30 giây sau khi mở app và cứ 15 phút một lần. Ba lần lỗi liên tiếp thì chờ 60 phút. Nút **Kiểm tra khả năng** gửi một ảnh 1×1, nhớ kết quả 7 ngày và tính vào ngân sách. Nguồn hiện cạnh tên model: từ OmniRoute, từ bảng LiteLLM, đã thử, hoặc tự đặt. Khi mọi bước trong route hết quota và hồ sơ bật đổi model (mặc định bật ở giám sát và tự chạy), lượt đó dùng model tương đương rồi giữ route cũ.

Mặc định ứng dụng dùng nhà cung cấp bạn đã chọn từng dòng. Cổng tắt thì các route trỏ vào đó lỗi cho đến khi bạn mở lại hoặc đổi provider. Ứng dụng không tạo tài khoản OmniRoute.

## Định tuyến {#dinh-tuyen}

Dùng để mỗi việc (viết kịch bản, trợ lý, bình luận, …) có một model.

1. Bấm **Định tuyến**.
2. Ở mỗi thẻ tác vụ, chọn nhà cung cấp và model. **Dùng mặc định** để trống lựa chọn riêng.
3. **Một model cho tất cả** hoặc **Mạnh cho viết, nhanh cho việc phụ** điền nhanh. **Dùng mặc định** trên một thẻ xoá lựa chọn đó.
4. Trong chuỗi dự phòng, đưa model lên hoặc xuống, hoặc **Xoá** một dòng.
5. Lưu trang theo nút lưu của form.

Route trống thì tác vụ không chạy được. Model **không khả dụng** vẫn hiện để bạn biết cấu hình cũ đang gãy. Đổi route không sửa video đã xong. Áp route cho cả ứng dụng. Từng dự án có thể ghi đè khi **Edit**.

## Model được phép nhìn ảnh {#model-nhin-anh}

Bốn việc đọc ảnh là kiểm tra ảnh, đồng nhất ảnh, kiểm tra frame sau render và chọn thumbnail. Provider có sẵn khả năng này: Anthropic, Gemini, Claude CLI, Copilot CLI. Trên OmniRoute, Grok 4 trở lên cũng được tính là model nhìn ảnh, gồm `grok-cli/grok-4.7`. Model khác phải được gán vào các việc đó.

Agent dùng tool `set_llm_models`. `task` là một việc (`script`), `default`, hoặc `vision` cho cả bốn việc đọc ảnh. `provider` và `model` là cặp trong danh sách, ví dụ OmniRoute và `grok-cli/grok-4.7`. Nếu provider chưa bật ảnh, app ghi model đó vào danh sách nhìn ảnh. Đổi xong thì chạy lại bước tìm ảnh. Lệnh đọc năng lực model cần đúng `modelId`, ví dụ `grok-cli/grok-4.7`.

## Cố vấn mô hình {#co-van}

Dùng để AI đề xuất bộ model. Cùng trang **Mô hình AI**, khối cố vấn.

1. Chọn mức ngân sách bạn muốn gợi ý theo.
2. Bấm nút đề xuất.
3. Đọc danh sách. Bấm áp dụng chỉ khi bạn đồng ý.

Đề xuất không tự ghi route. Trợ lý cũng đề xuất được và phải hỏi trước khi áp. **ECO** vẫn gọi được cố vấn, nhưng đó là một lượt gọi.

Cố vấn chỉ đề xuất đổi khi kết quả **So sánh model** gần đây cho thấy ứng viên đạt ngưỡng trên cùng tác vụ và cùng model hiện tại. App kiểm lại baseline, bằng chứng và quota khi bạn bấm áp dụng. Nếu model hiện tại đã đổi, hãy tạo đề xuất mới.

## Quota {#quota}

Dùng để khỏi vượt hạn mức miễn phí. Bấm **Quota**.

1. Xem từng model: còn lượt, sắp hết, đã hết, hoặc đang chờ.
2. **Khi hết hạn mức miễn phí**: **Chờ reset** (mặc định) hoặc **Dùng model trả phí**.
3. **Trần chi phí trả phí mỗi ngày (USD)** mặc định 1. Bấm **Lưu chính sách quota**.
4. **Thêm quy tắc** nếu một model chưa có hạn. **Sửa**, tắt, hoặc **Xoá chờ** trên từng dòng.

**Chờ reset** không gọi model trả phí. Pipeline dừng với câu `Hết quota miễn phí. Chờ đến …`. **Dùng model trả phí** chỉ chạy khi còn dưới trần, và bạn nhận thông báo. **Xoá chờ** không nạp thêm credit. Xem [Hết quota](xu-ly-su-co.md#llm-quota-wait).

## Tự chuyển nhà cung cấp {#tu-chuyen}

Khi một tác vụ gọi AI mà nhà cung cấp chính hết hạn mức, bị giới hạn tốc độ, quá tải hoặc chưa cấu hình, hệ thống tự thử lần lượt: model chính, model dự phòng, rồi các model trong danh sách **dự phòng** của tác vụ. Bạn không cần làm gì và job không bị ngắt.

1. Chỉ chuyển với lỗi hết hạn mức, giới hạn tốc độ (sau khi nhà cung cấp tự thử lại), 402, 429, 503 hoặc chưa cấu hình. Kết quả AI sai định dạng và việc bạn bấm huỷ **không** gây chuyển.
2. Model dự phòng không đọc được ảnh, hoặc không chứa vừa nội dung, sẽ bị bỏ qua, và lý do được ghi lại.
3. Chế độ ECO không bao giờ chuyển sang model trả phí trừ khi chính bạn đã liệt kê nó làm dự phòng (và vẫn theo trần chi phí ở [Quota](#quota)).
4. Nhà cung cấp vừa lỗi được cho **nghỉ**: giới hạn tốc độ nghỉ 60 giây rồi gấp đôi mỗi lần lặp lại, tối đa 15 phút; hết hạn mức nghỉ đến lúc reset nếu có, không thì 30 phút. Một lần gọi thành công xoá thời gian nghỉ. Khởi động lại máy chủ cũng xoá.
5. Nếu mọi nhà cung cấp đều không dùng được, bước báo `LLM_ALL_PROVIDERS_EXHAUSTED` kèm lý do của từng nhà cung cấp; bạn thử lại sau.

Ở tab **Định tuyến** của trang này, thẻ **Nhà cung cấp AI đang nghỉ** hiện "đang nghỉ đến HH:MM". Trợ lý và MCP có công cụ đọc `get_llm_health`. Nếu hơn 10 lần chuyển trong 10 phút, bảng giám sát báo "AI đổi nhà cung cấp liên tục": hãy kiểm tra hạn mức hoặc đổi model chính. Hệ thống **không** tự đổi cài đặt định tuyến của bạn.

## Quota OmniRoute {#quota-song}

Dùng khi bạn muốn số used/total thật, không chỉ ước tính local. Cùng tab **Quota**.

1. Nếu thấy **Cần token quản trị**, tạo token chỉ đọc trên OmniRoute.
2. Dán `<token của bạn>`, bấm **Lưu token**.
3. Bấm **Làm mới**. Thẻ **Từ OmniRoute (số thật)** hiện used, total và lúc reset.
4. Model đã định tuyến mà OmniRoute không trả quota: bấm **Thêm quy tắc** hoặc **Tạo quy tắc thủ công**.
5. **Xoá token** khi bạn không muốn ứng dụng đọc nữa.

Không có token thì trang vẫn dùng bộ đếm local. Token không hiện full. Sai quyền thì vẫn **Cần token quản trị** và câu từ chối đọc quota. Số live mới ghi đè ước tính. Số cũ hoặc mất kết nối thì quay lại bộ đếm local.

## Nhà cung cấp AI {#nha-cung-cap}

Trong tab **Năng lực và benchmark**, mục **So sánh model** chạy model hiện tại và ứng viên trên cùng bộ mẫu văn bản. Nhập theo dạng `provider/model` và xem số lượt gọi dự kiến trước khi chạy. App kiểm quota và chỉ nhận model có gói miễn phí hoặc thuê bao đã xác định. Báo cáo gồm chất lượng, lỗi schema, token, chi phí ước tính và độ trễ. Ứng viên thiếu mẫu hoặc dưới ngưỡng chất lượng sẽ có kết quả **Giữ model hiện tại**.

Menu: **Nhà cung cấp AI**, cạnh **Mô hình AI**.

Trang này ghi những gì đọc được từ trang chính thức của nhà cung cấp. Chỗ chưa có câu trích thì để **UNKNOWN**. UNKNOWN không có nghĩa là an toàn. Chip rủi ro vẫn hiện dù điểm cao.

1. Tab **Tổng quan** trả lời mười câu: ai đã có, ai gọi được, quota miễn phí, lợi ích chưa dùng, dịch vụ đám mây, cá nhân ở Việt Nam, thẻ hoặc KYC, sắp hết hạn, hữu ích cho dự án, và cái gì bật mà không phát sinh chi.
2. Tab **Đang dùng trong OmniRoute** chỉ đọc kết nối đã có. Bấm **Kiểm tra lại** để đọc lại. Nếu thiếu token chỉ đọc, làm theo câu hướng dẫn trên trang. Ứng dụng không tự tạo token.
3. Tab **Danh mục** lọc theo không cần thẻ, API miễn phí, và Việt Nam dùng được. Bấm **Điểm** để sắp xếp. Bấm tên để xem nguồn. Chip rủi ro vẫn hiện dù điểm cao.
4. Tab **Ưu đãi và lợi ích** tách ưu đãi đang có, sắp hết hạn, và đã hết hạn. Ưu đãi hết hạn được giữ, không xoá.
5. Tab **Rủi ro thanh toán** có mười câu trả lời. Bấm **Tôi đã kiểm tra trên dashboard** sau khi bạn tự xem trên web của nhà cung cấp.
6. Tab **Định tuyến** hiện phần chênh lệch. **Áp dụng** và **Cập nhật OmniRoute** chỉ chạy khi bạn bấm. Trước khi ghi combo, ứng dụng xuất bản sao lưu. Nếu bản sao lưu lỗi thì không ghi gì.
7. Tab **Thay đổi cần xem** có nút **Đã xem**.
8. Tab **Năng lực và benchmark** hiện bộ đánh giá và ước tính số lượt. Gõ tên model miễn phí rồi bấm **Chạy đánh giá**. Model trả phí sẽ hỏi bạn trước.

Ứng dụng không tự thêm thẻ, không bật nạp tiền tự động, và không chấp nhận điều khoản hộ bạn.

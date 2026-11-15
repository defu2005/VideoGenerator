# Agent nhận stage {#agent-nhan-stage}

Agent ngoài có thể nhận toàn bộ **bước tìm ảnh** bằng model, công cụ tìm kiếm và vision của chính nó. App vẫn giữ ảnh, nguồn, kết quả duyệt và tiến độ; các cổng chất lượng tiếp tục được kiểm tra trong app.

## Chọn cách xử lý {#che-do}

Trong **Hồ sơ → Brief mặc định**, hoặc phần tùy chỉnh khi tạo/sửa dự án, tìm **Ai xử lý bước tìm ảnh**:

| Lựa chọn | Cách chạy |
| --- | --- |
| App xử lý | App dùng các provider đã cấu hình như trước. |
| Giao cho agent ngoài | Bước vào hàng đợi agent ngay khi được xếp chạy. |
| App trước, agent khi chưa xong | App làm trước, rồi giao các cảnh còn mở khi hết provider/quota vision, nguồn ảnh giới hạn tốc độ sau các lần thử lại, không kiểm tra được ảnh hoặc vòng sửa ảnh chưa giải quyết xong. Đây là mặc định. |
| Theo hồ sơ / mặc định | Dự án dùng cấu hình hiện tại của hồ sơ. Hồ sơ chưa đặt thì dùng mặc định ở trên. |

**Thời gian chờ agent (phút)** mặc định là 30. Để trống để kế thừa hồ sơ. Nếu hết thời gian mà chưa ai nhận, bước báo lỗi “không có agent nào nhận”, không chờ vô hạn. Nếu agent mất heartbeat và hết lease, việc được trả về hàng đợi để nhận lại; thời gian chờ được tính lại từ đó.

Override của dự án ưu tiên hơn hồ sơ. Chọn lại **Theo hồ sơ / mặc định** và xóa thời gian chờ riêng để bỏ override. Hiện chỉ bước tìm ảnh hỗ trợ agent ngoài; các bước khác vẫn do app xử lý.

Chế độ **Giao cho agent ngoài** xếp việc cho agent kể cả khi worker nội bộ đang tắt. Agent nhận việc không cần chờ một lượt chạy của worker nội bộ.

## Kết nối và thêm scout {#them-scout}

1. Trong [Tài khoản của tôi](dang-nhap.md), người dùng tạo khóa máy với loại agent và **tên instance cố định**. Tên không được chỉ lấy từ header do agent tự khai.
2. Kết nối agent với [MCP của app](ket-noi-agent.md). Có thể dùng nhiều instance khác tên. Mỗi instance hiện nhận tối đa một stage đang có lease trong cùng workspace.
3. Agent gọi `stage_claim_next`, có thể lọc theo hồ sơ, dự án hoặc `VISUAL_SEARCH`. Không có việc phù hợp thì nhận `null`.

Phân công cố định theo vai trò chưa có trong phiên bản này. Bộ lọc nhận việc thu hẹp phạm vi được phép; nó không mở thêm quyền. Agent không tự sửa quyền, khóa, routing, tiền hoặc chế độ bản quyền.

## Tìm và duyệt ảnh {#tim-va-duyet}

Khi nhận việc, agent được xem các **cảnh còn mở**, lời đọc/chủ thể, truy vấn đã ghi nhận (kể cả lần tìm không có kết quả), ảnh đã loại và lý do, ghi chú phong cách, tỉ lệ video, giới hạn ảnh, ngân sách và chế độ bản quyền. Cảnh đã có ảnh hợp lệ hoặc do người dùng giữ được giữ nguyên.

- `stage_heartbeat`: báo tiến độ khoảng mỗi phút; lease có hiệu lực 10 phút kể từ lần gia hạn.
- `visual_submit_candidates`: gửi URL ảnh và trang nguồn, tiêu đề, lý do phù hợp, ghi chú giấy phép nếu có. App tải ảnh với giới hạn 25 MB, cạnh ngắn ít nhất 320 px, chặn địa chỉ nội bộ và ảnh trùng.
- `visual_get_candidate_image`: xem tệp app đã lưu, mặc định thu nhỏ tối đa 768 px. Agent duyệt ảnh này thay vì ảnh xem trước ở trang khác.
- `visual_record_verdict`: ghi pass/reject, chủ thể có khớp hay không, lý do và model đã dùng. Kết quả được gắn với hash của tệp và danh tính agent.
- `visual_select`: chọn ảnh đã pass. Tệp đổi hash, ảnh trùng, watermark, nguồn rủi ro hoặc cổng chất lượng chưa đạt vẫn bị từ chối.
- `stage_complete`: gửi tóm tắt khi mọi cảnh còn mở đã xong. App kiểm tra lại trước khi cho pipeline tiếp tục.

Ảnh trong màn hình duyệt hiển thị ai tìm, ai duyệt và model nào đã dùng. Đổi ảnh, cắt ảnh và các bước kiểm tra trước render vẫn dùng dữ liệu bình thường của dự án.

## Bản quyền và chi phí {#ban-quyen-va-chi-phi}

Ảnh agent tìm được mặc định có giấy phép **chưa xác minh**. Chỉ ghi chú nêu rõ giấy phép trên nguồn thuộc nhóm provider đã hỗ trợ mới được đánh dấu xác minh. URL trang nguồn luôn được lưu để đối chiếu.

- `off`: agent không chọn ảnh chưa xác minh giấy phép.
- `commentary`: ảnh được cân nhắc theo chế độ người dùng đã chọn, đồng thời vẫn phải qua cổng nguồn, chủ thể, watermark và chất lượng. Giấy phép không rõ hoặc nguồn rủi ro vẫn có thể bị từ chối.

Chỉ người dùng đổi chế độ bản quyền. Agent không được đổi chế độ để vượt một lần chọn ảnh bị từ chối.

Agent dùng model và công cụ riêng, không lấy khóa provider của app. Agent có thể báo `usage.calls` khi hoàn tất, gồm model, token và chi phí thực biết. App gắn provider theo instance. Chi phí và số lượt gọi chưa báo được ghi là **chưa rõ**; app không bịa số lượt gọi, không coi phần chưa báo là miễn phí và không phân bổ chi phí lời gọi app sang agent.

## Theo dõi và lấy lại việc {#lay-lai}

Thẻ quy trình hiển thị agent đang giữ việc, thời điểm, lý do chuyển giao và heartbeat gần nhất. **Lấy lại cho app** thu hồi lease hiện tại và xếp lại việc cho app. Khi người dùng sửa dự án, lease agent cũng bị ngắt; lệnh ghi bằng lease cũ nhận `LEASE_LOST` và agent phải dừng.

Agent không làm được có thể gọi `stage_release` với lý do `cannot_do` để trả về app; lý do khác trả về hàng đợi agent. Nhận rồi trả cùng một việc hơn ba lần tạo cảnh báo giám sát. Bước chạy quá dự kiến vẫn được theo dõi theo [quy trình quá giờ](du-an-va-quy-trinh.md#buoc-qua-du-kien), không bị dừng chỉ vì đồng hồ.

Dự án được bảo vệ không bao giờ được giao hoặc nhận qua protocol này.

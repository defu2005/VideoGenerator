# Agent nhận stage {#agent-nhan-stage}

Agent ngoài có thể nhận các bước pipeline được ủy quyền (như **tìm ảnh**, **nghiên cứu**, **kịch bản**, **tìm nhạc**) bằng model, công cụ và tri thức riêng của chính nó. App vẫn giữ kết quả, nguồn, dữ liệu duyệt và tiến độ; các cổng chất lượng tiếp tục được kiểm tra trong app.

## Chọn cách xử lý {#che-do}

Trong **Hồ sơ → Brief mặc định**, hoặc phần tùy chỉnh khi tạo/sửa dự án, có thể cấu hình người xử lý cho từng bước được hỗ trợ (**Ai xử lý bước tìm ảnh / nghiên cứu / kịch bản / tìm nhạc**):

| Lựa chọn | Cách chạy |
| --- | --- |
| App xử lý | App dùng các provider đã cấu hình như trước. Đây là mặc định cho nghiên cứu, kịch bản, tìm nhạc. |
| Giao cho agent ngoài | Bước vào hàng đợi agent ngay khi được xếp chạy. |
| App trước, agent khi chưa xong | App làm trước, rồi giao khi gặp lỗi bàn giao được cấu hình (ví dụ hết provider/quota vision, nguồn giới hạn tốc độ sau thử lại). Đây là mặc định cho bước tìm ảnh. |
| Theo hồ sơ / mặc định | Dự án dùng cấu hình hiện tại của hồ sơ. Hồ sơ chưa đặt thì dùng mặc định ở trên. |

**Thời gian chờ agent (phút)** mặc định là 30. Để trống để kế thừa hồ sơ. Nếu hết thời gian mà chưa ai nhận, bước báo lỗi “không có agent nào nhận”, không chờ vô hạn. Nếu agent mất heartbeat và hết lease, việc được trả về hàng đợi để nhận lại; thời gian chờ được tính lại từ đó.

Override của dự án ưu tiên hơn hồ sơ. Chọn lại **Theo hồ sơ / mặc định** và xóa thời gian chờ riêng để bỏ override. Bốn bước có thể giao cho agent: tìm ảnh, nghiên cứu, kịch bản và tìm nhạc. Danh sách chi tiết và cổng kiểm tra nằm trong mục bên dưới.

## Bước nào giao được, và app kiểm tra gì {#buoc-giao-duoc}

| Bước | Vai trò agent | Mặc định | Agent nộp gì | App kiểm tra trước khi nhận |
| --- | --- | --- | --- | --- |
| Tìm ảnh | `visual_scout` | App trước, agent khi chưa xong | Ứng viên ảnh, verdict, lựa chọn | Tải ảnh (giới hạn dung lượng, kích thước, địa chỉ nội bộ, trùng), kiểm chủ thể, watermark, nguồn rủi ro, chất lượng |
| Nghiên cứu | `research_scout` | App | Ghi chú nghiên cứu có nguồn | Ít nhất 6 ý chính; ít nhất 60% ý có nguồn; trích dẫn tối đa 30 từ; nguồn phải là http(s), không trỏ máy nội bộ, không thuộc miền bị chặn |
| Kịch bản | `script_writer` | App | Bản kịch bản đầy đủ | Kiểm văn phong (ghi chú `[lint]`), chấm critic bằng route LLM của app, kiểm sự thật với ghi chú nghiên cứu. Giữ khi tổng điểm dưới 60, độ chính xác dưới 3, hoặc có ý cần xác minh |
| Tìm nhạc | `music_scout` | App | Tối đa 8 bản nhạc cho mỗi việc | Giấy phép thuộc danh sách dùng thương mại của chế độ bản quyền; URL hợp lệ; app tự tải và đo thời lượng. Agent không chọn bản nhạc cuối |

Cổng của app luôn chạy, kể cả khi việc do agent làm. Không có công tắc nào để bỏ qua. Lý do: agent có thể mạnh về nghiên cứu hay viết, nhưng nếu cổng đặt ở phía agent thì một agent yếu có thể đưa kịch bản sai sự thật hoặc nhạc sai giấy phép vào video.

**Kịch bản do agent viết** được lưu với `author` là `agent:<tên instance>`, nên bạn thấy ai đã viết. Khi kịch bản bị giữ, agent nhận phản hồi chấm điểm và có thể nộp lại tối đa 2 lần trong lượt nhận việc. Nếu vẫn không đạt, việc trả về app hoặc chờ bạn, tùy cấu hình.

**Nghiên cứu do agent viết** có nguồn cho từng ý. Phần kịch bản kiểm sự thật dựa trên các nguồn này.

**Kịch bản đã do bạn sửa tay** không bị agent ghi đè. Khi đó agent nhận lỗi `SCRIPT_EDITED`.

**Nhạc:** agent chỉ đề xuất. App tải bản nhạc, đo thời lượng và đưa vào danh sách ứng viên. Bản cuối vẫn do gate MUSIC_REVIEW quyết định: tự động chọn bản xếp hạng cao nhất, hoặc chờ bạn duyệt, tùy cấu hình.

Chế độ **Giao cho agent ngoài** xếp việc cho agent kể cả khi worker nội bộ đang tắt. Agent nhận việc không cần chờ một lượt chạy của worker nội bộ.

## Kết nối và thêm scout {#them-scout}

1. Trong [Tài khoản của tôi](dang-nhap.md), người dùng tạo khóa máy với loại agent và **tên instance cố định**. Tên không được chỉ lấy từ header do agent tự khai.
2. Kết nối agent với [MCP của app](ket-noi-agent.md). Mở **Cài đặt → Đội Hermes → Phân công agent** để chọn vai trò, phạm vi và số việc đang giữ tối đa cho mỗi instance.
3. Agent gọi `stage_claim_next`, có thể lọc theo hồ sơ, dự án hoặc bước pipeline. Giao thức khớp vai trò của stage adapter với vai trò phân công của agent (loại trừ vai trò quản lý kênh `channel_manager`). Không có phân công đang bật khớp vai trò và phạm vi, hoặc đã đủ số việc, thì nhận `null`.

| Nhu cầu | Phân công |
| --- | --- |
| Hermes-1 quản lý kênh A | Chọn `hermes/Hermes-1`, vai trò `channel_manager` và hồ sơ A (không nhận stage trực tiếp). |
| Hermes-2 và Hermes-3 tìm ảnh cho mọi video | Tạo hai phân công `visual_scout` với tối đa 2 việc mỗi instance, hoặc dùng `*` để áp dụng cho nhóm khóa máy trong workspace. |
| Hermes-4 chỉ tìm ảnh video X | Chọn `hermes/Hermes-4`, vai trò `visual_scout`, video X và bước Tìm ảnh. |

Phân công cụ thể hơn có ưu tiên. Phạm vi video và bước đứng trước phạm vi hồ sơ và bước, rồi đến bước chung và nhóm. Giới hạn thấp của việc đã nhận vẫn áp dụng khi agent nhận thêm việc. Vai trò quản lý kênh dùng lease hồ sơ/dự án cho thao tác điều phối. Scout dùng lease của job để làm cảnh trong cùng kênh. Quyền của khóa máy vẫn áp dụng cho cả hai.

Chỉ người dùng có quyền quản lý cài đặt sửa phân công. Agent có thể gửi đề nghị qua luồng chuyển việc cho người dùng. Skill theo vai trò được ưu tiên trong gói đồng bộ. Mọi instance vẫn đọc được toàn bộ skill, kể cả skill đã cập nhật qua quy trình duyệt bản nháp.

Thẻ **Việc đang giao cho agent** hiển thị hàng đợi theo vai trò, số job đang giữ theo instance và trung vị giây mỗi cảnh từ các job có mẫu. Khi việc tìm ảnh chờ quá nửa số phút đã cấu hình, Fleet gợi ý thêm `visual_scout`. Mỗi scout cần khóa máy, tên và thư mục dữ liệu riêng.

## Tìm và duyệt ảnh {#tim-va-duyet}

Khi nhận việc, agent được xem các **cảnh còn mở**, lời đọc/chủ thể, truy vấn đã ghi nhận (kể cả lần tìm không có kết quả), ảnh đã loại và lý do, ghi chú phong cách, tỉ lệ video, giới hạn ảnh, ngân sách và chế độ bản quyền. Cảnh đã có ảnh hợp lệ hoặc do người dùng giữ được giữ nguyên.

- `stage_heartbeat`: báo tiến độ khoảng mỗi phút; lease có hiệu lực 10 phút kể từ lần gia hạn.
- `visual_cache_query`: tra kết quả tìm gần đây theo truy vấn và nguồn. Cache trong workspace giữ kết quả 7 ngày và bỏ URL chứa thông tin xác thực hoặc chữ ký.
- `visual_cache_lookup`: tra verdict theo `subjectKey` từ context và phash, candidate ID hoặc URL ảnh. Verdict giữ 90 ngày và giúp scout tham khảo. App chỉ dùng lại đánh giá phù hợp cảnh khi nội dung tệp, lời dẫn, mô tả hình, tỉ lệ khung và quy tắc kiểm tra đều khớp. Đổi ngữ cảnh sẽ kiểm ảnh lại; ảnh do bạn giữ vẫn được giữ. Scout vẫn xem tệp đã lưu và ghi quyết định trước khi chọn.
- `visual_submit_candidates`: gửi URL ảnh và trang nguồn, tiêu đề, lý do phù hợp, ghi chú giấy phép nếu có. App tải ảnh với giới hạn 25 MB, cạnh ngắn ít nhất 320 px, chặn địa chỉ nội bộ và ảnh trùng.
- `visual_get_candidate_image`: xem tệp app đã lưu, mặc định thu nhỏ tối đa 768 px. Agent duyệt ảnh này thay vì ảnh xem trước ở trang khác.
- `visual_record_verdict`: ghi pass/reject, chủ thể có khớp hay không, lý do và model đã dùng. Kết quả được gắn với hash của tệp và danh tính agent.
- `visual_select`: chọn ảnh đã pass. Tệp đổi hash, ảnh trùng, watermark, nguồn rủi ro hoặc cổng chất lượng chưa đạt vẫn bị từ chối.
- `stage_complete`: gửi tóm tắt khi mọi cảnh còn mở đã xong. App kiểm tra lại trước khi cho pipeline tiếp tục.

Ảnh trong màn hình duyệt hiển thị ai tìm, ai duyệt và model nào đã dùng. Đổi ảnh, cắt ảnh và các bước kiểm tra trước render vẫn dùng dữ liệu bình thường của dự án.

`sourceNotes` trong context lấy từ kho tri thức của workspace. Agent có thể đọc `list_knowledge` với `kind: source_note` hoặc gửi `propose_knowledge_change` kèm bằng chứng công khai. Ghi chú về website giúp chọn nơi tìm ảnh. Giấy phép của từng ảnh vẫn được kiểm riêng.

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

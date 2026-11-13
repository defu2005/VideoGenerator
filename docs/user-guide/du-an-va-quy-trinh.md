# Dự án và quy trình {#du-an}

Một dự án là một video. Pipeline đi từ nghiên cứu tới render. Sửa bước trước thì bước sau bị đánh dấu cũ.

## Thư viện dự án {#thu-vien-du-an}

Dùng để tìm và tạo video. Menu: **Dự án**.

1. Bấm **＋ New project**. Điền chủ đề. **Cancel** đóng hộp.
2. Ô tìm lọc theo tên. **Previous** / **Next** đổi trang.
3. Trên thẻ: **Edit**, **Duplicate**, **Delete**.
4. **Nhập video dài** đưa file đã có vào thư viện để cắt Shorts. Xem [Nhập video dài](#nhap-video-dai).

Dự án mới ở trạng thái Draft. **Delete** xoá dữ liệu dự án sau khi bạn xác nhận. Trợ lý xoá dự án thì luôn hỏi riêng. Không xoá được khi job đang chạy.

## Nhập video dài {#nhap-video-dai}

Dùng khi video đã dựng ở chỗ khác và bạn chỉ muốn cắt đoạn ngắn.

1. Trên **Dự án**, bấm **Nhập video dài**.
2. Chọn file và hồ sơ.
3. **Đóng** khi xong.

File nhập không chạy lại kịch bản. Mở tab **Render** để **Tạo đề xuất** Shorts. Xem [Shorts](tu-dong-hoa.md#shorts).

## Tổng quan {#tong-quan}

Dùng để thấy brief và chạy pipeline. Trong dự án, tab **Overview**.

Khối **Thời gian tối đa mỗi bước** hiện phút cho từng bước. Chip nguồn là **AI**, **Ước lượng** hoặc **Trộn**. Ô số lưu lựa chọn của bạn. **Tính lại** xin một kế hoạch mới. Dự án chưa chạy thì hiện câu *Sẽ tính khi dự án chạy.* Lần chạy lại sau khi quá giờ được thêm một nửa thời gian, và bước vẫn đang tiến thì được gia hạn thêm một lần.

1. Đọc brief và cảnh báo nếu có.
2. Trong **Production stages**, bấm **Generate All** (hoặc **Regenerate All** nếu đã xong).
3. Khi dòng chữ **Approve the review gate to continue** hiện, bấm **Approve** trên cổng đang chờ.
4. **Cancel** dừng job đang chạy.

Sau mỗi lần lưu hoặc bấm một thao tác, một dòng thông báo ngắn hiện ở góc màn hình. Lỗi của pipeline vẫn nằm ngay trên danh sách bước.

Dòng dưới tiêu đề cho biết stage, mode (**MANUAL**, **ASSISTED** hoặc **AUTO**) và ước tính số lượt gọi AI. **ASSISTED** dừng ở cổng. **MANUAL** cần **Run** từng giai đoạn. **AUTO** đi tiếp. Xem [Chế độ chạy](#che-do-chay).

**Generate All** không đăng bài. Clip cắt từ video dài chỉ còn tab **Overview** và **Render**.

### Tự sửa chất lượng {#tu-sua-chat-luong-du-an}

Khối **Tự sửa chất lượng** chỉ hiện khi agent đã sửa video này hoặc đã gác nó. Bảng liệt kê lỗi, cách sửa, ai chọn (Agent hoặc thang mặc định), kết quả và chi phí; không sửa được từ bảng. Video ở trạng thái **Shelved** có nút **Mở lại**, nút này đưa video về trạng thái trước và tính lại số lượt sửa từ đầu. Xem [Tự vận hành](tu-van-hanh.md#tu-sua-chat-luong).

### Bước chạy quá dự kiến {#buoc-qua-du-kien}

Mỗi bước có mức thời gian **dự kiến**, lấy theo thứ tự: số bạn đặt, lịch sử các lần chạy trước (tin cậy cao thì không tốn lượt gọi mô hình), một lần agent ước lượng cho cả kế hoạch, rồi ước lượng thô. Nhãn cạnh số cho biết nguồn: *từ lịch sử*, *agent ước lượng*, *ước lượng thô*, *bạn đặt*.

Quá mức dự kiến, bước **không bị dừng**. Thẻ bước hiện **Quá dự kiến**, lần kiểm tra gần nhất và lịch sử kiểm tra (cách nhau 2, 5, 10, 20, 30 phút). Bạn chọn **Chờ thêm**, **Dừng và thử lại** hoặc **Dừng hẳn**. Cài đặt **Khi quá thời gian** có ba giá trị: `Kiểm tra` (mặc định), `Dừng ngay`, `Chỉ báo`.

## Chế độ chạy {#che-do-chay}

Dùng để chọn ai bấm tiếp. Đặt trong brief lúc tạo hoặc **Edit** dự án.

1. **MANUAL**: bạn bấm **Run** hoặc **Run again** trên từng stage. Cổng vẫn cần **Approve**.
2. **ASSISTED** (mặc định): **Generate All** chạy và dừng ở **Visual review**, **Music review**, **Final approval**.
3. **AUTO**: không dừng cổng. Đọc cảnh báo ở [Báo cáo AUTO](#bao-cao-auto).

Đổi mode không hoàn tác video đã render. **Tạm dừng tất cả** trên Dashboard chỉ dừng lịch hồ sơ, không huỷ job dự án đang chạy. Job đó dùng **Cancel**.

Khi ảnh đang chờ ở **Visual review**, giọng, phụ đề và nhạc vẫn chạy. Timeline chỉ bắt đầu khi cả ảnh lẫn nhạc đã xong. **Cancel** hủy cả dự án. **Hủy làn** trên một dòng chỉ dừng làn đó.

## Kịch bản {#kich-ban}

Dùng để có lời thoại. Tab **Script**.

Mục **Mẫu video** trên brief chọn kiểu kể: giải thích, danh sách, kể chuyện, tin, tin đồn và sự thật, hướng dẫn, video ngắn. **Tự chọn** để app quyết theo thời lượng và chủ đề. Khi kịch bản đã lưu, trang kịch bản hiện **Bản đề xuất** với dàn ý từng phần và số giây. Trang tổng quan hiện tên mẫu và lý do chọn. Chat góp ý có nút **Hoàn tác** cho lần sửa timeline gần nhất. Nếu file giọng của cảnh đó không còn, cảnh được đánh dấu cần đọc lại.

1. Bấm nút chạy nghiên cứu / kịch bản (**Generate research**, rồi nút viết script), hoặc tự dán lời.
2. **Copy** chép prompt nếu bạn viết bằng công cụ khác rồi dán lại.

Form sửa tay dùng nhãn tiếng Việt: tiêu đề, mở đầu, các phần, lời thoại và câu tìm hình. Không có kịch bản thì không có cảnh. Sửa lời thoại làm các bước sau thành cũ. Chế độ **QUALITY** có thể thêm vòng AI đọc lại kịch bản. Bạn vẫn sửa tay được.

## Cảnh {#canh}

Dùng để xem storyboard. Tab **Scenes**.

1. Đợi stage cảnh xong, hoặc bấm **Run** nếu đang **MANUAL**.
2. Đọc thời lượng, lời và câu tìm ảnh từng cảnh.
3. Sửa câu tìm nếu ảnh ra lệch chủ đề, rồi chạy lại tìm ảnh. **Delete scene** hỏi lại trước khi xóa cảnh.

Tổng thời lượng nên gần thời lượng brief. Ứng dụng chia câu bằng mã, không cần bạn cắt tay từng giây.

## Timeline {#timeline}

Trên timeline có **kế hoạch dựng**: chọn kiểu chuyển cảnh và chuyển động từng cảnh, bấm từng từ trong lời thoại để thêm hoặc bỏ nhấn mạnh, chọn kiểu phụ đề (Sạch, Karaoke, Pop, Hộp) và xem thử kiểu đó ngay trên trang. **Tạo kế hoạch dựng bằng AI** chỉ chạy khi chế độ ngân sách bật mục này (tắt ở ECO). **Xem nhanh 10 giây** cho biết đoạn ngắn quanh cảnh đầu để kiểm tra hiệu ứng, kèm tên đồ họa nằm trong đoạn đó. Khung xem trước đồ họa có nút **Phát** và thanh tua. Thời lượng chuyển cảnh nằm trong khoảng 0,25–0,8 giây; kiểu Cắt không có thời lượng. Phong cách dựng (Điềm tĩnh, Nhanh, Tin tức, Kể chuyện) đặt ở hồ sơ, trong **Phong cách dựng**, cùng kiểu phụ đề, cỡ chữ, màu nhấn và khoảng nhấn mạnh. Dự án có thể ghi đè các mục đó khi sửa dự án. Ô **Bật đồ họa động** cũng nằm ở đó. Khi bật, timeline hiện các mẫu đồ họa đúng chỗ trên thanh thời gian, form sửa từng mẫu và khung xem trước của mẫu đang chọn. Tên kênh trên thẻ kết ghi ở hồ sơ. Cài Chrome cho HyperFrames ở **Cài đặt → Render → Cài trình render đồ họa**. **Render thử** trên trang đó đo một thẻ tiêu đề ngắn. Chat góp ý có **Hoàn tác** nếu lần sửa vừa rồi không đúng.

Dùng để ghép hình, giọng, nhạc và phụ đề trước khi xuất file. Tab **Timeline**.

1. Hoàn tất ảnh, giọng, phụ đề và nhạc.
2. Mở **Timeline** để xem thứ tự.
3. Dùng chat duyệt nếu muốn AI đề xuất sửa. Xem [Chat duyệt](#chat-duyet).
4. Cổng cuối: **Approve All**.

Chưa có timeline thì tab **Render** báo cần hoàn tất Timeline trước. **Approve All** cho phép render, chưa xuất file. Xuất file là nút **Render**.

## Chat duyệt {#chat-duyet}

Dùng để nhờ AI góp ý bản dựng, vẫn do bạn chốt. Nằm trên tab **Timeline**.

1. Gõ điều muốn đổi.
2. Đọc đề xuất. Chấp nhận mục bạn muốn, bỏ mục không muốn.
3. Chế độ **MAX** có thể gửi kèm ảnh để AI nhìn.

Chat không tự **Approve All** và không tự **Render**. Đề xuất sai thì bỏ, timeline cũ giữ nguyên cho đến khi bạn áp.

## Định hướng nội dung {#dinh-huong-noi-dung}

Dùng để nhắc AI các quy tắc kênh (kể chuyện, tin, v.v.). Menu: **Định hướng nội dung**. Trên dự án, phần guideline trong **Edit**.

1. Bật bộ có sẵn hoặc viết quy tắc riêng.
2. Lưu.
3. Khi chạy kịch bản, ảnh, nhạc, phụ đề hoặc metadata, AI nhận các nhắc này.

Đây là nhắc, không phải kiểm duyệt bắt buộc. Tắt **Kiểm tra định hướng nội dung bằng AI** trong **CUSTOM** thì bớt một lượt gọi. Bộ quy tắc không chặn render.

Trang này có mục **Tính nguyên bản theo hồ sơ**. Cách đọc bản kê và lúc nào video cần bạn duyệt trước khi đăng công khai: [Nguồn và tính nguyên bản](dang-bai.md#nguon-va-tinh-nguyen-ban).

## Báo cáo AUTO {#bao-cao-auto}

Dùng để xem chỗ AUTO tự quyết mà bạn nên đọc lại. Huy hiệu **AUTO: … cảnh báo** trên đầu dự án, hoặc tab **Render**.

1. Bấm huy hiệu. Nó mở tab **Render**.
2. Đọc từng cảnh báo.
3. Sửa cảnh, ảnh hoặc nhạc rồi chạy lại phần đó nếu cần.

Báo cáo không tự sửa video. Không có cảnh báo thì không hiện huy hiệu. **ASSISTED** ít khi có báo cáo này vì bạn đã bấm **Approve**.

<a id="ngu-canh-da-dung"></a>
## Ngữ cảnh đã dùng

Ở Research, Script và Metadata, mở **Ngữ cảnh đã dùng (N)** để đọc các đoạn mà AI đã tham khảo. **Bỏ đoạn này** loại đoạn riêng cho dự án; **Dùng lại** khôi phục. Sau thay đổi, app nhắc **Chạy lại bước này để áp dụng.** App không tự chạy lại. Nguồn đánh số giúp đối chiếu với câu trả lời của AI; nội dung tra cứu luôn được coi là dữ liệu tham khảo.

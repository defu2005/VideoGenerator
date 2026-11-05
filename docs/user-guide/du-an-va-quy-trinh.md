# Dự án và quy trình {#du-an}

Một dự án là một video. Pipeline đi từ nghiên cứu tới render. Sửa bước trước thì bước sau bị đánh dấu cũ.

## Thư viện dự án {#thu-vien-du-an}

Dùng để tìm và tạo video. Menu: **Projects**.

1. Bấm **＋ New project**. Điền chủ đề. **Cancel** đóng hộp.
2. Ô tìm lọc theo tên. **Previous** / **Next** đổi trang.
3. Trên thẻ: **Edit**, **Duplicate**, **Delete**.
4. **Nhập video dài** đưa file đã có vào thư viện để cắt Shorts. Xem [Nhập video dài](#nhap-video-dai).

Dự án mới ở trạng thái Draft. **Delete** xoá dữ liệu dự án sau khi bạn xác nhận. Trợ lý xoá dự án thì luôn hỏi riêng. Không xoá được khi job đang chạy.

## Nhập video dài {#nhap-video-dai}

Dùng khi video đã dựng ở chỗ khác và bạn chỉ muốn cắt đoạn ngắn.

1. Trên **Projects**, bấm **Nhập video dài**.
2. Chọn file và hồ sơ.
3. **Đóng** khi xong.

File nhập không chạy lại kịch bản. Mở tab **Render** để **Tạo đề xuất** Shorts. Xem [Shorts](tu-dong-hoa.md#shorts).

## Tổng quan {#tong-quan}

Dùng để thấy brief và chạy pipeline. Trong dự án, tab **Overview**.

1. Đọc brief và cảnh báo nếu có.
2. Trong **Production stages**, bấm **Generate All** (hoặc **Regenerate All** nếu đã xong).
3. Khi dòng chữ **Approve the review gate to continue** hiện, bấm **Approve** trên cổng đang chờ.
4. **Cancel** dừng job đang chạy.

Dòng dưới tiêu đề cho biết stage, mode (**MANUAL**, **ASSISTED** hoặc **AUTO**) và ước tính số lượt gọi AI. **ASSISTED** dừng ở cổng. **MANUAL** cần **Run** từng giai đoạn. **AUTO** đi tiếp. Xem [Chế độ chạy](#che-do-chay).

**Generate All** không đăng bài. Clip cắt từ video dài chỉ còn tab **Overview** và **Render**.

## Chế độ chạy {#che-do-chay}

Dùng để chọn ai bấm tiếp. Đặt trong brief lúc tạo hoặc **Edit** dự án.

1. **MANUAL**: bạn bấm **Run** hoặc **Run again** trên từng stage. Cổng vẫn cần **Approve**.
2. **ASSISTED** (mặc định): **Generate All** chạy và dừng ở **Visual review**, **Music review**, **Final approval**.
3. **AUTO**: không dừng cổng. Đọc cảnh báo ở [Báo cáo AUTO](#bao-cao-auto).

Đổi mode không hoàn tác video đã render. **Tạm dừng tất cả** trên Dashboard chỉ dừng lịch hồ sơ, không huỷ job dự án đang chạy. Job đó dùng **Cancel**.

## Kịch bản {#kich-ban}

Dùng để có lời thoại. Tab **Script**.

1. Bấm nút chạy nghiên cứu / kịch bản (**Generate research**, rồi nút viết script), hoặc tự dán lời.
2. **Copy** chép prompt nếu bạn viết bằng công cụ khác rồi dán lại.

Không có kịch bản thì không có cảnh. Sửa lời thoại làm các bước sau thành cũ. Chế độ **QUALITY** có thể thêm vòng AI đọc lại kịch bản. Bạn vẫn sửa tay được.

## Cảnh {#canh}

Dùng để xem storyboard. Tab **Scenes**.

1. Đợi stage cảnh xong, hoặc bấm **Run** nếu đang **MANUAL**.
2. Đọc thời lượng, lời và câu tìm ảnh từng cảnh.
3. Sửa câu tìm nếu ảnh ra lệch chủ đề, rồi chạy lại tìm ảnh.

Tổng thời lượng nên gần thời lượng brief. Ứng dụng chia câu bằng mã, không cần bạn cắt tay từng giây.

## Timeline {#timeline}

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

## Báo cáo AUTO {#bao-cao-auto}

Dùng để xem chỗ AUTO tự quyết mà bạn nên đọc lại. Huy hiệu **AUTO: … cảnh báo** trên đầu dự án, hoặc tab **Render**.

1. Bấm huy hiệu. Nó mở tab **Render**.
2. Đọc từng cảnh báo.
3. Sửa cảnh, ảnh hoặc nhạc rồi chạy lại phần đó nếu cần.

Báo cáo không tự sửa video. Không có cảnh báo thì không hiện huy hiệu. **ASSISTED** ít khi có báo cáo này vì bạn đã bấm **Approve**.

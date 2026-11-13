# Hình ảnh và giọng đọc {#hinh-anh}

Ảnh, giọng, phụ đề và nhạc là các tab của dự án. Nguồn và giọng mặc định nằm trong menu **Cài đặt**.

## Nguồn ảnh {#nguon-anh}

Dùng để chọn kho ảnh. Menu: **Nguồn ảnh**.

1. Bật hoặc tắt từng nguồn, chỉnh thứ tự ưu tiên.
2. Bấm **Lưu**.

Nguồn tắt thì pipeline bỏ qua. Kho cần khoá thì để trống cho đến khi bạn dán khoá của mình. Giấy phép hiện cạnh ảnh để bạn đọc, không chặn việc chọn.

## Nguồn ảnh web {#nguon-anh-web}

Dùng khi kho chính không đủ. Menu: **Nguồn ảnh web**.

1. Bật Brave, Gemini grounding hoặc đường crawl bạn cho phép.
2. Dán khoá nếu nguồn đó yêu cầu (`<token của bạn>`).
3. Bấm **Lưu**.

Số scene được tìm trên web phụ thuộc **Chế độ AI**. **ECO** tìm ít hoặc không tìm web. Nguồn lỗi một mạch thì ứng dụng ngắt tạm nguồn đó để các video sau không kẹt. Bạn vẫn chọn ảnh tay trên tab **Visuals**.

## Ảnh trong dự án {#anh}

Dùng để chốt ảnh từng cảnh. Tab **Visuals**.

1. Xem ứng viên. Chọn ảnh đúng nội dung.
2. Bấm **Approve** ở cổng visual khi cả dự án ổn.
3. Ảnh lệch: sửa câu tìm ở tab **Scenes** rồi chạy lại.

Không **Approve** thì **ASSISTED** và **MANUAL** không sang giọng. **AUTO** cũng dừng ở cổng này khi cảnh chưa có ảnh đúng chủ đề, rồi hỏi bạn. Ảnh người thật hoặc bản quyền là việc bạn tự xét.

Ảnh bị chặn có một trong các lý do: **ảnh lệch chủ đề** (không khớp tên tác phẩm, nhân vật hoặc chỉ khớp từ chung), **AI nhìn loại ảnh**, **chưa có kết quả AI nhìn** (chế độ MAX), **ảnh nguồn không dùng được** (nhỏ hơn 64 px hoặc nhẹ hơn 2 KB), **không có ảnh đúng**, hoặc **nguồn rủi ro cao** (Reddit, fan-art, trang tổng hợp, giấy phép web không rõ). Bạn sửa bằng cách tải ảnh lên, dán URL, chọn ảnh khác, tìm lại, hoặc đánh dấu cảnh **không cần ảnh**. Ảnh bạn tự chọn vẫn được dùng. Ảnh do agent chọn có thể được thay khi tìm được ảnh đúng hơn và qua AI nhìn.

Cảnh lệch chủ đề có nút **Tìm lại ảnh cho cảnh lệch chủ đề**. Nếu tìm web đang tắt, app ghi một mục **Cần bạn** cho dự án đó. Ảnh có bản quyền mặc định tắt. Chỉ bạn đổi được sang chế độ bình luận, và ảnh đó hiện tối đa 4 giây.

Nút **Cắt ảnh** chỉ chạy khi bạn bấm. Ảnh khác tỉ lệ video được cắt thành khung lớn nhất đúng tỉ lệ. Ảnh đã đúng tỉ lệ được cắt còn 9/10 mỗi chiều. File gốc được giữ. Render dùng ảnh đã cắt khi có file cắt cho đúng ảnh đang chọn.

App không gán cùng một ảnh cho hai cảnh. Cảnh không còn ảnh riêng thì dùng thẻ tiêu đề, ghi **Thẻ tiêu đề** trong báo cáo. Ảnh từ kho có watermark bị loại khỏi lựa chọn tự động. Trong hồ sơ, **Chất lượng ảnh** có **Tiết kiệm** và **Tốt nhất**. Tốt nhất tìm rộng hơn và tốn thêm lượt. Hồ sơ mới mặc định Tốt nhất. Nút **Dùng chế độ Tốt nhất cho mọi hồ sơ** đổi các hồ sơ hiện có. Tốt nhất không bật ảnh có bản quyền.

## Kiểm tra ảnh bằng AI nhìn {#kiem-tra-anh}

Dùng để AI chấm ảnh có đúng cảnh không, và nhìn vài frame sau render. Chỉ đáng kể ở **MAX** hoặc **CUSTOM** khi bạn bật.

1. Đặt **Chế độ AI / Budget mode** là **MAX**, hoặc **CUSTOM** rồi bật **Kiểm tra ảnh bằng AI nhìn** và **Kiểm tra frame sau render bằng AI nhìn**.
2. Chạy tìm ảnh như bình thường. Ảnh dưới ngưỡng được tìm lại theo **Số vòng tìm lại**.
3. Sau render, đọc cảnh báo **Lỗi AI nhìn sau render** hoặc **Frame không khớp** nếu có.

**ECO**, **BALANCED**, **QUALITY** không bật nhìn ảnh. AI nhìn tốn thêm lượt gọi. Nó không thay nút **Approve** khi bạn đang ở **ASSISTED**.

## Giọng đọc {#giong-doc}

Dùng để chọn giọng cho mọi dự án. Menu: **Giọng đọc (TTS)**.

1. Chọn nhà cung cấp. Mặc định thường là Edge nếu máy có edge-tts.
2. Chọn giọng tiếng Việt và tiếng Anh, tốc độ (mặc định `+0%`).
3. Nghe mẫu nếu có.
4. Bấm **Lưu giọng đọc**.
5. Nhà cần khoá: dán `<token của bạn>` vào đúng ô của nhà đó.

Edge không cần khoá. Google, Gemini, ElevenLabs, OpenAI, FPT, Viettel cần khoá của bạn. Piper và VieNeu chạy local nếu bạn đã cài. Đổi giọng mặc định không tạo lại file cũ. Vào từng dự án bấm **Tạo lại**. Xem [Không tạo được giọng đọc](xu-ly-su-co.md#loi-giong).

## Giọng trong dự án {#giong-trong-du-an}

Dùng để tạo file nói cho từng cảnh. Tab **Voice**.

1. Cảnh phải có lời thoại. Nếu không, trang nói **Chưa có lời thoại**.
2. Bấm **Tạo giọng đọc**.
3. Một cảnh sai: **Tạo lại**.

Nút tắt khi pipeline đang bận hoặc chưa tới stage giọng. Tốc độ trên đầu tab là giọng đang dùng. Bạn có thể tải file âm thanh của mình lên (MP3, WAV, M4A, OGG, tối đa 25 MB).

## Phụ đề {#phu-de}

Dùng để cháy chữ theo lời. Tab **Subtitles**.

1. Bật phụ đề trong brief nếu đang tắt. Mặc định bật, khoảng 42 ký tự mỗi dòng.
2. Mở tab **Subtitles** và để stage phụ đề chạy.
3. Sửa dòng nếu từ bị cắt.

Phụ đề lấy thời điểm từ giọng khi nhà TTS trả về từng từ. Không có giọng thì chưa có mốc thời gian. **Chỉ phụ đề** ở bản dịch không tạo giọng mới. Xem [Bản dịch](tu-dong-hoa.md#ban-dich).

## Nhạc {#nhac}

Dùng để chọn nhạc nền. Tab **Music**.

1. Để stage tìm nhạc chạy.
2. Nghe và chọn một bản.
3. Bấm **Approve** ở cổng nhạc.

Brief mặc định bật nhạc, âm lượng thấp (khoảng 0,2). Tắt **music** trong brief thì stage nhạc bỏ qua. Bạn chịu trách nhiệm giấy phép bản nhạc mình chọn.

## Gợi ý nhạc {#goi-y-nhac}

Dùng để AI gợi ý không khí nhạc cho đúng lời. Bật ở **BALANCED**, **QUALITY**, **MAX**, hoặc **CUSTOM**.

1. Giữ **Music assist** bật (mặc định của **BALANCED** trở lên).
2. Chạy tab **Music**.
3. Vẫn tự chọn bản và **Approve** nếu không ở **AUTO**.

**ECO** không gọi AI cho nhạc. Gợi ý không tự tải bài có bản quyền ngoài kho đã cấu hình.

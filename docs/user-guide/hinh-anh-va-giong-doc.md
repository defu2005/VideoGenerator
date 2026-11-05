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

Không **Approve** thì **ASSISTED** và **MANUAL** không sang giọng. **AUTO** tự qua cổng và ghi vào báo cáo nếu có cảnh báo. Ảnh người thật hoặc bản quyền là việc bạn tự xét.

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

# Sơ đồ và dòng thời gian {#so-do-va-dong-thoi-gian}

Hai kiểu cảnh này giúp người xem theo dõi một quy trình hoặc một chuỗi sự kiện trong video dùng kiểu dựng **Compose**.

## Khi nào xuất hiện {#khi-nao}

- **Sơ đồ:** thể loại **Giải thích** hoặc **Hướng dẫn**, có lời dẫn mô tả các bước, thành phần hay quan hệ nguyên nhân. BALANCED và QUALITY/MAX có thể dùng AI để trích các nút và mũi tên; tối đa 7 nút. Những cảnh khác vẫn giữ kế hoạch dựng đã có.
- **Dòng thời gian:** thể loại **Lịch sử** hoặc **Tổng hợp tin**, có ít nhất 3 sự kiện gắn với năm hoặc ngày tháng. App nhận diện mốc bằng code; QUALITY/MAX có thể tinh chỉnh phần trích bằng AI. Mỗi cảnh có tối đa 8 mốc.
- **ECO:** không gọi AI để làm sơ đồ. Chế độ đồ họa **Tắt** giữ hình minh họa như các cảnh khác. BALANCED dựng đồ họa tĩnh; QUALITY/MAX có thể dựng chuyển động theo cấu hình của bạn.

Mỗi nhãn phải lấy từ lời dẫn. App không tự thêm sự kiện, con số hoặc ảnh từ URL AI đưa ra. Nếu sơ đồ hay mốc thời gian không hợp lệ, app thử dùng danh sách từ lời đọc; nếu đoạn quá ngắn hoặc quá dài để đọc được danh sách thì dùng ảnh/footage.

Cảnh đồ họa vẫn chịu giới hạn thời lượng và độ đa dạng của cả video. Vì vậy có đủ ba mốc không có nghĩa cảnh đó luôn thành dòng thời gian: phần mở đầu, thời gian đọc và các cảnh quay khác vẫn được ưu tiên khi cần.

## Xem và giữ một cảnh {#xem-va-giu}

Mở dự án → tab **Render** → phần **Cảnh quay**. Hai kiểu mới có tên **Sơ đồ** và **Dòng thời gian**, kèm khoảng thời gian trong cảnh.

Bấm **Khoá** để giữ cảnh khi tạo lại kế hoạch. Bấm **Bỏ khoá** để cho phép app lập lại. App không có nút đổi một cảnh bất kỳ thành sơ đồ hoặc dòng thời gian vì cần dữ liệu nút/sự kiện được trích từ lời dẫn trước.

## Thời điểm hiện và cách đọc {#thoi-diem}

Mỗi nút hay mốc xuất hiện theo từ tương ứng trong giọng đọc. Nếu không có đủ timing từ, mẫu dùng nhịp xuất hiện ước tính; nó không coi thời điểm AI gửi là timing thật.

Sơ đồ có bố cục theo luồng, vòng hoặc trung tâm. Dòng thời gian dùng khoảng cách theo ngày/năm khi các mốc đủ rõ và không quá sát nhau; trường hợp mốc trùng, quá sát hoặc không có ngày chính xác thì giãn đều theo thứ tự kể. Khung dọc chuyển trục thời gian sang dọc và chừa vùng phụ đề/nút của nền tảng.

Ảnh tùy chọn của một mốc phải là tệp ảnh sẵn có trong phạm vi dự án; mẫu không tải ảnh ngoài mạng. Màu sắc, chữ và chuyển động dùng bộ phong cách của kênh.

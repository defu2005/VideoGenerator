# Máy worker (thử nghiệm) {#may-worker}

Máy worker là một máy khác nhận việc **dựng video** thay cho máy chính, và (nếu bạn bật) cả việc **tạo giọng đọc** và **tải clip stock**. Tính năng này đang thử nghiệm và **mặc định tắt**: khi tắt, mọi việc vẫn chạy trên máy chính như trước.

Mở trang **Máy worker** ở thanh bên (hoặc nhấn Ctrl+K rồi gõ "Máy worker"). Chỉ chủ sở hữu và quản trị mới thấy và dùng được trang này. Ở **Cài đặt → Render** chỉ còn một thẻ nhỏ cho biết có bao nhiêu máy đang chạy, kèm đường dẫn sang trang này.

Trang tự làm mới mỗi 15 giây và tạm dừng khi bạn chuyển sang tab khác. Mỗi dòng cho biết trạng thái, số việc đang chạy, CPU, RAM, ổ đĩa trống và lần cuối thấy máy. Bấm tên máy để xem chi tiết: việc đang chạy, việc gần đây và số lỗi 24 giờ qua.

## Thêm một máy worker {#them-may}

1. Bấm **Thêm máy**, rồi **Tạo mã tham gia**. Mã chỉ hiện một lần, dùng được một lần, hết hạn sau 1 giờ (có đếm ngược). Mã không bao giờ được lưu hay ghi vào nhật ký.
2. Sao chép lệnh hiện ra và chạy trên máy worker (bằng Docker, hoặc `bash deploy/install.sh worker`). Xem `deploy/README.md`.
3. Hộp thoại chờ tối đa 2 phút cho máy tham gia và báo ngay khi thấy máy mới. Máy giữ token riêng của nó, mã đã dùng xong.

Nếu trang đang mở bằng địa chỉ `localhost`, hộp thoại cảnh báo: máy khác không nối được tới `localhost` của bạn. Hãy mở trang bằng địa chỉ mạng riêng (hoặc Tailscale) của máy chính rồi tạo lại mã.

Máy worker không có cơ sở dữ liệu, không giữ khoá AI và không đăng nhập như người dùng. Nó chỉ nhận dữ liệu của đúng việc dựng đang giao cho nó.

## Chế độ dựng {#che-do}

- **Tắt**: luôn dựng trên máy chính (mặc định).
- **Ưu tiên máy worker**: nếu có máy worker rảnh, việc dựng đi máy worker. Chờ quá thời gian đặt (mặc định 30 giây) mà chưa có máy nào nhận thì máy chính tự dựng.
- **Chỉ máy worker**: máy chính không tự dựng. Không có máy worker thì việc chờ.

Trong trang một dự án, bước Dựng video ghi rõ **Máy: <tên máy>** hoặc **Máy chính**.

## Khả năng của máy và các bước khác {#kha-nang}

Mỗi máy khai báo những việc nó làm được, kèm phiên bản:

- `render`: dựng video.
- `tts:<nhà cung cấp>`: tạo giọng đọc, ví dụ `tts:piper`, `tts:google_cloud`. CLI cục bộ (Piper, VieNeu, edge-tts) chỉ được khai báo khi máy thật sự có công cụ. Nhà cung cấp dùng khoá (Google, ElevenLabs...) do người cài máy liệt kê trong `VG_NODE_TTS` (ví dụ `VG_NODE_TTS=google_cloud,openai`); máy không giữ sẵn khoá nào.
- `media_fetch`: tải clip stock về kho. Mặc định bật; đặt `VG_NODE_MEDIA=false` để tắt.

Bấm tên máy để xem khả năng kèm phiên bản và tick bỏ khả năng nào không muốn máy nhận. Việc chỉ được giao cho máy **có đủ khả năng**: máy không có `tts:piper` sẽ không bao giờ nhận việc tạo giọng bằng Piper.

Thẻ **Các bước khác chạy trên máy worker** có chế độ riêng cho **Tạo giọng đọc** và **Tải clip stock**, cùng ba mức như dựng video. Mặc định cả hai là **Tắt**, tức chỉ dựng video chạy trên máy worker. Với hai bước này, **Chỉ máy worker** nghĩa là máy chính không tự làm *khi có máy đủ khả năng đang rảnh*; việc không máy nào nhận được (ví dụ khoá bị giữ lại) vẫn chạy trên máy chính. Lần thử lại sau một lỗi trên máy worker luôn chạy trên máy chính.

Máy worker trả kết quả (âm thanh, clip) qua đường tải lên sẵn có. Máy chính kiểm tra mã sha256, kích thước và dạng tệp trước khi dùng; tệp sai bị từ chối.

## Khoá cho mượn {#khoa-cho-muon}

Bước tạo giọng bằng nhà cung cấp trả phí cần khoá API. Máy chính **cho mượn** khoá đó cho đúng một việc:

- Khoá được mã hoá riêng cho máy nhận (X25519 + AES-GCM) và chỉ nằm trong phản hồi nhận việc, không bao giờ trong tín hiệu sống hay nhật ký.
- Hết hạn sau thời gian thuê việc cộng 5 phút. Quá hạn, máy xin lại sẽ nhận lỗi 410.
- Thu hồi ngay khi việc xong, lỗi, bị huỷ, máy mất kết nối hay bị thu hồi.
- Máy giữ khoá trong bộ nhớ, không ghi ra đĩa, và xoá sau khi dùng.
- Máy chính chỉ lưu mã băm và thông tin mô tả, không lưu khoá.
- Chỉ khoá TTS và media được cho mượn; không bao giờ khoá `.env`, token OAuth hay token đăng bài.
- Tick **Không gửi khoá … ra node** để giữ riêng một khoá: bước đó chạy trên máy chính.

Mỗi lần cho mượn được ghi vào thẻ **Khoá đã cho node mượn**, ví dụ: "Node may-1 nhận khoá Google Cloud TTS cho job …, hết hạn lúc …", kèm nhãn **Còn hiệu lực** hoặc **Đã thu hồi**.

## Kiểm tra thật {#kiem-tra}

Khi tham gia và định kỳ sau đó, máy worker tự dựng thử một đoạn ngắn để chứng minh nó dựng được thật (có ffmpeg, trình duyệt và font). Nếu thất bại, dòng của máy hiện nhãn **Dựng thử lỗi** kèm lý do, và máy không được giao việc dựng.

## Cập nhật máy worker {#cap-nhat}

Máy worker phải cùng phiên bản với máy chính, vì gói dựng gắn với phiên bản đó. Phiên bản mục tiêu luôn là phiên bản của máy chính và không chỉnh riêng.

- Máy khác phiên bản hiện nhãn **Cần cập nhật** và không nhận việc mới.
- Bấm **Cập nhật tất cả** để cho các máy đó ngừng nhận việc, rồi chạy lệnh hiện ra (kéo image mới và khởi động lại) trên từng máy.
- Muốn máy tự khởi động lại khi cần cập nhật, đặt `VG_EXIT_FOR_UPDATE=1` cho máy worker (lệnh Docker từ hộp thoại **Thêm máy** đã có sẵn). Máy thoát với mã 75 và Docker (`restart: on-failure`) khởi động lại.
- Đặt `VG_PULL_POLICY=always` khi dùng image lấy từ kho để mỗi lần khởi động đều kéo bản mới. Mặc định là `missing`, hợp với image dựng tại chỗ.

## Rút việc và thu hồi {#thu-hoi}

- **Rút việc**: máy hoàn thành việc đang chạy và không nhận việc mới. Bấm **Nhận việc lại** để bật lại.
- **Thu hồi**: máy mất quyền ngay và tự dừng. Việc đang dựng dở được xếp lại, có thể mất vài phút. Muốn dùng lại phải tham gia bằng mã mới.

Trợ lý cũng có thể xem danh sách máy (`list_nodes`) và rút hay bật lại một máy (`set_node_drain`, cần bạn xác nhận).

## Khi máy bị mất kết nối {#mat-ket-noi}

Máy báo còn sống mỗi 15 giây. Không nghe tin trong khoảng 45 giây thì máy hiện **Mất kết nối**; hết hạn thuê việc (60 giây) thì việc báo lỗi `NODE_LOST` và được tự xếp lại. Kết quả gửi muộn từ máy cũ bị bỏ, không ghi đè.

Cách xử lý:

- **Mất kết nối mãi**: kiểm tra máy còn bật, còn nối mạng tới máy chính, và địa chỉ máy chính trong lệnh không phải `localhost`.
- **Cần cập nhật**: xem phần cập nhật ở trên.
- **Dựng thử lỗi**: đọc lý do trên dòng máy (thường thiếu ffmpeg hoặc trình duyệt), sửa image rồi cập nhật máy.

## Lưu ý an toàn {#an-toan}

- Dùng mạng riêng hoặc Tailscale giữa hai máy. Địa chỉ `http://` công khai bị máy worker từ chối.
- Mã tham gia và token máy không bao giờ ghi vào nhật ký.
- Khoá TTS chỉ được cho node mượn theo quy tắc ở [Khoá cho mượn](#khoa-cho-muon). Khoá `.env`, token đăng nhập mạng xã hội và token đăng bài không bao giờ rời máy chính.

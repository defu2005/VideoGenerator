# Rà soát giả định bên ngoài

- `youtube.data.videos_insert`: chi phí hiển thị 100, bucket riêng đếm request và lời giải thích khi quyền riêng tư trả về khác yêu cầu. Nguồn là [revision history](https://developers.google.com/youtube/data/revision_history) và RESEARCH-073.
- `youtube.data.quota`, `youtube.data.search_list`: bucket, múi giờ reset và chi phí các method đang dùng. Giá trị cấu hình cục bộ vẫn giới hạn quota chung của app.
- `limit.youtube.shorts_max_sec` và `limit.youtube.publisher`: giới hạn độ dài và metadata. Tách đếm byte mô tả với cắt chuỗi đầu vào. Số 30 tags vẫn là giới hạn UX của app.
- `guideline.*`: tham số, luật và nguồn của bộ có sẵn. Hook theo số giây là lời khuyên biên tập, giữ trong pack như trước.
- `analytics.scopes.*`: scope yêu cầu cho từng connector. Logic YouTube full scope bao hàm readonly giữ trong code để đọc grant cũ.
- `limit.tiktok.caption_max_utf16`: giới hạn caption Direct Post lấy từ [tài liệu TikTok](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post), kiểm ngày 2026-11-11. Độ dài tối đa của từng tài khoản vẫn ưu tiên phản hồi `creator_info`.
- Giữ việc luôn gửi `privacyStatus` theo lựa chọn người dùng, kể cả khi nhà cung cấp thay mặc định.
- Trình tự upload, chunking, đếm byte, de-dup tag, lựa chọn fallback và cấu hình URL giao thức là logic tích hợp. Các metadata/codec cố định trong adapter còn lại cần rà theo connector khi có nguồn chuẩn.
- Giá, free tier, license/caching của nguồn hình/nhạc/TTS vẫn do provider intel và metadata theo từng asset quản lý. Không tự thay điều khoản hoặc quyết định phân phối dựa trên nguồn chưa duyệt. Snapshot chưa chứa toàn bộ provider research.
- Giữ các ngưỡng an toàn hiện có của adapter Meta khi chưa có đối chiếu tài liệu endpoint đủ rõ. Giới hạn đăng Instagram ưu tiên phản hồi `content_publishing_limit` trước fallback. Các định danh licence Flickr là mã giao thức, phân loại quyền tiếp tục lấy theo từng asset.

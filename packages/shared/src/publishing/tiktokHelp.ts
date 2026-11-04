/** Vietnamese setup help for TikTok OAuth + Content Posting API. Shown in the UI. */
export const TIKTOK_SETUP_HELP_VI = `Cách kết nối TikTok (dùng app trên developers.tiktok.com của bạn):

1. Tạo ứng dụng trên developers.tiktok.com, bật Login Kit và Content Posting API.
2. Thêm redirect URI đúng như ô "Redirect URI" bên dưới (mặc định http://127.0.0.1:3001/api/oauth/tiktok/callback). TikTok có thể yêu cầu HTTPS hoặc domain đã đăng ký — nếu console từ chối localhost/HTTP, làm theo hướng dẫn hiện tại trên trang TikTok for Developers (ứng dụng không bịa workaround).
3. Điền Client Key / Client Secret vào "Thông tin ứng dụng" ở đây, hoặc đặt TIKTOK_CLIENT_KEY và TIKTOK_CLIENT_SECRET trong file .env.
4. Xin các quyền: user.info.basic, video.publish, video.upload, video.list, user.info.stats.
5. Quyền video.list và user.info.stats dùng để đồng bộ thống kê (lượt xem, thích, bình luận, chia sẻ, số follower). Hai scope này cần được TikTok duyệt trên developer portal trước khi dùng được ngoài sandbox.

Lưu ý quan trọng:
• Cho đến khi app TikTok của bạn được TikTok duyệt (audit), Direct Post chỉ được đăng ở chế độ riêng tư (SELF_ONLY). Nếu bạn chọn công khai, ứng dụng sẽ hạ xuống riêng tư và ghi cảnh báo.
• Chế độ "Gửi vào hộp thư nháp" tải video vào inbox TikTok (scope video.upload); bạn hoàn tất đăng trong app TikTok.
• TikTok API không hỗ trợ lên lịch đăng gốc — job SCHEDULED sẽ giữ đến giờ rồi mới tải lên.
• Chỉ đăng được bản render dọc (9:16).
• Tài khoản đã kết nối trước khi bật thống kê cần "Kết nối lại để bật thống kê" sau khi TikTok duyệt scope video.list / user.info.stats.`;

export const TIKTOK_AUDIT_PRIVATE_WARNING_VI =
  "Ứng dụng TikTok chưa được duyệt: video đăng ở chế độ riêng tư";

export const TIKTOK_INBOX_SENT_WARNING_VI =
  "Video đã gửi vào hộp thư nháp TikTok — mở app TikTok để hoàn tất đăng.";

export const TIKTOK_SCOPES = [
  "user.info.basic",
  "video.publish",
  "video.upload",
  "video.list",
  "user.info.stats",
] as const;

/** Caption / title limit in UTF-16 code units (TikTok docs). */
export const TIKTOK_CAPTION_MAX_UTF16 = 2200;

/** Prefer this chunk size for multi-chunk FILE_UPLOAD (within 5–64 MB). */
export const TIKTOK_PREFERRED_CHUNK_BYTES = 10 * 1024 * 1024;
export const TIKTOK_MIN_CHUNK_BYTES = 5 * 1024 * 1024;
export const TIKTOK_MAX_CHUNK_BYTES = 64 * 1024 * 1024;
export const TIKTOK_MAX_FINAL_CHUNK_BYTES = 128 * 1024 * 1024;

export const TikTokUploadModeSchema = {
  direct_post: "direct_post",
  inbox: "inbox",
} as const;
export type TikTokUploadMode = (typeof TikTokUploadModeSchema)[keyof typeof TikTokUploadModeSchema];

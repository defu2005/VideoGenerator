/** Vietnamese setup help for YouTube OAuth (Google Cloud Console). Shown in the UI. */
export const YOUTUBE_SETUP_HELP_VI = `Cách kết nối YouTube (dùng Google Cloud của bạn):

1. Tạo project trên Google Cloud Console, bật YouTube Data API v3 và YouTube Analytics API.
2. Cấu hình OAuth consent screen (External), thêm tài khoản Google của bạn làm test user.
3. Tạo OAuth client kiểu Desktop app hoặc Web application với redirect URI đúng như ô "Redirect URI" bên dưới (mặc định http://127.0.0.1:3001/api/oauth/youtube/callback).
4. Điền Client ID / Client Secret vào "Thông tin ứng dụng" ở đây, hoặc đặt YOUTUBE_CLIENT_ID và YOUTUBE_CLIENT_SECRET trong file .env.
5. Quyền OAuth: youtube.upload, youtube.readonly (hoặc youtube nếu có Playlist ID), yt-analytics.readonly để đồng bộ thống kê (lượt xem, thời gian xem, %), và (tuỳ chọn) yt-analytics-monetary.readonly khi bật "Thống kê doanh thu YouTube".

Lưu ý:
• Khi consent screen còn "Testing", refresh token hết hạn sau 7 ngày — cần "Kết nối lại" hàng tuần cho đến khi bạn publish consent screen.
• Video tải lên từ project API chưa được Google xác minh có thể bị YouTube khóa ở chế độ riêng tư; ứng dụng ghi nhận đó là cảnh báo, không phải lỗi đăng.
• Nếu bạn đặt Playlist ID, lần Kết nối sẽ xin thêm quyền youtube (không chỉ youtube.readonly) để thêm video vào playlist.
• Tài khoản đã kết nối trước khi bật thống kê cần "Kết nối lại để bật thống kê" để cấp quyền yt-analytics.readonly.
• Doanh thu YouTube cần bật riêng ("Bật thống kê doanh thu YouTube") vì xin quyền xem số tiền; kênh chưa tham gia Partner Program sẽ hiện "Kênh chưa bật kiếm tiền".`;

export const YOUTUBE_PLAYLIST_SCOPE_NOTE_VI =
  "Có Playlist ID: lần Kết nối sẽ xin quyền đầy đủ youtube (thêm video vào playlist), không chỉ youtube.readonly.";

export const YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
export const YOUTUBE_READONLY_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
export const YOUTUBE_FULL_SCOPE = "https://www.googleapis.com/auth/youtube";
/** YouTube Analytics API (reports.query) — required for watch time / avg view %. */
export const YOUTUBE_ANALYTICS_READONLY_SCOPE =
  "https://www.googleapis.com/auth/yt-analytics.readonly";
/** YouTube Analytics monetary metrics (estimatedRevenue, etc.) — opt-in per account. */
export const YOUTUBE_ANALYTICS_MONETARY_READONLY_SCOPE =
  "https://www.googleapis.com/auth/yt-analytics-monetary.readonly";

/** Default category: Education. */
export const YOUTUBE_DEFAULT_CATEGORY_ID = "27";

/** Shorts: vertical videos at most 3 minutes. */
export const YOUTUBE_SHORTS_MAX_SEC = 180;

/**
 * Quota units charged per videos.insert (YouTube docs as of late 2025 / 2026:
 * ~100 units in the combined bucket; uploads also have a separate daily call cap).
 */
export const YOUTUBE_UPLOAD_QUOTA_COST = 100;
export const YOUTUBE_THUMBNAIL_QUOTA_COST = 50;
export const YOUTUBE_PLAYLIST_ITEM_QUOTA_COST = 50;

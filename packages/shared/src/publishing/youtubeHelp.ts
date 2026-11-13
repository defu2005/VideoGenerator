import { ApiContractSchema } from "../knowledge/schema.js";
import { snapshotKnowledge } from "../knowledge/snapshot.js";
/** Vietnamese setup help for YouTube OAuth (Google Cloud Console). Shown in the UI. */
export const YOUTUBE_SETUP_HELP_VI = `Cách kết nối YouTube (dùng Google Cloud của bạn):

1. Tạo project trên Google Cloud Console, bật YouTube Data API v3 và YouTube Analytics API.
2. Cấu hình OAuth consent screen (External), thêm tài khoản Google của bạn làm test user.
3. Tạo OAuth client kiểu Desktop app hoặc Web application với redirect URI đúng như ô "Redirect URI" bên dưới (mặc định http://127.0.0.1:3001/api/oauth/youtube/callback).
4. Điền Client ID / Client Secret vào "Thông tin ứng dụng" ở đây, hoặc đặt YOUTUBE_CLIENT_ID và YOUTUBE_CLIENT_SECRET trong file .env.
5. Quyền OAuth: youtube.upload, youtube.readonly (hoặc youtube nếu có Playlist ID), yt-analytics.readonly để đồng bộ thống kê (lượt xem, thời gian xem, %), (tuỳ chọn) yt-analytics-monetary.readonly khi bật "Thống kê doanh thu YouTube", và (tuỳ chọn) youtube.force-ssl khi bật "Quản lý bình luận YouTube".

Lưu ý:
• Khi consent screen còn "Testing", refresh token hết hạn sau 7 ngày — cần "Kết nối lại" hàng tuần cho đến khi bạn publish consent screen.
• Ứng dụng gửi rõ chế độ hiển thị đã chọn. Nếu YouTube trả về chế độ khác, hãy kiểm tra video trong YouTube Studio.
• Nếu bạn đặt Playlist ID, lần Kết nối sẽ xin thêm quyền youtube (không chỉ youtube.readonly) để thêm video vào playlist.
• Tài khoản đã kết nối trước khi bật thống kê cần "Kết nối lại để bật thống kê" để cấp quyền yt-analytics.readonly.
• Doanh thu YouTube cần bật riêng ("Bật thống kê doanh thu YouTube") vì xin quyền xem số tiền; kênh chưa tham gia Partner Program sẽ hiện "Kênh chưa bật kiếm tiền".
• Thử 2 tiêu đề cần quyền youtube đầy đủ (cùng quyền dùng khi có Playlist ID). Nếu chưa cấp, hồ sơ sẽ ẩn công tắc và giải thích.
• Quản lý bình luận là quyền riêng (youtube.force-ssl): bật "Quản lý bình luận YouTube" rồi Kết nối lại. Tài khoản chưa cấp quyền sẽ hiện cần kết nối lại cho bình luận, không ảnh hưởng đăng video.`;

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
/** Comment read/reply/moderation. Opt-in per account ("Quản lý bình luận YouTube"). */
export const YOUTUBE_FORCE_SSL_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";

/** Default category: Education. */
export const YOUTUBE_DEFAULT_CATEGORY_ID = "27";

/** Snapshot defaults for callers without a server resolver. */
export const YOUTUBE_SHORTS_MAX_SEC = (snapshotKnowledge("limit.youtube.shorts_max_sec")!.value as { value: number }).value;
export const YOUTUBE_UPLOAD_QUOTA_COST = ApiContractSchema.parse(snapshotKnowledge("youtube.data.videos_insert")!.value).quotaCost!;
const quotaCosts = ApiContractSchema.parse(snapshotKnowledge("youtube.data.quota")!.value).methodCosts!;
export const YOUTUBE_THUMBNAIL_QUOTA_COST = quotaCosts["thumbnails.set"];
export const YOUTUBE_PLAYLIST_ITEM_QUOTA_COST = quotaCosts["playlistItems.insert"];
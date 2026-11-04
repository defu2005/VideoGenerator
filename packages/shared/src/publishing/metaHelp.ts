import { z } from "zod";

/** Graph API version used for Facebook / Instagram Reels. Update when Meta docs change. */
export const META_GRAPH_VERSION = "v26.0";

/** Vietnamese setup help for Meta (Facebook Login → Page / IG). Shown in the UI. */
export const META_SETUP_HELP_VI = `Cách kết nối Facebook Reels / Instagram Reels (dùng Meta app của bạn):

1. Tạo ứng dụng loại Business trên developers.facebook.com, thêm sản phẩm Facebook Login.
2. Thêm redirect URI đúng như ô "Redirect URI" bên dưới (mặc định http://127.0.0.1:3001/api/oauth/facebook_reels/callback hoặc …/instagram_reels/callback). Nếu Meta bắt buộc HTTPS cho redirect, làm theo hướng dẫn hiện tại trên trang Meta for Developers (ứng dụng không bịa workaround).
3. Điền App ID / App Secret vào "Thông tin ứng dụng" ở đây, hoặc đặt META_APP_ID và META_APP_SECRET trong file .env.
4. Trong chế độ Development, app chỉ hoạt động với tài khoản có vai trò trong app — đủ để dùng Page và Instagram của chính bạn.
5. Sau khi đăng nhập Facebook, chọn Trang (Facebook Reels) hoặc tài khoản Instagram chuyên nghiệp liên kết với Page (Instagram Reels).

Lưu ý:
• Token dài hạn hết hạn khoảng 60 ngày — ứng dụng cảnh báo trước 7 ngày ("Cần kết nối lại").
• Chỉ đăng bản render dọc (9:16).
• Facebook Reels: 3–90 giây, tối đa ~1 GB; Instagram Reels: 3 giây–15 phút, tối đa 300 MB.
• Instagram không hỗ trợ lên lịch gốc qua API — job SCHEDULED giữ đến giờ rồi mới tải lên (ticker TASK-024).`;

export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "publish_video",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
] as const;

export const META_OAUTH_SCOPES = META_SCOPES.join(",");

/** Warn / reconnect copy when the long-lived token is within 7 days of expiry. */
export const META_RECONNECT_SOON_VI = "Cần kết nối lại";

export const META_FB_MIN_DURATION_SEC = 3;
export const META_FB_MAX_DURATION_SEC = 90;
/** Soft file-size guard for Facebook Reels (~1 GB). */
export const META_FB_MAX_BYTES = 1024 * 1024 * 1024;
export const META_FB_MAX_DESCRIPTION_CHARS = 2200;
/** API-published Reels per Page per rolling 24 h (Meta docs). */
export const META_FB_PUBLISH_LIMIT_24H = 30;

export const META_IG_MIN_DURATION_SEC = 3;
export const META_IG_MAX_DURATION_SEC = 15 * 60;
export const META_IG_MAX_BYTES = 300 * 1024 * 1024;
export const META_IG_MAX_CAPTION_CHARS = 2200;
/** Approximate Content Publishing API quota (rolling 24 h); always prefer live content_publishing_limit. */
export const META_IG_PUBLISH_LIMIT_24H_FALLBACK = 50;

/** Server-side Meta target including the Page access token (never sent to the client). */
export type MetaTargetWithToken = {
  id: string;
  name: string;
  handle?: string;
  kind: "page" | "instagram";
  pageId?: string;
  pageAccessToken: string;
};

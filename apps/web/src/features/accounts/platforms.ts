import type { PlatformId } from "@vg/shared";

export const PLATFORM_LABEL: Record<PlatformId, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  facebook_reels: "Facebook Reels",
  instagram_reels: "Instagram Reels",
  mock: "Thử nghiệm (mock)",
};

export const CONNECTION_LABEL: Record<string, string> = {
  CONNECTED: "Đã kết nối",
  NOT_CONNECTED: "Chưa kết nối",
  EXPIRED: "Hết hạn",
  ERROR: "Lỗi",
};

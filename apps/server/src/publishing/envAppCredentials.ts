import type { PlatformId } from "@vg/shared";
import type { AppConfig } from "../lib/config.js";

/** Whether `.env` holds a usable developer-app credential pair for the platform. */
export function hasEnvAppCredentials(platform: PlatformId, config: AppConfig): boolean {
  switch (platform) {
    case "mock":
      return true;
    case "youtube":
      return Boolean(config.YOUTUBE_CLIENT_ID?.trim() && config.YOUTUBE_CLIENT_SECRET?.trim());
    case "tiktok":
      return Boolean(config.TIKTOK_CLIENT_KEY?.trim() && config.TIKTOK_CLIENT_SECRET?.trim());
    case "facebook_reels":
    case "instagram_reels":
      return Boolean(config.META_APP_ID?.trim() && config.META_APP_SECRET?.trim());
    default:
      return false;
  }
}

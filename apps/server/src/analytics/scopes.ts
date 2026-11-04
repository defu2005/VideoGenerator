import {
  YOUTUBE_ANALYTICS_READONLY_SCOPE,
  YOUTUBE_FULL_SCOPE,
  YOUTUBE_READONLY_SCOPE,
  type PlatformId,
} from "@vg/shared";

/** Scopes each platform fetcher needs for analytics (beyond upload). */
export const ANALYTICS_REQUIRED_SCOPES: Record<PlatformId, string[]> = {
  youtube: [YOUTUBE_READONLY_SCOPE, YOUTUBE_ANALYTICS_READONLY_SCOPE],
  tiktok: ["video.list", "user.info.stats"],
  instagram_reels: ["instagram_manage_insights"],
  facebook_reels: ["read_insights"],
  mock: [],
};

/**
 * Return required scopes not present in `granted`.
 * YouTube full scope (`youtube`) satisfies `youtube.readonly`.
 */
export function missingScopes(granted: string[], required: string[]): string[] {
  const set = new Set(granted);
  const hasYoutubeData =
    set.has(YOUTUBE_READONLY_SCOPE) || set.has(YOUTUBE_FULL_SCOPE);
  return required.filter((scope) => {
    if (scope === YOUTUBE_READONLY_SCOPE) return !hasYoutubeData;
    return !set.has(scope);
  });
}

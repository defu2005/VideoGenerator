import { YOUTUBE_FORCE_SSL_SCOPE, type PlatformId } from "@vg/shared";

/** Scopes required to read and moderate comments. YouTube is opt-in. */
export const COMMENT_REQUIRED_SCOPES: Record<PlatformId, string[]> = {
  youtube: [YOUTUBE_FORCE_SSL_SCOPE],
  instagram_reels: ["instagram_manage_comments"],
  facebook_reels: ["pages_read_user_content", "pages_manage_engagement"],
  tiktok: [],
  mock: [],
};

export function missingCommentScopes(granted: string[], required: string[]): string[] {
  const set = new Set(granted);
  return required.filter((scope) => !set.has(scope));
}

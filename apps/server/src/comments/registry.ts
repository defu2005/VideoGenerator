import type { PlatformId } from "@vg/shared";
import { FacebookCommentFetcher, InstagramCommentFetcher } from "./metaFetchers.js";
import type { CommentPlatformClient } from "./types.js";
import { YoutubeCommentFetcher, type YoutubeCommentFetcherOptions } from "./youtubeFetcher.js";

export function createCommentClients(
  options: YoutubeCommentFetcherOptions & { fetchImpl?: typeof fetch } = {},
): Partial<Record<PlatformId, CommentPlatformClient>> {
  return {
    youtube: new YoutubeCommentFetcher(options),
    instagram_reels: new InstagramCommentFetcher({ fetchImpl: options.fetchImpl }),
    facebook_reels: new FacebookCommentFetcher({ fetchImpl: options.fetchImpl }),
  };
}

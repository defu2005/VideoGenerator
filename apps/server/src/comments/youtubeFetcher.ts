import type { YoutubeQuotaTracker } from "../publishing/youtubeQuota.js";
import { CommentHttpError, throwIfBad } from "./http.js";
import { pullUntilOld } from "./paging.js";
import { COMMENT_REQUIRED_SCOPES } from "./scopes.js";
import type { CommentPage, CommentPlatformClient, CommentPullInput, FetchedComment } from "./types.js";

const DATA_API = "https://www.googleapis.com/youtube/v3";

type YtSnippet = {
  authorDisplayName?: string;
  authorChannelId?: { value?: string };
  textOriginal?: string;
  textDisplay?: string;
  likeCount?: number;
  publishedAt?: string;
  parentId?: string;
};

type YtComment = { id?: string; snippet?: YtSnippet };

type YtThread = {
  snippet?: { topLevelComment?: YtComment };
  replies?: { comments?: YtComment[] };
};

export type YoutubeCommentFetcherOptions = {
  fetchImpl?: typeof fetch;
  youtubeQuota?: YoutubeQuotaTracker;
};

export class YoutubeCommentFetcher implements CommentPlatformClient {
  readonly platform = "youtube" as const;
  readonly requiredScopes = [...COMMENT_REQUIRED_SCOPES.youtube];
  private readonly fetchImpl: typeof fetch;
  private readonly quota?: YoutubeQuotaTracker;

  constructor(options: YoutubeCommentFetcherOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.quota = options.youtubeQuota;
  }

  async fetchComments(input: CommentPullInput): Promise<FetchedComment[]> {
    return pullUntilOld(input.since, (pageToken) => this.fetchPage(input, pageToken));
  }

  async reply(input: {
    externalId: string;
    accessToken: string;
    text: string;
    signal: AbortSignal;
  }): Promise<{ replyExternalId: string }> {
    this.charge("comments.insert");
    const url = new URL(`${DATA_API}/comments`);
    url.searchParams.set("part", "snippet");
    const response = await this.fetchImpl(url.toString(), {
      method: "POST",
      signal: input.signal,
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        snippet: { parentId: input.externalId, textOriginal: input.text },
      }),
    });
    await throwIfBad(response, "YouTube comments.insert");
    const body = (await response.json()) as { id?: string };
    if (!body.id) throw new CommentHttpError("YouTube comments.insert không trả id", 502, false);
    return { replyExternalId: body.id };
  }

  async hide(input: { externalId: string; accessToken: string; signal: AbortSignal }): Promise<void> {
    await this.setModeration(input, "heldForReview");
  }

  async unhide(input: { externalId: string; accessToken: string; signal: AbortSignal }): Promise<void> {
    await this.setModeration(input, "published");
  }

  async markSpam(input: { externalId: string; accessToken: string; signal: AbortSignal }): Promise<void> {
    const url = new URL(`${DATA_API}/comments/markAsSpam`);
    url.searchParams.set("id", input.externalId);
    const response = await this.fetchImpl(url.toString(), {
      method: "POST",
      signal: input.signal,
      headers: { Authorization: `Bearer ${input.accessToken}` },
    });
    await throwIfBad(response, "YouTube comments.markAsSpam");
  }

  private async fetchPage(input: CommentPullInput, pageToken: string | null): Promise<CommentPage> {
    this.charge("commentThreads.list");
    const url = new URL(`${DATA_API}/commentThreads`);
    url.searchParams.set("part", "snippet,replies");
    url.searchParams.set("videoId", input.externalId);
    url.searchParams.set("order", "time");
    url.searchParams.set("maxResults", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await this.fetchImpl(url.toString(), {
      signal: input.signal,
      headers: { Authorization: `Bearer ${input.accessToken}` },
    });
    await throwIfBad(response, "YouTube commentThreads.list");
    const body = (await response.json()) as { items?: YtThread[]; nextPageToken?: string };
    const comments: FetchedComment[] = [];
    for (const thread of body.items ?? []) {
      const top = mapYtComment(thread.snippet?.topLevelComment, null);
      if (top) comments.push(top);
      for (const reply of thread.replies?.comments ?? []) {
        const mapped = mapYtComment(reply, top?.externalId ?? reply.snippet?.parentId ?? null);
        if (mapped) comments.push(mapped);
      }
    }
    return { comments, nextPageToken: body.nextPageToken ?? null };
  }

  private async setModeration(
    input: { externalId: string; accessToken: string; signal: AbortSignal },
    moderationStatus: "heldForReview" | "published",
  ): Promise<void> {
    const url = new URL(`${DATA_API}/comments/setModerationStatus`);
    url.searchParams.set("id", input.externalId);
    url.searchParams.set("moderationStatus", moderationStatus);
    const response = await this.fetchImpl(url.toString(), {
      method: "POST",
      signal: input.signal,
      headers: { Authorization: `Bearer ${input.accessToken}` },
    });
    await throwIfBad(response, "YouTube comments.setModerationStatus");
  }

  private charge(method: string): void {
    if (this.quota && !this.quota.charge(method)) {
      throw new CommentHttpError("Hết hạn mức YouTube Data API trong ngày", 429, true);
    }
  }
}

function mapYtComment(comment: YtComment | undefined, parentExternalId: string | null): FetchedComment | null {
  if (!comment?.id || !comment.snippet?.publishedAt) return null;
  return {
    externalId: comment.id,
    parentExternalId,
    authorName: comment.snippet.authorDisplayName?.trim() || "Ẩn danh",
    authorExternalId: comment.snippet.authorChannelId?.value ?? null,
    text: (comment.snippet.textOriginal ?? comment.snippet.textDisplay ?? "").trim(),
    likeCount: Number(comment.snippet.likeCount) || 0,
    publishedAt: comment.snippet.publishedAt,
  };
}

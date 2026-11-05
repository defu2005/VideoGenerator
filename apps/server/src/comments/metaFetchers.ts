import { META_GRAPH_VERSION } from "@vg/shared";
import { throwIfBad } from "./http.js";
import { pullUntilOld } from "./paging.js";
import { COMMENT_REQUIRED_SCOPES } from "./scopes.js";
import type { CommentPage, CommentPlatformClient, CommentPullInput, FetchedComment } from "./types.js";

const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

type IgComment = {
  id?: string;
  text?: string;
  username?: string;
  timestamp?: string;
  like_count?: number;
  replies?: { data?: IgComment[] };
};

type FbComment = {
  id?: string;
  message?: string;
  created_time?: string;
  like_count?: number;
  from?: { id?: string; name?: string };
  comments?: { data?: FbComment[] };
};

type GraphPage<T> = {
  data?: T[];
  paging?: { cursors?: { after?: string } };
};

export type MetaCommentFetcherOptions = {
  fetchImpl?: typeof fetch;
};

export class InstagramCommentFetcher implements CommentPlatformClient {
  readonly platform = "instagram_reels" as const;
  readonly requiredScopes = [...COMMENT_REQUIRED_SCOPES.instagram_reels];
  private readonly fetchImpl: typeof fetch;

  constructor(options: MetaCommentFetcherOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  fetchComments(input: CommentPullInput): Promise<FetchedComment[]> {
    return pullUntilOld(input.since, (pageToken) => this.fetchPage(input, pageToken));
  }

  async reply(input: { externalId: string; accessToken: string; text: string; signal: AbortSignal }) {
    const body = await this.postForm(`/${encodeURIComponent(input.externalId)}/replies`, input.accessToken, input.signal, {
      message: input.text,
    });
    const id = typeof body.id === "string" ? body.id : input.externalId;
    return { replyExternalId: id };
  }

  async hide(input: { externalId: string; accessToken: string; signal: AbortSignal }): Promise<void> {
    await this.postForm(`/${encodeURIComponent(input.externalId)}`, input.accessToken, input.signal, { hide: "true" });
  }

  async unhide(input: { externalId: string; accessToken: string; signal: AbortSignal }): Promise<void> {
    await this.postForm(`/${encodeURIComponent(input.externalId)}`, input.accessToken, input.signal, { hide: "false" });
  }

  async deleteComment(input: { externalId: string; accessToken: string; signal: AbortSignal }): Promise<void> {
    const url = graphUrl(`/${encodeURIComponent(input.externalId)}`, input.accessToken);
    const response = await this.fetchImpl(url, { method: "DELETE", signal: input.signal });
    await throwIfBad(response, "Instagram delete comment");
  }

  private async fetchPage(input: CommentPullInput, pageToken: string | null): Promise<CommentPage> {
    const url = new URL(`${GRAPH}/${encodeURIComponent(input.externalId)}/comments`);
    url.searchParams.set("fields", "id,text,username,timestamp,like_count,replies{id,text,username,timestamp,like_count}");
    url.searchParams.set("access_token", input.accessToken);
    if (pageToken) url.searchParams.set("after", pageToken);
    const response = await this.fetchImpl(url.toString(), { signal: input.signal });
    await throwIfBad(response, "Instagram comments");
    const body = (await response.json()) as GraphPage<IgComment>;
    const comments: FetchedComment[] = [];
    for (const item of body.data ?? []) {
      const top = mapIg(item, null);
      if (top) comments.push(top);
      for (const reply of item.replies?.data ?? []) {
        const mapped = mapIg(reply, top?.externalId ?? null);
        if (mapped) comments.push(mapped);
      }
    }
    return { comments, nextPageToken: body.paging?.cursors?.after ?? null };
  }

  private async postForm(path: string, accessToken: string, signal: AbortSignal, fields: Record<string, string>) {
    const response = await this.fetchImpl(graphUrl(path, accessToken), {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
    });
    await throwIfBad(response, "Instagram comments");
    return (await response.json()) as { id?: string };
  }
}

export class FacebookCommentFetcher implements CommentPlatformClient {
  readonly platform = "facebook_reels" as const;
  readonly requiredScopes = [...COMMENT_REQUIRED_SCOPES.facebook_reels];
  private readonly fetchImpl: typeof fetch;

  constructor(options: MetaCommentFetcherOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  fetchComments(input: CommentPullInput): Promise<FetchedComment[]> {
    return pullUntilOld(input.since, (pageToken) => this.fetchPage(input, pageToken));
  }

  async reply(input: { externalId: string; accessToken: string; text: string; signal: AbortSignal }) {
    const body = await this.postForm(`/${encodeURIComponent(input.externalId)}/comments`, input.accessToken, input.signal, {
      message: input.text,
    });
    const id = typeof body.id === "string" ? body.id : input.externalId;
    return { replyExternalId: id };
  }

  async hide(input: { externalId: string; accessToken: string; signal: AbortSignal }): Promise<void> {
    await this.postForm(`/${encodeURIComponent(input.externalId)}`, input.accessToken, input.signal, { is_hidden: "true" });
  }

  async unhide(input: { externalId: string; accessToken: string; signal: AbortSignal }): Promise<void> {
    await this.postForm(`/${encodeURIComponent(input.externalId)}`, input.accessToken, input.signal, { is_hidden: "false" });
  }

  private async fetchPage(input: CommentPullInput, pageToken: string | null): Promise<CommentPage> {
    const url = new URL(`${GRAPH}/${encodeURIComponent(input.externalId)}/comments`);
    url.searchParams.set("fields", "id,message,from,created_time,like_count,comments{id,message,from,created_time,like_count}");
    url.searchParams.set("access_token", input.accessToken);
    if (pageToken) url.searchParams.set("after", pageToken);
    const response = await this.fetchImpl(url.toString(), { signal: input.signal });
    await throwIfBad(response, "Facebook comments");
    const body = (await response.json()) as GraphPage<FbComment>;
    const comments: FetchedComment[] = [];
    for (const item of body.data ?? []) {
      const top = mapFb(item, null);
      if (top) comments.push(top);
      for (const reply of item.comments?.data ?? []) {
        const mapped = mapFb(reply, top?.externalId ?? null);
        if (mapped) comments.push(mapped);
      }
    }
    return { comments, nextPageToken: body.paging?.cursors?.after ?? null };
  }

  private async postForm(path: string, accessToken: string, signal: AbortSignal, fields: Record<string, string>) {
    const response = await this.fetchImpl(graphUrl(path, accessToken), {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
    });
    await throwIfBad(response, "Facebook comments");
    return (await response.json()) as { id?: string };
  }
}

function graphUrl(path: string, accessToken: string): string {
  const url = new URL(`${GRAPH}${path}`);
  url.searchParams.set("access_token", accessToken);
  return url.toString();
}

function mapIg(item: IgComment, parentExternalId: string | null): FetchedComment | null {
  if (!item.id || !item.timestamp) return null;
  return {
    externalId: item.id,
    parentExternalId,
    authorName: item.username?.trim() || "Ẩn danh",
    authorExternalId: null,
    text: (item.text ?? "").trim(),
    likeCount: Number(item.like_count) || 0,
    publishedAt: normalizeStamp(item.timestamp),
  };
}

function mapFb(item: FbComment, parentExternalId: string | null): FetchedComment | null {
  if (!item.id || !item.created_time) return null;
  return {
    externalId: item.id,
    parentExternalId,
    authorName: item.from?.name?.trim() || "Ẩn danh",
    authorExternalId: item.from?.id ?? null,
    text: (item.message ?? "").trim(),
    likeCount: Number(item.like_count) || 0,
    publishedAt: normalizeStamp(item.created_time),
  };
}

function normalizeStamp(value: string): string {
  const direct = Date.parse(value);
  if (!Number.isNaN(direct)) return new Date(direct).toISOString();
  const fixed = Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(fixed) ? value : new Date(fixed).toISOString();
}

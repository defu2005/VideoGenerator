import type { PlatformId } from "@vg/shared";

export type FetchedComment = {
  externalId: string;
  parentExternalId: string | null;
  authorName: string;
  authorExternalId: string | null;
  text: string;
  likeCount: number;
  publishedAt: string;
};

export type CommentPage = {
  comments: FetchedComment[];
  nextPageToken: string | null;
};

export type CommentPullInput = {
  externalId: string;
  accessToken: string;
  since: string | null;
  signal: AbortSignal;
};

export interface CommentPlatformClient {
  readonly platform: PlatformId;
  readonly requiredScopes: string[];
  fetchComments(input: CommentPullInput): Promise<FetchedComment[]>;
  reply(input: {
    externalId: string;
    accessToken: string;
    text: string;
    signal: AbortSignal;
  }): Promise<{ replyExternalId: string }>;
  hide(input: { externalId: string; accessToken: string; signal: AbortSignal }): Promise<void>;
  unhide(input: { externalId: string; accessToken: string; signal: AbortSignal }): Promise<void>;
  markSpam?(input: { externalId: string; accessToken: string; signal: AbortSignal }): Promise<void>;
  deleteComment?(input: { externalId: string; accessToken: string; signal: AbortSignal }): Promise<void>;
}

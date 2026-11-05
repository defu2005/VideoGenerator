import type { CommentSettings, CommentSettingsInput } from "@vg/shared";
import { apiRequest } from "./apiClient";

export type CommentInboxItem = {
  id: string;
  publicationId: string;
  projectId: string;
  profileId: string | null;
  platform: string;
  externalId: string;
  parentExternalId: string | null;
  authorName: string;
  text: string;
  likeCount: number;
  publishedAt: string;
  status: string;
  classification: string | null;
  priority: number;
  toxic: boolean;
  confidence: string | null;
  suggestedReply: string | null;
  repliedAt: string | null;
  repliedBy: string | null;
  videoTitle: string;
  thumbnailUrl: string | null;
  externalUrl: string | null;
};

export type CommentInboxResponse = {
  items: CommentInboxItem[];
  tiktok: Array<{
    accountId: string;
    displayName: string;
    note: string;
    videos: Array<{ title: string; url: string }>;
  }>;
};

export type CommentListQuery = {
  profileId?: string;
  platform?: string;
  status?: string;
  classification?: string;
};

export function listComments(query: CommentListQuery = {}): Promise<CommentInboxResponse> {
  const params = new URLSearchParams();
  if (query.profileId) params.set("profileId", query.profileId);
  if (query.platform) params.set("platform", query.platform);
  if (query.status) params.set("status", query.status);
  if (query.classification) params.set("classification", query.classification);
  const qs = params.toString();
  return apiRequest(`/comments${qs ? `?${qs}` : ""}`);
}

export function unreadCommentCount(): Promise<{ count: number }> {
  return apiRequest("/comments/unread");
}

export function replyToComment(id: string, text: string): Promise<{ ok: boolean }> {
  return apiRequest(`/comments/${encodeURIComponent(id)}/reply`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function hideComment(id: string): Promise<{ ok: boolean }> {
  return apiRequest(`/comments/${encodeURIComponent(id)}/hide`, { method: "POST" });
}

export function unhideComment(id: string): Promise<{ ok: boolean }> {
  return apiRequest(`/comments/${encodeURIComponent(id)}/unhide`, { method: "POST" });
}

export function spamComment(id: string): Promise<{ ok: boolean }> {
  return apiRequest(`/comments/${encodeURIComponent(id)}/spam`, { method: "POST" });
}

export function ignoreComment(id: string): Promise<{ ok: boolean }> {
  return apiRequest(`/comments/${encodeURIComponent(id)}/ignore`, { method: "POST" });
}

export function markCommentRead(id: string): Promise<{ ok: boolean }> {
  return apiRequest(`/comments/${encodeURIComponent(id)}/read`, { method: "POST" });
}

export function deleteComment(id: string): Promise<{ ok: boolean }> {
  return apiRequest(`/comments/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function bulkSpamComments(ids: string[]): Promise<{ updated: number }> {
  return apiRequest("/comments/bulk-spam", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export function getCommentSettings(profileId: string): Promise<CommentSettings> {
  return apiRequest(`/profiles/${encodeURIComponent(profileId)}/comment-settings`);
}

export function saveCommentSettings(profileId: string, input: CommentSettingsInput): Promise<CommentSettings> {
  return apiRequest(`/profiles/${encodeURIComponent(profileId)}/comment-settings`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function setYoutubeCommentSync(accountId: string, enabled: boolean): Promise<{ commentsEnabled: boolean; commentsStatus: string | null }> {
  return apiRequest(`/accounts/${encodeURIComponent(accountId)}/comment-sync`, {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
}

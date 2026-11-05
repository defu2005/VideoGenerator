import type { ThumbnailRecomposeBody, ThumbnailState } from "@vg/shared";
import { apiRequest } from "./apiClient";

export function getThumbnail(projectId: string): Promise<ThumbnailState> {
  return apiRequest<ThumbnailState>(`/projects/${projectId}/thumbnail`);
}

export function recomposeThumbnail(projectId: string, body: ThumbnailRecomposeBody): Promise<ThumbnailState> {
  return apiRequest<ThumbnailState>(`/projects/${projectId}/thumbnail/recompose`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function regenerateThumbnail(projectId: string): Promise<ThumbnailState> {
  return apiRequest<ThumbnailState>(`/projects/${projectId}/thumbnail/regenerate`, { method: "POST" });
}

export function uploadThumbnail(projectId: string, file: File): Promise<ThumbnailState> {
  return apiRequest<ThumbnailState>(`/projects/${projectId}/thumbnail/upload`, {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  });
}

export function thumbnailImageUrl(projectId: string, kind: string, cacheBust = ""): string {
  return `/api/projects/${projectId}/thumbnail/image/${encodeURIComponent(kind)}?v=${encodeURIComponent(cacheBust)}`;
}

import type { VideoMetadataDraft, VideoMetadataResponse } from "@vg/shared";
import { apiRequest } from "./apiClient";

const metadataPath = (projectId: string) => `/projects/${projectId}/metadata`;

export function getProjectMetadata(projectId: string): Promise<VideoMetadataResponse> {
  return apiRequest<VideoMetadataResponse>(metadataPath(projectId));
}

export function saveProjectMetadata(projectId: string, draft: VideoMetadataDraft): Promise<VideoMetadataResponse> {
  return apiRequest<VideoMetadataResponse>(metadataPath(projectId), {
    method: "PUT",
    body: JSON.stringify(draft),
  });
}

export function generateProjectMetadata(
  projectId: string,
  body: { overwriteEdits?: boolean } = {},
): Promise<VideoMetadataResponse & { source?: "LLM" | "CODE" }> {
  return apiRequest(metadataPath(projectId) + "/generate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

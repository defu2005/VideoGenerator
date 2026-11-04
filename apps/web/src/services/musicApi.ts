import type { MusicSettingsPatch, ProjectMusic } from "@vg/shared";
import { apiRequest } from "./apiClient";

const musicPath = (projectId: string) => `/projects/${projectId}/music`;

export function getProjectMusic(projectId: string): Promise<ProjectMusic> {
  return apiRequest<ProjectMusic>(musicPath(projectId));
}

export function searchMusic(projectId: string, query: string | null): Promise<ProjectMusic> {
  return apiRequest<ProjectMusic>(`${musicPath(projectId)}/search`, { method: "POST", body: JSON.stringify({ query }) });
}

export function selectMusic(projectId: string, candidateId: string): Promise<ProjectMusic> {
  return apiRequest<ProjectMusic>(`${musicPath(projectId)}/select`, { method: "POST", body: JSON.stringify({ candidateId }) });
}

export function selectNoMusic(projectId: string): Promise<ProjectMusic> {
  return apiRequest<ProjectMusic>(`${musicPath(projectId)}/none`, { method: "POST" });
}

export function updateMusicSettings(projectId: string, patch: MusicSettingsPatch): Promise<ProjectMusic> {
  return apiRequest<ProjectMusic>(`${musicPath(projectId)}/settings`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function uploadMusic(projectId: string, file: File): Promise<ProjectMusic> {
  const form = new FormData();
  form.append("file", file);
  return apiRequest<ProjectMusic>(`${musicPath(projectId)}/upload`, { method: "POST", body: form });
}

/** Local copies stream from the server; remote candidates preview straight from the provider. */
export function musicPreviewUrl(projectId: string, candidate: { id: string; localPath: string | null; provider: string; audioUrl: string | null }): string | null {
  if (candidate.localPath || candidate.provider === "local" || candidate.provider === "upload") {
    return `/api${musicPath(projectId)}/${candidate.id}/audio`;
  }
  return candidate.audioUrl;
}

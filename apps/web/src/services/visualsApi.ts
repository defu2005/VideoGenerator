import type { ProjectVisuals } from "@vg/shared";
import { apiRequest } from "./apiClient";

export function getProjectVisuals(projectId: string): Promise<ProjectVisuals> {
  return apiRequest<ProjectVisuals>(`/projects/${projectId}/visuals`);
}

const scenePath = (projectId: string, sceneId: string) => `/projects/${projectId}/scenes/${sceneId}/visuals`;

export function getSceneVisuals(projectId: string, sceneId: string) {
  return apiRequest<import("@vg/shared").SceneVisuals>(scenePath(projectId, sceneId));
}

export function searchSceneVisuals(projectId: string, sceneId: string, query: string) {
  return apiRequest<import("@vg/shared").SceneVisuals>(`${scenePath(projectId, sceneId)}/search`, {
    method: "POST",
    body: JSON.stringify({ query }),
  });
}

export function selectSceneVisual(projectId: string, sceneId: string, candidateId: string) {
  return apiRequest<import("@vg/shared").SceneVisuals>(`${scenePath(projectId, sceneId)}/select`, {
    method: "POST",
    body: JSON.stringify({ candidateId }),
  });
}

export function approveSceneVisual(projectId: string, sceneId: string) {
  return apiRequest<import("@vg/shared").SceneVisuals>(`${scenePath(projectId, sceneId)}/approve`, { method: "POST" });
}

export function rejectSceneVisual(projectId: string, sceneId: string) {
  return apiRequest<import("@vg/shared").SceneVisuals>(`${scenePath(projectId, sceneId)}/reject`, { method: "POST" });
}

export function removeSceneVisual(projectId: string, sceneId: string) {
  return apiRequest<import("@vg/shared").SceneVisuals>(`${scenePath(projectId, sceneId)}/remove`, { method: "POST" });
}

export function addCustomSceneVisual(projectId: string, sceneId: string, input: {
  url: string; title?: string; author?: string; license?: string;
}) {
  return apiRequest<import("@vg/shared").SceneVisuals>(`${scenePath(projectId, sceneId)}/custom-url`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function uploadSceneVisual(projectId: string, sceneId: string, file: File) {
  return apiRequest<import("@vg/shared").SceneVisuals>(`${scenePath(projectId, sceneId)}/upload`, {
    method: "POST",
    headers: { "Content-Type": file.type, "X-File-Name": file.name },
    body: file,
  });
}

export function editSceneVisualQuery(projectId: string, sceneId: string, input: {
  visualQueries?: { primary: string; alternatives: string[] }; visualDescription?: string;
}) {
  return apiRequest<import("@vg/shared").SceneVisuals>(`${scenePath(projectId, sceneId)}/query`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function approveAllSceneVisuals(projectId: string): Promise<{ approved: number; failed: { sceneId: string; reason: string; retryable: boolean }[] }> {
  return apiRequest(`/projects/${projectId}/visuals/approve-all`, { method: "POST" });
}

export function localVisualFileUrl(projectId: string, localPath: string): string {
  const fileName = localPath.split("/").at(-1) ?? "";
  return `/api/projects/${projectId}/visual-files/${encodeURIComponent(fileName)}`;
}

export function visionCheckCandidate(projectId: string, sceneId: string, candidateId: string) {
  return apiRequest<{
    candidate: import("@vg/shared").VisualCandidate;
    usage: unknown;
    estimate: { calls: number; images: number };
  }>(`${scenePath(projectId, sceneId)}/${candidateId}/vision-check`, { method: "POST" });
}

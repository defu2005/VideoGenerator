import type { ScenePatch, ScenePlanSummary } from "@vg/shared";
import { apiRequest } from "./apiClient";

const basePath = (projectId: string) => `/projects/${projectId}/scenes`;

export function getScenes(projectId: string): Promise<ScenePlanSummary> {
  return apiRequest<ScenePlanSummary>(basePath(projectId));
}

export function updateScene(projectId: string, sceneId: string, patch: ScenePatch): Promise<ScenePlanSummary> {
  return apiRequest<ScenePlanSummary>(`${basePath(projectId)}/${sceneId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function reorderScenes(projectId: string, sceneIds: string[]): Promise<ScenePlanSummary> {
  return apiRequest<ScenePlanSummary>(`${basePath(projectId)}/reorder`, {
    method: "POST",
    body: JSON.stringify({ sceneIds }),
  });
}

export function splitScene(projectId: string, sceneId: string, sentenceIndex: number): Promise<ScenePlanSummary> {
  return apiRequest<ScenePlanSummary>(`${basePath(projectId)}/${sceneId}/split`, {
    method: "POST",
    body: JSON.stringify({ sentenceIndex }),
  });
}

export function mergeScenes(projectId: string, sceneIds: [string, string]): Promise<ScenePlanSummary> {
  return apiRequest<ScenePlanSummary>(`${basePath(projectId)}/merge`, {
    method: "POST",
    body: JSON.stringify({ sceneIds }),
  });
}

export function deleteScene(projectId: string, sceneId: string): Promise<ScenePlanSummary> {
  return apiRequest<ScenePlanSummary>(`${basePath(projectId)}/${sceneId}`, { method: "DELETE" });
}

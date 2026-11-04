import type { ProjectRender } from "@vg/shared";
import { apiRequest } from "./apiClient";

export function getProjectRender(projectId: string): Promise<ProjectRender> {
  return apiRequest<ProjectRender>(`/projects/${projectId}/render`);
}

/** Direct file URLs for the player and download links; `v` makes each render a new browser cache entry. */
export function renderFileUrl(
  projectId: string,
  file: "video" | "credits" | "subtitles",
  renderId: string,
  download = false,
): string {
  return `/api/projects/${projectId}/render/${file}?v=${encodeURIComponent(renderId)}${download ? "&download=1" : ""}`;
}

export function renderThumbUrl(projectId: string, sceneId: string, renderId: string): string {
  return `/api/projects/${projectId}/render/thumbs/${sceneId}?v=${encodeURIComponent(renderId)}`;
}

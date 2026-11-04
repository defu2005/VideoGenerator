import type {
  PipelineState,
  ProjectRender,
  RenderSettings,
  RenderVariantAspect,
  RenderVariantsResult,
  RenderVersion,
  RenderVersionList,
  RenderVersionPatch,
} from "@vg/shared";
import { apiRequest } from "./apiClient";

export function getProjectRender(projectId: string): Promise<ProjectRender> {
  return apiRequest<ProjectRender>(`/projects/${projectId}/render`);
}

export function startProjectRender(projectId: string, aspectRatio?: RenderVariantAspect): Promise<PipelineState> {
  return apiRequest<PipelineState>(`/projects/${projectId}/render`, {
    method: "POST",
    body: JSON.stringify(aspectRatio ? { aspectRatio } : {}),
  });
}

export function startProjectRenderVariants(projectId: string): Promise<RenderVariantsResult> {
  return apiRequest<RenderVariantsResult>(`/projects/${projectId}/render-variants`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function listProjectRenders(projectId: string): Promise<RenderVersionList> {
  return apiRequest<RenderVersionList>(`/projects/${projectId}/renders`);
}

export function patchProjectRender(
  projectId: string,
  renderId: string,
  patch: RenderVersionPatch,
): Promise<RenderVersion> {
  return apiRequest<RenderVersion>(`/projects/${projectId}/renders/${renderId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteProjectRender(projectId: string, renderId: string): Promise<RenderVersion> {
  return apiRequest<RenderVersion>(`/projects/${projectId}/renders/${renderId}`, {
    method: "DELETE",
  });
}

export function getRenderSettings(): Promise<RenderSettings> {
  return apiRequest<RenderSettings>("/settings/render");
}

export function saveRenderSettings(settings: RenderSettings): Promise<RenderSettings> {
  return apiRequest<RenderSettings>("/settings/render", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

/** Direct file URLs for the player and download links; `v` makes each render a new browser cache entry. */
export function renderFileUrl(
  projectId: string,
  file: "video" | "credits" | "subtitles",
  renderId: string,
  download = false,
  versioned = false,
): string {
  const base = versioned
    ? `/api/projects/${projectId}/renders/${renderId}/${file}`
    : `/api/projects/${projectId}/render/${file}`;
  return `${base}?v=${encodeURIComponent(renderId)}${download ? "&download=1" : ""}`;
}

export function renderThumbUrl(projectId: string, sceneId: string, renderId: string, versioned = false): string {
  const base = versioned
    ? `/api/projects/${projectId}/renders/${renderId}/thumbs/${sceneId}`
    : `/api/projects/${projectId}/render/thumbs/${sceneId}`;
  return `${base}?v=${encodeURIComponent(renderId)}`;
}

export function renderExportUrl(projectId: string, renderId: string): string {
  return `/api/projects/${projectId}/renders/${renderId}/export`;
}

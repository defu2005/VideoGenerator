import type { EditPlan, ProjectTimeline, Timeline } from "@vg/shared";
import { apiRequest } from "./apiClient";

export function getProjectTimeline(projectId: string): Promise<ProjectTimeline> {
  return apiRequest<ProjectTimeline>(`/projects/${projectId}/timeline`);
}

export function saveEditPlan(projectId: string, plan: EditPlan): Promise<{ timeline: Timeline }> {
  return apiRequest(`/projects/${projectId}/timeline/edit`, { method: "PATCH", body: JSON.stringify(plan) });
}

export function generateEditPlan(projectId: string): Promise<{ timeline: Timeline }> {
  return apiRequest(`/projects/${projectId}/timeline/edit`, { method: "POST", body: JSON.stringify({}) });
}

export function saveGraphic(projectId: string, body: {
  id?: string;
  remove?: boolean;
  templateId: string;
  sceneId?: string | null;
  startSec: number;
  durationSec: number;
  variables: Record<string, string | number>;
}): Promise<{ timeline: Timeline }> {
  return apiRequest(`/projects/${projectId}/timeline/graphics`, { method: "PATCH", body: JSON.stringify(body) });
}

export function previewEditWindow(projectId: string, sceneId: string): Promise<{
  startSec: number;
  endSec: number;
  sceneId: string;
  graphics?: Array<{ templateId: string; startSec: number; durationSec: number }>;
}> {
  return apiRequest(`/projects/${projectId}/timeline/preview`, { method: "POST", body: JSON.stringify({ sceneId }) });
}

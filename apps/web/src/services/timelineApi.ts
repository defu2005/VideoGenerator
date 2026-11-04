import type { ProjectTimeline } from "@vg/shared";
import { apiRequest } from "./apiClient";

export function getProjectTimeline(projectId: string): Promise<ProjectTimeline> {
  return apiRequest<ProjectTimeline>(`/projects/${projectId}/timeline`);
}

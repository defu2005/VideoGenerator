import type { ProjectVisuals } from "@vg/shared";
import { apiRequest } from "./apiClient";

export function getProjectVisuals(projectId: string): Promise<ProjectVisuals> {
  return apiRequest<ProjectVisuals>(`/projects/${projectId}/visuals`);
}

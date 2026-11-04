import type { AutoReportResponse } from "@vg/shared";
import { apiRequest } from "./apiClient";

export function getAutoReport(projectId: string): Promise<AutoReportResponse> {
  return apiRequest<AutoReportResponse>(`/projects/${projectId}/auto-report`);
}

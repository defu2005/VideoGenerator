import { AppUsageSchema, ProjectUsageSchema, type AppUsage, type ProjectUsage, type UsageQuery } from "@vg/shared";
import { apiRequest } from "./apiClient";

export function getProjectUsage(projectId: string): Promise<ProjectUsage> {
  return apiRequest<unknown>(`/projects/${encodeURIComponent(projectId)}/usage`)
    .then((response) => ProjectUsageSchema.parse(response));
}

export function getUsage(query: UsageQuery): Promise<AppUsage> {
  const params = new URLSearchParams();
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  params.set("groupBy", query.groupBy);
  return apiRequest<unknown>(`/usage?${params.toString()}`)
    .then((response) => AppUsageSchema.parse(response));
}

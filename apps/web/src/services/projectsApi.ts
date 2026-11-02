import type {
  CreateProjectInput,
  Project,
  ProjectListQuery,
  ProjectListResponse,
  UpdateProjectInput,
} from "@vg/shared";
import { apiRequest } from "./apiClient";

export async function getProjects(query: ProjectListQuery): Promise<ProjectListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  return apiRequest<ProjectListResponse>(`/projects?${params.toString()}`);
}

export function getProject(id: string): Promise<Project> {
  return apiRequest<Project>(`/projects/${encodeURIComponent(id)}`);
}

export function createProject(input: CreateProjectInput): Promise<Project> {
  return apiRequest<Project>("/projects", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateProject(id: string, input: UpdateProjectInput): Promise<Project> {
  return apiRequest<Project>(`/projects/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function duplicateProject(id: string): Promise<Project> {
  return apiRequest<Project>(`/projects/${encodeURIComponent(id)}/duplicate`, { method: "POST" });
}

export function setProjectArchived(id: string, archived: boolean): Promise<Project> {
  const action = archived ? "archive" : "unarchive";
  return apiRequest<Project>(`/projects/${encodeURIComponent(id)}/${action}`, { method: "POST" });
}

export function deleteProject(id: string): Promise<void> {
  return apiRequest<void>(`/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
}

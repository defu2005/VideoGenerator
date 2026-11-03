import {
  LLM_TASKS,
  LlmProviderInfoSchema,
  LlmSettingsSchema,
  type LlmProviderInfo,
  type LlmSettings,
  type LlmTaskId,
} from "@vg/shared";
import { apiRequest } from "./apiClient";

export function getLlmProviders(): Promise<LlmProviderInfo[]> {
  return apiRequest<unknown>("/llm/providers").then((response) => {
    const parsed = LlmProviderInfoSchema.array().safeParse(response);
    if (!parsed.success) throw new Error("The server returned invalid LLM provider data");
    return parsed.data;
  });
}

export type LlmTask = (typeof LLM_TASKS)[number];
export type ResolvedLlmRoute = {
  provider: string;
  model: string;
  maxOutputTokens?: number;
  fallback?: { provider: string; model?: string };
  source: "project-task" | "project-default" | "app-task" | "app-default" | "env-task" | "env-default";
};
export type ProjectLlmRoutes = Partial<Record<LlmTaskId, ResolvedLlmRoute | null>>;

export async function getLlmTasks(): Promise<LlmTask[]> {
  const response = await apiRequest<unknown>("/llm/tasks");
  if (!Array.isArray(response)) throw new Error("The server returned invalid LLM task data");
  return response as LlmTask[];
}

export function getAppLlmRouting(): Promise<LlmSettings> {
  return apiRequest<unknown>("/settings/llm-routing").then((response) => {
    const parsed = LlmSettingsSchema.safeParse(response);
    if (!parsed.success) throw new Error("The server returned invalid LLM routing settings");
    return parsed.data;
  });
}

export function saveAppLlmRouting(settings: LlmSettings): Promise<LlmSettings> {
  return apiRequest<unknown>("/settings/llm-routing", {
    method: "PUT",
    body: JSON.stringify(settings),
  }).then((response) => {
    const parsed = LlmSettingsSchema.safeParse(response);
    if (!parsed.success) throw new Error("The server returned invalid LLM routing settings");
    return parsed.data;
  });
}

export function getProviderModels(provider: string): Promise<string[]> {
  return apiRequest<{ provider: string; models: string[] }>(`/llm/providers/${encodeURIComponent(provider)}/models`)
    .then(({ models }) => models);
}

export function getProjectLlmRoutes(projectId: string): Promise<ProjectLlmRoutes> {
  return apiRequest<{ routes: ProjectLlmRoutes }>(`/projects/${encodeURIComponent(projectId)}/llm-routes`)
    .then(({ routes }) => routes);
}

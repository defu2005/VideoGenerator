import {
  LLM_TASKS,
  LlmGatewaySettingsSchema,
  LlmProviderInfoSchema,
  LlmQuotaStatusSchema,
  LlmSettingsSchema,
  ModelAdvisorApplyBodySchema,
  ModelAdvisorApplyResultSchema,
  ModelAdvisorProposeBodySchema,
  ModelAdvisorProposalSchema,
  OmniRouteCatalogSchema,
  OmniRouteHealthSchema,
  type LlmGatewaySettings,
  type LlmProviderInfo,
  type LlmQuotaPolicyBody,
  type LlmQuotaRule,
  type LlmQuotaStatus,
  type LlmSettings,
  type LlmTaskId,
  type ModelAdvisorApplyBody,
  type ModelAdvisorApplyResult,
  type ModelAdvisorProposeBody,
  type ModelAdvisorProposal,
  type OmniRouteCatalog,
  type OmniRouteHealth,
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

export function getLlmQuotaStatus(): Promise<LlmQuotaStatus> {
  return apiRequest<unknown>("/llm/quota").then((response) => {
    const parsed = LlmQuotaStatusSchema.safeParse(response);
    if (!parsed.success) throw new Error("Máy chủ trả về quota LLM không hợp lệ");
    return parsed.data;
  });
}

export function saveLlmQuotaPolicy(body: LlmQuotaPolicyBody): Promise<LlmQuotaStatus> {
  return apiRequest<unknown>("/llm/quota/policy", {
    method: "PUT",
    body: JSON.stringify(body),
  }).then((response) => {
    const parsed = LlmQuotaStatusSchema.safeParse(response);
    if (!parsed.success) throw new Error("Máy chủ trả về quota LLM không hợp lệ");
    return parsed.data;
  });
}

export function saveLlmQuotaRule(rule: LlmQuotaRule): Promise<LlmQuotaStatus> {
  return apiRequest<unknown>("/llm/quota/rules", {
    method: "PUT",
    body: JSON.stringify(rule),
  }).then((response) => {
    const parsed = LlmQuotaStatusSchema.safeParse(response);
    if (!parsed.success) throw new Error("Máy chủ trả về quota LLM không hợp lệ");
    return parsed.data;
  });
}

export function setLlmQuotaRuleEnabled(provider: string, model: string, enabled: boolean): Promise<LlmQuotaStatus> {
  return apiRequest<unknown>("/llm/quota/rules/enabled", {
    method: "POST",
    body: JSON.stringify({ provider, model, enabled }),
  }).then((response) => {
    const parsed = LlmQuotaStatusSchema.safeParse(response);
    if (!parsed.success) throw new Error("Máy chủ trả về quota LLM không hợp lệ");
    return parsed.data;
  });
}

export function clearLlmCooldown(provider: string, model: string): Promise<LlmQuotaStatus> {
  return apiRequest<unknown>("/llm/quota/cooldowns/clear", {
    method: "POST",
    body: JSON.stringify({ provider, model }),
  }).then((response) => {
    const parsed = LlmQuotaStatusSchema.safeParse(response);
    if (!parsed.success) throw new Error("Máy chủ trả về quota LLM không hợp lệ");
    return parsed.data;
  });
}

export function getLlmGatewaySettings(): Promise<LlmGatewaySettings> {
  return apiRequest<unknown>("/settings/llm-gateway").then((response) => {
    const parsed = LlmGatewaySettingsSchema.safeParse(response);
    if (!parsed.success) throw new Error("Máy chủ trả về cài đặt gateway không hợp lệ");
    return parsed.data;
  });
}

export function saveLlmGatewaySettings(settings: LlmGatewaySettings): Promise<LlmGatewaySettings> {
  return apiRequest<unknown>("/settings/llm-gateway", {
    method: "PUT",
    body: JSON.stringify(settings),
  }).then((response) => {
    const parsed = LlmGatewaySettingsSchema.safeParse(response);
    if (!parsed.success) throw new Error("Máy chủ trả về cài đặt gateway không hợp lệ");
    return parsed.data;
  });
}

export function getOmnirouteHealth(): Promise<OmniRouteHealth> {
  return apiRequest<unknown>("/llm/providers/omniroute/health").then((response) => {
    const parsed = OmniRouteHealthSchema.safeParse(response);
    if (!parsed.success) throw new Error("Máy chủ trả về trạng thái OmniRoute không hợp lệ");
    return parsed.data;
  });
}

export function getOmnirouteCatalog(): Promise<OmniRouteCatalog> {
  return apiRequest<unknown>("/llm/providers/omniroute/catalog").then((response) => {
    const parsed = OmniRouteCatalogSchema.safeParse(response);
    if (!parsed.success) throw new Error("Máy chủ trả về catalog OmniRoute không hợp lệ");
    return parsed.data;
  });
}

export function refreshOmnirouteCatalog(): Promise<OmniRouteCatalog> {
  return apiRequest<unknown>("/llm/providers/omniroute/catalog/refresh", { method: "POST" }).then((response) => {
    const parsed = OmniRouteCatalogSchema.safeParse(response);
    if (!parsed.success) throw new Error("Máy chủ trả về catalog OmniRoute không hợp lệ");
    return parsed.data;
  });
}

export function proposeLlmAdvisor(body: ModelAdvisorProposeBody): Promise<ModelAdvisorProposal> {
  const payload = ModelAdvisorProposeBodySchema.parse(body);
  return apiRequest<unknown>("/llm/advisor/propose", {
    method: "POST",
    body: JSON.stringify(payload),
  }).then((response) => {
    const parsed = ModelAdvisorProposalSchema.safeParse(response);
    if (!parsed.success) throw new Error("Máy chủ trả về đề xuất model không hợp lệ");
    return parsed.data;
  });
}

export function applyLlmAdvisor(body: ModelAdvisorApplyBody): Promise<ModelAdvisorApplyResult> {
  const payload = ModelAdvisorApplyBodySchema.parse(body);
  return apiRequest<unknown>("/llm/advisor/apply", {
    method: "POST",
    body: JSON.stringify(payload),
  }).then((response) => {
    const parsed = ModelAdvisorApplyResultSchema.safeParse(response);
    if (!parsed.success) throw new Error("Máy chủ trả về kết quả áp dụng không hợp lệ");
    return parsed.data;
  });
}

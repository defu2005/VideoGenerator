import type {
  GuidelineFindingsResponse,
  GuidelinePack,
  GuidelinePacksResponse,
  GuidelineProfiles,
  GuidelineSettingsInput,
} from "@vg/shared";
import { apiRequest } from "./apiClient";

export function getGuidelinePacks(): Promise<GuidelinePacksResponse> {
  return apiRequest("/guidelines/packs");
}

export function saveGuidelinePacks(packs: GuidelinePack[]): Promise<GuidelinePacksResponse> {
  return apiRequest("/guidelines/packs", { method: "PUT", body: JSON.stringify({ packs }) });
}

export function getGuidelineProfiles(): Promise<GuidelineProfiles> {
  return apiRequest("/guidelines/profiles");
}

export function saveGuidelineProfiles(profiles: GuidelineProfiles): Promise<GuidelineProfiles> {
  return apiRequest("/guidelines/profiles", { method: "PUT", body: JSON.stringify(profiles) });
}

export function getGuidelineFindings(projectId: string): Promise<GuidelineFindingsResponse> {
  return apiRequest(`/projects/${encodeURIComponent(projectId)}/guidelines/findings`);
}

export function dismissGuidelineFinding(projectId: string, findingId: string, reason?: string): Promise<GuidelineFindingsResponse> {
  return apiRequest(`/projects/${encodeURIComponent(projectId)}/guidelines/findings/${encodeURIComponent(findingId)}/dismiss`, {
    method: "POST",
    body: JSON.stringify(reason ? { reason } : {}),
  });
}

export function recheckGuidelines(projectId: string): Promise<GuidelineFindingsResponse> {
  return apiRequest(`/projects/${encodeURIComponent(projectId)}/guidelines/check`, { method: "POST" });
}

export type { GuidelineSettingsInput };

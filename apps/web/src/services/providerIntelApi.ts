import { apiRequest } from "./apiClient";

export type ProviderCard = {
  id: string;
  name: string;
  website: string;
  needsResearch: boolean;
  score: number | null;
  riskLevel: string;
  flags: string[];
  autoConfigAllowed: boolean;
  vietnam: boolean;
  cardRequired: boolean;
  legitimacy?: string;
  bestOffer?: string;
  safestVi?: string;
};

export type ProviderIntelPageData = {
  overview: Array<{ id: string; questionVi: string; answerVi: string }>;
  providers: ProviderCard[];
  connections: {
    needsToken: boolean;
    stepsVi: string | null;
    connections: Array<{ id: string; label: string; provider: string; states: string[]; credentialPresent: boolean }>;
  } | null;
  offers: { active: Array<{ id: string; providerId: string; kind: string; status: string }>; expired: unknown[]; expiring: unknown[] };
  billing: Array<{ providerId: string; name: string; riskLevel: string; unverified: boolean; flags: string[]; autoConfigAllowed: boolean; safestVi?: string }>;
  changes: Array<{ id: string; providerId: string; what: string; oldSummary: string; newSummary: string; needsReview: boolean }>;
  profiles: Array<{ id: string; titleVi: string }>;
  proposals: Array<{ id: string; profileId: string; diffVi: string; modelIds: string[] }>;
  feeds: Array<{ url: string; label: string }>;
  suites: Array<{ id: string; titleVi: string; cases: number; taskId?: string }>;
  tasks?: Array<{ id: string; label: string }>;
  scorecard?: { ranked: Array<{ modelId: string; score: number; confidence: string; reasonVi: string }>; excluded: unknown[] };
  needsTokenStepsVi: string;
};

export function getProviderIntelPage(): Promise<ProviderIntelPageData> {
  return apiRequest<ProviderIntelPageData>("/provider-intel/page");
}

export function saveProviderChecklist(id: string, path: string, value: boolean): Promise<unknown> {
  return apiRequest(`/provider-intel/providers/${id}/checklist`, {
    method: "POST",
    body: JSON.stringify({ path, value }),
  });
}

export function applyRoutingProposal(proposalId: string): Promise<unknown> {
  return apiRequest("/provider-intel/routing/apply", {
    method: "POST",
    body: JSON.stringify({ proposalId }),
  });
}

export function updateOmnirouteCombos(profiles: Array<{ id: string; models: string[] }>): Promise<unknown> {
  return apiRequest("/provider-intel/omniroute/update", {
    method: "POST",
    body: JSON.stringify({ profiles }),
  });
}

export function markIntelChangeReviewed(id: string): Promise<unknown> {
  return apiRequest(`/provider-intel/changes/${id}/reviewed`, { method: "POST", body: "{}" });
}

export function rerunProviderAudit(): Promise<unknown> {
  return apiRequest("/provider-intel/audit", { method: "POST", body: "{}" });
}

export function saveProviderFeeds(feeds: Array<{ url: string; label: string }>): Promise<unknown> {
  return apiRequest("/provider-intel/feeds", { method: "PUT", body: JSON.stringify({ feeds }) });
}

type EvalModelRef = { provider: string; model: string };
type EvalMetrics = EvalModelRef & {
  cases: number;
  quality: number;
  schemaErrorRate: number;
  averageLatencyMs: number;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
};

export function compareProviderModels(input: {
  suiteId: string;
  baseline: EvalModelRef;
  candidate: EvalModelRef;
}): Promise<{
  runId: string;
  stopped: boolean;
  recommendation: "candidate_eligible" | "keep_baseline";
  baseline: EvalMetrics;
  candidate: EvalMetrics;
}> {
  return apiRequest("/provider-intel/eval/compare", { method: "POST", body: JSON.stringify(input) });
}

import { callTargetsOmniProvider } from "../llmQuota/live.js";

export type SwapCandidate = {
  provider: string;
  model: string;
  family?: string;
  tier?: number;
  price?: number;
  paid?: boolean;
  vision?: boolean;
  tools?: boolean;
  json?: boolean;
  healthy?: boolean;
  quotaBlocked?: boolean;
  retryAt?: string;
};

export type SwapRequest = {
  provider: string;
  model: string;
  taskNeedsVision?: boolean;
  budgetMode?: "ECO" | "BALANCED" | "QUALITY";
  pinnedPaid?: boolean;
  family?: string;
  tier?: number;
};

/** Pick a stand-in for this call only. Never returns the blocked route itself. */
export function findEquivalentModel(request: SwapRequest, candidates: SwapCandidate[], now = Date.now()): SwapCandidate | null {
  const open = candidates.filter((item) => {
    if (item.provider === request.provider && item.model === request.model) return false;
    if (item.quotaBlocked) return false;
    if (item.retryAt && Date.parse(item.retryAt) > now) return false;
    if (request.taskNeedsVision && item.vision !== true) return false;
    if (request.budgetMode === "ECO" && item.paid && !request.pinnedPaid) return false;
    if ((item.tier ?? 0) < (request.tier ?? 0)) return false;
    return item.healthy !== false;
  });
  open.sort((a, b) => {
    const family = Number(b.family === request.family) - Number(a.family === request.family);
    if (family) return family;
    const tier = (b.tier ?? 0) - (a.tier ?? 0);
    if (tier) return tier;
    const price = (a.price ?? 0) - (b.price ?? 0);
    if (price) return price;
    return Number(b.healthy !== false) - Number(a.healthy !== false);
  });
  return open[0] ?? null;
}

export function quotaBlocksCandidate(provider: string, model: string, blockedProvider: string): boolean {
  return callTargetsOmniProvider(provider, model, blockedProvider);
}

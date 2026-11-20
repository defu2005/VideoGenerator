import type { AppConfig } from "../../lib/config.js";
import { getCachedOmniroutePricing } from "./omnirouteCatalog.js";
import { LlmError } from "./types.js";

export type ModelPrice = { inputPerMTok: number; outputPerMTok: number };

export function getLlmPrice(
  config: Pick<AppConfig, "LLM_PRICES_JSON">,
  provider: string,
  model: string,
): ModelPrice | undefined {
  if (provider === "claude-cli" || provider === "copilot-cli" || provider === "antigravity-cli") return { inputPerMTok: 0, outputPerMTok: 0 };
  if (provider === "omniroute") {
    const catalogPrice = getCachedOmniroutePricing(model);
    if (catalogPrice) {
      return catalogPrice;
    }
  }
  if (!config.LLM_PRICES_JSON) return undefined;
  let prices: Record<string, ModelPrice>;
  try {
    const parsed: unknown = JSON.parse(config.LLM_PRICES_JSON);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new LlmError("LLM_PRICES_JSON must be a JSON object", "LLM_BAD_REQUEST", false);
    }
    prices = parsed as Record<string, ModelPrice>;
  } catch (error) {
    if (error instanceof LlmError) throw error;
    throw new LlmError("LLM_PRICES_JSON is invalid JSON", "LLM_BAD_REQUEST", false);
  }
  const price = prices[`${provider}:${model}`];
  if (!price) return undefined;
  if (!Number.isFinite(price.inputPerMTok) || !Number.isFinite(price.outputPerMTok)
    || price.inputPerMTok < 0 || price.outputPerMTok < 0) {
    throw new LlmError(`Invalid LLM price entry for ${provider}:${model}`, "LLM_BAD_REQUEST", false);
  }
  return price;
}

export function estimateLlmCost(
  config: Pick<AppConfig, "LLM_PRICES_JSON">,
  provider: string,
  model: string,
  usage: { inputTokens: number; outputTokens: number },
): number {
  const price = getLlmPrice(config, provider, model);
  if (!price) return 0;
  return usage.inputTokens * price.inputPerMTok / 1_000_000
    + usage.outputTokens * price.outputPerMTok / 1_000_000;
}

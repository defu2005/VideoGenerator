import type { AppConfig } from "../../lib/config.js";
import { LlmError } from "./types.js";

type ModelPrice = { inputPerMTok: number; outputPerMTok: number };

export function estimateLlmCost(
  config: Pick<AppConfig, "LLM_PRICES_JSON">,
  provider: string,
  model: string,
  usage: { inputTokens: number; outputTokens: number },
): number {
  if (provider === "claude-cli" || provider === "copilot-cli") return 0;
  if (!config.LLM_PRICES_JSON) return 0;
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
  if (!price) return 0;
  if (!Number.isFinite(price.inputPerMTok) || !Number.isFinite(price.outputPerMTok)
    || price.inputPerMTok < 0 || price.outputPerMTok < 0) {
    throw new LlmError(`Invalid LLM price entry for ${provider}:${model}`, "LLM_BAD_REQUEST", false);
  }
  return usage.inputTokens * price.inputPerMTok / 1_000_000
    + usage.outputTokens * price.outputPerMTok / 1_000_000;
}

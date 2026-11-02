import { describe, expect, it } from "vitest";
import { estimateLlmCost } from "../src/providers/llm/pricing.js";

describe("LLM subscription provider pricing", () => {
  it("always reports zero cost for subscription-backed CLI providers", () => {
    const config = { LLM_PRICES_JSON: "not-json" };
    const usage = { inputTokens: 10_000, outputTokens: 5_000 };
    expect(estimateLlmCost(config, "claude-cli", "sonnet", usage)).toBe(0);
    expect(estimateLlmCost(config, "copilot-cli", "auto", usage)).toBe(0);
  });
});

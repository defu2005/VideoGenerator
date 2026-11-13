import { describe, expect, it } from "vitest";
import {
  LITELLM_CAPABILITIES,
  findEquivalentModel,
  probeSawImage,
  resolveCapability,
  webhookRetryDelayMs,
  webhookUrlAllowed,
} from "../src/index.js";

describe("TASK-060 model swap and capabilities", () => {
  it("keeps vision on a vision model and refuses a paid ECO swap", () => {
    const candidates = [
      { provider: "gemini", model: "text-only", vision: false, tier: 2, healthy: true },
      { provider: "gemini", model: "sees", vision: true, tier: 2, healthy: true, paid: false, family: "gemini" },
      { provider: "openai", model: "paid-vision", vision: true, tier: 3, paid: true, price: 9 },
    ];
    expect(findEquivalentModel({
      provider: "omniroute", model: "blocked", taskNeedsVision: true, family: "gemini", tier: 1, budgetMode: "ECO",
    }, candidates)?.model).toBe("sees");
    expect(findEquivalentModel({
      provider: "omniroute", model: "blocked", budgetMode: "ECO", tier: 1,
    }, [{ provider: "openai", model: "paid", paid: true, tier: 2 }])).toBeNull();
  });

  it("prefers another provider of the same model and keeps the wait when nothing qualifies", () => {
    const same = findEquivalentModel(
      { provider: "grok-cli", model: "grok-4", tier: 2, family: "grok" },
      [
        { provider: "openrouter", model: "grok-4", family: "grok", tier: 2, price: 0 },
        { provider: "other", model: "bigger", family: "other", tier: 3, price: 1 },
      ],
    );
    expect(same?.provider).toBe("openrouter");
    expect(findEquivalentModel(
      { provider: "grok-cli", model: "grok-4" },
      [{ provider: "grok-cli", model: "grok-4", retryAt: "2999-01-01T00:00:00.000Z" }],
    )).toBeNull();
  });

  it("resolves capability from the override before the catalog", () => {
    expect(resolveCapability({
      modelId: "custom",
      override: { vision: false },
      omniroute: { vision: true },
    })).toMatchObject({ vision: false, source: "override" });
    expect(probeSawImage("yes, there is an image")).toBe(true);
    expect(probeSawImage("no")).toBe(false);
    const mixed = resolveCapability({
      modelId: "gemini-2.5-flash",
      omniroute: {},
      litellm: LITELLM_CAPABILITIES["gemini-2.5-flash"],
      probe: { vision: false },
    });
    expect(mixed.sources.vision).toBe("litellm");
    expect(mixed.vision).toBe(true);
    expect(resolveCapability({
      modelId: "custom-text",
      omniroute: { tools: true },
      litellm: { vision: true, contextTokens: 8000 },
    }).sources).toMatchObject({ tools: "omniroute", vision: "litellm", contextTokens: "litellm" });
  });
});

describe("TASK-060 webhooks", () => {
  it("schedules retries and refuses a private address", () => {
    expect(webhookRetryDelayMs(0)).toBe(5_000);
    expect(webhookRetryDelayMs(5)).toBe(10 * 3_600_000);
    expect(webhookRetryDelayMs(6)).toBeNull();
    expect(webhookUrlAllowed("https://10.0.0.1/hook")).toBe(false);
    expect(webhookUrlAllowed("https://10.0.0.1/hook", true)).toBe(true);
    expect(webhookUrlAllowed("http://127.0.0.1:9/hook")).toBe(true);
    expect(webhookUrlAllowed("http://example.com/hook")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  LLM_TASKS,
  LlmGatewaySettingsSchema,
  LlmRouteSchema,
  LlmSettingsInputSchema,
  LlmSettingsSchema,
  ModelAdvisorOutputSchema,
  ModelAdvisorProposalSchema,
  OmniRouteHealthSchema,
  OmniRouteModelInfoSchema,
  ProfileLlmSettingsSchema,
} from "../src/index.js";

describe("LLM routing schemas", () => {
  it("maps legacy provider selections into task routes without losing explicit new routes", () => {
    const parsed = LlmSettingsSchema.parse({
      default: { provider: "mock", model: "default-model" },
      research: { provider: "anthropic", model: "research-model" },
      script: { provider: "openai", model: "script-model" },
      sceneplan: { provider: "ollama", model: "scene-model" },
      tasks: { script: { provider: "gemini", model: "explicit-script-model" } },
    });

    expect(parsed).toEqual({
      default: { provider: "mock", model: "default-model" },
      tasks: {
        research: { provider: "anthropic", model: "research-model" },
        script: { provider: "gemini", model: "explicit-script-model" },
        scriptReview: { provider: "openai", model: "script-model" },
        sceneQueries: { provider: "ollama", model: "scene-model" },
        visualAltQueries: { provider: "ollama", model: "scene-model" },
        visualRerank: { provider: "ollama", model: "scene-model" },
        reviewChat: { provider: "gemini", model: "explicit-script-model" },
      },
    });
  });

  it("accepts partial task routes, nullable project reset markers, and unknown model identifiers", () => {
    expect(LlmSettingsSchema.parse({ tasks: { metadata: { provider: "custom", model: "future-model" } } }))
      .toEqual({ tasks: { metadata: { provider: "custom", model: "future-model" } } });
    expect(LlmSettingsInputSchema.parse({ tasks: { script: null } })).toEqual({ tasks: { script: null } });
    expect(LlmRouteSchema.safeParse({ provider: "mock", maxOutputTokens: 255 }).success).toBe(false);
    expect(LlmRouteSchema.safeParse({ provider: "mock", maxOutputTokens: 32_001 }).success).toBe(false);
  });

  it("catalogs the task tiers and budget feature controls", () => {
    expect(LLM_TASKS).toHaveLength(24);
    expect(LLM_TASKS.find((task) => task.id === "research")).toMatchObject({ stage: "RESEARCH", tier: "strong", qualityWeight: 3 });
    expect(LLM_TASKS.find((task) => task.id === "sceneQueries")).toMatchObject({
      stage: "SCENE_PLAN",
      tier: "fast",
      qualityWeight: 2,
      budgetFeature: "sceneQueryAssist",
    });
    expect(LLM_TASKS.find((task) => task.id === "reviewChat")).toMatchObject({
      stage: "FINAL_APPROVAL",
      tier: "strong",
      qualityWeight: 2,
    });
    expect(LLM_TASKS.find((task) => task.id === "reviewChat")?.budgetFeature).toBeUndefined();
    expect(LLM_TASKS.find((task) => task.id === "webImageGrounding")).toMatchObject({
      stage: "VISUAL_SEARCH",
      tier: "fast",
      budgetFeature: "webImageSearch",
    });
    expect(LLM_TASKS.find((task) => task.id === "modelAdvisor")).toMatchObject({
      stage: "SETTINGS",
      qualityWeight: 1,
      budgetFeature: "modelAdvisor",
    });
    expect(LLM_TASKS.find((task) => task.id === "topicSuggest")).toMatchObject({
      stage: "SETTINGS",
      qualityWeight: 1,
      budgetFeature: "topicSuggest",
    });
    expect(LLM_TASKS.find((task) => task.id === "assistantChat")).toMatchObject({
      stage: "SETTINGS",
      tier: "fast",
      budgetFeature: "assistantChat",
    });
    expect(LLM_TASKS.find((task) => task.id === "financeInsight")).toMatchObject({
      stage: "SETTINGS",
      tier: "fast",
      budgetFeature: "financeInsight",
    });
    expect(LLM_TASKS.find((task) => task.id === "thumbnailPick")).toMatchObject({
      stage: "RENDER",
      tier: "fast",
      needsVision: true,
      budgetFeature: "thumbnailPick",
    });
    expect(LLM_TASKS.find((task) => task.id === "performanceInsight")).toMatchObject({
      stage: "SETTINGS",
      tier: "strong",
      budgetFeature: "performanceInsight",
    });
    expect(LLM_TASKS.find((task) => task.id === "clipPick")).toMatchObject({
      stage: "RENDER",
      tier: "strong",
      budgetFeature: "clipPick",
    });
    expect(LLM_TASKS.find((task) => task.id === "commentAssist")).toMatchObject({
      stage: "SETTINGS",
      tier: "fast",
      budgetFeature: "commentAssist",
    });
    expect(LLM_TASKS.find((task) => task.id === "visionCheck")?.needsVision).toBe(true);
    expect(LLM_TASKS.find((task) => task.id === "script")?.qualityWeight).toBe(3);
    expect(LLM_TASKS.find((task) => task.id === "musicAssist")?.qualityWeight).toBe(1);
  });

  it("defaults reviewChat to the script route when unset", () => {
    expect(LlmSettingsSchema.parse({
      tasks: { script: { provider: "mock", model: "script-model" } },
    })).toEqual({
      tasks: {
        script: { provider: "mock", model: "script-model" },
        reviewChat: { provider: "mock", model: "script-model" },
      },
    });
  });

  it("parses model advisor output/proposal and profile autoModel settings", () => {
    expect(ModelAdvisorOutputSchema.parse({
      routes: { script: { provider: "mock", model: "mock-v1", reason: "Nhanh và đủ." } },
      notes: "ok",
    }).routes.script?.model).toBe("mock-v1");
    expect(ModelAdvisorProposalSchema.parse({
      proposalId: "p1",
      scope: "app",
      budgetMode: "ECO",
      language: "vi",
      routes: { musicAssist: { provider: "mock", model: "mock-v1", reason: "Rẻ." } },
      notes: "",
      diff: [{
        taskId: "musicAssist",
        current: null,
        proposed: { provider: "mock", model: "mock-v1", reason: "Rẻ." },
        changed: true,
      }],
      cached: false,
      createdAt: "2026-11-04T00:00:00.000Z",
    }).proposalId).toBe("p1");
    expect(ProfileLlmSettingsSchema.parse({})).toEqual({ autoModel: true });
    expect(ProfileLlmSettingsSchema.parse({
      autoModel: false,
      tasks: { script: { provider: "mock", model: "m" } },
    }).autoModel).toBe(false);
  });

  it("parses OmniRoute gateway settings, catalog models, and health payloads", () => {
    expect(LlmGatewaySettingsSchema.parse({})).toEqual({ mode: "off", mappings: [] });
    expect(LlmGatewaySettingsSchema.parse({
      mode: "prefer",
      mappings: [{ provider: "anthropic", model: "claude-sonnet-5-5", omnirouteModel: "cc/claude-sonnet" }],
    })).toMatchObject({ mode: "prefer", mappings: [{ omnirouteModel: "cc/claude-sonnet" }] });
    expect(LlmGatewaySettingsSchema.safeParse({ mode: "always" }).success).toBe(false);

    expect(OmniRouteModelInfoSchema.parse({
      id: "cc/claude-sonnet",
      ownedBy: "omniroute",
      contextWindow: 200_000,
      vision: true,
      pricing: { inputPerMTok: 3, outputPerMTok: 15 },
    })).toEqual({
      id: "cc/claude-sonnet",
      ownedBy: "omniroute",
      contextWindow: 200_000,
      vision: true,
      pricing: { inputPerMTok: 3, outputPerMTok: 15 },
    });
    expect(OmniRouteModelInfoSchema.safeParse({
      id: "x",
      ownedBy: "omniroute",
      unknownField: true,
    }).success).toBe(false);

    expect(OmniRouteHealthSchema.parse({
      reachable: false,
      latencyMs: null,
      modelCount: 0,
      lastError: "fetch failed",
      baseUrl: "http://127.0.0.1:20128/v1",
      configured: false,
      setupHint: "hint",
    }).reachable).toBe(false);
  });
});

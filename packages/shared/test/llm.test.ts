import { describe, expect, it } from "vitest";
import {
  LLM_TASKS,
  LlmRouteSchema,
  LlmSettingsInputSchema,
  LlmSettingsSchema,
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
    expect(LLM_TASKS).toHaveLength(16);
    expect(LLM_TASKS.find((task) => task.id === "research")).toMatchObject({ stage: "RESEARCH", tier: "strong" });
    expect(LLM_TASKS.find((task) => task.id === "sceneQueries")).toMatchObject({
      stage: "SCENE_PLAN",
      tier: "fast",
      budgetFeature: "sceneQueryAssist",
    });
    expect(LLM_TASKS.find((task) => task.id === "reviewChat")).toMatchObject({
      stage: "FINAL_APPROVAL",
      tier: "strong",
    });
    expect(LLM_TASKS.find((task) => task.id === "reviewChat")?.budgetFeature).toBeUndefined();
    expect(LLM_TASKS.find((task) => task.id === "webImageGrounding")).toMatchObject({
      stage: "VISUAL_SEARCH",
      tier: "fast",
      budgetFeature: "webImageSearch",
    });
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
});

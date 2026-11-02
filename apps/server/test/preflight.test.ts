import { ProjectSchema, ResearchNotesSchema } from "@vg/shared";
import { describe, expect, it } from "vitest";
import { preflight } from "../src/providers/llm/preflight.js";
import { estimateTokens } from "../src/providers/llm/tokenEstimate.js";
import type { LlmProvider } from "../src/providers/llm/types.js";

const timestamp = "2026-11-03T00:00:00.000Z";
const project = ProjectSchema.parse({
  id: "8b5a7792-cd2c-4230-bfff-9590b6de6ba4",
  title: "Test video",
  description: "",
  topic: "Một chủ đề thử nghiệm",
  mode: "ASSISTED",
  settings: { language: "vi", targetDurationSec: 120, aspectRatio: "16:9", stageExecutors: {} },
  status: "DRAFT",
  stage: "TOPIC",
  thumbnailPath: null,
  durationSec: null,
  version: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
  archivedAt: null,
});

function limitedProvider(maxOutputTokens = 5_000): LlmProvider {
  return {
    id: "mock",
    label: "Mock (development)",
    defaultModel: "test-model",
    limits: { maxInputTokens: 8_000, maxOutputTokens },
    async generate() { throw new Error("Not invoked"); },
  };
}

function forDuration(targetDurationSec: number) {
  return {
    ...project,
    settings: { ...project.settings, targetDurationSec },
  };
}

describe("LLM preflight", () => {
  it("uses a cheap conservative estimator for English, Vietnamese, and JSON", () => {
    expect(estimateTokens("a".repeat(12))).toBe(3);
    expect(estimateTokens("ă".repeat(12))).toBe(4);
    expect(estimateTokens("ă".repeat(12), true)).toBe(5);
  });

  it("keeps a short Vietnamese video merged, switches a medium one, and rejects an oversized script", () => {
    const make = (targetDurationSec: number) => preflight({
      provider: limitedProvider(),
      mode: "merged",
      project: forDuration(targetDurationSec),
      wordsPerMinute: 150,
      maxOutputTokens: 5_000,
      input: { system: "system", prompt: "prompt" },
    });

    expect(make(120)).toMatchObject({ decision: "proceed", mode: "merged" });
    expect(make(600)).toMatchObject({
      decision: "switch-to-separate",
      mode: "separate",
      message: expect.stringContaining("using 2 calls"),
    });
    expect(make(1800)).toMatchObject({
      decision: "reject",
      error: { code: "LLM_LIMIT_TOO_SMALL", retryable: false },
    });
  });

  it("trims excess research facts and timeline before rejecting oversized input", () => {
    const research = ResearchNotesSchema.parse({
      summary: "Research summary",
      keyFacts: Array.from({ length: 12 }, (_, index) => ({
        fact: `Fact ${index + 1} ${"detail ".repeat(40)}`,
        confidence: "medium",
        sourceHint: null,
      })),
      timeline: Array.from({ length: 10 }, (_, index) => ({
        date: `${index}`,
        event: `Event ${index} ${"detail ".repeat(40)}`,
      })),
      angles: ["Angle"],
      outline: [
        { section: "A", purpose: "A", points: [] },
        { section: "B", purpose: "B", points: [] },
        { section: "C", purpose: "C", points: [] },
      ],
      cautions: [],
    });
    const trimmed = {
      ...research,
      keyFacts: research.keyFacts.slice(0, 8),
      timeline: research.timeline.slice(0, 6),
    };
    const build = (notes: typeof research) => ({
      system: "system",
      prompt: JSON.stringify(notes),
    });
    const maxInputTokens = estimateTokens(`system\n${JSON.stringify(trimmed)}`, true);
    const result = preflight({
      provider: {
        ...limitedProvider(),
        limits: { maxInputTokens, maxOutputTokens: 5_000 },
      },
      mode: "off",
      project,
      wordsPerMinute: 150,
      maxOutputTokens: 2_000,
      input: build(research),
      research,
      rebuildInput: build,
    });
    expect(result).toMatchObject({
      decision: "proceed",
      research: { keyFacts: { length: 8 }, timeline: { length: 6 } },
    });
  });

  it("does not apply limits to providers that declare none", () => {
    const provider = limitedProvider();
    delete provider.limits;
    expect(preflight({
      provider,
      mode: "merged",
      project: forDuration(1800),
      wordsPerMinute: 150,
      maxOutputTokens: 123,
      input: { system: "s", prompt: "p".repeat(100_000) },
    })).toMatchObject({ decision: "proceed", maxOutputTokens: 123 });
  });
});

import { describe, expect, it } from "vitest";
import { RANK_WEIGHTS, scoreCandidate, rankCandidates } from "../src/index.js";

const candidate = {
  title: "Café Sunrise",
  description: "A wide landscape photo of a city",
  tags: ["city", "morning"],
  width: 1920,
  height: 1080,
  aspectRatio: 16 / 9,
  fileType: "jpg",
  watermark: "NONE" as const,
  license: { kind: "CC0" as const },
  provider: "wikimedia",
  providerItemId: "a",
  providerPosition: 1,
};

describe("visual ranking", () => {
  it("uses the specified component weights that sum to one", () => {
    expect(Object.values(RANK_WEIGHTS).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1);
    expect(scoreCandidate(candidate, {
      queryTerms: "cafe",
      sceneTerms: "city",
      targetAspect: 16 / 9,
    }).score).toBe(1);
  });

  it("scores resolution, aspect, license, watermark and file type independently", () => {
    const result = scoreCandidate({
      ...candidate,
      width: 320,
      height: 320,
      fileType: "svg",
      watermark: "SUSPECTED",
      license: { kind: "UNKNOWN" },
      sourceSite: "Getty Images",
    }, { queryTerms: "", sceneTerms: "", targetAspect: 16 / 9 });
    expect(result.breakdown).toMatchObject({
      keyword: 0,
      resolution: 0,
      aspect: expect.any(Number),
      license: 0,
      watermark: 0,
      fileType: 0.3,
    });
  });

  it("normalizes diacritics and sorts ties deterministically by provider order then item ID", () => {
    const ranked = rankCandidates([
      { ...candidate, provider: "openverse", providerItemId: "z", title: "Cafe Sunrise" },
      { ...candidate, provider: "wikimedia", providerItemId: "b" },
      { ...candidate, provider: "wikimedia", providerItemId: "a" },
    ], { queryTerms: "café", sceneTerms: "", targetAspect: 16 / 9, providerOrder: ["wikimedia", "openverse"] });
    expect(ranked.map((item) => item.providerItemId)).toEqual(["a", "b", "z"]);
    expect(ranked[0].relevanceScore).toBeGreaterThan(0);
  });

  it("places candidates with keyword matches ahead of higher-scoring irrelevant candidates", () => {
    const ranked = rankCandidates([
      { ...candidate, providerItemId: "irrelevant", title: "Dinosaur Adventure", tags: [], providerPosition: 1 },
      { ...candidate, providerItemId: "relevant", title: "Lee Sedol AlphaGo match", tags: [], providerPosition: 0.4 },
    ], { queryTerms: "Lee Sedol AlphaGo", sceneTerms: "", targetAspect: 16 / 9 });
    expect(ranked.map((item) => item.providerItemId)).toEqual(["relevant", "irrelevant"]);
    expect(ranked[0].scoreBreakdown.lowRelevance).toBe(false);
    expect(ranked[1].scoreBreakdown).toMatchObject({ keyword: 0, lowRelevance: true });
    expect(ranked[1].relevanceScore).toBeCloseTo(0.65);
  });
});

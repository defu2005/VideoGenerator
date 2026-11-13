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
    expect(ranked[1].relevanceScore).toBeCloseTo(0.5);
  });

  it("does not count the query that found a candidate as relevance evidence", () => {
    const ranked = rankCandidates([
      { ...candidate, providerItemId: "self-vouched", title: "Hook and loop fastener macro photograph", tags: [],
        searchQuery: "Hook archival photograph", providerPosition: 1 },
      { ...candidate, providerItemId: "on-topic", title: "Lee Sedol vs AlphaGo game 4", tags: [],
        width: 600, height: 600, providerPosition: 0.2 },
    ], { queryTerms: "Lee Sedol AlphaGo match Seoul 2016", sceneTerms: "", targetAspect: 16 / 9 });
    expect(ranked.map((item) => item.providerItemId)).toEqual(["on-topic", "self-vouched"]);
    expect(ranked[1].scoreBreakdown).toMatchObject({ keyword: 0, lowRelevance: true });
  });

  it("marks the Hermes off-topic examples as low relevance for Band of the Hawk", () => {
    const options = {
      queryTerms: "Band of the Hawk",
      sceneTerms: "Berserk",
      targetAspect: 16 / 9,
      entities: ["Band of the Hawk"],
    };
    const flickr = scoreCandidate({
      ...candidate, title: "Stone castle", description: "A fortress", tags: ["Berserk"], provider: "flickr",
    }, options);
    const cosplay = scoreCandidate({
      ...candidate, title: "Berserk cosplay at a convention", description: "Costume photo", tags: ["Berserk"],
    }, options);
    const hawks = scoreCandidate({
      ...candidate, title: "Golden Hawks marching band", description: "Parade", tags: ["band"],
    }, options);
    const real = scoreCandidate({
      ...candidate, title: "Band of the Hawk armor", description: "Berserk manga still of the mercenary band", tags: ["Berserk"],
    }, options);
    expect(flickr.breakdown.lowRelevance).toBe(true);
    expect(cosplay.breakdown.lowRelevance).toBe(true);
    expect(hawks.breakdown.lowRelevance).toBe(true);
    expect(real.breakdown.lowRelevance).toBe(false);
    const licensed = { ...candidate, title: "Band of the Hawk armor", license: { kind: "CC_BY" as const }, licenseVerified: true };
    const web = { ...candidate, title: "Band of the Hawk panel", providerItemId: "web-1", license: { kind: "UNKNOWN" as const }, licenseVerified: false };
    const off = rankCandidates([web, licensed], { ...options, copyrightMode: "off" });
    const commentary = rankCandidates([licensed, web], { ...options, copyrightMode: "commentary" });
    expect(off[0].providerItemId).toBe(licensed.providerItemId);
    expect(commentary.find((item) => item.licenseVerified === false)?.scoreBreakdown.usage).toBe("commentary");
    expect(hawks.breakdown.reasons).toEqual(expect.arrayContaining(["fan"]));
  });
});

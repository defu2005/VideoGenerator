import { describe, expect, it } from "vitest";
import { assignDistinct } from "../src/index.js";

const candidate = (providerItemId: string, imageUrl = `https://images.test/${providerItemId}.jpg`) => ({
  provider: "mock",
  providerItemId,
  imageUrl,
  sourceUrl: `https://source.test/${providerItemId}`,
});

describe("distinct scene assignment", () => {
  it("chooses distinct top-ranked candidates in scene order", () => {
    const assignments = assignDistinct([
      { sceneId: "b", order: 1, candidates: [candidate("shared"), candidate("second")] },
      { sceneId: "a", order: 0, candidates: [candidate("shared"), candidate("first")] },
    ]);
    expect(assignments.map((entry) => entry.candidate?.providerItemId)).toEqual(["shared", "second"]);
    expect(assignments.every((entry) => !entry.reusedAcrossScenes)).toBe(true);
  });

  it("falls back to a candidate not used by the previous scene and flags exhaustion", () => {
    const [first, second, third] = assignDistinct([
      { sceneId: "a", order: 0, candidates: [candidate("one")] },
      { sceneId: "b", order: 1, candidates: [candidate("one"), candidate("two")] },
      { sceneId: "c", order: 2, candidates: [candidate("two")] },
    ]);
    expect(first.candidate?.providerItemId).toBe("one");
    expect(second.candidate?.providerItemId).toBe("two");
    expect(second.reusedAcrossScenes).toBe(false);
    expect(third.candidate?.providerItemId).toBe("two");
    expect(third.reusedAcrossScenes).toBe(true);
  });

  it("preserves locked user choices and flags a locked duplicate", () => {
    const locked = candidate("same");
    const assignments = assignDistinct([
      { sceneId: "a", order: 0, candidates: [locked] },
      { sceneId: "b", order: 1, candidates: [candidate("other")], lockedCandidate: locked },
    ]);
    expect(assignments[1]).toMatchObject({ candidate: locked, reusedAcrossScenes: true });
  });

  it("prefers relevant candidates and varies repeated creators and titles", () => {
    const repeated = {
      ...candidate("repeated"),
      title: "Dinosaur Adventure",
      license: { evidence: "api", kind: "CC_BY", author: "Same Creator" },
      scoreBreakdown: { keyword: 0.5 },
    };
    const alternate = {
      ...candidate("alternate"),
      title: "Go tournament players",
      license: { evidence: "api", kind: "CC_BY", author: "Another Creator" },
      scoreBreakdown: { keyword: 0.3 },
    };
    const irrelevant = {
      ...candidate("irrelevant"),
      title: "High resolution landscape",
      scoreBreakdown: { keyword: 0 },
    };
    const [first, second] = assignDistinct([
      { sceneId: "a", order: 0, candidates: [repeated] },
      { sceneId: "b", order: 1, candidates: [repeated, alternate, irrelevant] },
    ]);
    expect(first.candidate).toEqual(repeated);
    expect(second.candidate).toEqual(alternate);
  });
});

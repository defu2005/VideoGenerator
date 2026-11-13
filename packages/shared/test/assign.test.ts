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

  it("asks for another search instead of repeating the last image", () => {
    const [first, second, third] = assignDistinct([
      { sceneId: "a", order: 0, candidates: [candidate("one")] },
      { sceneId: "b", order: 1, candidates: [candidate("one"), candidate("two")] },
      { sceneId: "c", order: 2, candidates: [candidate("two")] },
    ]);
    expect(first.candidate?.providerItemId).toBe("one");
    expect(second.candidate).toBeNull();
    expect(second.needsMoreSearch).toBe(true);
    expect(third.candidate?.providerItemId).toBe("two");
    expect(third.reusedAcrossScenes).toBe(false);
  });

  it("preserves locked user choices and flags a locked duplicate", () => {
    const locked = candidate("same");
    const assignments = assignDistinct([
      { sceneId: "a", order: 0, candidates: [locked] },
      { sceneId: "b", order: 1, candidates: [candidate("other")], lockedCandidate: locked },
    ]);
    expect(assignments[1]).toMatchObject({ candidate: locked, reusedAcrossScenes: false });
    expect(assignments[0].needsMoreSearch).toBe(true);
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

  it("keeps a later scene's only good image when an earlier scene has a backup", () => {
    const assignments = assignDistinct([
      { sceneId: "early", order: 0, candidates: [candidate("shared"), candidate("backup")] },
      { sceneId: "late", order: 4, candidates: [candidate("shared")] },
    ]);
    expect(assignments.map((entry) => entry.candidate?.providerItemId)).toEqual(["backup", "shared"]);
  });

  it("avoids a near-duplicate within three scenes when another image exists", () => {
    const close = { ...candidate("close"), phash: "00000000000000ff" };
    const anchor = { ...candidate("anchor"), phash: "0000000000000000" };
    const otherA = { ...candidate("other-a"), phash: "ffffffffffffffff" };
    const otherB = { ...candidate("other-b"), phash: "0f0f0f0f0f0f0f0f" };
    const assignments = assignDistinct([
      { sceneId: "a", order: 0, candidates: [anchor, otherA] },
      { sceneId: "b", order: 1, candidates: [close, otherB] },
    ]);
    expect(assignments[1].candidate?.providerItemId).not.toBe("close");
  });

  it("keeps two locked copies and marks the repeat", () => {
    const locked = candidate("same");
    const assignments = assignDistinct([
      { sceneId: "a", order: 0, candidates: [candidate("other")], lockedCandidate: locked },
      { sceneId: "b", order: 1, candidates: [candidate("else")], lockedCandidate: locked },
    ]);
    expect(assignments.every((entry) => entry.candidate?.providerItemId === "same")).toBe(true);
    expect(assignments.some((entry) => entry.reusedAcrossScenes)).toBe(true);
  });

  it("does not give the same hash to two scenes", () => {
    const shared = { ...candidate("wiki"), phash: "00000000000000ff" };
    const copy = { ...candidate("copy"), phash: "00000000000000ff" };
    const other = { ...candidate("other"), phash: "ffffffffffffffff" };
    const assignments = assignDistinct([
      { sceneId: "a", order: 0, candidates: [shared, other] },
      { sceneId: "b", order: 1, candidates: [copy] },
    ]);
    const hashes = assignments.map((entry) => entry.candidate?.phash);
    expect(new Set(hashes).size).toBe(2);
    expect(hashes).toContain("ffffffffffffffff");
  });
});

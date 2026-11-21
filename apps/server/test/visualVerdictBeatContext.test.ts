import { describe, expect, it } from "vitest";
import { imageVerdictContext } from "../src/agents/visualCache.js";

// TASK-146 slice 2 commit B: the verdict context changes with a beat's intent or purpose, and is unchanged without them.
// PINNED_CONTEXT was captured from the code before commit B (no beat fields) and must stay the same.

const input = { narration: "A river at dawn.", visualDescription: "river", aspectRatio: "16:9", visionThreshold: 7 };
const PINNED_CONTEXT = "340ac8f65a45a70c11ab3dae42ae80b216bc56309f7a7e3bb63051c88fcee432";

describe("imageVerdictContext beat fields", () => {
  it("keeps today's hash for a scene without beat fields", () => {
    expect(imageVerdictContext(input)).toBe(PINNED_CONTEXT);
  });

  it("changes the hash when the scene has a visualIntent", () => {
    expect(imageVerdictContext({ ...input, visualIntent: "the finished machine on a workbench" })).not.toBe(imageVerdictContext(input));
  });

  it("changes the hash when the scene has a beatPurpose", () => {
    expect(imageVerdictContext({ ...input, beatPurpose: "reveal" })).not.toBe(imageVerdictContext(input));
  });
});

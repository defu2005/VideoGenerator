import { describe, expect, it } from "vitest";
import { buildVisionCheckPrompt } from "../src/stages/visuals/visionPrompts.js";

// TASK-146 slice 2 commit B: the vision check prompt carries a scene's visualIntent and beatPurpose only when given.
// The byte-identical guard pins today's prompt for scenes without beat fields.

const base = { narration: "A river at dawn.", visualDescription: "river", aspectRatio: "16:9", images: [{ label: "A" }] };

describe("buildVisionCheckPrompt beat fields", () => {
  it("keeps the prompt byte-identical when no beat fields are given", () => {
    const expected = JSON.stringify({
      narration: base.narration,
      visualDescription: base.visualDescription,
      aspectRatio: base.aspectRatio,
      images: base.images,
      instruction: "For each image label, return fit (0-10), depicts, issues[], cropOk.",
    }, null, 2);
    expect(buildVisionCheckPrompt(base).prompt).toBe(expected);
  });

  it("carries visualIntent and beatPurpose in the prompt when given", () => {
    const { prompt } = buildVisionCheckPrompt({ ...base, visualIntent: "the finished machine on a workbench", beatPurpose: "reveal" });
    const parsed = JSON.parse(prompt) as Record<string, unknown>;
    expect(parsed.visualIntent).toBe("the finished machine on a workbench");
    expect(parsed.beatPurpose).toBe("reveal");
  });

  it("tells the model to reject an image that does not show the intent, only when beat fields are given", () => {
    const withBeat = JSON.parse(buildVisionCheckPrompt({ ...base, visualIntent: "x", beatPurpose: "reveal" }).prompt) as { instruction: string };
    expect(withBeat.instruction).toContain("visualIntent");
    expect(withBeat.instruction).toContain("wrong_subject");
    const plain = JSON.parse(buildVisionCheckPrompt(base).prompt) as { instruction: string };
    expect(plain.instruction).toBe("For each image label, return fit (0-10), depicts, issues[], cropOk.");
  });

  it("leaves the system text unchanged when beat fields are given", () => {
    expect(buildVisionCheckPrompt({ ...base, visualIntent: "x", beatPurpose: "setup" }).system)
      .toBe(buildVisionCheckPrompt(base).system);
  });
});

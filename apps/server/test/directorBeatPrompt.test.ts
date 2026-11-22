import { describe, expect, it } from "vitest";
import { buildDirectorPrompt } from "../src/compose/director/index.js";
import type { DirectorInput } from "../src/compose/director.js";

// TASK-146 4a: the beat purpose reaches the director prompt only when a scene has a beat.
// Written, not run (no-test rule in force).
const BEAT_SENTENCE = "the story purpose of the scene's beat";

function input(sceneId: string, beat?: NonNullable<DirectorInput["scene"]["beat"]>): DirectorInput {
  return {
    scene: { sceneId, index: 0, count: 2, text: "Giá tăng mạnh trong quý này.", durationSec: 5, ...(beat ? { beat } : {}) },
    words: [],
    recipeId: "explainer",
    aspect: "16:9",
    stills: [],
    footage: [],
  };
}

describe("director beat prompt (TASK-146 4a)", () => {
  it("adds neither the key nor the sentence when no scene has a beat", () => {
    const inputs = [input("s1"), input("s2")];
    const prompt = buildDirectorPrompt(inputs, [[], []]);
    expect(prompt).not.toContain('"b":');
    expect(prompt).not.toContain(BEAT_SENTENCE);
  });

  it("adds both the key and the sentence when a scene has a beat", () => {
    const inputs = [input("s1", { purpose: "reveal", start: true }), input("s2")];
    const prompt = buildDirectorPrompt(inputs, [[], []]);
    expect(prompt).toContain('"b":"reveal"');
    expect(prompt).toContain(BEAT_SENTENCE);
  });

  it("carries the key only on the scenes that have a beat in a mixed prompt", () => {
    const inputs = [input("s1", { purpose: "reveal", start: true }), input("s2")];
    const lines = buildDirectorPrompt(inputs, [[], []]).split("\n");
    const s1 = lines.find((line) => line.includes('"sceneId":"s1"'));
    const s2 = lines.find((line) => line.includes('"sceneId":"s2"'));
    expect(s1).toContain('"b":"reveal"');
    expect(s2).toBeDefined();
    expect(s2).not.toContain('"b":');
  });
});

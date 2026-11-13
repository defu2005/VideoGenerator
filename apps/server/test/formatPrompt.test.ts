import { describe, expect, it } from "vitest";
import type { Project } from "@vg/shared";
import { mergedStoryPrompt } from "../src/stages/script/mergedStoryPrompt.js";
import { formatLine, recipeResearchDepth } from "../src/stages/script/prompt.js";
import { researchPrompt } from "../src/stages/research/prompt.js";

function project(format?: string): Project {
  return {
    topic: "Tin về hố đen",
    description: "",
    settings: {
      language: "vi",
      style: "news",
      tone: "neutral",
      audience: "general",
      platform: "youtube",
      aspectRatio: "16:9",
      targetDurationSec: 120,
      wordsPerMinute: 150,
      format,
    },
  } as Project;
}

describe("format prompts", () => {
  it("puts the recipe structure into the merged story and research prompts", () => {
    const chosen = project("news_recap");
    expect(recipeResearchDepth(chosen)).toBe("deep");
    expect(recipeResearchDepth(project())).toBeNull();
    expect(mergedStoryPrompt(chosen, 150, "deep").prompt).toContain("sectionKey");
    expect(mergedStoryPrompt(chosen, 150, "deep").prompt).toContain("news_recap");
    expect(researchPrompt(chosen, "deep").prompt).toContain("shown on screen");
    expect(formatLine(project())).toContain("explainer");
    expect(researchPrompt(project(), "standard").prompt).not.toContain("shown on screen");
  });
});

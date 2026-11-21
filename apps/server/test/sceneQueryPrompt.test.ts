import { describe, expect, it } from "vitest";
import type { SceneDraft } from "@vg/shared";
import { sceneQueryPrompt } from "../src/stages/scenes/sceneQueryPrompt.js";

// TASK-146 slice 2 commit A: the query prompt carries a scene's visualIntent only when it has one.
// The byte-identical guard pins today's prompt for scenes without an intent.

const INSTRUCTION_PREFIX = "When a scene has visualIntent";
const INTENT = "the finished machine on a workbench";

function draft(overrides: Partial<SceneDraft> = {}): SceneDraft {
  return {
    order: 0,
    kind: "hook",
    sectionId: null,
    label: "Hook",
    narration: "Hook opens the story.",
    visualNotes: "",
    visualDescription: "",
    visualQueries: { primary: "s1 primary", alternatives: [] },
    queryVariant: false,
    musicMood: "",
    energy: "medium",
    estDurationSec: 4,
    durationOverrideSec: null,
    startSec: 0,
    transitionNote: "",
    ...overrides,
  } as SceneDraft;
}

describe("sceneQueryPrompt visualIntent", () => {
  it("keeps the prompt byte-identical when no scene carries a visualIntent", () => {
    const prompt = sceneQueryPrompt([{ index: 0, scene: draft() }]);
    const expected = [
      "For every supplied video scene, write one concise English visual description (one concrete sentence covering who/what/where/era) and varied English image-search queries.",
      "Keep proper nouns and named entities from the narration. Do not invent facts.",
      "Return one result for every supplied index with visualDescription, primary, and up to 3 alternatives. Each query must be a search phrase, not a sentence.",
      JSON.stringify({
        scenes: [{ index: 0, label: "Hook", narration: "Hook opens the story.", visualNotes: "", currentPrimary: "s1 primary" }],
      }),
    ].join("\n");
    expect(prompt).toBe(expected);
  });

  it("adds visualIntent to the scene it belongs to and one instruction line when some scene has one", () => {
    const prompt = sceneQueryPrompt([
      { index: 0, scene: draft() },
      { index: 1, scene: draft({ kind: "section", sectionId: "s1", label: "Setup", narration: "Next.", visualIntent: INTENT }) },
    ]);
    expect(prompt).toContain(`"visualIntent":"${INTENT}"`);
    expect(prompt.split("\n").filter((line) => line.startsWith(INSTRUCTION_PREFIX))).toHaveLength(1);
  });
});

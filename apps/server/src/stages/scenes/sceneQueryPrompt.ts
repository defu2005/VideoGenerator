import type { SceneDraft } from "@vg/shared";
import { appendGuidelineGuidance } from "../../guidelines/promptText.js";

export function sceneQueryPrompt(scenes: Array<{ index: number; scene: SceneDraft }>, guidance?: string): string {
  return appendGuidelineGuidance([
    "For every supplied video scene, write one concise English visual description (one concrete sentence covering who/what/where/era) and varied English image-search queries.",
    "Keep proper nouns and named entities from the narration. Do not invent facts.",
    "Return one result for every supplied index with visualDescription, primary, and up to 3 alternatives. Each query must be a search phrase, not a sentence.",
    JSON.stringify({
      scenes: scenes.map(({ index, scene }) => ({
        index,
        label: scene.label,
        narration: scene.narration,
        visualNotes: scene.visualNotes,
        currentPrimary: scene.visualQueries.primary,
      })),
    }),
  ].join("\n"), guidance);
}

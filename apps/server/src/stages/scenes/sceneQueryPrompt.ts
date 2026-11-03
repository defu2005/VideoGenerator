import type { SceneDraft } from "@vg/shared";

export function sceneQueryPrompt(scenes: Array<{ index: number; scene: SceneDraft }>): string {
  return [
    "Create concise English image-search queries for the supplied video scenes.",
    "Keep proper nouns and named entities from the narration. Do not invent facts.",
    "Return one result for every supplied index. Each primary and alternative must be a search phrase, not a sentence.",
    JSON.stringify({
      scenes: scenes.map(({ index, scene }) => ({
        index,
        label: scene.label,
        narration: scene.narration,
        visualNotes: scene.visualNotes,
        currentPrimary: scene.visualQueries.primary,
      })),
    }),
  ].join("\n");
}

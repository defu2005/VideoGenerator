import { z } from "zod";
import type { Scene } from "@vg/shared";
import { appendGuidelineGuidance } from "../../guidelines/promptText.js";

export const AltQueryResponseSchema = z.object({
  scenes: z.array(z.object({
    sceneId: z.string().uuid(),
    queries: z.array(z.string().trim().min(1).max(160)).max(3),
  }).strict()),
}).strict();

export function buildAltQueryPrompt(scenes: {
  sceneId: string;
  visualNotes: string;
  narration: string;
  queries: Pick<Scene["visualQueries"], "primary" | "alternatives">;
}[], guidance?: string) {
  return {
    system: "Generate concrete, searchable English image-search queries. Preserve proper nouns. Return only JSON matching the schema. Do not suggest URLs.",
    prompt: appendGuidelineGuidance(JSON.stringify({
      scenes: scenes.map((scene) => ({
        sceneId: scene.sceneId,
        visualNotes: scene.visualNotes,
        narration: scene.narration.slice(0, 240),
        existingQueries: [scene.queries.primary, ...scene.queries.alternatives],
      })),
      requestedOutput: { scenes: [{ sceneId: "uuid", queries: ["up to 3 queries"] }] },
    }), guidance),
  };
}

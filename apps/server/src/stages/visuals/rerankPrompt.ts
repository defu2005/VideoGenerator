import { z } from "zod";

export const RerankResponseSchema = z.object({
  scenes: z.array(z.object({
    sceneId: z.string().uuid(),
    order: z.array(z.number().int().nonnegative()),
  }).strict()),
}).strict();

export function buildRerankPrompt(scenes: {
  sceneId: string;
  narration: string;
  candidates: { candidateIndex: number; title: string; description: string; tags: string[] }[];
}[]) {
  return {
    system: "Rank image candidates by relevance to the narration. Return each candidate index exactly once, best first. Text only; do not infer image contents.",
    prompt: JSON.stringify({
      scenes: scenes.map((scene) => ({
        sceneId: scene.sceneId,
        narration: scene.narration.slice(0, 200),
        candidates: scene.candidates.map((candidate) => ({
          candidateIndex: candidate.candidateIndex,
          title: candidate.title,
          description: candidate.description.slice(0, 240),
          tags: candidate.tags.slice(0, 10),
        })),
      })),
    }),
  };
}

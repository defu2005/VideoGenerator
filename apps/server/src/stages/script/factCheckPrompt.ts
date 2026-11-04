import { FactCheckSchema, ScriptSchema, type ResearchNotes, type Script } from "@vg/shared";
import { z } from "zod";

export const FactCheckResponseSchema = FactCheckSchema.extend({
  revisedScript: ScriptSchema.optional(),
}).strict();

export function factCheckPrompt(
  topic: string,
  research: ResearchNotes | undefined,
  script: Script,
): { system: string; prompt: string } {
  return {
    system: [
      "You fact-check a video narration against research notes.",
      "Soften or hedge claims that are unsupported. Do not invent new facts.",
      "If the script is fine, return softenedClaims:[], notes, and omit revisedScript.",
      "If changes are needed, return revisedScript with the same section ids/order.",
    ].join(" "),
    prompt: JSON.stringify({
      topic,
      research: research ?? null,
      script,
    }, null, 2),
  };
}

export { FactCheckSchema };
export type FactCheckResponse = z.infer<typeof FactCheckResponseSchema>;

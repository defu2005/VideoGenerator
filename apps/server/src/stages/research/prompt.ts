import type { BudgetFeatures, Project } from "@vg/shared";
import { appendGuidelineGuidance } from "../../guidelines/promptText.js";

const factTargets: Record<BudgetFeatures["researchDepth"], { target: number; max: number }> = {
  light: { target: 6, max: 8 },
  standard: { target: 10, max: 12 },
  deep: { target: 14, max: 16 },
};

export function researchPrompt(project: Project, depth: BudgetFeatures["researchDepth"] = "standard", guidance?: string): { system: string; prompt: string } {
  const { target, max } = factTargets[depth];
  return {
    system: [
      "You are a careful research assistant preparing notes for a documentary video.",
      "Facts come from model knowledge and have not been independently verified. Mark uncertainty honestly.",
      "Never invent URLs. Use a short free-text sourceHint or null.",
      "Return only a JSON object matching the requested ResearchNotes schema.",
    ].join(" "),
    prompt: appendGuidelineGuidance([
      `Topic: ${project.topic}`,
      `Description: ${project.description || "(none)"}`,
      `Target language: ${project.settings.language}`,
      `Target video duration: ${project.settings.targetDurationSec} seconds`,
      `Return ${target}-${max} keyFacts, at most 10 timeline items, 3-8 outline sections, at most 6 angles and 6 cautions.`,
      "Use the requested language for all readable content.",
      "Compact JSON shape: summary, keyFacts[{fact,confidence,sourceHint}], timeline[{date,event}], angles, outline[{section,purpose,points}], cautions.",
    ].join("\n"), guidance),
  };
}

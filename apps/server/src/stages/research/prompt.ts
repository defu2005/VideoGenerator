import type { Project } from "@vg/shared";

export function researchPrompt(project: Project): { system: string; prompt: string } {
  return {
    system: [
      "You are a careful research assistant preparing notes for a documentary video.",
      "Facts come from model knowledge and have not been independently verified. Mark uncertainty honestly.",
      "Never invent URLs. Use a short free-text sourceHint or null.",
      "Return only a JSON object matching the requested ResearchNotes schema.",
    ].join(" "),
    prompt: [
      `Topic: ${project.topic}`,
      `Description: ${project.description || "(none)"}`,
      `Target language: ${project.settings.language}`,
      `Target video duration: ${project.settings.targetDurationSec} seconds`,
      "Return 5-12 keyFacts, at most 10 timeline items, 3-8 outline sections, at most 6 angles and 6 cautions.",
      "Use the requested language for all readable content.",
      "Compact JSON shape: summary, keyFacts[{fact,confidence,sourceHint}], timeline[{date,event}], angles, outline[{section,purpose,points}], cautions.",
    ].join("\n"),
  };
}

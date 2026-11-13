import { appendChannelDirection, type BudgetFeatures, type Project } from "@vg/shared";
import { appendGuidelineGuidance } from "../../guidelines/promptText.js";
import { formatLine, marketScriptLine } from "./prompt.js";

export function mergedStoryPrompt(
  project: Project,
  wordsPerMinute: number,
  depth: BudgetFeatures["researchDepth"] = "standard",
  guidance?: string,
  channelDirection?: string | null,
  learnedNotes?: string | null,
): { system: string; prompt: string } {
  const pace = project.settings.wordsPerMinute ?? wordsPerMinute;
  const factTargets = { light: "6-8", standard: "10-12", deep: "14-16" } as const;
  const pacing = project.settings.aspectRatio === "9:16" ? " (vertical, fast pacing)" : "";
  return {
    system: [
      "You are generating a merged story: research notes and a documentary script in one response.",
      "Research from model knowledge only; mark uncertainty and never invent URLs.",
      "Write narration in the requested language. Keep image search terms in English and retain proper nouns.",
      "Return compact JSON only with research and script fields exactly as requested.",
    ].join(" "),
    prompt: appendGuidelineGuidance(appendChannelDirection([
      `Topic: ${project.topic}`,
      `Description: ${project.description || "(none)"}`,
      `Language: ${project.settings.language}`,
      ...marketScriptLine(project.settings.market),
      `Style: ${project.settings.style}; tone: ${project.settings.tone}; audience: ${project.settings.audience}; platform: ${project.settings.platform}${pacing}`,
      `Target duration: ${project.settings.targetDurationSec} seconds`,
      formatLine(project),
      `Speaking pace: ${pace} words per minute`,
      "Return {research:{summary,keyFacts,timeline,angles,outline,cautions},script:{title,hook,sections,outro,music}}.",
      `Research: ${factTargets[depth]} keyFacts[{fact,confidence,sourceHint|null}], at most 10 timeline[{date,event}] and 6 cautions[string]; outline 3-8 items [{section,purpose,points[string]}].`,
      "Script: narration within 20% of target; sections[{id,heading,narration,visualQueries:{primary,alternatives[]},visualNotes,musicMood,energy}]. Provide 0-3 visual-query alternatives per section; the server calculates duration. music:{mood,energy,keywords[]}.",
      "Enum values must be these English words exactly: confidence = high|medium|low; energy = low|medium|high. JSON keys stay in English.",
    ].join("\n"), channelDirection, learnedNotes), guidance),
  };
}

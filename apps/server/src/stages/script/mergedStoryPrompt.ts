import type { Project } from "@vg/shared";

export function mergedStoryPrompt(project: Project, wordsPerMinute: number): { system: string; prompt: string } {
  return {
    system: [
      "You are generating a merged story: research notes and a documentary script in one response.",
      "Research from model knowledge only; mark uncertainty and never invent URLs.",
      "Write narration in the requested language. Keep image search terms in English and retain proper nouns.",
      "Return compact JSON only with research and script fields exactly as requested.",
    ].join(" "),
    prompt: [
      `Topic: ${project.topic}`,
      `Description: ${project.description || "(none)"}`,
      `Language: ${project.settings.language}`,
      `Target duration: ${project.settings.targetDurationSec} seconds`,
      `Speaking pace: ${wordsPerMinute} words per minute`,
      "Return {research:{summary,keyFacts,timeline,angles,outline,cautions},script:{title,hook,sections,outro,music}}.",
      "Research: 5-12 keyFacts[{fact,confidence,sourceHint}], at most 10 timeline entries and 6 cautions; outline 3-8 sections.",
      "Script: narration within 20% of target; sections[{id,heading,narration,visualQueries:{primary,alternatives},visualNotes,musicMood,energy}]. Provide 0-3 visual-query alternatives per section; the server calculates duration. Music:{mood,energy,keywords}.",
    ].join("\n"),
  };
}

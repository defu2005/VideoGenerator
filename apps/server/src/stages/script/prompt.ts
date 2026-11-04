import { appendChannelDirection, type Project, type ResearchNotes } from "@vg/shared";
import { appendGuidelineGuidance } from "../../guidelines/promptText.js";

export function scriptPrompt(
  project: Project,
  research?: ResearchNotes,
  wordsPerMinute = 150,
  guidance?: string,
  channelDirection?: string | null,
): { system: string; prompt: string } {
  const pace = project.settings.wordsPerMinute ?? wordsPerMinute;
  const pacing = project.settings.aspectRatio === "9:16" ? " (vertical, fast pacing)" : "";
  return {
    system: [
      "You are a documentary video scriptwriter.",
      "Write natural spoken narration in the requested language, with a compelling but accurate storytelling style.",
      "Do not present uncertain claims as verified facts.",
      "Return compact JSON only, matching the Script schema.",
    ].join(" "),
    prompt: appendGuidelineGuidance(appendChannelDirection([
      `Topic: ${project.topic}`,
      `Description: ${project.description || "(none)"}`,
      `Target language: ${project.settings.language}`,
      `Style: ${project.settings.style}; tone: ${project.settings.tone}; audience: ${project.settings.audience}; platform: ${project.settings.platform}${pacing}`,
      `Target duration: ${project.settings.targetDurationSec} seconds (the total narration should be within 20% of this target)`,
      `Speaking pace: ${pace} words per minute`,
      research ? `Research notes (unverified; preserve uncertainty):\n${JSON.stringify(research)}` : "No research notes are available; use the topic only.",
      "Script fields: title, hook, sections[{id,heading,narration,visualQueries:{primary,alternatives},visualNotes,musicMood,energy}], outro, music:{mood,energy,keywords}.",
      "Use English visual search terms, retain proper nouns, provide 0-3 alternatives; the server calculates section durations.",
    ].join("\n"), channelDirection), guidance),
  };
}

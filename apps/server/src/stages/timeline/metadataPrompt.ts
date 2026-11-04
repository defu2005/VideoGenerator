import { appendChannelDirection, type Project } from "@vg/shared";
import { appendGuidelineGuidance } from "../../guidelines/promptText.js";

export function metadataPrompt(input: {
  project: Project;
  scriptTitle: string;
  hook: string;
  sectionHeadings: string[];
  narrationSummary: string;
  guidance?: string;
  channelDirection?: string | null;
}): { system: string; prompt: string } {
  const { project } = input;
  return {
    system: [
      "You write publishing metadata for short documentary and explainer videos.",
      "Titles and description must match the platform and language.",
      "Do not include chapter timestamps or asset credits in the description; the server appends those.",
      "Return compact JSON only.",
    ].join(" "),
    prompt: appendGuidelineGuidance(appendChannelDirection([
      `Topic: ${project.topic}`,
      `Description: ${project.description || "(none)"}`,
      `Platform: ${project.settings.platform}`,
      `Language: ${project.settings.language}`,
      `Tone: ${project.settings.tone}; style: ${project.settings.style}; audience: ${project.settings.audience}`,
      `Script title: ${input.scriptTitle}`,
      `Hook: ${input.hook}`,
      `Section headings: ${input.sectionHeadings.join(" | ") || "(none)"}`,
      `Narration summary: ${input.narrationSummary || "(none)"}`,
      "Return titles (3, ≤100 chars), description (≤1500 chars, no chapters/credits), tags (≤15), hashtags (≤5, with #), thumbnailText (2 short overlay ideas).",
    ].join("\n"), input.channelDirection), input.guidance),
  };
}

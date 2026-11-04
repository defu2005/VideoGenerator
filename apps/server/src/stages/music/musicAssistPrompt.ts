import type { Project } from "@vg/shared";
import { appendGuidelineGuidance } from "../../guidelines/promptText.js";

export function musicAssistPrompt(input: {
  project: Project;
  scriptTitle: string;
  hook: string;
  narrationSample: string;
  sceneMoods: string[];
  music: { mood: string; keywords: string[] };
  guidance?: string;
}): { system: string; prompt: string } {
  const { project } = input;
  return {
    system: [
      "You are a music search assistant for documentary and explainer videos.",
      "Suggest short English instrumental search queries that match the brief and narration mood.",
      "Prefer tracks without vocals. Return compact JSON only.",
    ].join(" "),
    prompt: appendGuidelineGuidance([
      `Topic: ${project.topic}`,
      `Description: ${project.description || "(none)"}`,
      `Tone: ${project.settings.tone}; style: ${project.settings.style}; platform: ${project.settings.platform}`,
      `Audience: ${project.settings.audience}; language: ${project.settings.language}`,
      `Target duration: ${project.settings.targetDurationSec} seconds`,
      `Script title: ${input.scriptTitle}`,
      `Hook: ${input.hook}`,
      `Narration sample: ${input.narrationSample || "(none)"}`,
      `Scene moods: ${input.sceneMoods.filter(Boolean).join(", ") || "(none)"}`,
      `Current music mood: ${input.music.mood || "(none)"}`,
      `Current music keywords: ${input.music.keywords.join(", ") || "(none)"}`,
      "Return mood, energy (low|medium|high), 1-3 short English queries, avoid terms (e.g. vocals), and a short why.",
    ].join("\n"), input.guidance),
  };
}

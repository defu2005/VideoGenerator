import { appendChannelDirection, fallbackFormat, resolveFormat, type Project, type ResearchNotes } from "@vg/shared";
import { appendGuidelineGuidance } from "../../guidelines/promptText.js";

const audienceRegions = new Intl.DisplayNames("en", { type: "region" });

export function marketScriptLine(code?: string): string[] {
  if (!code) return [];
  return [`Audience country: ${audienceRegions.of(code)} (${code}). Use local units, currency, examples and date format.`];
}

export function scriptPrompt(
  project: Project,
  research?: ResearchNotes,
  wordsPerMinute = 150,
  guidance?: string,
  channelDirection?: string | null,
  learnedNotes?: string | null,
  ownerRules?: string | null,
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
      ...marketScriptLine(project.settings.market),
      `Style: ${project.settings.style}; tone: ${project.settings.tone}; audience: ${project.settings.audience}; platform: ${project.settings.platform}${pacing}`,
      `Target duration: ${project.settings.targetDurationSec} seconds (the total narration should be within 20% of this target)`,
      formatLine(project),
      `Speaking pace: ${pace} words per minute`,
      research ? `Research notes (unverified; preserve uncertainty):\n${JSON.stringify(research)}` : "No research notes are available; use the topic only.",
      "Script fields: title, hook, sections[{id,heading,narration,visualQueries:{primary,alternatives},visualNotes,musicMood,energy}], outro, music:{mood,energy,keywords}.",
      "Use English visual search terms, retain proper nouns, provide 0-3 alternatives; the server calculates section durations.",
    ].join("\n"), channelDirection, learnedNotes), guidance) + (ownerRules?.trim() ? `\n\n${ownerRules.trim()}` : ""),
  };
}

export function formatLine(project: Project): string {
  const input = {
    topic: project.topic,
    aspectRatio: project.settings.aspectRatio,
    targetDurationSec: project.settings.targetDurationSec,
    format: project.settings.format,
  };
  const picked = resolveFormat(input);
  const fallback = fallbackFormat(input);
  const reason = picked.recipe.id === fallback.id ? fallback.reason : picked.reason;
  const keys = picked.recipe.script.structure.map((section) => section.key).join(", ");
  const cite = picked.recipe.research.citeOnScreen
    ? " Name the source in sourceHint; it is shown on screen."
    : "";
  return `Format ${picked.recipe.id} (${picked.recipe.nameVi}): ${reason} Sections in order: ${keys}. Tag each section with sectionKey. Hook under ${picked.recipe.script.hookMaxSec}s. Sentences under ${picked.recipe.script.sentenceMaxWords} words.${cite}`;
}

const RESEARCH_DEPTH_RANK = { light: 0, standard: 1, deep: 2 } as const;

export function deeperResearchDepth(
  budgetDepth: "light" | "standard" | "deep",
  project: Project,
): "light" | "standard" | "deep" {
  const recipeDepth = recipeResearchDepth(project);
  if (!recipeDepth) return budgetDepth;
  return RESEARCH_DEPTH_RANK[recipeDepth] > RESEARCH_DEPTH_RANK[budgetDepth] ? recipeDepth : budgetDepth;
}

export function recipeResearchDepth(project: Project): "light" | "standard" | "deep" | null {
  if (!project.settings.format) return null;
  const depth = resolveFormat({
    topic: project.topic,
    aspectRatio: project.settings.aspectRatio,
    targetDurationSec: project.settings.targetDurationSec,
    format: project.settings.format,
  }).recipe.research.depth;
  return depth === "normal" ? "standard" : depth;
}

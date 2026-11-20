import { appendChannelDirection, fallbackFormat, resolveFormat, type FormatRecipe, type Project, type ResearchNotes } from "@vg/shared";
import { appendGuidelineGuidance } from "../../guidelines/promptText.js";
import { narrationRulesBlock, WRITER_SYSTEM } from "./narrationRules.js";

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
    system: `${WRITER_SYSTEM} Return compact JSON only, matching the Script schema.`,
    prompt: appendGuidelineGuidance(appendChannelDirection([
      `Topic: ${project.topic}`,
      `Description: ${project.description || "(none)"}`,
      `Target language: ${project.settings.language}`,
      ...marketScriptLine(project.settings.market),
      `Style: ${project.settings.style}; tone: ${project.settings.tone}; audience: ${project.settings.audience}; platform: ${project.settings.platform}${pacing}`,
      `Target duration: ${project.settings.targetDurationSec} seconds (the total narration should be within 20% of this target)`,
      formatLine(project),
      formatGuidance(project),
      narrationRulesBlock(),
      `Speaking pace: ${pace} words per minute`,
      research ? `Research notes (unverified; preserve uncertainty):\n${JSON.stringify(research)}` : "No research notes are available; use the topic only.",
      "Script fields: title, hook, sections[{id,heading,narration,visualQueries:{primary,alternatives},visualNotes,musicMood,energy}], outro, music:{mood,energy,keywords}.",
      "The hook is spoken on its own: section 1 must continue after it without repeating it. The outro must conclude the video without repeating the last section.",
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

export function projectRecipe(project: Project): FormatRecipe {
  return resolveFormat({
    topic: project.topic,
    aspectRatio: project.settings.aspectRatio,
    targetDurationSec: project.settings.targetDurationSec,
    format: project.settings.format,
  }).recipe;
}

/** Per-section purpose, hook tactics and reading level of the chosen recipe (Vietnamese text quoted as is). */
export function formatGuidance(project: Project): string {
  const recipe = projectRecipe(project);
  const sections = recipe.script.structure
    .map((section) => `- ${section.key} — ${section.nameVi}: ${section.purposeVi} (≈${Math.round(section.shareOfDuration * 100)}%${section.required ? "" : ", optional"})`)
    .join("\n");
  return [
    `Format guidance (${recipe.id}): ${recipe.descriptionVi}`,
    `Each section must do its job:\n${sections}`,
    `Allowed hook tactics: ${recipe.script.hookStyles.join(", ")}.`,
    `Reading level: ${recipe.script.readingLevelVi}`,
  ].join("\n");
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

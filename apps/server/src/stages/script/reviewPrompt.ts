import type { Project, ResearchNotes, Script } from "@vg/shared";
import type { NarrationLintFinding } from "@vg/shared";
import { appendGuidelineGuidance } from "../../guidelines/promptText.js";
import { narrationRulesBlock } from "./narrationRules.js";
import { formatGuidance } from "./prompt.js";

export const REVIEW_CRITERIA: readonly string[] = [
  "hook strength: tension or a real question, a promise the script keeps",
  "each section fulfils its format purpose (see the format guidance)",
  "concrete scenes (person, place, object, decision) instead of listing facts or dates",
  "open loops are closed: every question or tease raised is answered later",
  "the outro pays off the hook's question, or names what is unknown; no thank-you outro",
  "TTS naturalness: spoken numbers and years, no stage directions, varied rhythm",
  "length: last, and never by removing a section's concrete moment",
];

export function lintProblemsBlock(findings: NarrationLintFinding[]): string[] {
  if (findings.length === 0) return [];
  return [
    "Problems found by the checker; fix each one:",
    ...findings.map((finding) => `- [${finding.code}] section ${finding.sectionId}: ${finding.message}`),
  ];
}

export function scriptReviewPrompt(
  project: Project,
  research: ResearchNotes | undefined,
  script: Script,
  wordsPerMinute = 150,
  pass = 1,
  priorNotes: string[] = [],
  guidance?: string,
  lintFindings: NarrationLintFinding[] = [],
): { system: string; prompt: string } {
  const pace = project.settings.wordsPerMinute ?? wordsPerMinute;
  return {
    system: pass === 1
      ? "You are a script editor for video narration who edits for storytelling, not only copy. Return only valid JSON with revisedScript, notes and score from 0 to 10."
      : "You are polishing a reviewed video script as a story editor. Return only valid JSON with revisedScript, notes and score from 0 to 10.",
    prompt: appendGuidelineGuidance([
      `${pass === 1 ? "Review and revise" : "Polish"} this ${project.settings.language} narration for a ${project.settings.targetDurationSec}-second video.`,
      `Target duration: ${project.settings.targetDurationSec} seconds`,
      `Speaking pace: ${pace} words per minute`,
      formatGuidance(project),
      narrationRulesBlock(),
      `Score and revise against these criteria, in this order:\n${REVIEW_CRITERIA.map((c, i) => `${i + 1}. ${c}`).join("\n")}`,
      "Every note must name the section id it concerns (or hook / outro). Length fixes come last.",
      "Keep its language, target duration, every section id in the same order, and the Script schema including visualQueries.",
      "Make only meaningful improvements. Return at most 8 concise review notes.",
      ...lintProblemsBlock(lintFindings),
      ...(priorNotes.length ? [`Previous review notes: ${JSON.stringify(priorNotes)}`] : []),
      `Research summary: ${research?.summary ?? "No research summary available."}`,
      `Script: ${JSON.stringify(script)}`,
      'Output: {"revisedScript": <Script>, "notes": ["..."], "score": 8}',
    ].join("\n"), guidance),
  };
}

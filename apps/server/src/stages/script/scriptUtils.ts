import { createHash } from "node:crypto";
import type { Project, Script } from "@vg/shared";

export function scriptInputHash(project: Project, researchInputHash?: string): string {
  return createHash("sha256").update(JSON.stringify([
    project.topic,
    project.description,
    project.settings.language,
    project.settings.targetDurationSec,
    researchInputHash ?? null,
  ])).digest("hex");
}

export function researchInputHash(project: Project): string {
  return createHash("sha256").update(JSON.stringify([
    project.topic,
    project.description,
    project.settings.language,
    project.settings.targetDurationSec,
  ])).digest("hex");
}

export function maxOutputTokensForDuration(targetDurationSec: number, wordsPerMinute: number): number {
  const targetWords = targetDurationSec * wordsPerMinute / 60;
  return Math.ceil(targetWords * 2 + 800);
}

export function scriptContentHash(script: Script): string {
  return createHash("sha256").update(JSON.stringify(script)).digest("hex");
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function computeSectionDurations(script: Script, wordsPerMinute: number): Script {
  return {
    ...script,
    sections: script.sections.map((section) => ({
      ...section,
      estDurationSec: Math.round(countWords(section.narration) * 60 / wordsPerMinute),
    })),
  };
}

export function scriptTotalDuration(script: Script, wordsPerMinute: number): number {
  const words = countWords([
    script.hook,
    ...script.sections.map((section) => section.narration),
    script.outro,
  ].join(" "));
  return Math.round(words * 60 / wordsPerMinute);
}

/**
 * Duration policy: a near miss (outside ±20%) is only a warning the user can fix by editing,
 * because rejecting it would cost a repair LLM call. Only clearly broken output
 * (< 50% or > 200% of the target) is rejected.
 */
export function checkScriptDuration(script: Script, targetDurationSec: number, wordsPerMinute: number): {
  duration: number;
  reject: string | null;
  warning: string | null;
} {
  const duration = scriptTotalDuration(script, wordsPerMinute);
  const reject = duration < targetDurationSec * 0.5 || duration > targetDurationSec * 2
    ? `Total estimated duration must be between ${Math.round(targetDurationSec * 0.5)} and ${Math.round(targetDurationSec * 2)} seconds; got ${duration}.`
    : null;
  const warning = !reject && (duration < targetDurationSec * 0.8 || duration > targetDurationSec * 1.2)
    ? `script is ~${duration}s vs target ${targetDurationSec}s — edit it in the Script tab if needed`
    : null;
  return { duration, reject, warning };
}

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

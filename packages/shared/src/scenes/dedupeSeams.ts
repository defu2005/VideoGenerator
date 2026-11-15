import type { Script } from "../schemas/script.js";
import { splitSentences } from "./sentences.js";

export interface SeamDrop {
  seam: "hook" | "outro" | "section";
  sectionId: string | null;
  sentence: string;
}

export interface SeamReport {
  seam: "hook" | "outro" | "section";
  sectionId: string | null;
  sentence: string;
  action: "dropped" | "kept";
  reason?: string;
}

export type DedupeSeamsResult = Script & {
  script: Script;
  dropped: SeamDrop[];
  reports: SeamReport[];
};

export interface DuplicateSentenceWarning {
  code: "DUPLICATE_NARRATION_SEAM" | "NEIGHBOURING_DUPLICATE_SENTENCE";
  severity: "WARN";
  sceneId: string;
  nextSceneId: string;
  sentence: string;
  message: string;
}

/**
 * Normalises a sentence for seam comparison:
 * - NFC Unicode normalization
 * - lower case
 * - strip punctuation and quotes (Vietnamese diacritics kept)
 * - collapse whitespace and trim
 */
export function normalizeSentence(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Computes token Jaccard similarity over word tokens from normalized text.
 */
export function tokenJaccard(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 && tokensB.length === 0) return 1;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      intersection++;
    }
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Two sentences count as equal when they are identical after normalising,
 * or when their token Jaccard similarity is >= 0.9 and both have at least 6 words.
 */
export function areSentencesEqual(a: string, b: string): boolean {
  const normA = normalizeSentence(a);
  const normB = normalizeSentence(b);
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  const tokensA = normA.split(" ").filter(Boolean);
  const tokensB = normB.split(" ").filter(Boolean);
  if (tokensA.length >= 6 && tokensB.length >= 6) {
    return tokenJaccard(tokensA, tokensB) >= 0.9;
  }
  return false;
}

/**
 * Deduplicates repeated narration at:
 * 1. Hook seam: if first sentence(s) of section 0 repeat hook, drop from section 0.
 * 2. Section seams: if section i's first sentence equals section i-1's last sentence, drop from section i.
 * 3. Outro seam: if outro starts with last sentence of last section, drop from outro.
 * Never empties a section (keeps it as is and reports it instead).
 */
export function dedupeSeams(script: Script, language = "vi"): DedupeSeamsResult {
  const dropped: SeamDrop[] = [];
  const reports: SeamReport[] = [];

  const sections = script.sections.map((section) => ({ ...section }));

  // 1. Hook seam
  if (script.hook && script.hook.trim() && sections.length > 0) {
    const firstSection = sections[0]!;
    const hookSentences = splitSentences(script.hook, language);
    const sectionSentences = splitSentences(firstSection.narration, language);

    let hookIdx = 0;
    let modified = false;

    while (sectionSentences.length > 0 && hookIdx < hookSentences.length) {
      const currentSentence = sectionSentences[0]!;
      const targetHook = hookSentences[hookIdx]!;
      const matches = areSentencesEqual(currentSentence, targetHook) || areSentencesEqual(currentSentence, script.hook);

      if (matches) {
        if (sectionSentences.length === 1) {
          // Never empty a section: keep as it is and report it
          reports.push({
            seam: "hook",
            sectionId: firstSection.id,
            sentence: currentSentence,
            action: "kept",
            reason: "would_empty_section",
          });
          break;
        }
        dropped.push({
          seam: "hook",
          sectionId: firstSection.id,
          sentence: currentSentence,
        });
        reports.push({
          seam: "hook",
          sectionId: firstSection.id,
          sentence: currentSentence,
          action: "dropped",
        });
        sectionSentences.shift();
        hookIdx++;
        modified = true;
      } else {
        break;
      }
    }

    if (modified) {
      firstSection.narration = sectionSentences.join(" ");
    }
  }

  // 2. Section seams
  for (let i = 1; i < sections.length; i++) {
    const prevSection = sections[i - 1]!;
    const currSection = sections[i]!;
    const prevSentences = splitSentences(prevSection.narration, language);
    const currSentences = splitSentences(currSection.narration, language);

    if (prevSentences.length === 0 || currSentences.length === 0) continue;

    const lastPrev = prevSentences[prevSentences.length - 1]!;
    const firstCurr = currSentences[0]!;

    if (areSentencesEqual(firstCurr, lastPrev)) {
      if (currSentences.length === 1) {
        // Never empty a section: keep as it is and report it
        reports.push({
          seam: "section",
          sectionId: currSection.id,
          sentence: firstCurr,
          action: "kept",
          reason: "would_empty_section",
        });
      } else {
        dropped.push({
          seam: "section",
          sectionId: currSection.id,
          sentence: firstCurr,
        });
        reports.push({
          seam: "section",
          sectionId: currSection.id,
          sentence: firstCurr,
          action: "dropped",
        });
        currSentences.shift();
        currSection.narration = currSentences.join(" ");
      }
    }
  }

  // 3. Outro seam
  let cleanOutro = script.outro;
  if (script.outro && script.outro.trim() && sections.length > 0) {
    const lastSection = sections[sections.length - 1]!;
    const lastSectionSentences = splitSentences(lastSection.narration, language);
    const outroSentences = splitSentences(script.outro, language);

    if (lastSectionSentences.length > 0 && outroSentences.length > 0) {
      const lastSecSentence = lastSectionSentences[lastSectionSentences.length - 1]!;
      const firstOutroSentence = outroSentences[0]!;

      if (areSentencesEqual(firstOutroSentence, lastSecSentence)) {
        dropped.push({
          seam: "outro",
          sectionId: null,
          sentence: firstOutroSentence,
        });
        reports.push({
          seam: "outro",
          sectionId: null,
          sentence: firstOutroSentence,
          action: "dropped",
        });
        outroSentences.shift();
        cleanOutro = outroSentences.join(" ");
      }
    }
  }

  const cleanedScript: Script = {
    ...script,
    hook: script.hook,
    sections,
    outro: cleanOutro,
  };

  return {
    ...cleanedScript,
    script: cleanedScript,
    dropped,
    reports,
  };
}

/** Helper exposing the drop list so callers can log it. */
export function getSeamDrops(script: Script, language = "vi"): SeamDrop[] {
  return dedupeSeams(script, language).dropped;
}

/** Helper exposing full reports including kept sections. */
export function getSeamReports(script: Script, language = "vi"): SeamReport[] {
  return dedupeSeams(script, language).reports;
}

/**
 * Pre-render check: flags two neighbouring scenes with the same sentence (as a warning only).
 */
export function checkNeighbouringSceneDuplicates(
  scenes: Array<{ id: string; narration: string; order?: number }>,
  language = "vi",
): DuplicateSentenceWarning[] {
  const warnings: DuplicateSentenceWarning[] = [];
  for (let i = 0; i < scenes.length - 1; i++) {
    const sceneA = scenes[i]!;
    const sceneB = scenes[i + 1]!;
    const sentencesA = splitSentences(sceneA.narration, language);
    const sentencesB = splitSentences(sceneB.narration, language);
    if (sentencesA.length === 0 || sentencesB.length === 0) continue;

    let flagged = false;
    for (const sA of sentencesA) {
      for (const sB of sentencesB) {
        if (areSentencesEqual(sA, sB)) {
          warnings.push({
            code: "NEIGHBOURING_DUPLICATE_SENTENCE",
            severity: "WARN",
            sceneId: sceneA.id,
            nextSceneId: sceneB.id,
            sentence: sA,
            message: `Hai cảnh liền nhau (${sceneA.id}, ${sceneB.id}) có câu trùng lặp: "${sA}"`,
          });
          flagged = true;
          break;
        }
      }
      if (flagged) break;
    }
  }
  return warnings;
}

export const preRenderCheck = checkNeighbouringSceneDuplicates;

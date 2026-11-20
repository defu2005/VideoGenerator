import type { FormatRecipe } from "../formats/recipes.js";
import type { Script } from "../schemas/script.js";
import { areSentencesEqual, normalizeSentence } from "../scenes/dedupeSeams.js";
import { splitSentences } from "../scenes/sentences.js";
import { CLICHES_EN } from "./cliches.en.js";
import { CLICHES_VI } from "./cliches.vi.js";

/** All tunable thresholds in one place (tests and later tasks may tune them). */
export const NARRATION_LINT_THRESHOLDS = {
  /** DATE_LIST: share of a section's sentences that start with a date. */
  dateStartRatio: 0.4,
  /** DATE_LIST: the ratio only applies with at least this many sentences. */
  dateMinSentences: 3,
  /** DATE_LIST: this many date-starting sentences in a row also trigger. */
  dateStreak: 2,
  /** FLAT_RHYTHM: coefficient of variation of sentence length below this. */
  flatRhythmCv: 0.25,
  flatRhythmMinSentences: 4,
  /** NO_QUESTION_PAYOFF: shared content words needed between hook question and outro. */
  questionOverlapWords: 2,
  questionMinWordLength: 3,
  /** TEMPLATE_OUTRO: a non-template sentence needs this many words to count as content. */
  outroContentMinWords: 5,
  /** LONG_SENTENCE: over max words is a warn, over max * this factor is a fix. */
  longSentenceFixFactor: 1.5,
} as const;

export type NarrationLintCode =
  | "HOOK_REPEATED"
  | "DATE_LIST"
  | "CLICHE"
  | "TEMPLATE_OUTRO"
  | "FLAT_RHYTHM"
  | "NO_QUESTION_PAYOFF"
  | "LONG_SENTENCE";

export interface NarrationLintFinding {
  code: NarrationLintCode;
  /** A section id, or "hook" / "outro". */
  sectionId: string;
  message: string;
  severity: "warn" | "fix";
}

/** Stable priority: actionable fixes must survive before advisory warnings in capped notes. */
export function prioritizeNarrationLint(findings: readonly NarrationLintFinding[]): NarrationLintFinding[] {
  return [...findings].sort((a, b) => Number(b.severity === "fix") - Number(a.severity === "fix"));
}

const DATE_START = /^(?:năm\s+\d{3,4}|vào\s+năm|thế\s+kỷ|in\s+\d{4}|\d{4}\b)/iu;
const TEMPLATE_SENTENCE = /(cảm ơn|đăng ký|đăng kí|theo dõi kênh|hẹn gặp lại|bật\s+chuông|nhấn\s+chuông|đừng quên|\bsubscribe\b|thanks? for|thank you|see you|ring the bell|\blike\b.*\b(?:subscribe|comment|share)\b|\b(?:subscribe|comment|share)\b.*\blike\b)/iu;
const STOPWORDS = new Set([
  "và", "của", "là", "có", "không", "một", "những", "các", "cho", "với", "này", "đã", "được", "trong", "như",
  "the", "and", "was", "that", "this", "with", "for", "are", "why", "how", "what", "did", "does",
  "sao", "gì", "thế", "nào", "ai", "đâu", "khi", "vì", "để", "từ", "ra", "lại", "cũng",
]);

function clichesFor(language: string): readonly string[] {
  const lang = language.toLowerCase();
  if (lang.startsWith("vi")) return CLICHES_VI;
  if (lang.startsWith("en")) return CLICHES_EN;
  return [...CLICHES_VI, ...CLICHES_EN];
}

function wordCount(sentence: string): number {
  return sentence.split(/\s+/u).filter(Boolean).length;
}

function contentWords(text: string): Set<string> {
  const t = NARRATION_LINT_THRESHOLDS;
  return new Set(
    normalizeSentence(text).split(" ")
      .filter((word) => word.length >= t.questionMinWordLength && !STOPWORDS.has(word)),
  );
}

function sentenceLengthCv(sentences: string[]): number {
  const lengths = sentences.map(wordCount);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  if (mean === 0) return 0;
  const variance = lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / lengths.length;
  return Math.sqrt(variance) / mean;
}

/**
 * Code-only style checks on a script (no LLM). Pure and deterministic.
 * `fix` findings are fed to the reviewer; `warn` findings are only reported.
 */
export function lintNarration(script: Script, recipe: FormatRecipe, language: string): NarrationLintFinding[] {
  const t = NARRATION_LINT_THRESHOLDS;
  const findings: NarrationLintFinding[] = [];
  const push = (finding: NarrationLintFinding) => findings.push(finding);
  const maxWords = recipe.script.sentenceMaxWords;
  const cliches = clichesFor(language);

  const blocks: Array<{ id: string; text: string }> = [
    { id: "hook", text: script.hook },
    ...script.sections.map((section) => ({ id: section.id, text: section.narration })),
    { id: "outro", text: script.outro },
  ];

  // HOOK_REPEATED
  const first = script.sections[0];
  if (first && script.hook.trim()) {
    const hookSentences = splitSentences(script.hook, language);
    const firstSentences = splitSentences(first.narration, language);
    const repeated = firstSentences.find((s) => hookSentences.some((h) => areSentencesEqual(s, h)) || areSentencesEqual(s, script.hook));
    if (repeated) {
      push({ code: "HOOK_REPEATED", sectionId: first.id, severity: "fix", message: `Section "${first.id}" repeats the hook: "${repeated}". Continue the story instead.` });
    }
  }

  for (const block of blocks) {
    if (!block.text.trim()) continue;
    const sentences = splitSentences(block.text, language);

    // CLICHE
    const normalized = block.text.normalize("NFC").toLowerCase();
    for (const phrase of cliches) {
      if (normalized.includes(phrase)) {
        push({ code: "CLICHE", sectionId: block.id, severity: "warn", message: `Cliché "${phrase}" in ${block.id}. Say something concrete.` });
      }
    }

    // LONG_SENTENCE
    for (const sentence of sentences) {
      const words = wordCount(sentence);
      if (words > maxWords) {
        push({
          code: "LONG_SENTENCE",
          sectionId: block.id,
          severity: words > maxWords * t.longSentenceFixFactor ? "fix" : "warn",
          message: `A sentence in ${block.id} has ${words} words (max ${maxWords}): "${sentence.slice(0, 60)}…". Split it.`,
        });
      }
    }

    if (block.id === "hook" || block.id === "outro") continue;

    // DATE_LIST
    const dateFlags = sentences.map((s) => DATE_START.test(s));
    const dateCount = dateFlags.filter(Boolean).length;
    let streak = 0;
    let maxStreak = 0;
    for (const flag of dateFlags) {
      streak = flag ? streak + 1 : 0;
      maxStreak = Math.max(maxStreak, streak);
    }
    if (maxStreak >= t.dateStreak || (sentences.length >= t.dateMinSentences && dateCount / sentences.length > t.dateStartRatio)) {
      push({ code: "DATE_LIST", sectionId: block.id, severity: "fix", message: `Section ${block.id} lists dates (${dateCount}/${sentences.length} sentences start with a year). Build it around one concrete moment; put dates inside the scene.` });
    }

    // FLAT_RHYTHM
    if (sentences.length >= t.flatRhythmMinSentences && sentenceLengthCv(sentences) < t.flatRhythmCv) {
      push({ code: "FLAT_RHYTHM", sectionId: block.id, severity: "warn", message: `Section ${block.id} has uniform sentence lengths. Mix short and long sentences.` });
    }
  }

  // TEMPLATE_OUTRO
  if (script.outro.trim()) {
    const outroSentences = splitSentences(script.outro, language);
    const hasContent = outroSentences.some((s) => !TEMPLATE_SENTENCE.test(s) && wordCount(s) >= t.outroContentMinWords);
    if (!hasContent) {
      push({ code: "TEMPLATE_OUTRO", sectionId: "outro", severity: "fix", message: "The outro is only thanks, subscribe or goodbye. Answer the hook's question or name what is still unknown." });
    }
  }

  // NO_QUESTION_PAYOFF
  if (script.hook.includes("?") && script.outro.trim()) {
    const questions = splitSentences(script.hook, language).filter((s) => s.includes("?"));
    const question = contentWords(questions.join(" "));
    const outro = contentWords(script.outro);
    let overlap = 0;
    for (const word of question) if (outro.has(word)) overlap += 1;
    if (overlap < t.questionOverlapWords) {
      push({ code: "NO_QUESTION_PAYOFF", sectionId: "outro", severity: "warn", message: "The hook asks a question but the outro does not seem to answer it." });
    }
  }

  return findings;
}

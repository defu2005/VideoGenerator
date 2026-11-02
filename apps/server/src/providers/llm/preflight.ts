import type { Project, ResearchNotes } from "@vg/shared";
import type { LlmProvider } from "./types.js";
import { LlmError } from "./types.js";
import { estimateTokens } from "./tokenEstimate.js";

export const PREFLIGHT_ESTIMATES = {
  researchOutputTokens: 900,
  scriptJsonOverheadTokens: 400,
  tokensPerWord: { vi: 2.5, en: 1.4, other: 2.0 },
} as const;

export type LlmCallMode = "merged" | "separate" | "off";

export type PreflightPrompt = { system: string; prompt: string };

export type PreflightInput = {
  provider: LlmProvider;
  mode: LlmCallMode;
  project: Project;
  wordsPerMinute: number;
  maxOutputTokens: number;
  input: PreflightPrompt;
  research?: ResearchNotes;
  rebuildInput?: (research?: ResearchNotes) => PreflightPrompt;
};

export type PreflightResult =
  | {
    decision: "proceed" | "switch-to-separate";
    mode: LlmCallMode;
    maxOutputTokens: number;
    input: PreflightPrompt;
    research?: ResearchNotes;
    message?: string;
  }
  | { decision: "reject"; error: LlmError };

export function preflight(input: PreflightInput): PreflightResult {
  const limits = input.provider.limits;
  if (!limits) {
    return {
      decision: "proceed",
      mode: input.mode,
      maxOutputTokens: input.maxOutputTokens,
      input: input.input,
      ...(input.research ? { research: input.research } : {}),
    };
  }

  const requiredScriptTokens = estimateScriptOutput(
    input.project.settings.targetDurationSec,
    input.wordsPerMinute,
    input.project.settings.language,
  );
  const requiredOutputTokens = input.mode === "merged"
    ? requiredScriptTokens + PREFLIGHT_ESTIMATES.researchOutputTokens
    : input.mode === "separate"
      ? PREFLIGHT_ESTIMATES.researchOutputTokens
      : requiredScriptTokens;
  const maxOutputLimit = limits.maxOutputTokens;

  let research = input.research;
  let promptInput = input.input;
  let inputEstimate = estimateTokens(`${promptInput.system}\n${promptInput.prompt}`, true);
  if (limits.maxInputTokens !== undefined && inputEstimate > limits.maxInputTokens && research) {
    const trimmed = {
      ...research,
      keyFacts: research.keyFacts.slice(0, 8),
      timeline: research.timeline.slice(0, 6),
    };
    promptInput = input.rebuildInput?.(trimmed) ?? input.input;
    inputEstimate = estimateTokens(`${promptInput.system}\n${promptInput.prompt}`, true);
    if (inputEstimate <= limits.maxInputTokens) research = trimmed;
  }
  if (limits.maxInputTokens !== undefined && inputEstimate > limits.maxInputTokens) {
    return rejectLimit(
      `${input.provider.label} input limit is too small for this request (~${inputEstimate} estimated tokens). Shorten the topic or use another provider.`,
    );
  }

  if (maxOutputLimit !== undefined && requiredOutputTokens > maxOutputLimit) {
    if (
      input.mode === "merged"
      && requiredScriptTokens <= maxOutputLimit
      && PREFLIGHT_ESTIMATES.researchOutputTokens <= maxOutputLimit
    ) {
      return {
        decision: "switch-to-separate",
        mode: "separate",
        maxOutputTokens: maxOutputLimit === undefined
          ? input.maxOutputTokens
          : Math.min(PREFLIGHT_ESTIMATES.researchOutputTokens, maxOutputLimit),
        input: promptInput,
        ...(research ? { research } : {}),
        message: `Merged output (~${requiredOutputTokens} tokens) exceeds ${input.provider.label} limit (${maxOutputLimit}); using 2 calls`,
      };
    }
    return rejectLimit(
      `${input.provider.label} output limit is too small for this video. Try a shorter duration or another provider.`,
    );
  }

  return {
    decision: "proceed",
    mode: input.mode,
    maxOutputTokens: maxOutputLimit === undefined
      ? input.maxOutputTokens
      : Math.min(Math.max(input.maxOutputTokens, requiredOutputTokens), maxOutputLimit),
    input: promptInput,
    ...(research ? { research } : {}),
  };
}

export function estimateScriptOutput(
  targetDurationSec: number,
  wordsPerMinute: number,
  language: string,
): number {
  const tokensPerWord = language.toLowerCase().startsWith("vi")
    ? PREFLIGHT_ESTIMATES.tokensPerWord.vi
    : language.toLowerCase().startsWith("en")
      ? PREFLIGHT_ESTIMATES.tokensPerWord.en
      : PREFLIGHT_ESTIMATES.tokensPerWord.other;
  const words = targetDurationSec / 60 * wordsPerMinute;
  return Math.ceil(words * tokensPerWord + PREFLIGHT_ESTIMATES.scriptJsonOverheadTokens);
}

function rejectLimit(message: string): PreflightResult {
  return { decision: "reject", error: new LlmError(message, "LLM_LIMIT_TOO_SMALL", false) };
}

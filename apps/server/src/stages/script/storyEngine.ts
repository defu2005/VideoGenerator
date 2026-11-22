/**
 * Story engine: outline -> hook candidates -> narration -> critic -> targeted rewrite -> length fit.
 *
 * Story structure, dramaturgy, loops, and critic adapted from:
 * - jtydhr88/screenwriting-skills (MIT)
 * - danjdewhurst/story-skills (MIT)
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type Database from "better-sqlite3";
import {
  computeScriptCritique,
  HookAssessmentsSchema,
  hookTacticsForRecipe,
  lintNarration,
  pickStoryHook,
  prioritizeNarrationLint,
  researchFactsWithIds,
  scriptCritiqueNeedsRewrite,
  ScriptCritiqueInputSchema,
  ScriptCritiqueSchema,
  ScriptSchema,
  ScriptSectionSchema,
  STORY_FRAMEWORKS_BY_RECIPE,
  StoryOutlineResponseSchema,
  validateStoryOutline,
  type FormatRecipe,
  type FormatRecipeId,
  type HookAssessment,
  type HookCandidate,
  type HookTactic,
  type LlmCallUsage,
  type Project,
  type ResearchNotes,
  type Script,
  type ScriptCritique,
  type ScriptSection,
  type StoryOutline,
} from "@vg/shared";
import type { AppConfig } from "../../lib/config.js";
import { StageError, type StageContext } from "../../pipeline/stageExecutor.js";
import type { LlmCache } from "../../providers/llm/cache.js";
import { estimateLlmCost } from "../../providers/llm/pricing.js";
import type { LlmProviderRegistry, ResolvedLlmRoute } from "../../providers/llm/registry.js";
import { generateRoutedStructured } from "../../providers/llm/structured.js";
import { LlmError } from "../../providers/llm/types.js";
import { blockingNote } from "../../operator/qualityGates.js";
import { narrationRulesBlock, WRITER_SYSTEM } from "./narrationRules.js";
import { checkScriptDuration, computeSectionDurations, scriptTotalDuration } from "./scriptUtils.js";
import { formatGuidance, projectRecipe } from "./prompt.js";

export type StoryEngineResult =
  | {
      fallback: false;
      /** TASK-146 outline mode: the run stopped after the outline and hooks, for the user to approve. */
      parked: true;
      outline: StoryOutline;
      hookCandidates: HookCandidate[];
      provider: string;
      model: string;
      spentCost: number;
      spentCalls: number;
      spentInputTokens: number;
      spentOutputTokens: number;
      callUsages: LlmCallUsage[];
      featureCounts: Record<string, number>;
    }
  | {
      fallback: false;
      parked: false;
      script: Script;
      provider: string;
      model: string;
      qualityScore: number;
      blockingFacts: number;
      reviewNotes: string[];
      draft: {
        outline: StoryOutline;
        hookCandidates: HookCandidate[];
        chosenHookId: string;
        hookAssessments?: HookAssessment[];
        critique: ScriptCritique;
        critiqueHistory: Array<{ round: number; total: number; scores: ScriptCritique["scores"] }>;
      };
      spentCost: number;
      spentCalls: number;
      spentInputTokens: number;
      spentOutputTokens: number;
      callUsages: LlmCallUsage[];
      featureCounts: Record<string, number>;
    }
  | {
      fallback: true;
      fallbackNote: string;
      spentCost: number;
      spentCalls: number;
      spentInputTokens: number;
      spentOutputTokens: number;
      callUsages: LlmCallUsage[];
      featureCounts: Record<string, number>;
    };

export async function runStoryEngine(params: {
  project: Project;
  applicableResearch: ResearchNotes | undefined;
  engineMode: "lite" | "full";
  scriptGuidance: string;
  channelDirection?: string;
  learnedNotes?: string;
  ownerRules?: string;
  context: StageContext;
  sqlite: Database.Database;
  registry: LlmProviderRegistry;
  cache: LlmCache;
  config: AppConfig;
  appRouting?: Parameters<LlmProviderRegistry["resolveTask"]>[2];
  inputHash: string;
  cacheKeyExtra: string;
  /** TASK-146 outline mode: stop after step 1 (outline + hooks) and return them as `parked`. */
  parkAfterOutline?: boolean;
  /** TASK-146 outline mode: an approved outline resumes from step 2 (no outline call); it is validated again. */
  resumeOutline?: { outline: StoryOutline; hookCandidates: HookCandidate[] };
}): Promise<StoryEngineResult> {
  const {
    project,
    applicableResearch,
    engineMode,
    scriptGuidance,
    channelDirection,
    learnedNotes,
    ownerRules,
    context,
    sqlite,
    registry,
    cache,
    config,
    appRouting,
    inputHash,
    cacheKeyExtra,
    parkAfterOutline,
    resumeOutline,
  } = params;

  let spentCost = 0;
  let spentCalls = 0;
  let spentInputTokens = 0;
  let spentOutputTokens = 0;
  const callUsages: LlmCallUsage[] = [];
  const featureCounts: Record<string, number> = {};

  function recordCall(
    feature: string,
    usage: { inputTokens: number; outputTokens: number; llmCalls?: number; calls?: LlmCallUsage[]; tokensUnknown?: boolean },
    provider: string,
    model: string,
  ) {
    spentCalls += usage.llmCalls ?? 1;
    spentInputTokens += usage.inputTokens;
    spentOutputTokens += usage.outputTokens;
    featureCounts[feature] = (featureCounts[feature] ?? 0) + (usage.llmCalls ?? 1);
    if (usage.calls && usage.calls.length > 0) {
      callUsages.push(...usage.calls);
    } else {
      callUsages.push({
        task: feature,
        provider,
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cached: false,
        fallback: false,
        ok: true,
      });
    }
    spentCost += estimateLlmCost(config, provider, model, usage);
  }

  const recipe = projectRecipe(project);
  const factsWithIds = applicableResearch ? researchFactsWithIds(applicableResearch) : [];
  const researchSummary = applicableResearch?.summary ?? "";
  const allowedFrameworks = STORY_FRAMEWORKS_BY_RECIPE[recipe.id as FormatRecipeId] ?? ["question_driven", "three_act"];
  const allowedTactics = hookTacticsForRecipe(recipe);

  // --------------------------------------------------------------------------
  // Step 1: Outline + hooks (1 call, storyOutline)
  // --------------------------------------------------------------------------
  context.reportProgress(20, "Creating story outline and hook candidates");
  let outlineRoute: ResolvedLlmRoute;
  try {
    outlineRoute = registry.resolveTask("storyOutline", project, appRouting);
  } catch {
    outlineRoute = registry.resolveTask("script", project, appRouting);
  }

  const outlineSystem = [
    "You are a master story architect for video narration.",
    "Your goal is to structure a compelling narrative before writing any narration text.",
    "Decide the central question, promise, framework, turning points, surprises, beats, open/closed loops, and setup/payoffs.",
    "Generate 3 distinct hook candidates using 3 different tactics from the allowed list.",
    narrationRulesBlock(),
  ].join("\n\n");

  const outlinePrompt = [
    `Topic: ${project.topic}`,
    project.description ? `Description: ${project.description}` : "",
    `Language: ${project.settings.language}`,
    `Target duration: ${project.settings.targetDurationSec} seconds`,
    `Recipe format: ${recipe.id} (${recipe.nameVi})`,
    formatGuidance(project),
    `Allowed frameworks for this recipe: ${allowedFrameworks.join(", ")}`,
    `Allowed hook tactics for this recipe: ${allowedTactics.join(", ")}`,
    channelDirection ? `Channel direction: ${channelDirection}` : "",
    learnedNotes ? `Learned notes: ${learnedNotes}` : "",
    scriptGuidance ? `Guidelines:\n${scriptGuidance}` : "",
    ownerRules ? `Owner rules:\n${ownerRules}` : "",
    factsWithIds.length > 0
      ? `Research key facts with stable IDs (use these IDs in outline beats and surprises):\n${factsWithIds.map((f) => `[${f.id}] ${f.fact}${f.sourceHint ? ` (Source: ${f.sourceHint})` : ""}`).join("\n")}`
      : "No research facts provided.",
    "Requirements:",
    "- outline.framework must be one of the allowed frameworks listed above.",
    "- Each beat.sectionKey must match a section key from the recipe structure.",
    "- All required recipe section keys must be present.",
    "- Every loop opened must be closed by a strictly later beat.",
    "- Beat durations (targetSec) must sum to within 10% of target duration.",
    "- Provide exactly 3 hooks using 3 DIFFERENT tactics from the allowed hook tactics.",
  ].filter(Boolean).join("\n\n");

  let outlineResult: { outline: StoryOutline; hooks: HookCandidate[] };
  let primaryProvider = outlineRoute.provider.id;
  let primaryModel = outlineRoute.model;

  if (resumeOutline) {
    // An approved outline is trusted only after it passes the same checks as a fresh one. Failing here throws:
    // it must not drop into the single-pass fallback below, which would ignore the approval.
    const shape = StoryOutlineResponseSchema.safeParse({ outline: resumeOutline.outline, hooks: resumeOutline.hookCandidates });
    // Both failures are typed so the executor can clear the stale approval; the next attempt then parks a fresh outline.
    if (!shape.success) {
      const issue = shape.error.issues[0];
      throw new StageError(`Approved outline is no longer valid: ${issue ? `${issue.path.join(".")}: ${issue.message}` : "malformed outline"}`, "APPROVED_OUTLINE_INVALID", true);
    }
    const resumed = shape.data;
    const resumeErrors = validateStoryOutline(
      resumed,
      recipe,
      applicableResearch ?? { summary: project.topic, keyFacts: [], timeline: [], angles: [], outline: [], cautions: [] },
      project.settings.targetDurationSec,
    );
    if (resumeErrors.length > 0) throw new StageError(`Approved outline is no longer valid: ${resumeErrors[0]}`, "APPROVED_OUTLINE_INVALID", true);
    outlineResult = resumed;
  } else try {
    const generatedOutline = await generateRoutedStructured({
      registry,
      route: outlineRoute,
      task: "storyOutline",
      knowledgeProject: project,
      knowledgeQuery: [project.topic, researchSummary].filter(Boolean).join(" "),
      system: outlineSystem,
      prompt: outlinePrompt,
      schema: StoryOutlineResponseSchema,
      schemaName: "StoryOutlineResponse",
      schemaVersion: "1",
      maxOutputTokens: 4000,
      repairAttempts: 1,
      signal: context.signal,
      cache,
      cacheKeyExtra: `${cacheKeyExtra}:outline`,
      logger: context.logger,
    });
    recordCall("storyOutline", generatedOutline.usage, generatedOutline.provider, generatedOutline.model);
    outlineResult = generatedOutline.value;
    primaryProvider = generatedOutline.provider;
    primaryModel = generatedOutline.model;

    // Validate in code
    const validationErrors = validateStoryOutline(
      outlineResult,
      recipe,
      applicableResearch ?? { summary: project.topic, keyFacts: [], timeline: [], angles: [], outline: [], cautions: [] },
      project.settings.targetDurationSec,
    );

    if (validationErrors.length > 0) {
      context.logger.warn({ errors: validationErrors }, "Story outline validation failed; attempting one repair call");
      const repairPrompt = [
        outlinePrompt,
        "PREVIOUS OUTLINE PRODUCED VALIDATION ERRORS. FIX EACH OF THE FOLLOWING ISSUES:",
        ...validationErrors.map((err) => `- ${err}`),
      ].join("\n\n");

      const repaired = await generateRoutedStructured({
        registry,
        route: outlineRoute,
        task: "storyOutline",
        knowledgeProject: project,
        knowledgeQuery: [project.topic, researchSummary].filter(Boolean).join(" "),
        system: outlineSystem,
        prompt: repairPrompt,
        schema: StoryOutlineResponseSchema,
        schemaName: "StoryOutlineResponse",
        schemaVersion: "1",
        maxOutputTokens: 4000,
        repairAttempts: 0,
        signal: context.signal,
        cache,
        cacheKeyExtra: `${cacheKeyExtra}:outline:repair`,
        logger: context.logger,
      });
      recordCall("storyOutline", repaired.usage, repaired.provider, repaired.model);

      const secondErrors = validateStoryOutline(
        repaired.value,
        recipe,
        applicableResearch ?? { summary: project.topic, keyFacts: [], timeline: [], angles: [], outline: [], cautions: [] },
        project.settings.targetDurationSec,
      );

      if (secondErrors.length > 0) {
        context.logger.warn({ errors: secondErrors }, "Story outline repair failed; falling back to single-pass");
        return {
          fallback: true,
          fallbackNote: `[engine-fallback] Outline validation failed (${secondErrors[0] ?? "unknown"}); fell back to single pass`,
          spentCost,
          spentCalls,
          spentInputTokens,
          spentOutputTokens,
          callUsages,
          featureCounts,
        };
      }
      outlineResult = repaired.value;
    }
  } catch (error) {
    if (error instanceof LlmError && error.usage) {
      recordCall("storyOutline", error.usage, outlineRoute.provider.id, outlineRoute.model);
    }
    context.logger.warn({ error }, "Story outline call failed; falling back to single-pass");
    return {
      fallback: true,
      fallbackNote: `[engine-fallback] Story outline generation failed (${error instanceof Error ? error.message : "error"}); fell back to single pass`,
      spentCost,
      spentCalls,
      spentInputTokens,
      spentOutputTokens,
      callUsages,
      featureCounts,
    };
  }

  if (parkAfterOutline && !resumeOutline) {
    return {
      fallback: false,
      parked: true,
      outline: outlineResult.outline,
      hookCandidates: outlineResult.hooks,
      provider: primaryProvider,
      model: primaryModel,
      spentCost,
      spentCalls,
      spentInputTokens,
      spentOutputTokens,
      callUsages,
      featureCounts,
    };
  }

  // --------------------------------------------------------------------------
  // Step 2: Hook pick (1 call in full mode, or pick first in lite)
  // --------------------------------------------------------------------------
  let chosenHook: HookCandidate;
  let hookAssessments: HookAssessment[] | undefined;

  if (engineMode === "lite") {
    chosenHook = outlineResult.hooks[0]!;
  } else {
    context.reportProgress(35, "Evaluating hook candidates with critic");
    let criticRoute: ResolvedLlmRoute;
    try {
      criticRoute = registry.resolveTask("scriptCritic", project, appRouting);
    } catch {
      criticRoute = registry.resolveTask("scriptReview", project, appRouting);
    }

    // Query recent hook tactics for tie-breaking
    const recentTactics = recentHookTactics(sqlite, project.profileId ?? "");

    const hookAssessmentSystem =
      "You are a narrative critic scoring hook candidates for a video. Score each hook 0–5 on clarity, curiosity, accuracy against research facts, audience fit, and whether the outline can pay it off.";

    const hookAssessmentPrompt = JSON.stringify({
      topic: project.topic,
      centralQuestion: outlineResult.outline.centralQuestion,
      promise: outlineResult.outline.promise,
      researchSummary,
      keyFacts: factsWithIds,
      hooks: outlineResult.hooks,
    }, null, 2);

    try {
      const assessed = await generateRoutedStructured({
        registry,
        route: criticRoute,
        task: "scriptCritic",
        knowledgeProject: project,
        knowledgeQuery: project.topic,
        system: hookAssessmentSystem,
        prompt: hookAssessmentPrompt,
        schema: HookAssessmentsSchema,
        schemaName: "HookAssessments",
        schemaVersion: "1",
        maxOutputTokens: 1000,
        repairAttempts: 1,
        signal: context.signal,
        cache,
        cacheKeyExtra: `${cacheKeyExtra}:hooks`,
        logger: context.logger,
      });
      recordCall("scriptCritic", assessed.usage, assessed.provider, assessed.model);
      hookAssessments = assessed.value.hooks;
      chosenHook = pickStoryHook(outlineResult.hooks, hookAssessments, recentTactics);
    } catch (error) {
      if (error instanceof LlmError && error.usage) {
        recordCall("scriptCritic", error.usage, criticRoute.provider.id, criticRoute.model);
      }
      context.logger.warn({ error }, "Hook assessment call failed; using first candidate");
      chosenHook = outlineResult.hooks[0]!;
    }
  }

  // --------------------------------------------------------------------------
  // Step 3: Narration (1 call, script)
  // --------------------------------------------------------------------------
  context.reportProgress(50, "Writing narration from approved outline");
  let scriptRoute: ResolvedLlmRoute;
  try {
    scriptRoute = registry.resolveTask("script", project, appRouting);
  } catch {
    scriptRoute = outlineRoute;
  }

  const narrationSystem = [
    WRITER_SYSTEM,
    narrationRulesBlock(),
    "Write the complete script adhering strictly to the approved outline beats and chosen hook.",
    "One section per beat, or merge adjacent beats sharing a sectionKey.",
    "Preserve beat metadata: sectionKey, beatPurpose, emotion, visualIntent, factIds, opensLoops, closesLoops.",
  ].join("\n\n");

  const narrationPrompt = JSON.stringify({
    topic: project.topic,
    language: project.settings.language,
    targetDurationSec: project.settings.targetDurationSec,
    outline: outlineResult.outline,
    chosenHook: { id: chosenHook.id, tactic: chosenHook.tactic, text: chosenHook.text, promise: chosenHook.promise },
    researchFacts: factsWithIds,
    recipe: { id: recipe.id, nameVi: recipe.nameVi },
    guidelines: scriptGuidance || undefined,
  }, null, 2);

  const narrationGenerated = await generateRoutedStructured({
    registry,
    route: scriptRoute,
    task: "script",
    knowledgeProject: project,
    knowledgeQuery: [project.topic, researchSummary].filter(Boolean).join(" "),
    system: narrationSystem,
    prompt: narrationPrompt,
    schema: ScriptSchema,
    schemaName: "Script",
    schemaVersion: "3",
    maxOutputTokens: 4000,
    repairAttempts: 1,
    signal: context.signal,
    cache,
    cacheKeyExtra: `${cacheKeyExtra}:narration`,
    logger: context.logger,
  });
  recordCall("script", narrationGenerated.usage, narrationGenerated.provider, narrationGenerated.model);

  const seenIds = new Set<string>();
  const writtenSections: ScriptSection[] = (narrationGenerated.value.sections ?? []).map((sec, idx) => {
    let id = sec.id?.trim() || `sec-${idx + 1}`;
    if (seenIds.has(id)) {
      id = `${id}-${idx + 1}`;
    }
    seenIds.add(id);
    return { ...sec, id, sectionKey: sec.sectionKey ?? `section_${idx + 1}` };
  });
  // Approved outline beats are authoritative for beat metadata (TASK-145 P2): the writer's copy is not trusted.
  const binding = bindSectionsToBeats(writtenSections, outlineResult.outline.beats);
  if (binding.note) context.logger.warn({ note: binding.note }, binding.note);
  const mappedSections: ScriptSection[] = binding.sections;

  let currentScript: Script = {
    ...narrationGenerated.value,
    sections: mappedSections,
    hook: chosenHook.text,
    centralQuestion: outlineResult.outline.centralQuestion,
    framework: outlineResult.outline.framework,
  };
  primaryProvider = narrationGenerated.provider;
  primaryModel = narrationGenerated.model;

  // --------------------------------------------------------------------------
  // Step 4 & 5: Lint + Critic & Targeted Rewrite
  // --------------------------------------------------------------------------
  let criticRoute: ResolvedLlmRoute;
  try {
    criticRoute = registry.resolveTask("scriptCritic", project, appRouting);
  } catch {
    criticRoute = registry.resolveTask("scriptReview", project, appRouting);
  }

  const criticSystem = [
    "You are an independent narrative critic and script reviewer for video narration.",
    "Evaluate the script against the 6 research rubric criteria: structure (20%), hook (20%), accuracy (20%), ttsNatural (15%), visualizable (15%), originality (10%).",
    "Each score must be an integer from 0 to 5.",
    "List specific section issues with concrete actionable fixes.",
    "Do NOT rewrite the script yourself; only judge and diagnose.",
  ].join("\n\n");

  const critiqueHistory: Array<{ round: number; total: number; scores: ScriptCritique["scores"] }> = [];

  async function evaluateScript(script: Script, round: number): Promise<{ critique: ScriptCritique; hasFixLint: boolean; lintFindings: ReturnType<typeof lintNarration> }> {
    const rawLint = lintNarration(script, recipe, project.settings.language);
    const sortedLint = prioritizeNarrationLint(rawLint);
    const hasFixLint = sortedLint.some((f) => f.severity === "fix");

    const criticPrompt = JSON.stringify({
      topic: project.topic,
      outline: outlineResult.outline,
      chosenHook,
      script,
      researchFacts: factsWithIds,
      lintFindings: sortedLint,
    }, null, 2);

    const generated = await generateRoutedStructured({
      registry,
      route: criticRoute,
      task: "scriptCritic",
      knowledgeProject: project,
      knowledgeQuery: project.topic,
      system: criticSystem,
      prompt: criticPrompt,
      schema: ScriptCritiqueInputSchema,
      schemaName: "ScriptCritique",
      schemaVersion: "1",
      maxOutputTokens: 2500,
      repairAttempts: 1,
      signal: context.signal,
      cache,
      cacheKeyExtra: `${cacheKeyExtra}:critic:round${round}`,
      logger: context.logger,
    });
    recordCall("scriptCritic", generated.usage, generated.provider, generated.model);

    // Code computes total, never trusted from LLM
    const critique = computeScriptCritique(generated.value);
    critiqueHistory.push({ round, total: critique.total, scores: critique.scores });
    return { critique, hasFixLint, lintFindings: sortedLint };
  }

  context.reportProgress(65, "Evaluating narration with critic");
  let { critique, hasFixLint, lintFindings } = await evaluateScript(currentScript, 1);

  // Step 5: Targeted rewrite (0-2 calls)
  const maxRewriteRounds = engineMode === "full" ? 2 : 1;
  let rewriteRound = 0;

  while (rewriteRound < maxRewriteRounds && scriptCritiqueNeedsRewrite(critique, hasFixLint)) {
    rewriteRound += 1;
    context.reportProgress(70, `Targeted rewrite round ${rewriteRound}/${maxRewriteRounds}`);

    let rewriteRoute: ResolvedLlmRoute;
    try {
      rewriteRoute = registry.resolveTask("scriptRewrite", project, appRouting);
    } catch {
      rewriteRoute = registry.resolveTask("scriptReview", project, appRouting);
    }

    const failingSectionIds = new Set(critique.sectionIssues.map((issue) => issue.sectionId));
    // Also include sections with fix lint
    for (const f of lintFindings) {
      if (f.severity === "fix" && f.sectionId !== "outro") failingSectionIds.add(f.sectionId);
    }

    const RewriteOutputSchema = z.object({
      hook: z.string().optional(),
      sections: z.array(ScriptSectionSchema).optional(),
      outro: z.string().optional(),
    }).strict();

    const rewriteSystem = [
      "You rewrite ONLY the failing sections of a video script.",
      "Keep all other sections untouched.",
      "Neighbouring sections' first and last sentences are provided for smooth transitions.",
      "Ensure fixed sections address the diagnostic issues and adhere to narration rules.",
      narrationRulesBlock(),
    ].join("\n\n");

    const sectionsContext = currentScript.sections.map((sec, idx) => ({
      id: sec.id,
      heading: sec.heading,
      isFailing: failingSectionIds.has(sec.id),
      prevLastSentence: idx > 0 ? currentScript.sections[idx - 1]!.narration.split(/[.?!]/).filter(Boolean).slice(-1)[0]?.trim() : currentScript.hook,
      currentNarration: sec.narration,
      nextFirstSentence: idx < currentScript.sections.length - 1 ? currentScript.sections[idx + 1]!.narration.split(/[.?!]/).filter(Boolean)[0]?.trim() : currentScript.outro,
      issues: critique.sectionIssues.filter((i) => i.sectionId === sec.id),
      lintIssues: lintFindings.filter((l) => l.sectionId === sec.id),
    }));

    const allowHookRewrite = !critique.hookPaidOff || critique.scores.hook < 3;
    const allowOutroRewrite = !critique.hookPaidOff || lintFindings.some((l) => l.sectionId === "outro");

    const rewritePrompt = JSON.stringify({
      topic: project.topic,
      outline: outlineResult.outline,
      critiqueIssues: critique.sectionIssues,
      rewriteHook: allowHookRewrite,
      rewriteOutro: allowOutroRewrite,
      sections: sectionsContext,
    }, null, 2);

    try {
      const rewritten = await generateRoutedStructured({
        registry,
        route: rewriteRoute,
        task: "scriptRewrite",
        knowledgeProject: project,
        knowledgeQuery: project.topic,
        system: rewriteSystem,
        prompt: rewritePrompt,
        schema: RewriteOutputSchema,
        schemaName: "RewriteOutput",
        schemaVersion: "1",
        maxOutputTokens: 3000,
        repairAttempts: 1,
        signal: context.signal,
        cache,
        cacheKeyExtra: `${cacheKeyExtra}:rewrite:round${rewriteRound}`,
        logger: context.logger,
      });
      recordCall("scriptRewrite", rewritten.usage, rewritten.provider, rewritten.model);

      const returnedSectionsMap = new Map((rewritten.value.sections ?? []).map((s) => [s.id, s]));
      const nextSections = currentScript.sections.map((original) => {
        // Enforce strict allowlist: non-failing sections are byte-identical!
        if (!failingSectionIds.has(original.id)) return original;
        const replacement = returnedSectionsMap.get(original.id);
        if (!replacement) return original;
        return {
          ...original,
          narration: replacement.narration,
          heading: replacement.heading || original.heading,
          visualQueries: replacement.visualQueries || original.visualQueries,
          visualNotes: replacement.visualNotes || original.visualNotes,
          musicMood: replacement.musicMood || original.musicMood,
          energy: replacement.energy || original.energy,
        };
      });

      const nextScript: Script = {
        ...currentScript,
        sections: nextSections,
        hook: allowHookRewrite && rewritten.value.hook ? rewritten.value.hook : currentScript.hook,
        outro: allowOutroRewrite && rewritten.value.outro ? rewritten.value.outro : currentScript.outro,
      };

      const prevTotal = critique.total;
      const nextEval = await evaluateScript(nextScript, rewriteRound + 1);
      const gain = nextEval.critique.total - prevTotal;

      if (gain <= 0) {
        context.logger.info({ prevTotal, nextTotal: nextEval.critique.total, gain }, "Rewrite round did not improve score; reverting and stopping");
        // Revert to previous script and stop
        break;
      }

      currentScript = nextScript;
      critique = nextEval.critique;
      hasFixLint = nextEval.hasFixLint;
      lintFindings = nextEval.lintFindings;

      // Stop early when score gain is less than 3 (including gain 1 and 2)
      if (gain < 3) {
        context.logger.info({ prevTotal, nextTotal: nextEval.critique.total, gain }, "Rewrite round gain < 3; stopping early");
        break;
      }
    } catch (error) {
      if (error instanceof LlmError && error.usage) {
        recordCall("scriptRewrite", error.usage, rewriteRoute.provider.id, rewriteRoute.model);
      }
      context.logger.warn({ error }, "Targeted rewrite call failed; keeping current script");
      break;
    }
  }

  // --------------------------------------------------------------------------
  // Step 6: Length fit (0–1 call, scriptLengthFit)
  // --------------------------------------------------------------------------
  const durationCheckBeforeFit = computeSectionDurations(currentScript, config.SPEECH_WORDS_PER_MINUTE);
  const totalSec = scriptTotalDuration(durationCheckBeforeFit, config.SPEECH_WORDS_PER_MINUTE);
  const targetSec = project.settings.targetDurationSec;
  const isOutsideLength = Math.abs(totalSec - targetSec) > targetSec * 0.15;
  let lengthFitNote: string | undefined;

  if (isOutsideLength) {
    context.reportProgress(80, `Adjusting script length (${totalSec}s vs target ${targetSec}s)`);
    let lengthRoute: ResolvedLlmRoute;
    try {
      lengthRoute = registry.resolveTask("scriptLengthFit", project, appRouting);
    } catch {
      lengthRoute = registry.resolveTask("script", project, appRouting);
    }

    const lengthFitSystem = [
      "You are a timing editor for video narration.",
      "Adjust section narration lengths so total spoken duration closely matches targetDurationSec.",
      "Keep each section's concrete moment, its loop lines, its hook payoff, and section ids.",
      "Do NOT alter the core beats, surprises, or tone.",
      narrationRulesBlock(),
    ].join("\n\n");

    const lengthFitPrompt = JSON.stringify({
      currentScript,
      currentDurationSec: totalSec,
      targetDurationSec: targetSec,
      wordsPerMinute: config.SPEECH_WORDS_PER_MINUTE,
    }, null, 2);

    try {
      const fitted = await generateRoutedStructured({
        registry,
        route: lengthRoute,
        task: "scriptLengthFit",
        knowledgeProject: project,
        knowledgeQuery: project.topic,
        system: lengthFitSystem,
        prompt: lengthFitPrompt,
        schema: ScriptSchema,
        schemaName: "Script",
        schemaVersion: "3",
        maxOutputTokens: 4000,
        repairAttempts: 1,
        signal: context.signal,
        cache,
        cacheKeyExtra: `${cacheKeyExtra}:lengthFit`,
        logger: context.logger,
      });
      recordCall("scriptLengthFit", fitted.usage, fitted.provider, fitted.model);

      // Check if lint worsened
      const preLint = lintNarration(currentScript, recipe, project.settings.language);
      const postLint = lintNarration(fitted.value, recipe, project.settings.language);
      const preFixes = preLint.filter((f) => f.severity === "fix").length;
      const postFixes = postLint.filter((f) => f.severity === "fix").length;

      // The current script's metadata wins; a length fit that changes section ids or count is reverted.
      const sectionsWithMeta = keepScriptMetadata(fitted.value.sections, currentScript.sections);
      if (!sectionsWithMeta) {
        lengthFitNote = "[length-fit] Reverted length fit because section ids or count changed";
        context.logger.info("Reverted length fit because section ids or count changed");
      } else if (postFixes > preFixes || (postFixes === preFixes && postLint.length > preLint.length)) {
        lengthFitNote = "[length-fit] Reverted length fit because narration lint worsened";
        context.logger.info("Reverted length fit because narration lint worsened");
      } else {
        currentScript = {
          ...fitted.value,
          sections: sectionsWithMeta,
          centralQuestion: currentScript.centralQuestion,
          framework: currentScript.framework,
        };
      }
    } catch (error) {
      if (error instanceof LlmError && error.usage) {
        recordCall("scriptLengthFit", error.usage, lengthRoute.provider.id, lengthRoute.model);
      }
      lengthFitNote = `[length-fit] Length fit skipped (${error instanceof Error ? error.message : "error"})`;
      context.logger.warn({ error }, "Length fit call failed; keeping current script");
    }
  }

  // --------------------------------------------------------------------------
  // Step 8: Result assembling
  // --------------------------------------------------------------------------
  const finalWithDurations = computeSectionDurations(currentScript, config.SPEECH_WORDS_PER_MINUTE);
  const qualityScore = Math.round((critique.total / 10) * 10) / 10;
  let blockingFacts = 0;
  if (critique.scores.accuracy < 3) {
    blockingFacts = 1;
  }

  // Assemble review_notes: top issues, lint notes, engine fallbacks (cap at 8)
  const topIssues = critique.sectionIssues.slice(0, 4).map((issue) => `[${issue.criterion}] ${issue.sectionId}: ${issue.problem}`);
  if (critique.scores.accuracy < 3) {
    topIssues.unshift(blockingNote("Độ chính xác chưa đạt (accuracy < 3/5)"));
  }
  if (!critique.hookPaidOff) {
    topIssues.push("Hook chưa được giải quyết ở phần kết (hookPaidOff = false)");
  }

  const finalLint = prioritizeNarrationLint(lintNarration(finalWithDurations, recipe, project.settings.language))
    .slice(0, 3)
    .map((f) => `[lint] ${f.code} (${f.sectionId}): ${f.message}`);

  const reviewNotes = [
    ...topIssues,
    ...finalLint,
    ...(lengthFitNote ? [lengthFitNote] : []),
  ].slice(0, 8);

  return {
    fallback: false,
    parked: false,
    script: finalWithDurations,
    provider: primaryProvider,
    model: primaryModel,
    qualityScore,
    blockingFacts,
    reviewNotes,
    draft: {
      outline: outlineResult.outline,
      hookCandidates: outlineResult.hooks,
      chosenHookId: chosenHook.id,
      hookAssessments,
      critique,
      critiqueHistory,
    },
    spentCost,
    spentCalls,
    spentInputTokens,
    spentOutputTokens,
    callUsages,
    featureCounts,
  };
}

type BeatLike = {
  sectionKey: string;
  purpose?: string;
  emotion?: string;
  visualIntent?: string;
  factIds?: string[];
  opensLoops?: string[];
  closesLoops?: string[];
};

const unique = (values: string[]) => [...new Set(values)];

// TASK-145 P2: bind the writer's sections to the approved outline beats by order, never by key alone.
// Same count as beats: one section per beat. Same count as consecutive same-key runs: one section per run.
// Otherwise the writer's metadata is kept, with factIds not in the outline dropped, and a note is returned.
export function bindSectionsToBeats<B extends BeatLike>(sections: ScriptSection[], beats: B[]): { sections: ScriptSection[]; note?: string } {
  if (beats.length === 0) return { sections };
  const runs: B[][] = [];
  for (const beat of beats) {
    const last = runs[runs.length - 1];
    if (last && last[0]!.sectionKey === beat.sectionKey) last.push(beat);
    else runs.push([beat]);
  }
  const apply = (sec: ScriptSection, group: B[], key: string): ScriptSection => {
    const first = group[0]!;
    return {
      ...sec,
      sectionKey: key,
      beatPurpose: (first.purpose ?? sec.beatPurpose) as ScriptSection["beatPurpose"],
      emotion: (first.emotion ?? sec.emotion) as ScriptSection["emotion"],
      visualIntent: first.visualIntent ?? sec.visualIntent,
      factIds: unique(group.flatMap((b) => b.factIds ?? [])),
      opensLoops: unique(group.flatMap((b) => b.opensLoops ?? [])),
      closesLoops: unique(group.flatMap((b) => b.closesLoops ?? [])),
    };
  };
  if (sections.length === beats.length) {
    return { sections: sections.map((sec, i) => apply(sec, [beats[i]!], beats[i]!.sectionKey)) };
  }
  if (sections.length === runs.length) {
    return { sections: sections.map((sec, i) => apply(sec, runs[i]!, runs[i]![0]!.sectionKey)) };
  }
  // Ambiguous count: keep the writer's values, fill only the gaps from the beat with the same index or key,
  // and drop factIds that the outline does not contain.
  const known = new Set(beats.flatMap((b) => b.factIds ?? []));
  const pickBeat = (sec: ScriptSection, idx: number): B | undefined =>
    beats.find((b) => b.sectionKey === sec.sectionKey) ?? beats[idx];
  return {
    sections: sections.map((sec, idx) => {
      const beat = pickBeat(sec, idx);
      const writerFacts = (sec.factIds ?? []).filter((id) => known.has(id));
      return {
        ...sec,
        sectionKey: sec.sectionKey ?? beat?.sectionKey,
        beatPurpose: sec.beatPurpose ?? (beat?.purpose as ScriptSection["beatPurpose"] | undefined),
        emotion: sec.emotion ?? (beat?.emotion as ScriptSection["emotion"] | undefined),
        visualIntent: sec.visualIntent ?? beat?.visualIntent,
        factIds: writerFacts.length ? writerFacts : unique(beat?.factIds ?? []),
        opensLoops: sec.opensLoops?.length ? sec.opensLoops : unique(beat?.opensLoops ?? []),
        closesLoops: sec.closesLoops?.length ? sec.closesLoops : unique(beat?.closesLoops ?? []),
      };
    }),
    note: `[beat-binding] ${sections.length} sections for ${beats.length} beats (${runs.length} key runs): kept writer metadata, filled gaps from beats, dropped factIds outside the outline`,
  };
}

// Length fit may change text only. Metadata and ids come from the current script, bound by index.
// Returns null only when the section count changed, which is the sole revert case.
export function keepScriptMetadata(fitted: ScriptSection[], current: ScriptSection[]): ScriptSection[] | null {
  if (fitted.length !== current.length) return null;
  return fitted.map((fit, i) => {
    const orig = current[i]!;
    return {
      ...fit,
      id: orig.id,
      sectionKey: orig.sectionKey,
      beatPurpose: orig.beatPurpose,
      emotion: orig.emotion,
      visualIntent: orig.visualIntent,
      factIds: orig.factIds ?? [],
      opensLoops: orig.opensLoops ?? [],
      closesLoops: orig.closesLoops ?? [],
    };
  });
}

/**
 * Tactics of the hooks chosen in the 10 most recent drafts for a profile (tie-break input).
 * Reads chosenHookId, falling back to the legacy chosenId key.
 */
export function recentHookTactics(sqlite: Database.Database, profileId: string): HookTactic[] {
  const recentTactics: HookTactic[] = [];
  try {
    const rows = sqlite.prepare(
      "SELECT sd.hook_candidates FROM script_drafts sd JOIN projects p ON p.id = sd.project_id WHERE p.profile_id = ? ORDER BY sd.updated_at DESC LIMIT 10",
    ).all(profileId) as Array<{ hook_candidates: string | null }>;
    for (const row of rows) {
      if (!row.hook_candidates) continue;
      try {
        const parsed = JSON.parse(row.hook_candidates) as { candidates?: HookCandidate[]; chosenId?: string; chosenHookId?: string };
        const chosenId = parsed.chosenHookId ?? parsed.chosenId;
        const picked = parsed.candidates?.find((c) => c.id === chosenId);
        if (picked?.tactic) recentTactics.push(picked.tactic);
      } catch {
        // ignore parsing error
      }
    }
  } catch {
    // ignore query error
  }
  return recentTactics;
}

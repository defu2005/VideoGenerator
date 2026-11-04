import { MergedStorySchema, ResearchNotesSchema, type LlmCallUsage } from "@vg/shared";
import type Database from "better-sqlite3";
import type { AppConfig } from "../../lib/config.js";
import { StageError, type StageContext, type StageExecutor } from "../../pipeline/stageExecutor.js";
import { LlmCache } from "../../providers/llm/cache.js";
import { estimateLlmCost } from "../../providers/llm/pricing.js";
import type { LlmProviderRegistry } from "../../providers/llm/registry.js";
import type { ResolvedLlmRoute } from "../../providers/llm/registry.js";
import { generateRoutedStructured } from "../../providers/llm/structured.js";
import { LlmError } from "../../providers/llm/types.js";
import { preflight } from "../../providers/llm/preflight.js";
import { resolveBudget, storyModeForProject } from "@vg/shared";
import { checkScriptDuration, computeSectionDurations, maxOutputTokensForDuration, scriptTotalDuration, researchInputHash } from "../script/scriptUtils.js";
import { researchPrompt } from "./prompt.js";
import { mergedStoryPrompt } from "../script/mergedStoryPrompt.js";
import { z } from "zod";
import { getAppLlmSettings } from "../../providers/llm/settings.js";
import { GuidelineService } from "../../guidelines/service.js";

type ExistingScript = { data: string; version: number; input_hash: string; review_notes: string | null };

export class ResearchExecutor implements StageExecutor {
  readonly stage = "RESEARCH" as const;
  private readonly cache: LlmCache;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly registry: LlmProviderRegistry,
    private readonly config: AppConfig,
  ) {
    this.cache = new LlmCache(sqlite, config.LLM_CACHE_ENABLED);
  }

  async run(context: StageContext) {
    context.reportProgress(10, "Building research prompt");
    const project = context.project;
    const mode = storyModeForProject(project);
    const budget = resolveBudget(project);
    const repairAttempts = budget.repairAttempts;
    let usageFeature = "research";
    let spentUsage: { llmCalls: number; inputTokens: number; outputTokens: number; tokensUnknown?: boolean; calls?: LlmCallUsage[] } | undefined;
    let usageRecorded = false;
    let selected: ResolvedLlmRoute | undefined;
    try {
      if (mode === "off") {
        throw new StageError("Research is disabled by the project's research mode.", "LLM_RESEARCH_DISABLED", false);
      }
      selected = this.registry.resolveTask("research", project, getAppLlmSettings(this.sqlite));
      const inputHash = researchInputHash(project);
      let effectiveMode = mode;
      usageFeature = mode === "merged" ? "story" : "research";
      const guidelines = new GuidelineService(this.sqlite);
      let promptInput = mode === "merged"
        ? mergedStoryPrompt(project, this.config.SPEECH_WORDS_PER_MINUTE, budget.researchDepth, guidelines.guidanceFor(project, ["script", "subtitles"]))
        : researchPrompt(project, budget.researchDepth, guidelines.guidanceFor(project, ["script"]));
      const desiredOutputTokens = Math.ceil(
        maxOutputTokensForDuration(project.settings.targetDurationSec, this.config.SPEECH_WORDS_PER_MINUTE)
          * budget.outputHeadroom,
      );
      let limitMessage: string | undefined;
      let check = preflight({
        provider: selected.provider,
        mode,
        project,
        wordsPerMinute: this.config.SPEECH_WORDS_PER_MINUTE,
        maxOutputTokens: desiredOutputTokens,
        input: promptInput,
      });
      if (check.decision === "reject") throw check.error;
      if (check.decision === "switch-to-separate") {
        limitMessage = check.message;
        effectiveMode = "separate";
        usageFeature = "research";
        promptInput = researchPrompt(project, budget.researchDepth, new GuidelineService(this.sqlite).guidanceFor(project, ["script"]));
        check = preflight({
          provider: selected.provider,
          mode: "separate",
          project,
          wordsPerMinute: this.config.SPEECH_WORDS_PER_MINUTE,
          maxOutputTokens: desiredOutputTokens,
          input: promptInput,
        });
        if (check.decision === "reject") throw check.error;
      }
      const { system, prompt } = check.input;
      const mergedSchema = MergedStorySchema.superRefine(({ script }, ctx) => {
        const { reject } = checkScriptDuration(script, project.settings.targetDurationSec, this.config.SPEECH_WORDS_PER_MINUTE);
        if (reject) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["script"], message: reject });
      });
      context.reportProgress(20, "Calling research provider");
      const request = {
        registry: this.registry,
        route: selected,
        task: "research" as const,
        system,
        prompt,
        maxOutputTokens: check.maxOutputTokens,
        repairAttempts,
        signal: context.signal,
        cache: this.cache,
        cacheKeyExtra: inputHash,
        logger: context.logger,
      };
      const generated = effectiveMode === "merged"
        ? await generateRoutedStructured({
          ...request,
          schema: mergedSchema,
          schemaName: "MergedStory",
          schemaVersion: "2",
        })
        : await generateRoutedStructured({
          ...request,
          schema: ResearchNotesSchema,
          schemaName: "ResearchNotes",
          schemaVersion: "2",
        });
      spentUsage = generated.usage;
      usageFeature = effectiveMode === "merged" ? "story" : "research";
      context.reportProgress(80, "Validating research notes");
      const costUsd = estimateLlmCost(this.config, generated.provider, generated.model, generated.usage);
      const research = effectiveMode === "merged"
        ? MergedStorySchema.parse(generated.value).research
        : ResearchNotesSchema.parse(generated.value);
      this.sqlite.prepare(
        "INSERT INTO research_notes (project_id, input_hash, provider, model, cached, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET input_hash = excluded.input_hash, provider = excluded.provider, model = excluded.model, cached = excluded.cached, created_at = excluded.created_at, data = excluded.data",
      ).run(
        project.id,
        inputHash,
        generated.provider,
        generated.model,
        generated.cached ? 1 : 0,
        new Date().toISOString(),
        JSON.stringify(research),
      );
      if (effectiveMode === "merged") {
        const merged = MergedStorySchema.parse(generated.value);
        const script = computeSectionDurations(merged.script, this.config.SPEECH_WORDS_PER_MINUTE);
        const existing = this.sqlite.prepare("SELECT data, version, input_hash, review_notes FROM scripts WHERE project_id = ?")
          .get(project.id) as ExistingScript | undefined;
        const scriptHash = researchInputHash(project);
        const scriptData = JSON.stringify(script);
        if (!(resolveBudget(project).scriptReview && existing?.review_notes && existing.input_hash === scriptHash)) {
          this.sqlite.prepare(
            "INSERT INTO scripts (project_id, data, origin, edited, input_hash, version, provider, model, updated_at, merged_call) VALUES (?, ?, 'AGENT', false, ?, ?, ?, ?, ?, true) ON CONFLICT(project_id) DO UPDATE SET review_notes = CASE WHEN ? AND scripts.data = excluded.data AND scripts.input_hash = excluded.input_hash THEN scripts.review_notes ELSE NULL END, data = excluded.data, origin = 'AGENT', edited = false, input_hash = excluded.input_hash, version = excluded.version, provider = excluded.provider, model = excluded.model, updated_at = excluded.updated_at, merged_call = true",
          ).run(
            project.id,
            scriptData,
            scriptHash,
            (existing?.version ?? 0) + (existing?.data === scriptData ? 0 : 1),
            generated.provider,
            generated.model,
            new Date().toISOString(),
            resolveBudget(project).scriptReview ? 1 : 0,
          );
        }
      }
      context.recordUsage({
        llmCalls: generated.usage.llmCalls,
        inputTokens: generated.usage.inputTokens,
        outputTokens: generated.usage.outputTokens,
        costUsd,
        provider: generated.provider,
        model: generated.model,
        ...(generated.usage.tokensUnknown ? { tokensUnknown: true } : {}),
        features: { [usageFeature]: generated.usage.llmCalls },
        calls: generated.usage.calls,
      });
      usageRecorded = true;
      context.reportProgress(100, effectiveMode === "merged" ? "Research and script saved" : "Research notes saved");
      return {
        message: limitMessage
          ? `${limitMessage}. Research notes saved; the script will run in a separate call`
          : generated.cached
            ? effectiveMode === "merged" ? "Research and script loaded from cache" : "Research notes loaded from cache"
            : effectiveMode === "merged" ? "Research and script saved from one call" : "Research notes saved",
      };
    } catch (error) {
      if (!usageRecorded) recordFailureUsage(error, context, spentUsage, selected?.provider.id, selected?.model, usageFeature);
      throw asStageError(error);
    }
  }
}

function recordFailureUsage(
  error: unknown,
  context: StageContext,
  spentUsage?: { llmCalls: number; inputTokens: number; outputTokens: number; tokensUnknown?: boolean; calls?: LlmCallUsage[] },
  provider?: string,
  model?: string,
  feature = "research",
): void {
  const usage = error instanceof LlmError ? error.usage ?? spentUsage : spentUsage;
  if (!usage) return;
  context.recordUsage({
    ...usage,
    costUsd: 0,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(usage.tokensUnknown ? { tokensUnknown: true } : {}),
    features: { [feature]: usage.llmCalls },
    ...(usage.calls ? { calls: usage.calls } : {}),
  });
}

function asStageError(error: unknown): Error {
  if (error instanceof LlmError) return new StageError(error.message, error.code, error.retryable);
  if (error instanceof SyntaxError) return new StageError(error.message, "LLM_INVALID_OUTPUT", false);
  if (error instanceof z.ZodError) return new StageError(error.message, "LLM_INVALID_OUTPUT", false);
  return error instanceof Error ? error : new Error(String(error));
}

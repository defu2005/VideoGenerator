import { MergedStorySchema, ResearchNotesSchema } from "@vg/shared";
import type Database from "better-sqlite3";
import type { AppConfig } from "../../lib/config.js";
import { StageError, type StageContext, type StageExecutor } from "../../pipeline/stageExecutor.js";
import { LlmCache } from "../../providers/llm/cache.js";
import { estimateLlmCost } from "../../providers/llm/pricing.js";
import type { LlmProviderRegistry } from "../../providers/llm/registry.js";
import { generateStructured } from "../../providers/llm/structured.js";
import { LlmError } from "../../providers/llm/types.js";
import { preflight } from "../../providers/llm/preflight.js";
import { checkScriptDuration, computeSectionDurations, maxOutputTokensForDuration, scriptTotalDuration, researchInputHash } from "../script/scriptUtils.js";
import { researchPrompt } from "./prompt.js";
import { mergedStoryPrompt } from "../script/mergedStoryPrompt.js";
import { z } from "zod";

type ExistingScript = { data: string; version: number };

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
    const mode = project.settings.researchMode ?? this.config.LLM_RESEARCH_MODE;
    let spentUsage: { llmCalls: number; inputTokens: number; outputTokens: number; tokensUnknown?: boolean } | undefined;
    let usageRecorded = false;
    let selected: ReturnType<LlmProviderRegistry["resolve"]> | undefined;
    try {
      if (mode === "off") {
        throw new StageError("Research is disabled by the project's research mode.", "LLM_RESEARCH_DISABLED", false);
      }
      selected = this.registry.resolve(project.settings.llm?.research, project.settings.llm?.default, "research");
      const inputHash = researchInputHash(project);
      let effectiveMode = mode;
      let promptInput = mode === "merged"
        ? mergedStoryPrompt(project, this.config.SPEECH_WORDS_PER_MINUTE)
        : researchPrompt(project);
      let limitMessage: string | undefined;
      let check = preflight({
        provider: selected.provider,
        mode,
        project,
        wordsPerMinute: this.config.SPEECH_WORDS_PER_MINUTE,
        maxOutputTokens: maxOutputTokensForDuration(project.settings.targetDurationSec, this.config.SPEECH_WORDS_PER_MINUTE),
        input: promptInput,
      });
      if (check.decision === "reject") throw check.error;
      if (check.decision === "switch-to-separate") {
        limitMessage = check.message;
        effectiveMode = "separate";
        promptInput = researchPrompt(project);
        check = preflight({
          provider: selected.provider,
          mode: "separate",
          project,
          wordsPerMinute: this.config.SPEECH_WORDS_PER_MINUTE,
          maxOutputTokens: maxOutputTokensForDuration(project.settings.targetDurationSec, this.config.SPEECH_WORDS_PER_MINUTE),
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
        provider: selected.provider,
        model: selected.model,
        system,
        prompt,
        maxOutputTokens: check.maxOutputTokens,
        signal: context.signal,
        cache: this.cache,
        cacheKeyExtra: inputHash,
        logger: context.logger,
      };
      const generated = effectiveMode === "merged"
        ? await generateStructured({
          ...request,
          schema: mergedSchema,
          schemaName: "MergedStory",
          schemaVersion: "2",
        })
        : await generateStructured({
          ...request,
          schema: ResearchNotesSchema,
          schemaName: "ResearchNotes",
          schemaVersion: "2",
        });
      spentUsage = generated.usage;
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
        const existing = this.sqlite.prepare("SELECT data, version FROM scripts WHERE project_id = ?")
          .get(project.id) as ExistingScript | undefined;
        const scriptHash = researchInputHash(project);
        const scriptData = JSON.stringify(script);
        this.sqlite.prepare(
          "INSERT INTO scripts (project_id, data, origin, edited, input_hash, version, provider, model, updated_at, merged_call) VALUES (?, ?, 'AGENT', false, ?, ?, ?, ?, ?, true) ON CONFLICT(project_id) DO UPDATE SET data = excluded.data, origin = 'AGENT', edited = false, input_hash = excluded.input_hash, version = excluded.version, provider = excluded.provider, model = excluded.model, updated_at = excluded.updated_at, merged_call = true",
        ).run(
          project.id,
          scriptData,
          scriptHash,
          (existing?.version ?? 0) + (existing?.data === scriptData ? 0 : 1),
          generated.provider,
          generated.model,
          new Date().toISOString(),
        );
      }
      context.recordUsage({
        llmCalls: generated.usage.llmCalls,
        inputTokens: generated.usage.inputTokens,
        outputTokens: generated.usage.outputTokens,
        costUsd,
        provider: generated.provider,
        model: generated.model,
        ...(generated.usage.tokensUnknown ? { tokensUnknown: true } : {}),
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
      if (!usageRecorded) recordFailureUsage(error, context, spentUsage, selected?.provider.id, selected?.model);
      throw asStageError(error);
    }
  }
}

function recordFailureUsage(
  error: unknown,
  context: StageContext,
  spentUsage?: { llmCalls: number; inputTokens: number; outputTokens: number; tokensUnknown?: boolean },
  provider?: string,
  model?: string,
): void {
  const usage = error instanceof LlmError ? error.usage ?? spentUsage : spentUsage;
  if (!usage) return;
  context.recordUsage({
    ...usage,
    costUsd: 0,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(usage.tokensUnknown ? { tokensUnknown: true } : {}),
  });
}

function asStageError(error: unknown): Error {
  if (error instanceof LlmError) return new StageError(error.message, error.code, error.retryable);
  if (error instanceof SyntaxError) return new StageError(error.message, "LLM_INVALID_OUTPUT", false);
  if (error instanceof z.ZodError) return new StageError(error.message, "LLM_INVALID_OUTPUT", false);
  return error instanceof Error ? error : new Error(String(error));
}

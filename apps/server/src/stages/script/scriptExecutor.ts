import { ResearchNotesSchema, ScriptSchema } from "@vg/shared";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { AppConfig } from "../../lib/config.js";
import { StageError, type StageContext, type StageExecutor } from "../../pipeline/stageExecutor.js";
import { LlmCache } from "../../providers/llm/cache.js";
import { estimateLlmCost } from "../../providers/llm/pricing.js";
import type { LlmProviderRegistry } from "../../providers/llm/registry.js";
import { generateStructured } from "../../providers/llm/structured.js";
import { LlmError } from "../../providers/llm/types.js";
import { preflight } from "../../providers/llm/preflight.js";
import { scriptPrompt } from "./prompt.js";
import { checkScriptDuration, computeSectionDurations, maxOutputTokensForDuration, researchInputHash, scriptInputHash, scriptTotalDuration } from "./scriptUtils.js";

type ResearchRow = { input_hash: string; data: string; provider: string; model: string };
type ExistingScript = {
  data: string;
  origin: "AGENT" | "USER";
  edited: number;
  input_hash: string;
  version: number;
  provider: string | null;
  model: string | null;
  merged_call: number;
};

export class ScriptExecutor implements StageExecutor {
  readonly stage = "SCRIPT" as const;
  private readonly cache: LlmCache;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly registry: LlmProviderRegistry,
    private readonly config: AppConfig,
  ) {
    this.cache = new LlmCache(sqlite, config.LLM_CACHE_ENABLED);
  }

  async run(context: StageContext) {
    context.reportProgress(10, "Building script prompt");
    const project = context.project;
    const researchRow = this.sqlite.prepare("SELECT input_hash, data, provider, model FROM research_notes WHERE project_id = ?")
      .get(project.id) as ResearchRow | undefined;
    const existing = this.sqlite.prepare("SELECT * FROM scripts WHERE project_id = ?")
      .get(project.id) as ExistingScript | undefined;
    const runMode = (this.sqlite.prepare("SELECT run_mode FROM projects WHERE id = ?")
      .get(project.id) as { run_mode: string | null } | undefined)?.run_mode;
    const researchMode = project.settings.researchMode ?? this.config.LLM_RESEARCH_MODE;
    const applicableResearch = researchMode === "off" ? undefined : researchRow;
    const mergedHash = researchInputHash(project);
    if (
      runMode === "ALL"
      && researchMode === "merged"
      && researchRow?.input_hash === mergedHash
      && existing?.merged_call
      && existing.input_hash === researchRow.input_hash
      && existing.origin === "AGENT"
      && !existing.edited
    ) {
      try {
        const parsed = ScriptSchema.parse(JSON.parse(existing.data) as unknown);
        const durationCheck = checkScriptDuration(parsed, project.settings.targetDurationSec, this.config.SPEECH_WORDS_PER_MINUTE);
        if (durationCheck.reject) {
          throw new LlmError("The merged script no longer matches the target duration.", "LLM_INVALID_OUTPUT", false);
        }
        const data = computeSectionDurations(parsed, this.config.SPEECH_WORDS_PER_MINUTE);
        this.sqlite.prepare("UPDATE scripts SET data = ?, updated_at = ? WHERE project_id = ?")
          .run(JSON.stringify(data), new Date().toISOString(), project.id);
        context.recordUsage({ llmCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 });
        const mergedMessage = durationCheck.warning
          ? `Script from merged call (0 tokens); ${durationCheck.warning}`
          : "Script from merged call (0 tokens)";
        context.reportProgress(100, mergedMessage);
        return { message: mergedMessage };
      } catch (error) {
        if (error instanceof LlmError) throw asStageError(error);
        if (error instanceof SyntaxError) throw new StageError(error.message, "LLM_INVALID_OUTPUT", false);
        if (error instanceof z.ZodError) throw new StageError(error.message, "LLM_INVALID_OUTPUT", false);
        throw error;
      }
    }

    let spentUsage: { llmCalls: number; inputTokens: number; outputTokens: number; tokensUnknown?: boolean } | undefined;
    let usageRecorded = false;
    let selected: ReturnType<LlmProviderRegistry["resolve"]> | undefined;
    try {
      selected = this.registry.resolve(project.settings.llm?.script, project.settings.llm?.default, "script");
      const research = applicableResearch
        ? ResearchNotesSchema.parse(JSON.parse(applicableResearch.data) as unknown)
        : undefined;
      const inputHash = scriptInputHash(project, applicableResearch?.input_hash);
      const initialPrompt = scriptPrompt(project, research, this.config.SPEECH_WORDS_PER_MINUTE);
      const check = preflight({
        provider: selected.provider,
        mode: "off",
        project,
        wordsPerMinute: this.config.SPEECH_WORDS_PER_MINUTE,
        maxOutputTokens: maxOutputTokensForDuration(
          project.settings.targetDurationSec,
          this.config.SPEECH_WORDS_PER_MINUTE,
        ),
        input: initialPrompt,
        ...(research ? {
          research,
          rebuildInput: (trimmedResearch) => scriptPrompt(project, trimmedResearch, this.config.SPEECH_WORDS_PER_MINUTE),
        } : {}),
      });
      if (check.decision === "reject") throw check.error;
      const { system, prompt } = check.input;
      const validatedSchema = ScriptSchema.superRefine((script, ctx) => {
        const { reject } = checkScriptDuration(script, project.settings.targetDurationSec, this.config.SPEECH_WORDS_PER_MINUTE);
        if (reject) ctx.addIssue({ code: z.ZodIssueCode.custom, message: reject });
      });
      context.reportProgress(20, "Calling script provider");
      const generated = await generateStructured({
        provider: selected.provider,
        model: selected.model,
        system,
        prompt,
        schema: validatedSchema,
        schemaName: "Script",
        schemaVersion: "2",
        maxOutputTokens: check.maxOutputTokens,
        signal: context.signal,
        cache: this.cache,
        cacheKeyExtra: inputHash,
        logger: context.logger,
      });
      spentUsage = generated.usage;
      context.reportProgress(80, "Validating script");
      const data = computeSectionDurations(generated.value, this.config.SPEECH_WORDS_PER_MINUTE);
      const costUsd = estimateLlmCost(this.config, generated.provider, generated.model, generated.usage);
      const serializedData = JSON.stringify(data);
      const version = (existing?.version ?? 0) + (existing?.data === serializedData ? 0 : 1);
      this.sqlite.prepare(
        "INSERT INTO scripts (project_id, data, origin, edited, input_hash, version, provider, model, updated_at, merged_call) VALUES (?, ?, 'AGENT', false, ?, ?, ?, ?, ?, false) ON CONFLICT(project_id) DO UPDATE SET data = excluded.data, origin = 'AGENT', edited = false, input_hash = excluded.input_hash, version = excluded.version, provider = excluded.provider, model = excluded.model, updated_at = excluded.updated_at, merged_call = false",
      ).run(
        project.id,
        serializedData,
        inputHash,
        version,
        generated.provider,
        generated.model,
        new Date().toISOString(),
      );
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
      context.reportProgress(100, "Script saved");
      return { message: generated.cached ? "Script loaded from cache" : "Script saved" };
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
  if (error instanceof z.ZodError) return new StageError(error.message, "LLM_INVALID_OUTPUT", false);
  return error instanceof Error ? error : new Error(String(error));
}

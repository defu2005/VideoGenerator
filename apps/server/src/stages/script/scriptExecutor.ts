import { ResearchNotesSchema, resolveBudget, ScriptSchema, storyModeForProject, type LlmCallUsage, type Script } from "@vg/shared";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { AppConfig } from "../../lib/config.js";
import { StageError, type StageContext, type StageExecutor } from "../../pipeline/stageExecutor.js";
import { LlmCache } from "../../providers/llm/cache.js";
import { estimateLlmCost } from "../../providers/llm/pricing.js";
import type { LlmProviderRegistry } from "../../providers/llm/registry.js";
import type { ResolvedLlmRoute } from "../../providers/llm/registry.js";
import { generateRoutedStructured } from "../../providers/llm/structured.js";
import { LlmError } from "../../providers/llm/types.js";
import { preflight } from "../../providers/llm/preflight.js";
import { scriptPrompt } from "./prompt.js";
import { checkScriptDuration, computeSectionDurations, maxOutputTokensForDuration, researchInputHash, scriptContentHash, scriptInputHash } from "./scriptUtils.js";
import { scriptReviewPrompt } from "./reviewPrompt.js";
import { getAppLlmSettings } from "../../providers/llm/settings.js";

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
  review_notes: string | null;
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
    const budget = resolveBudget(project);
    const researchMode = storyModeForProject(project);
    const applicableResearch = researchMode === "off" ? undefined : researchRow;
    const mergedHash = researchInputHash(project);
    const mergedSource = Boolean(
      runMode === "ALL"
      && researchMode === "merged"
      && researchRow?.input_hash === mergedHash
      && existing?.merged_call
      && existing.input_hash === researchRow.input_hash
      && existing.origin === "AGENT"
      && !existing.edited
    );
    if (mergedSource && (!budget.scriptReview || existing?.review_notes !== null)) {
      try {
        const parsed = ScriptSchema.parse(JSON.parse(existing!.data) as unknown);
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

    const spentUsage = { llmCalls: 0, inputTokens: 0, outputTokens: 0, tokensUnknown: false, calls: [] as LlmCallUsage[] };
    const features: Record<string, number> = {};
    let spentCost = 0;
    let usageRecorded = false;
    let activeFeature = "script";
    let selected: ResolvedLlmRoute | undefined;
    const appRouting = getAppLlmSettings(this.sqlite);
    try {
      const research = applicableResearch
        ? ResearchNotesSchema.parse(JSON.parse(applicableResearch.data) as unknown)
        : undefined;
      let script: Script;
      let mergedCall = false;
      let provider: string;
      let model: string;
      if (mergedSource) {
        script = ScriptSchema.parse(JSON.parse(existing!.data) as unknown);
        const durationCheck = checkScriptDuration(script, project.settings.targetDurationSec, this.config.SPEECH_WORDS_PER_MINUTE);
        if (durationCheck.reject) {
          throw new LlmError("The merged script no longer matches the target duration.", "LLM_INVALID_OUTPUT", false);
        }
        mergedCall = true;
        provider = existing!.provider ?? researchRow?.provider ?? "unknown";
        model = existing!.model ?? researchRow?.model ?? "unknown";
      } else {
        selected = this.registry.resolveTask("script", project, appRouting);
        const inputHash = scriptInputHash(project, applicableResearch?.input_hash);
        const initialPrompt = scriptPrompt(project, research, this.config.SPEECH_WORDS_PER_MINUTE);
        const check = preflight({
          provider: selected.provider,
          mode: "off",
          project,
          wordsPerMinute: this.config.SPEECH_WORDS_PER_MINUTE,
          maxOutputTokens: Math.ceil(maxOutputTokensForDuration(
            project.settings.targetDurationSec,
            this.config.SPEECH_WORDS_PER_MINUTE,
          ) * budget.outputHeadroom),
          input: initialPrompt,
          ...(research ? {
            research,
            rebuildInput: (trimmedResearch) => scriptPrompt(project, trimmedResearch, this.config.SPEECH_WORDS_PER_MINUTE),
          } : {}),
        });
        if (check.decision === "reject") throw check.error;
        const { system, prompt } = check.input;
        const validatedSchema = ScriptSchema.superRefine((value, ctx) => {
          const { reject } = checkScriptDuration(value, project.settings.targetDurationSec, this.config.SPEECH_WORDS_PER_MINUTE);
          if (reject) ctx.addIssue({ code: z.ZodIssueCode.custom, message: reject });
        });
        context.reportProgress(20, "Calling script provider");
        const generated = await generateRoutedStructured({
          registry: this.registry,
          route: selected,
          task: "script",
          system,
          prompt,
          schema: validatedSchema,
          schemaName: "Script",
          schemaVersion: "3",
          maxOutputTokens: check.maxOutputTokens,
          repairAttempts: budget.repairAttempts,
          signal: context.signal,
          cache: this.cache,
          cacheKeyExtra: inputHash,
          logger: context.logger,
        });
        addUsage(spentUsage, features, "script", generated.usage);
        spentCost += estimateLlmCost(this.config, generated.provider, generated.model, generated.usage);
        script = generated.value;
        provider = generated.provider;
        model = generated.model;
      }

      const baseData = computeSectionDurations(script, this.config.SPEECH_WORDS_PER_MINUTE);
      let finalData = baseData;
      let reviewNotes: string[] | null = null;
      let reviewed = false;
      let reviewSkippedCode: string | null = null;
      const baseVersion = (existing?.version ?? 0) + (existing?.data === JSON.stringify(baseData) ? 0 : 1);
      let version = baseVersion;
      if (budget.scriptReviewPasses > 0) {
        const reviewRoute = this.registry.resolveTask("scriptReview", project, appRouting);
        const reviewSchema = z.object({
          revisedScript: ScriptSchema,
          notes: z.array(z.string()).max(8),
        }).strict().superRefine(({ revisedScript }, ctx) => {
          const expectedIds = baseData.sections.map((section) => section.id);
          const actualIds = revisedScript.sections.map((section) => section.id);
          if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["revisedScript", "sections"], message: "Review must preserve section ids and order." });
          }
          const { reject } = checkScriptDuration(revisedScript, project.settings.targetDurationSec, this.config.SPEECH_WORDS_PER_MINUTE);
          if (reject) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["revisedScript"], message: reject });
        });
        let priorNotes: string[] = [];
        for (let pass = 1; pass <= budget.scriptReviewPasses; pass += 1) {
          const reviewPrompt = scriptReviewPrompt(
            project,
            research,
            finalData,
            this.config.SPEECH_WORDS_PER_MINUTE,
            pass,
            priorNotes,
          );
          const reviewHash = `${scriptInputHash(project, applicableResearch?.input_hash)}:${scriptContentHash(finalData)}:${JSON.stringify(research ?? null)}:${pass}:${JSON.stringify(priorNotes)}`;
          context.reportProgress(70, `Reviewing and revising script (${pass}/${budget.scriptReviewPasses})`);
          activeFeature = "review";
          try {
            const reviewedResult = await generateRoutedStructured({
              registry: this.registry,
              route: reviewRoute,
              task: "scriptReview",
              ...reviewPrompt,
              schema: reviewSchema,
              schemaName: "ScriptReview",
              schemaVersion: "2",
              maxOutputTokens: Math.ceil(maxOutputTokensForDuration(
                project.settings.targetDurationSec,
                this.config.SPEECH_WORDS_PER_MINUTE,
              ) * budget.outputHeadroom),
              repairAttempts: budget.repairAttempts,
              signal: context.signal,
              cache: this.cache,
              cacheKeyExtra: reviewHash,
              logger: context.logger,
            });
            addUsage(spentUsage, features, "review", reviewedResult.usage);
            spentCost += estimateLlmCost(this.config, reviewedResult.provider, reviewedResult.model, reviewedResult.usage);
            finalData = computeSectionDurations(reviewedResult.value.revisedScript, this.config.SPEECH_WORDS_PER_MINUTE);
            reviewNotes = [...priorNotes, ...reviewedResult.value.notes].slice(0, 8);
            priorNotes = reviewNotes;
            reviewed = true;
            provider = reviewedResult.provider;
            model = reviewedResult.model;
          } catch (error) {
            const code = error instanceof LlmError
              ? error.code
              : error instanceof z.ZodError
                ? "LLM_INVALID_OUTPUT"
                : "LLM_UNAVAILABLE";
            reviewSkippedCode = code;
            if (error instanceof LlmError && error.usage) {
              addUsage(spentUsage, features, "review", error.usage);
              spentCost += estimateLlmCost(this.config, reviewRoute.provider.id, reviewRoute.model, error.usage);
            }
            if (!reviewed) {
              finalData = baseData;
              reviewNotes = null;
            }
            context.reportProgress(75, `AI review skipped (${code}): kept the ${reviewed ? "last reviewed" : "original"} script`);
            break;
          }
        }
        if (JSON.stringify(finalData) !== JSON.stringify(baseData)) version += 1;
      }

      context.reportProgress(85, "Saving script");
      const serializedData = JSON.stringify(finalData);
      if (existing?.data === serializedData) version = existing.version;
      const inputHash = mergedCall && researchRow
        ? researchRow.input_hash
        : scriptInputHash(project, applicableResearch?.input_hash);
      this.sqlite.prepare(
        "INSERT INTO scripts (project_id, data, origin, edited, input_hash, version, provider, model, updated_at, merged_call, review_notes) VALUES (?, ?, 'AGENT', false, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET data = excluded.data, origin = 'AGENT', edited = false, input_hash = excluded.input_hash, version = excluded.version, provider = excluded.provider, model = excluded.model, updated_at = excluded.updated_at, merged_call = excluded.merged_call, review_notes = excluded.review_notes",
      ).run(
        project.id,
        serializedData,
        inputHash,
        version,
        provider,
        model,
        new Date().toISOString(),
        mergedCall ? 1 : 0,
        reviewNotes === null ? null : JSON.stringify(reviewNotes),
      );
      context.recordUsage({
        ...spentUsage,
        costUsd: spentCost,
        ...(provider ? { provider } : {}),
        ...(model ? { model } : {}),
        ...(spentUsage.tokensUnknown ? { tokensUnknown: true } : {}),
        features,
        calls: spentUsage.calls,
      });
      usageRecorded = true;
      const message = reviewSkippedCode
        ? `AI review skipped (${reviewSkippedCode}): kept the original script`
        : reviewed ? "Script reviewed and saved" : mergedCall ? "Script from merged call (0 tokens)" : "Script saved";
      context.reportProgress(100, message);
      return { message };
    } catch (error) {
      if (!usageRecorded) recordFailureUsage(error, context, spentUsage, features, activeFeature, spentCost, selected?.provider.id, selected?.model);
      throw asStageError(error);
    }
  }
}

function recordFailureUsage(
  error: unknown,
  context: StageContext,
  spentUsage: { llmCalls: number; inputTokens: number; outputTokens: number; tokensUnknown: boolean; calls: LlmCallUsage[] },
  features: Record<string, number>,
  activeFeature: string,
  spentCost: number,
  provider?: string,
  model?: string,
): void {
  const errorUsage = error instanceof LlmError ? error.usage : undefined;
  const combined = {
    llmCalls: spentUsage.llmCalls + (errorUsage?.llmCalls ?? 0),
    inputTokens: spentUsage.inputTokens + (errorUsage?.inputTokens ?? 0),
    outputTokens: spentUsage.outputTokens + (errorUsage?.outputTokens ?? 0),
    tokensUnknown: spentUsage.tokensUnknown || errorUsage?.tokensUnknown === true,
    calls: [...spentUsage.calls, ...(errorUsage?.calls ?? [])],
  };
  if (errorUsage && errorUsage.llmCalls > 0) {
    features[activeFeature] = (features[activeFeature] ?? 0) + errorUsage.llmCalls;
  }
  if (combined.llmCalls === 0 && combined.inputTokens === 0 && combined.outputTokens === 0 && combined.calls.length === 0) return;
  context.recordUsage({
    ...combined,
    costUsd: spentCost,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(combined.tokensUnknown ? { tokensUnknown: true } : {}),
    features,
    calls: combined.calls,
  });
}

function addUsage(
  total: { llmCalls: number; inputTokens: number; outputTokens: number; tokensUnknown: boolean; calls: LlmCallUsage[] },
  features: Record<string, number>,
  feature: string,
  usage: { llmCalls: number; inputTokens: number; outputTokens: number; tokensUnknown?: boolean; calls?: LlmCallUsage[] },
): void {
  total.llmCalls += usage.llmCalls;
  total.inputTokens += usage.inputTokens;
  total.outputTokens += usage.outputTokens;
  total.tokensUnknown ||= usage.tokensUnknown === true;
  total.calls.push(...(usage.calls ?? []));
  features[feature] = (features[feature] ?? 0) + usage.llmCalls;
}

function asStageError(error: unknown): Error {
  if (error instanceof LlmError) return new StageError(error.message, error.code, error.retryable);
  if (error instanceof z.ZodError) return new StageError(error.message, "LLM_INVALID_OUTPUT", false);
  return error instanceof Error ? error : new Error(String(error));
}

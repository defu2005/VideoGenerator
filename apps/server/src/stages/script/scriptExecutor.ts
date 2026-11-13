import { enqueueIndex } from "../../retrieval/service.js";
import { FORMAT_RECIPE_IDS, ResearchNotesSchema, fallbackFormat, missingRequiredSections, resolveBudget, resolveFormat, ScriptSchema, guidelineRulesFor, storyModeForProject, type GuidelineFindingDraft, type LlmCallUsage, type Script } from "@vg/shared";
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
import { preferenceBlock } from "../../operator/autopilot.js";
import {
  blockingNote, readScriptRepairHint, SCRIPT_REVISION_HEADER, scriptCacheExtra, scriptRepairHintDigest, scriptRepairHintPrompt,
  scriptRevisionFeedback,
} from "../../operator/qualityGates.js";
import { scriptPrompt } from "./prompt.js";
import { checkScriptDuration, computeSectionDurations, maxOutputTokensForDuration, researchInputHash, scriptContentHash, scriptInputHash } from "./scriptUtils.js";
import { scriptReviewPrompt } from "./reviewPrompt.js";
import { FactCheckResponseSchema, factCheckPrompt } from "./factCheckPrompt.js";
import { getAppLlmSettings } from "../../providers/llm/settings.js";
import { GuidelineService } from "../../guidelines/service.js";
import { runGuidelineLlmCheck } from "../../guidelines/llmCheck.js";
import { getProfileDirection, getProfilePromptContext } from "../../services/profileService.js";
import { rememberTreatment } from "../../formats/treatmentStore.js";

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
    const feedback = scriptRevisionFeedback(this.sqlite, project.id);
    const revising = feedback.round > 0 && existing?.origin === "AGENT" && !existing.edited;
    const mergedSource = Boolean(
      !revising
      && runMode === "ALL"
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
        const mergedSpent = { llmCalls: 0, inputTokens: 0, outputTokens: 0, tokensUnknown: false, calls: [] as LlmCallUsage[] };
        const mergedFeatures: Record<string, number> = {};
        let mergedCost = 0;
        const guidedEarly = await this.applyScriptGuidelines({
          context,
          project,
          research: researchRow ? ResearchNotesSchema.parse(JSON.parse(researchRow.data) as unknown) : undefined,
          script: data,
          budget,
          reviewNotes: existing?.review_notes ? JSON.parse(existing.review_notes) as string[] : null,
          spent: mergedSpent,
          features: mergedFeatures,
          addCost: (value) => { mergedCost += value; },
        });
        if (JSON.stringify(guidedEarly.script) !== JSON.stringify(data)) {
          this.sqlite.prepare("UPDATE scripts SET data = ?, version = version + 1, updated_at = ? WHERE project_id = ?")
            .run(JSON.stringify(guidedEarly.script), new Date().toISOString(), project.id);
        }
        this.persistGuidelineResults(project, guidedEarly);
        enqueueIndex(this.sqlite,{scope:"source",kind:"script",sourceId:project.id});
      context.recordUsage({
          ...mergedSpent,
          costUsd: mergedCost,
          ...(Object.keys(mergedFeatures).length ? { features: mergedFeatures } : {}),
          calls: mergedSpent.calls,
        });
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
    if (!project.settings.format && budget.formatPick) {
      const fallback = fallbackFormat({
        topic: project.topic,
        aspectRatio: project.settings.aspectRatio,
        targetDurationSec: project.settings.targetDurationSec,
      });
      let picked = { id: fallback.id, reason: fallback.reason };
      try {
        const route = this.registry.resolveTask("formatPick", project, getAppLlmSettings(this.sqlite));
        const niche = getProfileDirection(this.sqlite, project.profileId) ?? "";
        const generated = await generateRoutedStructured({
          registry: this.registry,
          route,
          task: "formatPick",
          system: "Pick one format recipe. Return JSON only.",
          prompt: `Topic: ${project.topic}\nNiche: ${niche || "(none)"}\nAspect: ${project.settings.aspectRatio}\nDuration: ${project.settings.targetDurationSec}\nIds: ${FORMAT_RECIPE_IDS.join(", ")}`,
          schema: z.object({ id: z.enum(FORMAT_RECIPE_IDS), reason: z.string().min(1).max(240) }).strict(),
          schemaName: "FormatPick",
          schemaVersion: "1",
          maxOutputTokens: 200,
          repairAttempts: 0,
          signal: context.signal,
          cache: this.cache,
          logger: context.logger,
        });
        picked = generated.value;
        addUsage(spentUsage, features, "formatPick", generated.usage);
        spentCost += estimateLlmCost(this.config, generated.provider, generated.model, generated.usage);
      } catch (error) {
        if (context.signal.aborted) throw error;
        if (error instanceof LlmError && error.usage) addUsage(spentUsage, features, "formatPick", error.usage);
        context.logger.warn({ err: error }, "formatPick failed; using the code fallback");
      }
      project.settings = { ...project.settings, format: picked.id, formatReason: picked.reason };
      this.sqlite.prepare("UPDATE projects SET settings = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(project.settings), new Date().toISOString(), project.id);
    }
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
      const scriptGuidance = new GuidelineService(this.sqlite).guidanceFor(project, ["script", "subtitles"]);
      const promptContext = getProfilePromptContext(this.sqlite, project.profileId);
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
        const ownerRules = project.profileId ? preferenceBlock(this.sqlite, project.profileId, "script") : "";
        const initialPrompt = scriptPrompt(project, research, this.config.SPEECH_WORDS_PER_MINUTE, scriptGuidance, promptContext.direction, promptContext.learnedNotes, ownerRules);
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
            rebuildInput: (trimmedResearch) => scriptPrompt(project, trimmedResearch, this.config.SPEECH_WORDS_PER_MINUTE, scriptGuidance, promptContext.direction, promptContext.learnedNotes, ownerRules),
          } : {}),
        });
        if (check.decision === "reject") throw check.error;
        const system = check.input.system;
        let prompt = check.input.prompt;
        let cacheKeyExtra = inputHash;
        if (revising) {
          let scenes = existing?.data ?? "";
          try {
            const parsed = JSON.parse(existing?.data ?? "") as { sections?: unknown };
            scenes = JSON.stringify(parsed.sections ?? []);
          } catch {
            scenes = existing?.data ?? "";
          }
          prompt = `${prompt}\n\n${SCRIPT_REVISION_HEADER}\n${feedback.reasons.map((reason) => `- ${reason}`).join("\n")}\n${scenes.slice(0, 4000)}`;
          cacheKeyExtra = scriptCacheExtra(inputHash, feedback.round, feedback.reasons);
        }
        const repairHint = readScriptRepairHint(this.sqlite, project.id);
        if (repairHint) {
          const extra = scriptRepairHintPrompt(repairHint);
          if (extra) prompt = `${prompt}\n\n${extra}`;
          cacheKeyExtra = `${cacheKeyExtra}:${scriptRepairHintDigest(repairHint)}`;
          if (repairHint.stronger) {
            try {
              selected = this.registry.resolveTask("scriptReview", project, appRouting);
            } catch {
              // Keep the normal script route when no stronger one resolves.
            }
          }
        }
        const validatedSchema = ScriptSchema.superRefine((value, ctx) => {
          const { reject } = checkScriptDuration(value, project.settings.targetDurationSec, this.config.SPEECH_WORDS_PER_MINUTE);
          if (reject) ctx.addIssue({ code: z.ZodIssueCode.custom, message: reject });
        });
        context.reportProgress(20, "Calling script provider");
        const generated = await generateRoutedStructured({
          registry: this.registry,
          route: selected,
          task: "script",
          knowledgeProject: project,
          knowledgeQuery: [project.topic,research?.summary].filter(Boolean).join(" "),
          system,
          prompt,
          schema: validatedSchema,
          schemaName: "Script",
          schemaVersion: "3",
          maxOutputTokens: check.maxOutputTokens,
          repairAttempts: budget.repairAttempts,
          signal: context.signal,
          cache: this.cache,
          cacheKeyExtra,
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
      let qualityScore: number | null = null;
      let blockingFacts = 0;
      let reviewed = false;
      let reviewSkippedCode: string | null = null;
      const baseVersion = (existing?.version ?? 0) + (existing?.data === JSON.stringify(baseData) ? 0 : 1);
      let version = baseVersion;
      if (budget.scriptReviewPasses > 0) {
        const reviewRoute = this.registry.resolveTask("scriptReview", project, appRouting);
        const reviewSchema = z.object({
          revisedScript: ScriptSchema,
          notes: z.array(z.string()).max(8),
          score: z.number().min(0).max(10),
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
            scriptGuidance,
          );
          const reviewHash = `${scriptInputHash(project, applicableResearch?.input_hash)}:${scriptContentHash(finalData)}:${JSON.stringify(research ?? null)}:${pass}:${JSON.stringify(priorNotes)}`;
          context.reportProgress(70, `Reviewing and revising script (${pass}/${budget.scriptReviewPasses})`);
          activeFeature = "review";
          try {
            const reviewedResult = await generateRoutedStructured({
              registry: this.registry,
              route: reviewRoute,
              task: "scriptReview",
          knowledgeProject: project,
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
            qualityScore = reviewedResult.value.score;
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

      const beforeGuidelines = JSON.stringify(finalData);
      const guided = await this.applyScriptGuidelines({
        context,
        project,
        research,
        script: finalData,
        budget,
        reviewNotes,
        spent: spentUsage,
        features,
        addCost: (value) => { spentCost += value; },
      });
      finalData = guided.script;
      reviewNotes = guided.reviewNotes;
      if (guided.provider) {
        provider = guided.provider;
        model = guided.model || model;
      }
      if (JSON.stringify(finalData) !== beforeGuidelines) version += 1;

      if (budget.factCheck) {
        context.reportProgress(82, "Fact-checking script against research");
        try {
          const factRoute = this.registry.resolveTask("factCheck", project, appRouting);
          const factPrompt = factCheckPrompt(project.topic, research, finalData);
          const factChecked = await generateRoutedStructured({
            registry: this.registry,
            route: factRoute,
            task: "factCheck",
          knowledgeProject: project,
            ...factPrompt,
            schema: FactCheckResponseSchema,
            schemaName: "FactCheck",
            schemaVersion: "1",
            maxOutputTokens: Math.ceil(maxOutputTokensForDuration(
              project.settings.targetDurationSec,
              this.config.SPEECH_WORDS_PER_MINUTE,
            ) * budget.outputHeadroom),
            repairAttempts: Math.min(1, budget.repairAttempts) as 0 | 1,
            signal: context.signal,
            cache: this.cache,
            cacheKeyExtra: scriptContentHash(finalData),
            logger: context.logger,
          });
          addUsage(spentUsage, features, "factCheck", factChecked.usage);
          spentCost += estimateLlmCost(this.config, factChecked.provider, factChecked.model, factChecked.usage);
          if (factChecked.value.revisedScript) {
            finalData = computeSectionDurations(factChecked.value.revisedScript, this.config.SPEECH_WORDS_PER_MINUTE);
            version += 1;
          }
          if (factChecked.value.notes.length) {
            const factLines = factChecked.value.notes.map((note) => note.severity === "blocking" ? blockingNote(note.text) : note.text);
            reviewNotes = [...(reviewNotes ?? []), ...factLines].slice(0, 8);
            blockingFacts += factChecked.value.notes.filter((note) => note.severity === "blocking").length;
          }
          provider = factChecked.provider;
          model = factChecked.model;
        } catch (error) {
          if (error instanceof LlmError && error.usage) {
            addUsage(spentUsage, features, "factCheck", error.usage);
          }
          context.logger.warn({ err: error }, "factCheck failed; continuing with the current script");
        }
      }

      const tagged = finalData.sections.some((section) => section.sectionKey);
      if ((tagged || project.settings.format) && selected) {
        const recipe = resolveFormat({
          topic: project.topic,
          aspectRatio: project.settings.aspectRatio,
          targetDurationSec: project.settings.targetDurationSec,
          format: project.settings.format,
        }).recipe;
        let missing = missingRequiredSections(recipe, finalData.sections.map((section) => section.sectionKey));
        if (missing.length > 0 && project.settings.format) {
          try {
            const repaired = await generateRoutedStructured({
              registry: this.registry,
              route: selected,
              task: "script",
          knowledgeProject: project,
              system: "Repair the script so every required sectionKey is present. Return the full script.",
              prompt: `Missing: ${missing.join(", ")}. Current script: ${JSON.stringify(finalData)}`,
              schema: ScriptSchema,
              schemaName: "ScriptSectionRepair",
              schemaVersion: "1",
              maxOutputTokens: 1200,
              repairAttempts: 0,
              signal: context.signal,
              logger: context.logger,
            });
            finalData = computeSectionDurations(ScriptSchema.parse(repaired.value), this.config.SPEECH_WORDS_PER_MINUTE);
            version += 1;
            addUsage(spentUsage, features, "script", repaired.usage);
            spentCost += estimateLlmCost(this.config, repaired.provider, repaired.model, repaired.usage);
            provider = repaired.provider;
            model = repaired.model;
            missing = missingRequiredSections(recipe, finalData.sections.map((section) => section.sectionKey));
          } catch (error) {
            context.logger.warn({ err: error }, "section repair failed; keeping the script");
          }
        }
        if (missing.length > 0) {
          reviewNotes = [...(reviewNotes ?? []), `Thiếu mục bắt buộc: ${missing.join(", ")}`].slice(0, 8);
        }
      }
      context.reportProgress(85, "Saving script");
      const serializedData = JSON.stringify(finalData);
      if (existing?.data === serializedData) version = existing.version;
      const inputHash = mergedCall && researchRow
        ? researchRow.input_hash
        : scriptInputHash(project, applicableResearch?.input_hash);
      this.sqlite.prepare(
        "INSERT INTO scripts (project_id, data, origin, edited, input_hash, version, provider, model, updated_at, merged_call, review_notes, quality_score, blocking_facts) VALUES (?, ?, 'AGENT', false, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET data = excluded.data, origin = 'AGENT', edited = false, input_hash = excluded.input_hash, version = excluded.version, provider = excluded.provider, model = excluded.model, updated_at = excluded.updated_at, merged_call = excluded.merged_call, review_notes = excluded.review_notes, quality_score = excluded.quality_score, blocking_facts = excluded.blocking_facts",
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
        qualityScore,
        blockingFacts,
      );
      rememberTreatment(this.sqlite, project, finalData);
      this.persistGuidelineResults(project, guided);
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

  private persistGuidelineResults(project: StageContext["project"], guided: { findings: GuidelineFindingDraft[] | null; strictness: "REMIND" | "FILTER" }): void {
    const service = new GuidelineService(this.sqlite);
    if (guided.findings) service.replaceFindings(project.id, "SCRIPT", "LLM", guided.findings);
    if (guided.strictness === "FILTER") service.runCodeChecks(project, "SCRIPT");
  }

  private async applyScriptGuidelines(input: {
    context: StageContext;
    project: StageContext["project"];
    research: ReturnType<typeof ResearchNotesSchema.parse> | undefined;
    script: Script;
    budget: ReturnType<typeof resolveBudget>;
    reviewNotes: string[] | null;
    spent: { llmCalls: number; inputTokens: number; outputTokens: number; tokensUnknown: boolean; calls: LlmCallUsage[] };
    features: Record<string, number>;
    addCost: (value: number) => void;
  }): Promise<{ script: Script; reviewNotes: string[] | null; findings: GuidelineFindingDraft[] | null; strictness: "REMIND" | "FILTER"; provider?: string; model?: string }> {
    const service = new GuidelineService(this.sqlite);
    const active = service.activeFor(input.project);
    let script = input.script;
    let reviewNotes = input.reviewNotes;
    let provider: string | undefined;
    let model: string | undefined;
    if (active.strictness !== "FILTER" || input.budget.guidelineCheck === "off") {
      return { script, reviewNotes, findings: null, strictness: active.strictness };
    }
    const rules = guidelineRulesFor(active, ["script", "subtitles", "metadata"]);
    if (!rules.length) return { script, reviewNotes, findings: [], strictness: active.strictness };
    const checkOnce = async (value: Script) => {
      try {
        const checked = await runGuidelineLlmCheck({
          sqlite: this.sqlite,
          registry: this.registry,
          config: this.config,
          project: input.project,
          script: value,
          active,
          signal: input.context.signal,
          logger: input.context.logger,
          cache: this.cache,
        });
        addUsage(input.spent, input.features, "guidelineCheck", checked.usage);
        if (checked.provider) {
          input.addCost(estimateLlmCost(this.config, checked.provider, checked.model, checked.usage));
          provider = checked.provider;
          model = checked.model;
        }
        return checked.drafts;
      } catch (error) {
        if (error instanceof LlmError && error.usage) {
          addUsage(input.spent, input.features, "guidelineCheck", error.usage);
          input.addCost(estimateLlmCost(this.config, provider ?? "mock", model ?? "mock", error.usage));
        }
        throw error;
      }
    };
    try {
      let findings = await checkOnce(script);
      if (input.budget.guidelineCheck === "checkAndFix" && findings.some((finding) => finding.severity === "MUST")) {
        try {
          const guidance = [
            service.guidanceFor(input.project, ["script", "subtitles"]),
            "Fix these content-guideline findings. Keep every section id and the section order.",
            ...findings.map((finding) => `- ${finding.ruleId} [${finding.severity}] scene ${finding.sceneId ?? "null"}: ${finding.text}${finding.suggestion ? ` Suggestion: ${finding.suggestion}` : ""}`),
          ].filter(Boolean).join("\n");
          const reviewRoute = this.registry.resolveTask("scriptReview", input.project, getAppLlmSettings(this.sqlite));
          const reviewSchema = z.object({
            revisedScript: ScriptSchema,
            notes: z.array(z.string()).max(8),
            score: z.number().min(0).max(10),
          }).strict().superRefine(({ revisedScript }, ctx) => {
            const expectedIds = script.sections.map((section) => section.id);
            const actualIds = revisedScript.sections.map((section) => section.id);
            if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["revisedScript", "sections"], message: "Review must preserve section ids and order." });
            }
            const { reject } = checkScriptDuration(revisedScript, input.project.settings.targetDurationSec, this.config.SPEECH_WORDS_PER_MINUTE);
            if (reject) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["revisedScript"], message: reject });
          });
          const reviewedResult = await generateRoutedStructured({
            registry: this.registry,
            route: reviewRoute,
            task: "scriptReview",
          knowledgeProject: input.project,
          knowledgeQuery: [input.script.title,...input.script.sections.map(s=>s.narration)].join(" ").slice(0,2500),
            ...scriptReviewPrompt(
              input.project,
              input.research,
              script,
              this.config.SPEECH_WORDS_PER_MINUTE,
              input.budget.scriptReviewPasses + 1,
              reviewNotes ?? [],
              guidance,
            ),
            schema: reviewSchema,
            schemaName: "ScriptReview",
            schemaVersion: "2",
            maxOutputTokens: Math.ceil(maxOutputTokensForDuration(
              input.project.settings.targetDurationSec,
              this.config.SPEECH_WORDS_PER_MINUTE,
            ) * input.budget.outputHeadroom),
            repairAttempts: input.budget.repairAttempts,
            signal: input.context.signal,
            cache: this.cache,
            cacheKeyExtra: `guideline-fix:${scriptContentHash(script)}:${findings.map((finding) => finding.ruleId).join(",")}`,
            logger: input.context.logger,
          });
          addUsage(input.spent, input.features, "review", reviewedResult.usage);
          input.addCost(estimateLlmCost(this.config, reviewedResult.provider, reviewedResult.model, reviewedResult.usage));
          provider = reviewedResult.provider;
          model = reviewedResult.model;
          const revised = computeSectionDurations(reviewedResult.value.revisedScript, this.config.SPEECH_WORDS_PER_MINUTE);
          reviewNotes = [...(reviewNotes ?? []), ...reviewedResult.value.notes].slice(0, 8);
          let nextFindings = findings;
          try {
            nextFindings = await checkOnce(revised);
          } catch (error) {
            input.context.logger.warn({ err: error }, "guidelineCheck after the fix pass failed");
          }
          script = revised;
          findings = nextFindings;
        } catch (error) {
          input.context.logger.warn({ err: error }, "Guideline fix pass skipped");
          if (error instanceof LlmError && error.usage) {
            addUsage(input.spent, input.features, "review", error.usage);
          }
        }
      }
      return { script, reviewNotes, findings, strictness: active.strictness, ...(provider ? { provider, model } : {}) };
    } catch (error) {
      input.context.logger.warn({ err: error }, "guidelineCheck failed; continuing without LLM findings");
      return { script, reviewNotes, findings: null, strictness: active.strictness };
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
  if (error instanceof LlmError) return new StageError(error.message, error.code, error.retryable, error.retryAt);
  if (error instanceof z.ZodError) return new StageError(error.message, "LLM_INVALID_OUTPUT", false);
  return error instanceof Error ? error : new Error(String(error));
}

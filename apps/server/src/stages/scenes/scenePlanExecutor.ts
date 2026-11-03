import { createHash, randomUUID } from "node:crypto";
import {
  ensureConsecutiveQueryVariety,
  resolveBudget,
  SceneQueryAssistSchema,
  ScriptSchema,
  planScenes,
  type SceneDraft,
  type Script,
} from "@vg/shared";
import type Database from "better-sqlite3";
import type { AppConfig } from "../../lib/config.js";
import { StageError, type StageContext, type StageExecutor } from "../../pipeline/stageExecutor.js";
import { LlmCache } from "../../providers/llm/cache.js";
import { estimateLlmCost } from "../../providers/llm/pricing.js";
import { generateRoutedStructured } from "../../providers/llm/structured.js";
import type { LlmProviderRegistry } from "../../providers/llm/registry.js";
import type { ResolvedLlmRoute } from "../../providers/llm/registry.js";
import { LlmError } from "../../providers/llm/types.js";
import { estimateTokens } from "../../providers/llm/tokenEstimate.js";
import { sceneQueryPrompt } from "./sceneQueryPrompt.js";
import { getAppLlmSettings } from "../../providers/llm/settings.js";

type ScriptRow = { data: string };
const SYSTEM_PROMPT = "You are an image-search query editor. Return only JSON matching the requested schema.";

function sceneInputHash(script: Script, sceneDurationSec: number, wordsPerMinute: number): string {
  return createHash("sha256").update(JSON.stringify([script, sceneDurationSec, wordsPerMinute])).digest("hex");
}

function errorCode(error: unknown): string {
  return error instanceof LlmError ? error.code : "UNKNOWN";
}

export class ScenePlanExecutor implements StageExecutor {
  readonly stage = "SCENE_PLAN" as const;
  private readonly cache: LlmCache;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly registry: LlmProviderRegistry,
    private readonly config: AppConfig,
  ) {
    this.cache = new LlmCache(sqlite, config.LLM_CACHE_ENABLED);
  }

  async run(context: StageContext) {
    const scriptRow = this.sqlite.prepare("SELECT data FROM scripts WHERE project_id = ?")
      .get(context.project.id) as ScriptRow | undefined;
    if (!scriptRow) {
      context.reportProgress(100, "Script is missing");
      throw new StageError(
        "A script is required before planning scenes.",
        "SCRIPT_MISSING",
        false,
      );
    }

    const script = ScriptSchema.parse(JSON.parse(scriptRow.data) as unknown) as Script;
    const settings = context.project.settings;
    const scenes = planScenes(script, {
      sceneDurationSec: settings.sceneDurationSec,
      wordsPerMinute: settings.wordsPerMinute,
      language: settings.language,
    });
    const inputHash = sceneInputHash(script, settings.sceneDurationSec, settings.wordsPerMinute);
    const splitScenes = scenes.map((scene) => ({ index: scene.order, scene }));
    const totalSec = Math.round(scenes.reduce((sum, scene) => sum + scene.estDurationSec, 0));
    let message = `${scenes.length} scenes · total ~${totalSec}s (target ${settings.targetDurationSec}s) · ~${settings.sceneDurationSec}s/scene`;

    context.reportProgress(20, "Planning scenes deterministically");
    const budget = resolveBudget(context.project);
    if (budget.sceneQueryAssist && splitScenes.length > 0) {
      let selected: ResolvedLlmRoute | undefined;
      try {
        context.reportProgress(55, "Assisting visual queries");
        selected = this.registry.resolveTask("sceneQueries", context.project, getAppLlmSettings(this.sqlite));
        const maxOutputTokens = Math.max(256, splitScenes.length * 100);
        const maxInput = selected.provider.limits?.maxInputTokens;
        const prompt = sceneQueryPrompt(splitScenes);
        if (maxInput !== undefined && estimateTokens(`${SYSTEM_PROMPT}\n${prompt}`, true) > maxInput) {
          throw new LlmError("Scene query prompt exceeds the provider input limit.", "LLM_LIMIT_TOO_SMALL", false);
        }
        const outputLimit = Math.min(
          selected.provider.limits?.maxOutputTokens ?? Number.POSITIVE_INFINITY,
          selected.maxOutputTokens ?? Number.POSITIVE_INFINITY,
        );
        if (outputLimit !== undefined && outputLimit < 256) {
          throw new LlmError("Scene query output exceeds the provider output limit.", "LLM_LIMIT_TOO_SMALL", false);
        }
        const assistSchema = SceneQueryAssistSchema.superRefine((value, ctx) => {
          const actual = value.scenes.map((item) => item.index).sort((a, b) => a - b);
          const expected = splitScenes.map((item) => item.index).sort((a, b) => a - b);
          if (new Set(actual).size !== actual.length || JSON.stringify(actual) !== JSON.stringify(expected)) {
            ctx.addIssue({
              code: "custom",
              path: ["scenes"],
              message: "Scene query assist must return one unique result for every requested scene index.",
            });
          }
        });
        const generated = await generateRoutedStructured({
          registry: this.registry,
          route: selected,
          task: "sceneQueries",
          system: SYSTEM_PROMPT,
          prompt,
          schema: assistSchema,
          schemaName: "SceneQueryAssist",
          schemaVersion: "1",
          maxOutputTokens: Math.min(maxOutputTokens, outputLimit ?? maxOutputTokens),
          repairAttempts: 0,
          signal: context.signal,
          cache: this.cache,
          cacheKeyExtra: inputHash,
          logger: context.logger,
        });
        const byIndex = new Map(generated.value.scenes.map((item) => [item.index, item]));
        for (const { index } of splitScenes) {
          const assist = byIndex.get(index);
          if (!assist) continue;
          scenes[index].visualDescription = assist.visualDescription;
          scenes[index].visualQueries = {
            primary: assist.primary,
            alternatives: assist.alternatives,
          };
        }
        let costUsd = 0;
        try {
          costUsd = estimateLlmCost(this.config, generated.provider, generated.model, generated.usage);
        } catch (error) {
          context.logger.error({ err: error }, "Could not estimate scene query assist cost");
        }
        context.recordUsage({
          ...generated.usage,
          costUsd,
          provider: generated.provider,
          model: generated.model,
          features: { sceneQueryAssist: generated.usage.llmCalls },
          calls: generated.usage.calls,
        });
      } catch (error) {
        if (context.signal.aborted) throw error;
        const usage = error instanceof LlmError ? error.usage : undefined;
        let costUsd = 0;
        if (usage && usage.llmCalls > 0) {
          try {
            costUsd = estimateLlmCost(this.config, selected?.provider.id ?? "unknown", selected?.model ?? "", usage);
          } catch (costError) {
            context.logger.error({ err: costError }, "Could not estimate failed scene query assist cost");
          }
        }
        context.recordUsage({
          llmCalls: usage?.llmCalls ?? 0,
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          ...(usage?.tokensUnknown ? { tokensUnknown: true } : {}),
          costUsd,
          ...(selected ? { provider: selected.provider.id } : {}),
          ...(selected?.model ? { model: selected.model } : {}),
          features: { sceneQueryAssist: usage?.llmCalls ?? 0 },
          ...(usage?.calls ? { calls: usage.calls } : {}),
        });
        const code = errorCode(error);
        context.logger.warn({ err: error, code }, "Scene query assist skipped; using deterministic queries");
        message += ` · AI query assist skipped (${code})`;
      }
    } else {
      context.recordUsage({
        llmCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        features: { sceneQueryAssist: 0 },
      });
    }

    ensureConsecutiveQueryVariety(scenes);

    const now = new Date().toISOString();
    const insert = this.sqlite.prepare(
      "INSERT INTO scenes (id, project_id, \"order\", kind, section_id, label, narration, visual_notes, visual_description, visual_queries, music_mood, energy, est_duration_sec, duration_override_sec, start_sec, transition_note, origin, edited, input_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AGENT', 0, ?, ?, ?)",
    );
    const replace = this.sqlite.transaction(() => {
      this.sqlite.prepare("DELETE FROM scenes WHERE project_id = ?").run(context.project.id);
      scenes.forEach((scene, order) => insert.run(
        randomUUID(),
        context.project.id,
        order,
        scene.kind,
        scene.sectionId,
        scene.label,
        scene.narration,
        scene.visualNotes,
        scene.visualDescription,
        JSON.stringify({ ...scene.visualQueries, queryVariant: scene.queryVariant }),
        scene.musicMood,
        scene.energy,
        scene.estDurationSec,
        scene.durationOverrideSec,
        scene.startSec,
        scene.transitionNote,
        inputHash,
        now,
        now,
      ));
    });
    replace();
    context.reportProgress(100, message);
    return { outputHash: inputHash, message };
  }
}

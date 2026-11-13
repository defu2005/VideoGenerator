import {
  applyVisionIssueCap,
  combineVisionScore,
  type BudgetFeatures,
  type LlmCallUsage,
  type Project,
  type SceneVisionMeta,
  type VisionCheck,
  type VisionIssue,
  normalizeVisionCheckBatch,
  VisionCheckBatchSchema,
  VisionConsistencySchema,
  VisionResearchSchema,
} from "@vg/shared";
import type { FastifyBaseLogger } from "fastify";
import { join } from "node:path";
import type { AppConfig } from "../lib/config.js";
import { StageError } from "../pipeline/stageExecutor.js";
import { LlmCache } from "../providers/llm/cache.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { getAppLlmSettings } from "../providers/llm/settings.js";
import { assertVisionCapable, generateRoutedStructured } from "../providers/llm/structured.js";
import { LlmError } from "../providers/llm/types.js";
import { projectDir } from "../storage/paths.js";
import {
  buildVisionCheckPrompt,
  buildVisionConsistencyPrompt,
  buildVisionResearchPrompt,
} from "../stages/visuals/visionPrompts.js";
import type Database from "better-sqlite3";

export type VisionCandidateInput = {
  id: string;
  label: string;
  localPath: string | null;
  relevanceScore: number;
  textRerank?: number;
};

export type VisionSceneInput = {
  sceneId: string;
  narration: string;
  visualDescription: string;
  queries: string[];
  candidates: VisionCandidateInput[];
};

export type VisionSceneResult = {
  sceneId: string;
  checks: Map<string, VisionCheck>;
  scores: Map<string, number>;
  bestCandidateId: string | null;
  bestFit: number | null;
  needsAttention: boolean;
  reason?: string;
  reSearchHistory: NonNullable<SceneVisionMeta["reSearchHistory"]>;
  visionBatchFailures: number;
  visionSkipped: number;
  usage: { llmCalls: number; inputTokens: number; outputTokens: number; calls: LlmCallUsage[] };
};

function emptyUsage() {
  return { llmCalls: 0, inputTokens: 0, outputTokens: 0, calls: [] as LlmCallUsage[] };
}

function mergeUsage(
  target: ReturnType<typeof emptyUsage>,
  usage: { llmCalls: number; inputTokens: number; outputTokens: number; calls?: LlmCallUsage[] },
) {
  target.llmCalls += usage.llmCalls;
  target.inputTokens += usage.inputTokens;
  target.outputTokens += usage.outputTokens;
  target.calls.push(...(usage.calls ?? []));
}

export function requireVisionRoute(
  registry: LlmProviderRegistry,
  project: Project,
  sqlite: Database.Database,
): void {
  const route = registry.resolveTask("visionCheck", project, getAppLlmSettings(sqlite));
  try {
    assertVisionCapable(route.provider, [{ path: "dummy", label: "preflight" }]);
  } catch (error) {
    if (error instanceof LlmError && error.code === "VISION_PROVIDER_REQUIRED") {
      throw new StageError(
        "MAX cần route vision. Vào Cài đặt → Mô hình AI và chọn provider hỗ trợ ảnh (anthropic, gemini, claude-cli, copilot-cli) hoặc model OmniRoute grok-cli/grok-4.7.",
        "VISION_PROVIDER_REQUIRED",
        false,
      );
    }
    throw error;
  }
}

export async function verifySceneVision(input: {
  project: Project;
  scene: VisionSceneInput;
  budget: BudgetFeatures;
  aspectRatio: string;
  registry: LlmProviderRegistry;
  sqlite: Database.Database;
  config: AppConfig;
  signal: AbortSignal;
  logger?: FastifyBaseLogger;
  searchMore: (sceneId: string, queries: string[]) => Promise<VisionCandidateInput[]>;
}): Promise<VisionSceneResult> {
  const usage = emptyUsage();
  const checks = new Map<string, VisionCheck>();
  const scores = new Map<string, number>();
  const reSearchHistory: NonNullable<SceneVisionMeta["reSearchHistory"]> = [];
  let visionBatchFailures = 0;
  let visionSkipped = 0;
  let candidates = [...input.scene.candidates];
  const threshold = input.budget.visionThreshold;
  const visionCacheDir = join(projectDir(input.config.DATA_DIR, input.project.id), "vision-cache");
  const appRouting = getAppLlmSettings(input.sqlite);
  const cache = new LlmCache(input.sqlite, input.config.LLM_CACHE_ENABLED);

  const visionNormalize = (raw: unknown) => {
    const result = normalizeVisionCheckBatch(raw);
    if (result.droppedIssues > 0) {
      input.logger?.warn({ droppedIssues: result.droppedIssues, sceneId: input.scene.sceneId }, "Vision batch normalized unknown issue labels");
    } else {
      input.logger?.debug?.({ droppedIssues: 0, sceneId: input.scene.sceneId }, "Vision batch normalized");
    }
    return result.value;
  };

  const applyVisionResults = (
    withLocal: VisionCandidateInput[],
    images: Array<{ label: string; fit: number; depicts: string; issues: VisionIssue[]; cropOk: boolean }>,
    model: string,
    checkedAt: string,
  ) => {
    for (const image of images) {
      const candidate = withLocal.find((item) => item.label === image.label);
      if (!candidate) continue;
      const fit = applyVisionIssueCap(image.fit, image.issues);
      const check: VisionCheck = {
        fit,
        depicts: image.depicts,
        issues: image.issues,
        cropOk: image.cropOk,
        model,
        checkedAt,
      };
      checks.set(candidate.id, check);
      scores.set(candidate.id, combineVisionScore({
        visionFit: fit,
        textRerank: candidate.textRerank,
        codeScore: candidate.relevanceScore,
      }));
    }
  };

  const callVisionBatch = async (candidates: VisionCandidateInput[]) => {
    const route = input.registry.resolveTask("visionCheck", input.project, appRouting);
    const prompt = buildVisionCheckPrompt({
      narration: input.scene.narration,
      visualDescription: input.scene.visualDescription,
      aspectRatio: input.aspectRatio,
      images: candidates.map((candidate) => ({ label: candidate.label })),
    });
    return generateRoutedStructured({
      registry: input.registry,
      route,
      task: "visionCheck",
      system: prompt.system,
      prompt: prompt.prompt,
      schema: VisionCheckBatchSchema,
      schemaName: "VisionCheck",
      schemaVersion: "2",
      maxOutputTokens: 2_000,
      repairAttempts: 1,
      signal: input.signal,
      cache,
      logger: input.logger,
      normalize: visionNormalize,
      images: candidates.map((candidate) => ({ path: candidate.localPath!, label: candidate.label })),
      visionCacheDir,
    });
  };

  const runCheck = async (batch: VisionCandidateInput[]) => {
    const withLocal = batch.filter((candidate) => candidate.localPath);
    if (!withLocal.length) return;
    const checkedAt = new Date().toISOString();
    const isRecoverableVisionParseError = (error: unknown) =>
      error instanceof LlmError
      && (error.code === "LLM_INVALID_OUTPUT" || error.code === "LLM_OUTPUT_TRUNCATED");

    try {
      const generated = await callVisionBatch(withLocal);
      mergeUsage(usage, generated.usage);
      applyVisionResults(withLocal, generated.value.images, generated.model, checkedAt);
      return;
    } catch (error) {
      if (error instanceof LlmError && error.usage) mergeUsage(usage, error.usage);
      if (!isRecoverableVisionParseError(error)) throw error;
    }

    visionBatchFailures += 1;
    let skipped = 0;
    if (withLocal.length === 1) {
      skipped = 1;
    } else {
      for (const candidate of withLocal) {
        try {
          const generated = await callVisionBatch([candidate]);
          mergeUsage(usage, generated.usage);
          applyVisionResults([candidate], generated.value.images, generated.model, checkedAt);
        } catch (singleError) {
          if (singleError instanceof LlmError && singleError.usage) mergeUsage(usage, singleError.usage);
          if (!isRecoverableVisionParseError(singleError)) throw singleError;
          skipped += 1;
        }
      }
    }
    visionSkipped += skipped;
    input.logger?.warn({
      sceneId: input.scene.sceneId,
      batchSize: withLocal.length,
      skipped,
    }, "Vision batch parse failed; skipped images without vision result");
  };

  const topN = (list: VisionCandidateInput[]) =>
    [...list].sort((a, b) => (scores.get(b.id) ?? b.relevanceScore) - (scores.get(a.id) ?? a.relevanceScore)).slice(0, 5);

  await runCheck(topN(candidates));

  let best = pickBest(candidates, scores, checks);
  let round = 0;
  while (best.fit !== null && best.fit < threshold && round < input.budget.visionRetryRounds) {
    if (input.signal.aborted) throw input.signal.reason ?? new Error("Vision verification aborted");
    round += 1;
    const bestCheck = best.id ? checks.get(best.id) : undefined;
    const researchRoute = input.registry.resolveTask("visionResearch", input.project, appRouting);
    const researchPrompt = buildVisionResearchPrompt({
      narration: input.scene.narration,
      visualDescription: input.scene.visualDescription,
      depicts: bestCheck?.depicts ?? "",
      issues: bestCheck?.issues ?? [],
      previousQueries: input.scene.queries,
    });
    let queries: string[] = [];
    let why = "Vision fit below threshold";
    try {
      const researched = await generateRoutedStructured({
        registry: input.registry,
        route: researchRoute,
        task: "visionResearch",
        system: researchPrompt.system,
        prompt: researchPrompt.prompt,
        schema: VisionResearchSchema,
        schemaName: "VisionResearch",
        schemaVersion: "1",
        maxOutputTokens: 800,
        repairAttempts: 0,
        signal: input.signal,
        cache,
        logger: input.logger,
      });
      mergeUsage(usage, researched.usage);
      queries = researched.value.queries;
      why = researched.value.why ?? why;
    } catch (error) {
      if (error instanceof LlmError && error.usage) mergeUsage(usage, error.usage);
      input.logger?.warn({ err: error }, "Vision re-search query generation failed");
      break;
    }
    const found = await input.searchMore(input.scene.sceneId, queries);
    const existingIds = new Set(candidates.map((candidate) => candidate.id));
    const fresh = found.filter((candidate) => !existingIds.has(candidate.id));
    candidates = [...candidates, ...fresh];
    await runCheck(topN(fresh.length ? fresh : candidates));
    best = pickBest(candidates, scores, checks);
    reSearchHistory.push({
      round,
      queries,
      why,
      bestFit: best.fit,
    });
  }

  const needsAttention = best.fit === null || best.fit < threshold;
  return {
    sceneId: input.scene.sceneId,
    checks,
    scores,
    bestCandidateId: best.id,
    bestFit: best.fit,
    needsAttention,
    reason: needsAttention
      ? `Vision fit ${best.fit ?? 0}/10 dưới ngưỡng ${threshold}/10`
      : undefined,
    reSearchHistory,
    visionBatchFailures,
    visionSkipped,
    usage,
  };
}

export async function runConsistencyCheck(input: {
  project: Project;
  scenes: {
    sceneId: string;
    label: string;
    visualDescription: string;
    imageLabel: string;
    localPath: string;
  }[];
  registry: LlmProviderRegistry;
  sqlite: Database.Database;
  config: AppConfig;
  signal: AbortSignal;
  logger?: FastifyBaseLogger;
}): Promise<{ flags: Map<string, string[]>; usage: ReturnType<typeof emptyUsage> }> {
  const usage = emptyUsage();
  const flags = new Map<string, string[]>();
  if (!input.scenes.length) return { flags, usage };
  const route = input.registry.resolveTask("visionConsistency", input.project, getAppLlmSettings(input.sqlite));
  const maxImages = route.provider.capabilities?.maxImagesPerCall ?? 5;
  const visionCacheDir = join(projectDir(input.config.DATA_DIR, input.project.id), "vision-cache");
  const cache = new LlmCache(input.sqlite, input.config.LLM_CACHE_ENABLED);
  for (let offset = 0; offset < input.scenes.length; offset += maxImages) {
    const batch = input.scenes.slice(offset, offset + maxImages);
    const prompt = buildVisionConsistencyPrompt({
      scenes: batch.map((scene) => ({
        sceneId: scene.sceneId,
        label: scene.label,
        visualDescription: scene.visualDescription,
        imageLabel: scene.imageLabel,
      })),
    });
    try {
      const generated = await generateRoutedStructured({
        registry: input.registry,
        route,
        task: "visionConsistency",
        system: prompt.system,
        prompt: prompt.prompt,
        schema: VisionConsistencySchema,
        schemaName: "VisionConsistency",
        schemaVersion: "1",
        maxOutputTokens: 1_500,
        repairAttempts: 0,
        signal: input.signal,
        cache,
        logger: input.logger,
        images: batch.map((scene) => ({ path: scene.localPath, label: scene.imageLabel })),
        visionCacheDir,
      });
      mergeUsage(usage, generated.usage);
      for (const flag of generated.value.flags) {
        const list = flags.get(flag.sceneId) ?? [];
        list.push(flag.reason);
        flags.set(flag.sceneId, list);
      }
    } catch (error) {
      if (error instanceof LlmError && error.usage) mergeUsage(usage, error.usage);
      input.logger?.warn({ err: error }, "Vision consistency check failed");
    }
  }
  return { flags, usage };
}

function pickBest(
  candidates: VisionCandidateInput[],
  scores: Map<string, number>,
  checks: Map<string, VisionCheck>,
): { id: string | null; fit: number | null } {
  let bestId: string | null = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = scores.get(candidate.id);
    if (score === undefined) continue;
    if (score > bestScore) {
      bestScore = score;
      bestId = candidate.id;
    }
  }
  return {
    id: bestId,
    fit: bestId ? checks.get(bestId)?.fit ?? null : null,
  };
}

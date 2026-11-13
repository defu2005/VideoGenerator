import {
  StageEstimateAgentSchema,
  historyBucket,
  planFromEstimates,
  stageTimeoutInputHash,
  stageTimeoutPlanIsFresh,
  timeoutBriefFromSettings,
  resolveBudget,
  type Project,
  type ProjectSettings,
} from "@vg/shared";
import type { z } from "zod";
import type Database from "better-sqlite3";
import { generateRoutedStructured } from "../providers/llm/structured.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { getAppLlmSettings } from "../providers/llm/settings.js";
import { estimateAllStages } from "./stageHistory.js";

export async function ensureStageTimeoutPlan(input: {
  project: Project;
  sqlite: Database.Database;
  registry: LlmProviderRegistry;
  signal: AbortSignal;
  force?: boolean;
  log?: (message: string) => void;
}): Promise<void> {
  const brief = timeoutBriefFromSettings(input.project.settings, input.project.topic);
  const estimates = estimateAllStages(input.sqlite, brief);
  const hash = stageTimeoutInputHash({ ...brief, historyBucket: historyBucket(estimates) });
  if (!input.force && stageTimeoutPlanIsFresh(input.project.settings, hash)) return;
  const previous = input.project.settings.stageTimeouts ?? null;
  const features = resolveBudget(input.project);
  const userStages = new Set(Object.entries(previous?.stages ?? {}).filter(([, entry]) => entry.source === "user").map(([stage]) => stage));
  const lowStages = Object.entries(estimates)
    .filter(([stage, estimate]) => estimate.confidence === "low" && !userStages.has(stage));
  let agent: z.infer<typeof StageEstimateAgentSchema> | null = null;
  // Plan order: user override, high-confidence history (no LLM), one agent call for the rest, else "rough".
  if (features.stageTimeouts && lowStages.length > 0) {
    try {
      const route = input.registry.resolveTask("stageTimeouts", input.project, getAppLlmSettings(input.sqlite));
      const generated = await generateRoutedStructured({
        registry: input.registry,
        route,
        task: "stageTimeouts",
        schema: StageEstimateAgentSchema,
        schemaName: "StageTimeouts",
        schemaVersion: "2",
        maxOutputTokens: 900,
        system: "Bạn ước lượng thời gian một bước của video sẽ chạy và mức tối đa chấp nhận được. Chỉ trả JSON, chỉ cho các bước được hỏi. timeoutSec là mức tối đa, expectedSec là thời gian thường gặp (nhỏ hơn timeoutSec). reason là một câu tiếng Việt nêu lý do. Không bịa thêm bước.",
        prompt: JSON.stringify({
          brief,
          sceneCount: Math.max(1, Math.ceil(brief.targetDurationSec / brief.sceneDurationSec)),
          stages: lowStages.map(([stage, estimate]) => ({
            stage,
            codeExpectedSec: Math.round(estimate.expectedMs / 1000),
            codeLimitSec: Math.round(estimate.limitMs / 1000),
            samples: estimate.samples,
            whyUnsure: estimate.lowReasons,
          })),
        }),
        signal: input.signal,
      });
      agent = generated.value;
    } catch (error) {
      input.log?.(`stage timeout plan used rough estimate: ${error instanceof Error ? error.message : "lỗi"}`);
      agent = null;
    }
  }
  const plan = planFromEstimates(brief, estimates, previous, agent);
  const settings: ProjectSettings = { ...input.project.settings, stageTimeouts: plan };
  input.sqlite.prepare("UPDATE projects SET settings = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(settings), new Date().toISOString(), input.project.id);
}

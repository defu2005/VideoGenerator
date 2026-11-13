import type Database from "better-sqlite3";
import { z } from "zod";
import type { Project } from "@vg/shared";
import { LlmCache } from "../providers/llm/cache.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { getAppLlmSettings } from "../providers/llm/settings.js";
import { generateRoutedStructured } from "../providers/llm/structured.js";
import { autonomyBudgetStatus, hasAutonomySpendLimit } from "./autonomyBudget.js";
import { UsageService } from "../services/usageService.js";

function digestProject(): Project {
  const now = new Date().toISOString();
  return {
    id: "00000000-0000-4000-8000-000000000059",
    title: "digest",
    description: "",
    topic: "bản tin",
    mode: "ASSISTED",
    settings: {
      language: "vi",
      targetDurationSec: 60,
      wordsPerMinute: 150,
      aspectRatio: "16:9",
      platform: "youtube",
      style: "documentary",
      tone: "neutral",
      audience: "general",
      visualStyle: "photo",
      sceneDurationSec: 6,
      budget: { mode: "ECO" },
      subtitles: { enabled: true, maxCharsPerLine: 42 },
      music: { enabled: false, volume: 0 },
      userSet: [],
      stageExecutors: {},
      autoRender: false,
      guidelines: { platformPack: "auto", customRules: [] },
    },
    status: "DRAFT",
    stage: "RESEARCH",
    thumbnailPath: null,
    durationSec: null,
    version: 1,
    profileId: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
}

/** One short line when the budget still allows a model call. */
export async function summarizeDigest(registry: LlmProviderRegistry, sqlite: Database.Database, facts: string): Promise<string | null> {
  try {
    if (hasAutonomySpendLimit(sqlite)) {
      const status = autonomyBudgetStatus(sqlite, new UsageService(sqlite, 26_000));
      if (status.state === "stop") return null;
    }
    const route = registry.resolveTask("operatorPlan", digestProject(), getAppLlmSettings(sqlite));
    const generated = await generateRoutedStructured({
      registry,
      route,
      task: "operatorPlan",
      schema: z.object({ summary: z.string() }),
      schemaName: "DigestLine",
      schemaVersion: "1",
      system: "Tóm tắt một câu tiếng Việt cho chủ kênh.",
      prompt: facts,
      maxOutputTokens: 120,
      signal: AbortSignal.timeout(20_000),
      cache: new LlmCache(sqlite, false),
    });
    const value = generated.value as { summary?: string };
    return value.summary ?? null;
  } catch {
    return null;
  }
}

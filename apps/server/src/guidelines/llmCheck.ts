import {
  GuidelineCheckOutputSchema,
  guidelineRulesFor,
  type ActiveGuidelines,
  type GuidelineFindingDraft,
  type LlmCallUsage,
  type Project,
  type Script,
} from "@vg/shared";
import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "../lib/config.js";
import { LlmCache } from "../providers/llm/cache.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { getAppLlmSettings } from "../providers/llm/settings.js";
import { generateRoutedStructured } from "../providers/llm/structured.js";
import type Database from "better-sqlite3";

export async function runGuidelineLlmCheck(input: {
  sqlite: Database.Database;
  registry: LlmProviderRegistry;
  config: AppConfig;
  project: Project;
  script: Script;
  active: ActiveGuidelines;
  signal: AbortSignal;
  logger?: FastifyBaseLogger;
  cache?: LlmCache;
}): Promise<{
  drafts: GuidelineFindingDraft[];
  usage: { llmCalls: number; inputTokens: number; outputTokens: number; tokensUnknown?: boolean; calls: LlmCallUsage[] };
  provider: string;
  model: string;
}> {
  const rules = guidelineRulesFor(input.active, ["script", "subtitles", "metadata"]);
  if (!rules.length) {
    return { drafts: [], usage: { llmCalls: 0, inputTokens: 0, outputTokens: 0, calls: [] }, provider: "", model: "" };
  }
  const sectionIds = new Set(input.script.sections.map((section) => section.id));
  const allowed = new Map(rules.map((rule) => [rule.key, rule]));
  const route = input.registry.resolveTask("guidelineCheck", input.project, getAppLlmSettings(input.sqlite));
  const generated = await generateRoutedStructured({
    registry: input.registry,
    route,
    task: "guidelineCheck",
    system: "You check a video script against content guidelines. Return only JSON. Cite only rule keys from the list. sceneId must be a section id from the script, or null for the whole video.",
    prompt: [
      `Topic: ${input.project.topic}`,
      `Description: ${input.project.description || "(none)"}`,
      `Language: ${input.project.settings.language}`,
      `Platform: ${input.project.settings.platform}; style: ${input.project.settings.style}; tone: ${input.project.settings.tone}; audience: ${input.project.settings.audience}`,
      "Active rules (cite these keys only):",
      ...rules.map((rule) => `- ${rule.key} [${rule.severity}] ${rule.text}`),
      "Script:",
      JSON.stringify({
        title: input.script.title,
        hook: input.script.hook,
        sections: input.script.sections.map((section) => ({
          id: section.id,
          heading: section.heading,
          narration: section.narration,
        })),
        outro: input.script.outro,
      }),
      'Return {"findings":[{"ruleId":"pack.rule","severity":"MUST|SHOULD|TIP","sceneId":"section id or null","quote":"","problem":"","suggestion":""}]}.',
    ].join("\n"),
    schema: GuidelineCheckOutputSchema,
    schemaName: "GuidelineCheck",
    schemaVersion: "1",
    maxOutputTokens: 1200,
    repairAttempts: 0,
    signal: input.signal,
    cache: input.cache ?? new LlmCache(input.sqlite, input.config.LLM_CACHE_ENABLED),
    logger: input.logger,
  });
  return {
    drafts: generated.value.findings.flatMap((finding) => {
      const rule = allowed.get(finding.ruleId);
      if (!rule) return [];
      return [{
        ruleId: finding.ruleId,
        severity: rule.severity,
        sceneId: finding.sceneId && sectionIds.has(finding.sceneId) ? finding.sceneId : null,
        text: finding.problem,
        quote: finding.quote.trim() ? finding.quote : null,
        suggestion: finding.suggestion.trim() ? finding.suggestion : null,
      }];
    }),
    usage: generated.usage,
    provider: generated.provider,
    model: generated.model,
  };
}

import { createHash } from "node:crypto";
import { ContinuityPlanSchema, emptyContinuityPlan, resolveBudget, type ContinuityEnvelope } from "@vg/shared";
import type Database from "better-sqlite3";
import type { AppConfig } from "../lib/config.js";
import type { StageContext } from "../pipeline/stageExecutor.js";
import { LlmCache } from "../providers/llm/cache.js";
import { LlmError } from "../providers/llm/types.js";
import { generateRoutedStructured } from "../providers/llm/structured.js";
import { getAppLlmSettings } from "../providers/llm/settings.js";
import { estimateLlmCost } from "../providers/llm/pricing.js";
import type { LlmProviderRegistry, ResolvedLlmRoute } from "../providers/llm/registry.js";
import { StyleService } from "../style/service.js";
import { writeContinuity } from "./store.js";

/** OpenReels director-before-search design; no source code copied. */
export async function buildContinuityPlan(projectId: string, db: Database.Database, registry: LlmProviderRegistry,
  config: AppConfig, context: StageContext): Promise<ContinuityEnvelope> {
  const scenes = db.prepare('SELECT id,kind,narration,visual_description,est_duration_sec FROM scenes WHERE project_id=? ORDER BY "order"').all(projectId) as { id: string }[];
  const script = db.prepare("SELECT data FROM scripts WHERE project_id=?").get(projectId);
  const profile = context.project.profileId ? db.prepare("SELECT style_pack_id FROM profiles WHERE id=?").get(context.project.profileId) as { style_pack_id: string | null } | undefined : undefined;
  const pack = profile?.style_pack_id ? new StyleService(db).getPack(profile.style_pack_id) : null;
  const inputs = { script, scenes, channelStyle: pack?.tokens ?? null, genre: context.project.settings.format ?? context.project.settings.style };
  const sourceHash = createHash("sha256").update(JSON.stringify(inputs)).digest("hex");
  const result: ContinuityEnvelope = { version: 1, plan: emptyContinuityPlan(), weight: 0.05, sourceHash };
  const cost = (provider: string, model: string, usage: Parameters<typeof estimateLlmCost>[3]) => {
    try { return estimateLlmCost(config, provider, model, usage); }
    catch (error) { context.logger.warn({ err: error }, "Continuity cost is unknown"); return 0; }
  };
  if (!resolveBudget(context.project).continuityPlan || !scenes.length) {
    result.note = "Định hướng tự động đang tắt theo ngân sách; có thể chỉnh thủ công.";
  } else {
    let route: ResolvedLlmRoute | undefined;
    try {
      route = registry.resolveTask("continuityPlan", context.project, getAppLlmSettings(db));
      const ids = new Set(scenes.map((scene) => scene.id));
      const schema = ContinuityPlanSchema.refine((plan) => [...plan.characters.flatMap((item) => item.appearsInScenes), ...plan.motifs.flatMap((item) => item.scenes)].every((id) => ids.has(id)), "Use only the supplied scene IDs");
      const generated = await generateRoutedStructured({ registry, route, task: "continuityPlan", schema,
        schemaName: "ContinuityPlan", schemaVersion: "1", repairAttempts: 1,
        system: "You are a video continuity director. Return JSON only. Never invent recurring people who are absent from the script.",
        prompt: `Make one coherent visual plan. Characters: id,description,appearsInScenes,referenceQuery. Palette: temperature warm|neutral|cool, saturation low|mid|high, dominantHues as #RRGGBB. Seed palette from channelStyle when present. Pacing: hook/body/outro target shot seconds, not whole scene lengths; follow genre rhythm. Motifs: at most 3, id,description,scenes. Avoid: short strings. Use supplied scene UUIDs.\n${JSON.stringify(inputs)}`,
        maxOutputTokens: Math.min(2048, route.maxOutputTokens ?? 2048, route.provider.limits?.maxOutputTokens ?? 2048),
        cache: new LlmCache(db, config.LLM_CACHE_ENABLED), cacheKeyExtra: sourceHash,
        signal: context.signal, logger: context.logger });
      result.plan = generated.value;
      context.recordUsage({ ...generated.usage, costUsd: cost(generated.provider, generated.model, generated.usage),
        provider: generated.provider, model: generated.model, features: { continuityPlan: generated.usage.llmCalls }, calls: generated.usage.calls });
    } catch (error) {
      if (context.signal.aborted) throw error;
      const usage = error instanceof LlmError ? error.usage : undefined;
      if (usage) context.recordUsage({ ...usage, costUsd: cost(route?.provider.id ?? "unknown", route?.model ?? "", usage),
        features: { continuityPlan: usage.llmCalls }, calls: usage.calls });
      result.note = "Không tạo được định hướng hợp lệ sau một lần sửa; tiếp tục với kế hoạch rỗng.";
      context.logger.warn({ err: error }, "Continuity plan unavailable; pipeline continues");
    }
  }
  writeContinuity(db, projectId, result);
  return result;
}

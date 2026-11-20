import { createHash, randomUUID } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { continuityFindings, type ContinuityPlan, type ContinuityReport, type ComposePlan } from "@vg/shared";
import type Database from "better-sqlite3";
import type { AppConfig } from "../lib/config.js";
import type { StageContext } from "../pipeline/stageExecutor.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { LlmCache } from "../providers/llm/cache.js";
import { LlmError } from "../providers/llm/types.js";
import { getAppLlmSettings } from "../providers/llm/settings.js";
import { generateRoutedStructured } from "../providers/llm/structured.js";
import { estimateLlmCost } from "../providers/llm/pricing.js";
import { projectDir, resolveAssetPath } from "../storage/paths.js";
import { isInside } from "../storage/references.js";
import { readComposePlan } from "../services/composeBridge.js";
import { averageLab } from "./color.js";
import { continuityFingerprint, readContinuity } from "./store.js";

export function continuityLocalPath(dataDir: string, projectId: string, path: string | null): string | null {
  if (!path) return null;
  try {
    const full = resolveAssetPath(dataDir, projectId, path);
    return existsSync(full) && isInside(realpathSync.native(resolve(dataDir)), realpathSync.native(full)) ? full : null;
  } catch { return null; }
}

export function getValidatedComposePlan(projectId: string, db: Database.Database, config: AppConfig): ComposePlan | null {
  try {
    const renderDir = join(projectDir(config.DATA_DIR, projectId), "render");
    const plan = readComposePlan(renderDir);
    if (!plan || !Array.isArray(plan.scenes) || plan.scenes.length === 0) return null;

    const dbScenes = db.prepare(
      'SELECT id, "order", est_duration_sec, duration_override_sec FROM scenes WHERE project_id=? ORDER BY "order"'
    ).all(projectId) as Array<{ id: string; order: number; est_duration_sec: number; duration_override_sec: number | null }>;

    if (plan.scenes.length !== dbScenes.length) return null;

    for (let i = 0; i < dbScenes.length; i++) {
      const planScene = plan.scenes[i];
      const dbScene = dbScenes[i]!;
      if (!planScene || planScene.sceneId !== dbScene.id) return null;
      if (!Array.isArray(planScene.shots) || planScene.shots.length === 0) return null;

      const voice = db.prepare("SELECT duration_sec FROM voice_tracks WHERE project_id=? AND scene_id=?").get(projectId, dbScene.id) as { duration_sec: number } | undefined;
      const expectedDur = dbScene.duration_override_sec ?? voice?.duration_sec ?? dbScene.est_duration_sec;
      if (Math.abs(planScene.durationSec - expectedDur) > 0.1) return null;
    }

    const tlRow = db.prepare("SELECT data FROM timelines WHERE project_id=?").get(projectId) as { data: string } | undefined;
    if (tlRow) {
      try {
        const tl = JSON.parse(tlRow.data) as { scenes: Array<{ sceneId: string; durationSec: number }> };
        if (Array.isArray(tl.scenes)) {
          if (tl.scenes.length !== plan.scenes.length) return null;
          for (let i = 0; i < tl.scenes.length; i++) {
            if (tl.scenes[i]!.sceneId !== plan.scenes[i]!.sceneId) return null;
            if (Math.abs(tl.scenes[i]!.durationSec - plan.scenes[i]!.durationSec) > 0.05) return null;
          }
        }
      } catch { return null; }
    }

    return plan;
  } catch {
    return null;
  }
}

/** Public code-first port for TASK-140 and read-only tools. No context means no model calls. */
export async function checkContinuity(projectId: string, db: Database.Database, config: AppConfig,
  options: { registry?: LlmProviderRegistry; context?: StageContext } = {}): Promise<ContinuityReport> {
  const envelope = readContinuity(db, projectId);
  const report: ContinuityReport = { dimension: "continuity", findings: [], characterCheck: "skipped",
    characterReason: envelope?.note ?? "Chưa có định hướng hình ảnh.", estimatedPacing: true };
  if (!envelope || envelope.note) return report;
  const rows = db.prepare(`SELECT s.id,s.kind,s.duration_override_sec,s.est_duration_sec,vtrack.duration_sec AS voice_duration_sec,c.local_path,c.tags,c.sha256,c.provider,c.provider_item_id
    FROM scenes s LEFT JOIN visual_selections v ON v.scene_id=s.id AND v.slot=0
    LEFT JOIN visual_candidates c ON c.id=v.candidate_id
    LEFT JOIN voice_tracks vtrack ON vtrack.scene_id=s.id AND vtrack.project_id=s.project_id
    WHERE s.project_id=? ORDER BY s."order"`).all(projectId) as Array<{
      id: string; kind: "hook" | "section" | "outro"; duration_override_sec: number | null; est_duration_sec: number;
      voice_duration_sec: number | null;
      local_path: string | null; tags: string | null; sha256: string | null; provider: string | null; provider_item_id: string | null;
    }>;
  const composePlan = getValidatedComposePlan(projectId, db, config);
  report.estimatedPacing = composePlan === null;
  const measured = await Promise.all(rows.map(async (row) => {
    const cached = row.provider && row.provider_item_id ? `vision-cache/${createHash("sha256").update(`${row.provider}:${row.provider_item_id}`).digest("hex").slice(0, 16)}.jpg` : null;
    const path = continuityLocalPath(config.DATA_DIR, projectId, row.local_path ?? cached);
    let tags: string[] = [];
    if (row.tags) {
      try { const parsedTags = JSON.parse(row.tags); if (Array.isArray(parsedTags)) tags = parsedTags as string[]; } catch { tags = []; }
    }
    const scenePlan = composePlan?.scenes.find((s) => s.sceneId === row.id);
    const validatedShots = scenePlan?.shots.map((shot) => Math.max(0.01, shot.endSec - shot.startSec));
    const sceneDuration = row.duration_override_sec ?? row.voice_duration_sec ?? row.est_duration_sec;
    // Không có shot đã kiểm chứng thì không truyền shot nào: không có pacing đo được (xem continuityFindings).
    const shots = validatedShots ?? [];

    return { id: row.id, kind: row.kind, duration: sceneDuration, shots,
      lab: path ? await averageLab(path) : null, tags, path,
      stamp: path ? String(statSync(path, { bigint: true }).mtimeNs) : "missing" };
  }));
  report.findings = continuityFindings(envelope.plan, measured);
  const characterScenes = measured.filter((row) => row.path && envelope.plan.characters.some((character) => character.appearsInScenes.includes(row.id)));
  const key = createHash("sha256").update(JSON.stringify(["continuity-check-v1", continuityFingerprint(envelope), rows, measured.map((row) => row.stamp)])).digest("hex");
  const cached = db.prepare("SELECT data FROM auto_report_entries WHERE project_id=? AND code='CONTINUITY_REPORT' ORDER BY created_at DESC LIMIT 1").get(projectId) as { data: string } | undefined;
  const previous = cached ? JSON.parse(cached.data) as { key: string; report: ContinuityReport } : undefined;
  if (previous?.key === key && previous.report.characterCheck === "checked") {
    report.findings.push(...previous.report.findings.filter((finding) => finding.code === "character_mismatch"));
    report.characterCheck = "checked"; report.characterReason = previous.report.characterReason;
    return report;
  }
  report.characterReason = !envelope.plan.characters.length ? "Không có nhân vật lặp lại cần kiểm tra." : "Chưa chạy kiểm tra nhân vật bằng model vision; không suy đoán.";
  if (options.registry && options.context && envelope.plan.characters.length && characterScenes.length) {
    const context = options.context;
    let route;
    try {
      route = options.registry.resolveTask("visionConsistency", context.project, getAppLlmSettings(db));
      if (route.provider.configured === false || !route.provider.capabilities?.vision) throw new Error("Chưa cấu hình model vision.");
      if (characterScenes.length > (route.provider.capabilities.maxImagesPerCall ?? 0)) throw new Error("Số ảnh nhân vật vượt giới hạn một batch của model.");
      const sceneIds = new Set(characterScenes.map((scene) => scene.id));
      const schema = z.object({ findings: z.array(z.object({ sceneIds: z.array(z.string().uuid()).min(1), reason: z.string().min(1).max(500) }).strict()).max(50) }).strict()
        .refine((value) => value.findings.every((finding) => finding.sceneIds.every((id) => sceneIds.has(id))), "Use only attached scene IDs");
      const generated = await generateRoutedStructured({ registry: options.registry, route, task: "visionConsistency",
        system: "Check whether the SAME recurring character has a different appearance across the attached scenes. Return JSON {findings:[{sceneIds,reason}]}; report only visible contradictions, do not guess identity.",
        prompt: JSON.stringify({ characters: envelope.plan.characters, sceneIds: characterScenes.map((scene) => scene.id) }),
        schema, schemaName: "ContinuityCharacters", schemaVersion: "1", repairAttempts: 0, maxOutputTokens: Math.min(1500, route.maxOutputTokens ?? 1500),
        images: characterScenes.map((scene) => ({ path: scene.path!, label: scene.id })), signal: context.signal,
        visionCacheDir: resolve(config.DATA_DIR, "projects", projectId, "vision-cache"),
        cache: new LlmCache(db, config.LLM_CACHE_ENABLED), cacheKeyExtra: key, logger: context.logger });
      context.recordUsage({ ...generated.usage, costUsd: estimateLlmCost(config, generated.provider, generated.model, generated.usage),
        provider: generated.provider, model: generated.model, calls: generated.usage.calls, features: { continuityCharacters: generated.usage.llmCalls } });
      report.characterCheck = "checked"; report.characterReason = "Đã kiểm tra nhân vật bằng một batch vision.";
      report.findings.push(...generated.value.findings.map((finding) => ({ code: "character_mismatch" as const, sceneIds: finding.sceneIds,
        message: finding.reason, suggestedFix: "Tìm lại với referenceQuery của nhân vật, rồi duyệt ảnh thay thế." })));
    } catch (error) {
      if (context.signal.aborted) throw error;
      if (error instanceof LlmError && error.usage) context.recordUsage({ ...error.usage,
        costUsd: estimateLlmCost(config, route?.provider.id ?? "unknown", route?.model ?? "", error.usage), calls: error.usage.calls,
        features: { continuityCharacters: error.usage.llmCalls } });
      report.characterReason = error instanceof Error ? error.message : "Không kiểm tra được nhân vật bằng vision.";
    }
  }
  if (options.context) db.transaction(() => {
    db.prepare("DELETE FROM auto_report_entries WHERE project_id=? AND code='CONTINUITY_REPORT'").run(projectId);
    db.prepare("INSERT INTO auto_report_entries(id,project_id,stage,code,severity,message,data,created_at) VALUES (?,?,'VISUAL_SEARCH','CONTINUITY_REPORT','INFO',?,?,?)")
      .run(randomUUID(), projectId, "Định hướng hình ảnh liền mạch", JSON.stringify({ key, report }), new Date().toISOString());
  })();
  return report;
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  ComposePlanSchema,
  computeStats,
  directivesForRecipe,
  estimateRenderSeconds,
  FOOTAGE_MIN_SCORE,
  graphicDurationBounds,
  parseBlackdetect,
  resolveBudget,
  SHOT_KINDS,
  TimelineSchema,
  validateScenePlan,
  type ComposePlan,
  type JobUsage,
  type LlmVariantChoice,
  type Project,
  type RenderTimeEstimate,
  type Shot,
  type ShotKind,
  type Timeline,
} from "@vg/shared";
import type { AppConfig } from "../lib/config.js";
import { projectDir } from "../storage/paths.js";
import { beatGridForMusic } from "../compose/beatsFile.js";
import { planProject, renderSceneClip } from "../compose/composeService.js";
import { baselineDirector, type Director } from "../compose/director.js";
import { createLlmDirector, createRuleDirector, type LlmCall } from "../compose/director/index.js";
import { graphicVariantOptions } from "../compose/render/graphicStyle.js";
import { StyleService } from "../style/service.js";
import { ensureFootage, pickFootageFile } from "../providers/footage/download.js";
import { searchFootage } from "../providers/footage/registry.js";
import type { FootageHit } from "../providers/footage/types.js";
import { LlmCache } from "../providers/llm/cache.js";
import { estimateLlmCost } from "../providers/llm/pricing.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { getAppLlmSettings } from "../providers/llm/settings.js";
import { generateRoutedStructured } from "../providers/llm/structured.js";
import type Database from "better-sqlite3";

/** Search pool per query. Ranking still keeps the best hits for the director. */
const FOOTAGE_SEARCH_LIMIT = 12;

const DirectorAnswerSchema = z.array(z.object({
  sceneId: z.string(),
  spans: z.array(z.object({
    kind: z.string(),
    words: z.tuple([z.number(), z.number()]),
    payload: z.record(z.string(), z.unknown()).optional(),
  }).strict()),
}).strict());

type DirectorModule = { ruleDirector?: Director; llmDirector?: Director };

export function pickDirector(mode: "eco" | "quality", directors: DirectorModule = {}): Director {
  if (mode === "quality" && directors.llmDirector) return directors.llmDirector;
  if (directors.ruleDirector) return directors.ruleDirector;
  return baselineDirector;
}

/** ECO never calls the LLM, even when the project asked for the quality director. */
export function directorModeFor(project: Project): "eco" | "quality" {
  if (project.settings.budget?.mode === "ECO") return "eco";
  return project.settings.edit?.directorMode === "quality" ? "quality" : "eco";
}

export function footageCreditLines(plan: ComposePlan | null): string {
  if (!plan) return "";
  const lines = ["", "FOOTAGE"];
  let any = false;
  for (const scene of plan.scenes) {
    for (const shot of scene.shots) {
      if (shot.source.kind !== "footage") continue;
      any = true;
      const license = shot.source.license;
      lines.push(`- ${license.provider} ${license.clipId}`);
      lines.push(`  Tác giả: ${license.author}`);
      lines.push(`  Giấy phép: ${license.licenseName}`);
      lines.push(`  Nguồn: ${license.pageUrl}`);
    }
  }
  return any ? lines.join("\n") : "";
}

export function footageLicences(plan: ComposePlan): { provider: string; clipId: string; author: string; licenseName: string; pageUrl: string }[] {
  return plan.scenes.flatMap((scene) => scene.shots.flatMap((shot) => shot.source.kind === "footage" ? [shot.source.license] : []));
}

export async function probeFreezeBlack(
  ffmpeg: (args: string[], options: { cwd?: string; signal?: AbortSignal; onStdout?: (chunk: string) => void }) => Promise<{ stderr: string }>,
  file: string,
  signal?: AbortSignal,
): Promise<{ freezeSegments: number; blackSegments: number; freezeAtSec: number[]; blackAtSec: number[] }> {
  const freeze = await ffmpeg(["-hide_banner", "-nostdin", "-i", file, "-vf", "freezedetect=n=0.003:d=1.5", "-f", "null", "-"], { signal });
  const black = await ffmpeg(["-hide_banner", "-nostdin", "-i", file, "-vf", "blackdetect=d=0.2:pix_th=0.10", "-f", "null", "-"], { signal });
  return {
    freezeSegments: (freeze.stderr.match(/freeze_start/g) ?? []).length,
    blackSegments: parseBlackdetect(black.stderr).length,
    freezeAtSec: [...freeze.stderr.matchAll(/freeze_start:\s*(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1])).slice(0, 50),
    blackAtSec: parseBlackdetect(black.stderr).map((item) => item.startSec).slice(0, 50),
  };
}

export async function prepareComposePlan(input: {
  sqlite: Database.Database;
  config: AppConfig;
  project: Project;
  timeline: Timeline;
  resolvePath: (path: string) => string;
  renderDir: string;
  registry?: LlmProviderRegistry;
  signal?: AbortSignal;
}): Promise<{ plan: ComposePlan | null; warnings: string[]; usage?: JobUsage }> {
  const warnings: string[] = [];
  let usage: JobUsage | undefined;
  try {
    const features = resolveBudget(input.project.settings.budget ?? { mode: "BALANCED" });
    const mode = directorModeFor(input.project);
    const aspect = input.project.settings.aspectRatio ?? "16:9";
    const shortSide = Math.min(input.timeline.target.width, input.timeline.target.height);
    const found = new Map<string, FootageHit>();
    const orientation = aspect === "9:16" ? "portrait" : aspect === "1:1" ? "square" : "landscape";
    let beats = null;
    if (input.timeline.music) {
      try {
        beats = await beatGridForMusic(input.config.DATA_DIR, input.resolvePath(input.timeline.music.path));
      } catch (error) {
        warnings.push(`Không đọc được nhịp nhạc: ${error instanceof Error ? error.message : "lỗi"}`);
      }
    }
    const scenes = input.sqlite.prepare("SELECT id, narration, visual_queries AS visualQueries FROM scenes WHERE project_id = ?")
      .all(input.project.id) as { id: string; narration: string; visualQueries: unknown }[];
    const voices = input.sqlite.prepare("SELECT scene_id AS sceneId, words, cues, timing_source AS timingSource FROM voice_tracks WHERE project_id = ?")
      .all(input.project.id) as { sceneId: string; words: unknown; cues: unknown; timingSource: string }[];
    const recipeId = input.project.settings.format || input.project.settings.treatment?.formatId || "explainer";
    const directives = directivesForRecipe(recipeId);
    const llmVariantChoices: LlmVariantChoice[] = [];
    const plan = await planProject({
      timeline: input.timeline,
      scenes: scenes.map((scene) => ({
        id: scene.id,
        narration: scene.narration,
        visualQueries: jsonRecord(scene.visualQueries) as { primary: string; alternatives: string[] } | undefined,
      })),
      voiceTracks: voices.map((track) => ({
        sceneId: track.sceneId,
        words: jsonArray(track.words),
        cues: jsonArray(track.cues),
        timingSource: track.timingSource === "provider" || track.timingSource === "aligned" ? track.timingSource : "estimated",
      })),
      recipeId,
      directives,
      preset: input.project.settings.edit?.preset ?? directives.pacing.preset,
      aspect,
      language: input.project.settings.language,
      targetShortSide: shortSide,
      lockedShots: readComposePlan(input.renderDir)?.scenes.flatMap((scene) => {
        const shots = scene.shots.filter((shot) => shot.locked);
        return shots.length ? [{ sceneId: scene.sceneId, shots }] : [];
      }),
      director: pickDirector(mode, {
        ruleDirector: createRuleDirector({
          language: input.project.settings.language,
          composeGraphics: features.composeGraphics,
        }),
        llmDirector: mode === "quality" && input.registry
          ? createLlmDirector(composeLlm(input, (next) => { usage = next; }), {
            language: input.project.settings.language,
            composeGraphics: features.composeGraphics,
            // QUALITY only: the LLM may pick among the picker's allowed looks inside this same call.
            variants: {
              optionsFor: (shots) => graphicVariantOptions({
                projectId: input.project.id,
                profileId: input.project.profileId,
                recipeId,
                brandColor: input.project.settings.motionGraphics?.brandColor,
                accentColor: input.project.settings.motionGraphics?.accentColor,
                width: input.timeline.target.width,
                height: input.timeline.target.height,
                styles: new StyleService(input.sqlite),
              }, shots),
              onChoices: (choices) => { llmVariantChoices.push(...choices); },
            },
          })
          : undefined,
      }),
      beats,
      // Search returns metadata only. Files are downloaded after planning, for the chosen shots only.
      footageSearch: async (query) => {
        const hits = await cachedFootageSearch(input.config.DATA_DIR, `${orientation}:${query}`, () =>
          searchFootage(input.config, query, { query, orientation, minDurationSec: 1, limit: FOOTAGE_SEARCH_LIMIT }));
        const usable = hits.slice(0, FOOTAGE_SEARCH_LIMIT).filter((hit) => hit.durationSec <= 60
          && pickFootageFile(hit.files.length ? hit.files : [{ url: hit.url, width: hit.width, height: hit.height }], shortSide) !== null);
        for (const hit of usable) found.set(footageKey(hit.provider, hit.clipId), hit);
        return usable;
      },
    });
    if (llmVariantChoices.length > 0) plan.llmVariantChoices = llmVariantChoices;
    const kept = plan.footageNotes?.filter((note) => note.kept).length ?? 0;
    const dropped = plan.footageNotes?.filter((note) => !note.kept).length ?? 0;
    if (kept + dropped > 0) warnings.push(`Footage: giữ ${kept} clip, bỏ ${dropped} clip. Điểm nằm trong kế hoạch.`);
    warnings.push(...await downloadChosenFootage(plan, found, (hit) => ensureFootage(input.config.DATA_DIR, hit, shortSide)));
    mkdirSync(input.renderDir, { recursive: true });
    writeFileSync(join(input.renderDir, "compose-plan.json"), JSON.stringify(plan));
    return { plan, warnings, ...(usage ? { usage } : {}) };
  } catch (error) {
    warnings.push(`Không lập được kế hoạch compose: ${error instanceof Error ? error.message : "lỗi"}. Dùng ảnh tĩnh.`);
    return { plan: null, warnings, ...(usage ? { usage } : {}) };
  }
}

function composeLlm(
  input: { sqlite: Database.Database; config: AppConfig; project: Project; registry?: LlmProviderRegistry; signal?: AbortSignal },
  onUsage: (usage: JobUsage) => void,
): LlmCall {
  return async (prompt) => {
    const registry = input.registry;
    if (!registry) throw new Error("Không có LLM");
    const route = registry.resolveTask("editPlan", input.project, getAppLlmSettings(input.sqlite));
    const generated = await generateRoutedStructured({
      registry,
      route,
      task: "editPlan",
      knowledgeProject: input.project,
      system: "Return JSON only. No prose.",
      prompt,
      schema: DirectorAnswerSchema,
      schemaName: "ComposeDirector",
      schemaVersion: "1",
      maxOutputTokens: Math.min(route.maxOutputTokens ?? 2000, 2000),
      repairAttempts: 0,
      signal: input.signal ?? new AbortController().signal,
      cache: new LlmCache(input.sqlite, input.config.LLM_CACHE_ENABLED),
    });
    let costUsd = 0;
    try {
      costUsd = estimateLlmCost(input.config, generated.provider, generated.model, generated.usage);
    } catch {
      costUsd = 0;
    }
    onUsage({
      llmCalls: generated.usage.llmCalls,
      inputTokens: generated.usage.inputTokens,
      outputTokens: generated.usage.outputTokens,
      costUsd,
      provider: generated.provider,
      model: generated.model,
      ...(generated.usage.tokensUnknown ? { tokensUnknown: true } : {}),
      features: { editPlan: generated.usage.llmCalls },
      ...(generated.usage.calls?.length ? { calls: generated.usage.calls } : {}),
    });
    return JSON.stringify(generated.value);
  };
}

export const FOOTAGE_SEARCH_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Pixabay's API terms ask clients to cache search results for 24 hours.
 * The cache also keeps the plan stable between renders, so scene clips are reused.
 * An empty result is not cached, so a failed search is retried next time.
 */
export async function cachedFootageSearch(
  dataDir: string,
  key: string,
  search: () => Promise<FootageHit[]>,
  now: () => number = Date.now,
): Promise<FootageHit[]> {
  const file = join(dataDir, "footage", "search-cache", `${createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`);
  if (existsSync(file)) {
    try {
      const cached = JSON.parse(readFileSync(file, "utf8")) as { at: number; hits: FootageHit[] };
      if (now() - cached.at < FOOTAGE_SEARCH_TTL_MS && Array.isArray(cached.hits)) return cached.hits;
    } catch {
      // A broken cache file is ignored and replaced.
    }
  }
  const hits = await search();
  if (hits.length) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ at: now(), hits: hits.map(({ localPath: _localPath, ...hit }) => hit) }));
  }
  return hits;
}

function footageKey(provider: string, clipId: string): string {
  return `${provider}:${clipId}`;
}

/** Downloads each footage clip the plan uses, once, and writes its path into the plan. */
export async function downloadChosenFootage(
  plan: ComposePlan,
  hits: Map<string, FootageHit>,
  ensure: (hit: FootageHit) => Promise<{ path: string | null; warning?: string }>,
): Promise<string[]> {
  const warnings: string[] = [];
  const paths = new Map<string, string | null>();
  for (const scene of plan.scenes) {
    for (const shot of scene.shots) {
      if (shot.source.kind !== "footage" || shot.source.path) continue;
      const key = footageKey(shot.source.license.provider, shot.source.clipId);
      if (!paths.has(key)) {
        const hit = hits.get(key);
        const file = hit ? await ensure(hit) : { path: null, warning: "Không tìm lại được clip footage đã chọn." };
        if (file.warning) warnings.push(file.warning);
        paths.set(key, file.path);
      }
      shot.source.path = paths.get(key) ?? null;
    }
  }
  return warnings;
}

/** Plans without footage search so the render screen can show a range before the job starts. */
export async function previewRenderEstimate(input: {
  sqlite: Database.Database;
  project: Project;
  dataDir: string;
}): Promise<RenderTimeEstimate | null> {
  const features = resolveBudget(input.project.settings.budget ?? { mode: "BALANCED" });
  const mode = { composeGraphics: features.composeGraphics, graphicGrain: features.graphicGrain };
  const saved = readComposePlan(join(projectDir(input.dataDir, input.project.id), "render"));
  if (saved) return estimateRenderSeconds(saved, mode);
  const row = input.sqlite.prepare("SELECT data FROM timelines WHERE project_id = ?").get(input.project.id) as { data: string } | undefined;
  if (!row) return null;
  let timeline: Timeline;
  try {
    const parsed = TimelineSchema.safeParse(JSON.parse(row.data));
    if (!parsed.success) return null;
    timeline = parsed.data;
  } catch {
    return null;
  }
  if (timeline.scenes.length === 0) return null;
  const scenes = input.sqlite.prepare("SELECT id, narration, visual_queries AS visualQueries FROM scenes WHERE project_id = ?")
    .all(input.project.id) as { id: string; narration: string; visualQueries: unknown }[];
  const voices = input.sqlite.prepare("SELECT scene_id AS sceneId, words, cues, timing_source AS timingSource FROM voice_tracks WHERE project_id = ?")
    .all(input.project.id) as { sceneId: string; words: unknown; cues: unknown; timingSource: string }[];
  try {
    const recipeId = input.project.settings.format || input.project.settings.treatment?.formatId || "explainer";
    const directives = directivesForRecipe(recipeId);
    const plan = await planProject({
      timeline,
      scenes: scenes.map((scene) => ({
        id: scene.id,
        narration: scene.narration,
        visualQueries: jsonRecord(scene.visualQueries) as { primary: string; alternatives: string[] } | undefined,
      })),
      voiceTracks: voices.map((track) => ({
        sceneId: track.sceneId,
        words: jsonArray(track.words),
        cues: jsonArray(track.cues),
        timingSource: track.timingSource === "provider" || track.timingSource === "aligned" ? track.timingSource : "estimated",
      })),
      recipeId,
      directives,
      preset: input.project.settings.edit?.preset ?? directives.pacing.preset,
      aspect: input.project.settings.aspectRatio ?? "16:9",
      language: input.project.settings.language,
      director: createRuleDirector({ language: input.project.settings.language, composeGraphics: features.composeGraphics }),
      rankFootage: false,
    });
    return estimateRenderSeconds(plan, mode);
  } catch {
    return null;
  }
}

export function readComposePlan(renderDir: string): ComposePlan | null {
  const path = join(renderDir, "compose-plan.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as ComposePlan;
}

export type ShotPatch = { kind?: ShotKind; reroll?: boolean; locked?: boolean };

function kindFits(kind: ShotKind, seconds: number): boolean {
  const bounds = graphicDurationBounds(kind);
  if (!bounds) return kind === "still" || kind === "footage";
  return seconds >= bounds.min - 1e-9 && seconds <= bounds.max + 1e-9;
}

function rankedNotes(plan: ComposePlan, sceneId: string) {
  return (plan.footageNotes ?? [])
    .filter((note) => note.sceneId === sceneId && note.fit >= FOOTAGE_MIN_SCORE && note.author && note.licenseName && note.pageUrl)
    .sort((a, b) => b.fit - a.fit || a.clipId.localeCompare(b.clipId));
}

function footageSource(note: NonNullable<ComposePlan["footageNotes"]>[number]): Shot["source"] | null {
  const [provider, ...rest] = note.clipId.split(":");
  const clipId = rest.join(":");
  if ((provider !== "pexels" && provider !== "pixabay") || !clipId || !note.author || !note.licenseName || !note.pageUrl) return null;
  return {
    kind: "footage",
    clipId,
    path: null,
    inSec: 0.5,
    license: { provider, clipId, author: note.author, licenseName: note.licenseName, pageUrl: note.pageUrl },
  };
}

function nextFootage(plan: ComposePlan, sceneId: string, currentId: string, skipCurrent: boolean): Shot["source"] | null {
  const ranked = rankedNotes(plan, sceneId).filter((note) => note.clipId.includes(":"));
  const index = ranked.findIndex((note) => note.clipId === currentId);
  const later = skipCurrent ? ranked.slice(index < 0 ? 0 : index + 1) : ranked;
  const next = later.find((note) => note.clipId !== currentId);
  return next ? footageSource(next) : null;
}

/** Changes one shot. A kind the span cannot hold, or a reroll with no further hit, comes back as an error. */
export function editComposeShot(plan: ComposePlan, shotId: string, patch: ShotPatch): { plan: ComposePlan } | { error: string } {
  const scene = plan.scenes.find((item) => item.shots.some((shot) => shot.id === shotId));
  const shot = scene?.shots.find((item) => item.id === shotId);
  if (!scene || !shot) return { error: "Không có cảnh quay này." };
  let next: Shot = { ...shot, source: shot.source };
  if (patch.kind && patch.kind !== shot.kind) {
    const seconds = shot.endSec - shot.startSec;
    if (!SHOT_KINDS.includes(patch.kind) || !kindFits(patch.kind, seconds)) return { error: "Kiểu không hợp độ dài cảnh quay này." };
    if (patch.kind === "still") {
      const still = shot.source.kind === "still"
        ? shot.source
        : scene.shots.find((item) => item.source.kind === "still")?.source;
      if (!still || still.kind !== "still") return { error: "Cảnh này không có ảnh để đổi." };
      next = { ...next, kind: "still", source: still, reason: `${shot.reason}+đổi` };
    } else if (patch.kind === "footage") {
      const current = shot.source.kind === "footage" ? `${shot.source.license.provider}:${shot.source.clipId}` : "";
      const source = nextFootage(plan, scene.sceneId, current, false);
      if (!source || source.kind !== "footage") return { error: "Hết clip phù hợp." };
      next = { ...next, kind: "footage", source, reason: `${shot.reason}+đổi` };
    } else {
      return { error: "Chưa đủ chữ trên hình cho kiểu này." };
    }
  }
  if (patch.reroll) {
    if (next.kind !== "footage" || next.source.kind !== "footage") return { error: "Chỉ đổi footage của cảnh quay footage." };
    const source = nextFootage(plan, scene.sceneId, `${next.source.license.provider}:${next.source.clipId}`, true);
    if (!source) return { error: "Hết clip phù hợp." };
    next = { ...next, kind: "footage", source, reason: `${next.reason}+đổi` };
  }
  if (patch.locked !== undefined) next = { ...next, locked: patch.locked };
  const scenes = plan.scenes.map((item) => item === scene
    ? { ...item, shots: item.shots.map((itemShot) => itemShot.id === shotId ? next : itemShot) }
    : item);
  const used = new Set(scenes.flatMap((item) => item.shots.flatMap((itemShot) => (
    itemShot.source.kind === "footage" ? [`${itemShot.source.license.provider}:${itemShot.source.clipId}`] : []
  ))));
  const footageNotes = plan.footageNotes?.map((note) => ({ ...note, kept: used.has(note.clipId) }));
  const stats = {
    ...computeStats({ scenes }, scenes.map(() => []), scenes.map(() => null)),
    beatCutPct: plan.stats.beatCutPct,
    wordGapCutPct: plan.stats.wordGapCutPct,
  };
  const updated = { ...plan, scenes, stats, ...(footageNotes ? { footageNotes } : {}) };
  const edited = scenes.find((item) => item.sceneId === scene.sceneId)!;
  const errors = validateScenePlan(edited, []);
  if (errors.length) return { error: errors[0] ?? "Cảnh quay không hợp lệ." };
  const parsed = ComposePlanSchema.safeParse(updated);
  if (!parsed.success) return { error: "Kế hoạch sau khi sửa không hợp lệ." };
  return { plan: parsed.data };
}

export function editSavedComposeShot(renderDir: string, shotId: string, patch: ShotPatch): { plan: ComposePlan } | { error: string } {
  const current = readComposePlan(renderDir);
  if (!current) return { error: "Chưa có kế hoạch cảnh quay." };
  const parsed = ComposePlanSchema.safeParse(current);
  if (!parsed.success) return { error: "Kế hoạch cảnh quay không đọc được." };
  const edited = editComposeShot(parsed.data, shotId, patch);
  if ("error" in edited) return edited;
  mkdirSync(renderDir, { recursive: true });
  writeFileSync(join(renderDir, "compose-plan.json"), JSON.stringify(edited.plan));
  return edited;
}

export { renderSceneClip };

function jsonArray(value: unknown): { startSec: number; endSec: number; text: string }[] {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  return Array.isArray(parsed) ? parsed as { startSec: number; endSec: number; text: string }[] : [];
}

function jsonRecord(value: unknown): unknown {
  if (typeof value === "string") {
    try { return JSON.parse(value) as unknown; } catch { return undefined; }
  }
  return value ?? undefined;
}

import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type Database from "better-sqlite3";
import {
  directivesForRecipe,
  renderTargetFor,
  TimelineSchema,
  ComposePlanSchema,
  type AspectRatio,
  type ComposePlan,
  type Project,
  type ScenePlan,
  type Shot,
  type Timeline,
} from "@vg/shared";
import { planProject } from "../compose/composeService.js";
import { createRuleDirector } from "../compose/director/index.js";
import { composeInputFingerprint, readPlanInputs } from "../compose/planInputs.js";
import { readComposePlan } from "../services/composeBridge.js";
import { projectDir } from "../storage/paths.js";

/** Where the preview took its scenes from. `selection` means TIMELINE is not DONE yet. */
export type PreviewBasis = "timeline" | "selection";

export type PreviewScene = {
  sceneId: string;
  index: number;
  label: string;
  /** Video-clock start. */
  startSec: number;
  durationSec: number;
  plan: ScenePlan;
  voice: { path: string; offsetSec: number } | null;
};

export type PreviewPlan = {
  basis: PreviewBasis;
  aspect: AspectRatio;
  fps: number;
  scenes: PreviewScene[];
  /** ASS file on the video clock, when the timeline has one. */
  subtitleAssPath: string | null;
  /** Crop files by source image path, so the preview shows the same crop as RENDER. */
  cropByPath: Map<string, string>;
  notes: string[];
};

export type PlanSourceDeps = {
  sqlite: Database.Database;
  dataDir: string;
  /** Returns the saved timeline for the project, or null. */
  timeline: (projectId: string) => Timeline | null;
};

const SELECTION_SEC_PER_WORD = 0.4;

function aspectOf(target: { width: number; height: number }): AspectRatio {
  if (target.width === target.height) return "1:1";
  return target.height > target.width ? "9:16" : "16:9";
}

function timelineDone(sqlite: Database.Database, projectId: string): boolean {
  const row = sqlite.prepare("SELECT state FROM project_stages WHERE project_id = ? AND stage = 'TIMELINE'").get(projectId) as { state: string } | undefined;
  return row?.state === "DONE";
}

function cropsFor(sqlite: Database.Database, timeline: Timeline | null, aspect: AspectRatio, paths: { candidateId: string; path: string }[]): Map<string, string> {
  const map = new Map<string, string>();
  const list = timeline
    ? timeline.scenes.flatMap((scene) => scene.visuals.flatMap((visual) => visual.kind === "IMAGE" && visual.path && visual.candidateId ? [{ candidateId: visual.candidateId, path: visual.path }] : []))
    : paths;
  for (const item of list) {
    const crop = sqlite.prepare("SELECT output_path FROM visual_crops WHERE candidate_id = ? AND aspect = ?").get(item.candidateId, aspect) as { output_path: string } | undefined;
    if (crop && existsSync(crop.output_path)) map.set(item.path, crop.output_path);
  }
  return map;
}

export async function loadPreviewPlan(deps: PlanSourceDeps, project: Project): Promise<PreviewPlan> {
  const timeline = deps.timeline(project.id);
  if (timeline && timelineDone(deps.sqlite, project.id)) return fromTimeline(deps, project, timeline);
  return fromSelection(deps, project, timeline === null ? "Chưa có timeline." : "Bước Timeline chưa xong.");
}

/**
 * A saved plan is reused only when its sidecar fingerprint matches the current inputs (see planInputs.ts).
 * Field-by-field checks missed motion, graphic text, FPS and reordering, so they are no longer used.
 * This check only confirms that every timeline scene has a plan entry.
 */
function savedPlanCoversTimeline(saved: ComposePlan, timeline: Timeline): boolean {
  if (!Array.isArray(saved.scenes) || saved.scenes.length !== timeline.scenes.length) return false;
  const planned = new Set(saved.scenes.map((scene) => scene.sceneId));
  return timeline.scenes.every((scene) => planned.has(scene.sceneId));
}

function extractLockedShots(saved: ComposePlan | null): { sceneId: string; shots: Shot[] }[] {
  if (!saved || !Array.isArray(saved.scenes)) return [];
  const result: { sceneId: string; shots: Shot[] }[] = [];
  for (const scene of saved.scenes) {
    if (Array.isArray(scene.shots)) {
      const locked = scene.shots.filter((shot) => shot.locked);
      if (locked.length > 0) result.push({ sceneId: scene.sceneId, shots: locked });
    }
  }
  return result;
}

async function fromTimeline(deps: PlanSourceDeps, project: Project, timeline: Timeline): Promise<PreviewPlan> {
  const parsed = TimelineSchema.safeParse(timeline);
  const tl = parsed.success ? parsed.data : timeline;
  const aspect = aspectOf(tl.target);
  const renderDir = join(projectDir(deps.dataDir, project.id), "render");
  let saved: ComposePlan | null = null;
  try {
    const raw = readComposePlan(renderDir);
    if (raw) {
      const parsedPlan = ComposePlanSchema.safeParse(raw);
      if (parsedPlan.success) saved = parsedPlan.data;
    }
  } catch {
    // Unreadable or invalid JSON: treated as no saved plan, so the preview rebuilds.
    saved = null;
  }
  const fingerprint = composeInputFingerprint(deps.sqlite, project, tl);
  const notes: string[] = [];
  let compose: ComposePlan;
  if (saved && saved.aspect === aspect && readPlanInputs(renderDir) === fingerprint && savedPlanCoversTimeline(saved, tl)) {
    compose = saved;
  } else {
    // Locked shots from the saved plan still carry over, as RENDER does.
    compose = await planFromTimeline(deps, project, tl, aspect, extractLockedShots(saved));
    notes.push("Chưa có kế hoạch dựng đã lưu hoặc timeline đã thay đổi — dùng kế hoạch dựng tạm, không tìm video stock.");
  }
  const scenes: PreviewScene[] = [];
  for (const [index, scene] of tl.scenes.entries()) {
    const plan = compose.scenes.find((item) => item.sceneId === scene.sceneId);
    if (!plan) {
      notes.push(`Cảnh ${index + 1} không có trong kế hoạch dựng nên không xem trước được.`);
      continue;
    }
    scenes.push({
      sceneId: scene.sceneId,
      index,
      label: scene.label,
      startSec: scene.startSec,
      durationSec: scene.durationSec,
      plan,
      voice: scene.voice ? { path: scene.voice.path, offsetSec: Math.max(0, scene.voice.startSec - scene.startSec) } : null,
    });
  }
  return {
    basis: "timeline",
    aspect,
    fps: tl.target.fps,
    scenes,
    subtitleAssPath: tl.subtitles?.assPath && existsSync(tl.subtitles.assPath) ? tl.subtitles.assPath : null,
    cropByPath: cropsFor(deps.sqlite, tl, aspect, []),
    notes,
  };
}

async function planFromTimeline(
  deps: PlanSourceDeps,
  project: Project,
  timeline: Timeline,
  aspect: AspectRatio,
  lockedShots?: { sceneId: string; shots: Shot[] }[],
): Promise<ComposePlan> {
  const scenes = deps.sqlite.prepare("SELECT id, narration, visual_queries AS visualQueries FROM scenes WHERE project_id = ?")
    .all(project.id) as { id: string; narration: string; visualQueries: unknown }[];
  const voices = deps.sqlite.prepare("SELECT scene_id AS sceneId, words, cues, timing_source AS timingSource FROM voice_tracks WHERE project_id = ?")
    .all(project.id) as { sceneId: string; words: unknown; cues: unknown; timingSource: string }[];
  const json = (value: unknown): unknown => {
    if (typeof value !== "string") return value;
    try { return JSON.parse(value); } catch { return undefined; }
  };
  const array = (value: unknown): unknown[] => { const parsed = json(value); return Array.isArray(parsed) ? parsed : []; };
  const recipeId = project.settings.format || project.settings.treatment?.formatId || "explainer";
  const directives = directivesForRecipe(recipeId);
  return planProject({
    timeline,
    scenes: scenes.map((scene) => ({
      id: scene.id,
      narration: scene.narration,
      visualQueries: json(scene.visualQueries) as { primary: string; alternatives: string[] } | undefined,
    })),
    voiceTracks: voices.map((track) => ({
      sceneId: track.sceneId,
      words: array(track.words) as never,
      cues: array(track.cues) as never,
      timingSource: track.timingSource === "provider" || track.timingSource === "aligned" ? track.timingSource : "estimated",
    })),
    recipeId,
    directives,
    preset: project.settings.edit?.preset ?? directives.pacing.preset,
    aspect,
    language: project.settings.language,
    director: createRuleDirector({ language: project.settings.language, composeGraphics: "static" }),
    rankFootage: false,
    ...(lockedShots && lockedShots.length > 0 ? { lockedShots } : {}),
  });
}

type SelectionRow = {
  id: string;
  label: string;
  narration: string;
  est: number | null;
  override: number | null;
  noVisual: number;
  candidateId: string | null;
  localPath: string | null;
};

/** TIMELINE is not DONE: one still per scene from the approved or best candidate, with a guessed length. */
function fromSelection(deps: PlanSourceDeps, project: Project, why: string): PreviewPlan {
  const aspect = (project.settings.aspectRatio ?? "16:9") as AspectRatio;
  const target = renderTargetFor(aspect);
  const rows = deps.sqlite.prepare(`
    SELECT s.id, s.label, s.narration, s.est_duration_sec AS est, s.duration_override_sec AS override, s.no_visual AS noVisual,
      (SELECT v.candidate_id FROM visual_selections v WHERE v.scene_id = s.id ORDER BY v.slot ASC LIMIT 1) AS candidateId,
      (SELECT c.local_path FROM visual_selections v JOIN visual_candidates c ON c.id = v.candidate_id WHERE v.scene_id = s.id ORDER BY v.slot ASC LIMIT 1) AS localPath
    FROM scenes s WHERE s.project_id = ? ORDER BY s."order" ASC
  `).all(project.id) as SelectionRow[];
  const base = projectDir(deps.dataDir, project.id);
  const scenes: PreviewScene[] = [];
  const picked: { candidateId: string; path: string }[] = [];
  let cursor = 0;
  for (const [index, row] of rows.entries()) {
    const words = row.narration.trim().split(/\s+/).filter(Boolean).length;
    const durationSec = Math.max(1, row.override ?? row.est ?? words * SELECTION_SEC_PER_WORD);
    const frames = Math.max(1, Math.round(durationSec * target.fps));
    const path = row.localPath ? (isAbsolute(row.localPath) ? row.localPath : join(base, row.localPath)) : null;
    const usable = path !== null && existsSync(path) && !row.noVisual;
    const source: Shot["source"] = usable && row.candidateId
      ? { kind: "still", candidateId: row.candidateId, path, motion: "push_in" }
      : { kind: "kinetic_text", lines: [row.label || `Cảnh ${index + 1}`], emphasis: [], style: "bold" };
    if (usable && row.candidateId && path) picked.push({ candidateId: row.candidateId, path });
    const shot: Shot = {
      id: `${row.id}-sel0`,
      kind: source.kind === "still" ? "still" : "kinetic_text",
      startSec: 0,
      endSec: frames / target.fps,
      source,
      reason: "selection",
    };
    scenes.push({
      sceneId: row.id,
      index,
      label: row.label,
      startSec: cursor,
      durationSec: frames / target.fps,
      plan: { sceneId: row.id, durationSec: frames / target.fps, durationFrames: frames, fps: target.fps, shots: [shot], warnings: [] },
      voice: null,
    });
    cursor += frames / target.fps;
  }
  return {
    basis: "selection",
    aspect,
    fps: target.fps,
    scenes,
    subtitleAssPath: null,
    cropByPath: cropsFor(deps.sqlite, null, aspect, picked),
    notes: [`${why} Xem trước dựa trên ảnh đã chọn, độ dài cảnh là ước lượng; chưa có giọng đọc và phụ đề.`],
  };
}


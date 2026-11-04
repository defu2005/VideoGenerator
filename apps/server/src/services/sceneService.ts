import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import {
  ScenePlanSummarySchema,
  SceneSchema,
  StoredVisualQueriesSchema,
  splitSentences,
  type PipelineStage,
  type Project,
  type Scene,
  type ScenePatch,
} from "@vg/shared";
import type Database from "better-sqlite3";
import type { JobRepository } from "../jobs/jobRepository.js";
import { markStaleFrom } from "../pipeline/invalidation.js";
import { AppError } from "../lib/errors.js";

export type SceneMutateOptions = {
  /** Stage after which later DONE stages become STALE. Defaults to SCENE_PLAN. */
  staleFrom?: PipelineStage;
};

type SceneRow = {
  id: string;
  project_id: string;
  order: number;
  kind: Scene["kind"];
  section_id: string | null;
  label: string;
  narration: string;
  visual_notes: string;
  visual_description: string;
  no_visual: number;
  visual_queries: string;
  music_mood: string;
  energy: Scene["energy"];
  est_duration_sec: number;
  duration_override_sec: number | null;
  start_sec: number;
  transition_note: string;
  origin: Scene["origin"];
  edited: number;
  input_hash: string;
  created_at: string;
  updated_at: string;
};

function wordCount(value: string): number {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function storedVisualQueries(scene: Pick<Scene, "visualQueries" | "queryVariant">): string {
  return JSON.stringify({ ...scene.visualQueries, queryVariant: scene.queryVariant });
}

function fromRow(row: SceneRow): Scene {
  const storedVisualQueries = StoredVisualQueriesSchema.parse(JSON.parse(row.visual_queries) as unknown);
  return SceneSchema.parse({
    id: row.id,
    projectId: row.project_id,
    order: row.order,
    kind: row.kind,
    sectionId: row.section_id,
    label: row.label,
    narration: row.narration,
    visualNotes: row.visual_notes,
    visualDescription: row.visual_description,
    noVisual: Boolean(row.no_visual),
    visualQueries: {
      primary: storedVisualQueries.primary,
      alternatives: storedVisualQueries.alternatives,
    },
    queryVariant: storedVisualQueries.queryVariant,
    musicMood: row.music_mood,
    energy: row.energy,
    estDurationSec: row.est_duration_sec,
    durationOverrideSec: row.duration_override_sec,
    startSec: row.start_sec,
    transitionNote: row.transition_note,
    origin: row.origin,
    edited: Boolean(row.edited),
    inputHash: row.input_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class SceneService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly repository: JobRepository,
  ) {}

  hasEditedScenes(projectId: string): boolean {
    return this.sqlite.prepare("SELECT 1 FROM scenes WHERE project_id = ? AND edited = 1 LIMIT 1")
      .get(projectId) !== undefined;
  }

  get(projectId: string) {
    const project = this.requireProject(projectId);
    const scenes = this.list(projectId);
    return ScenePlanSummarySchema.parse({
      scenes,
      totalSec: this.totalDuration(scenes),
      targetSec: project.settings.targetDurationSec,
      stale: this.repository.getStage(projectId, "SCENE_PLAN").state === "STALE",
    });
  }

  patch(projectId: string, sceneId: string, patch: ScenePatch, options?: SceneMutateOptions) {
    return this.mutate(projectId, () => {
      const project = this.requireProject(projectId);
      const current = this.findScene(projectId, sceneId);
      if (!current) throw new AppError(404, "SCENE_NOT_FOUND", "Scene not found");
      const next = {
        ...current,
        ...patch,
        visualQueries: patch.visualQueries ?? current.visualQueries,
        queryVariant: patch.visualQueries === undefined ? current.queryVariant : false,
        durationOverrideSec: patch.durationOverrideSec === undefined
          ? current.durationOverrideSec
          : patch.durationOverrideSec,
        estDurationSec: this.estimate(patch.narration ?? current.narration, project),
        origin: "USER" as const,
        edited: true,
        updatedAt: new Date().toISOString(),
      };
      this.saveScene(next);
      return this.recompute(projectId, project);
    }, options);
  }

  reorder(projectId: string, sceneIds: string[], options?: SceneMutateOptions) {
    return this.mutate(projectId, () => {
      const project = this.requireProject(projectId);
      const scenes = this.list(projectId);
      if (sceneIds.length !== scenes.length
        || new Set(sceneIds).size !== scenes.length
        || sceneIds.some((id) => !scenes.some((scene) => scene.id === id))) {
        throw new AppError(400, "INVALID_SCENE_ORDER", "Scene IDs must be a permutation of this project's scenes.");
      }
      this.setTemporaryOrder(projectId, scenes.length);
      const update = this.sqlite.prepare("UPDATE scenes SET \"order\" = ?, origin = 'USER', edited = 1, updated_at = ? WHERE id = ? AND project_id = ?");
      const timestamp = new Date().toISOString();
      sceneIds.forEach((id, order) => update.run(order, timestamp, id, projectId));
      return this.recompute(projectId, project);
    }, options);
  }

  split(projectId: string, sceneId: string, sentenceIndex: number) {
    return this.mutate(projectId, () => {
      const project = this.requireProject(projectId);
      const scene = this.findScene(projectId, sceneId);
      if (!scene) throw new AppError(404, "SCENE_NOT_FOUND", "Scene not found");
      const sentences = splitSentences(scene.narration, project.settings.language);
      if (sentenceIndex >= sentences.length - 1) {
        throw new AppError(400, "INVALID_SPLIT_INDEX", "A split requires at least one sentence on each side.");
      }
      const now = new Date().toISOString();
      const firstText = sentences.slice(0, sentenceIndex + 1).join(" ");
      const secondText = sentences.slice(sentenceIndex + 1).join(" ");
      const secondId = randomUUID();
      const insert = this.sqlite.prepare(
        "INSERT INTO scenes (id, project_id, \"order\", kind, section_id, label, narration, visual_notes, visual_description, visual_queries, music_mood, energy, est_duration_sec, duration_override_sec, start_sec, transition_note, origin, edited, input_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'USER', 1, ?, ?, ?)",
      );
      const moved = this.list(projectId).filter((item) => item.order > scene.order);
      this.setTemporaryOrder(projectId, this.list(projectId).length);
      this.saveScene({
        ...scene,
        order: scene.order,
        narration: firstText,
        estDurationSec: this.estimate(firstText, project),
        durationOverrideSec: null,
        origin: "USER",
        edited: true,
        updatedAt: now,
      });
      insert.run(
        secondId, projectId, scene.order + 1, scene.kind, scene.sectionId, scene.label,
        secondText, scene.visualNotes, scene.visualDescription, storedVisualQueries(scene), scene.musicMood, scene.energy,
        this.estimate(secondText, project), scene.startSec, scene.transitionNote, scene.inputHash, now, now,
      );
      const updateOrder = this.sqlite.prepare("UPDATE scenes SET \"order\" = ? WHERE id = ? AND project_id = ?");
      moved.forEach((item, index) => updateOrder.run(scene.order + index + 2, item.id, projectId));
      return this.recompute(projectId, project);
    });
  }

  merge(projectId: string, sceneIds: [string, string]) {
    const deletedTrack = this.voiceTrackPath(sceneIds[1], projectId);
    const result = this.mutate(projectId, () => {
      const project = this.requireProject(projectId);
      const scenes = this.list(projectId);
      const left = scenes.find((scene) => scene.id === sceneIds[0]);
      const right = scenes.find((scene) => scene.id === sceneIds[1]);
      if (!left || !right) throw new AppError(404, "SCENE_NOT_FOUND", "Scene not found");
      if (right.order !== left.order + 1) {
        throw new AppError(400, "SCENES_NOT_ADJACENT", "Only adjacent scenes can be merged in their displayed order.");
      }
      const mergedText = `${left.narration.trim()} ${right.narration.trim()}`.trim();
      this.saveScene({
        ...left,
        narration: mergedText,
        estDurationSec: this.estimate(mergedText, project),
        durationOverrideSec: null,
        edited: true,
        origin: "USER",
        updatedAt: new Date().toISOString(),
      });
      this.sqlite.prepare("DELETE FROM scenes WHERE id = ? AND project_id = ?").run(right.id, projectId);
      this.compactOrders(projectId, scenes.length);
      return this.recompute(projectId, project);
    });
    if (deletedTrack && existsSync(deletedTrack)) rmSync(deletedTrack, { force: true });
    return result;
  }

  delete(projectId: string, sceneId: string) {
    const deletedTrack = this.voiceTrackPath(sceneId, projectId);
    const result = this.mutate(projectId, () => {
      const project = this.requireProject(projectId);
      const scenes = this.list(projectId);
      const scene = scenes.find((item) => item.id === sceneId);
      if (!scene) throw new AppError(404, "SCENE_NOT_FOUND", "Scene not found");
      if (scenes.length <= 1) throw new AppError(400, "LAST_SCENE", "A project must keep at least one scene.");
      this.sqlite.prepare("DELETE FROM scenes WHERE id = ? AND project_id = ?").run(scene.id, projectId);
      this.compactOrders(projectId, scenes.length);
      return this.recompute(projectId, project);
    });
    if (deletedTrack && existsSync(deletedTrack)) rmSync(deletedTrack, { force: true });
    return result;
  }

  private voiceTrackPath(sceneId: string, projectId: string): string | undefined {
    const track = this.sqlite.prepare(
      "SELECT audio_path FROM voice_tracks WHERE scene_id = ? AND project_id = ?",
    ).get(sceneId, projectId) as { audio_path: string } | undefined;
    return track?.audio_path;
  }

  private mutate<T>(projectId: string, operation: () => T, options?: SceneMutateOptions): T {
    const staleFrom = options?.staleFrom ?? "SCENE_PLAN";
    return this.repository.atomic(() => {
      this.requireProject(projectId);
      if (this.repository.getActiveJob(projectId)) {
        throw new AppError(409, "INVALID_PIPELINE_STATE", "A job is already active for this project.");
      }
      const result = operation();
      this.repository.updateStage(projectId, "SCENE_PLAN", {
        state: "DONE",
        progress: 100,
        message: "Edited by user",
        jobId: null,
        error: null,
      });
      markStaleFrom(this.repository, projectId, staleFrom);
      return result;
    });
  }

  private requireProject(projectId: string): Project {
    const project = this.repository.getProject(projectId);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    return project;
  }

  private list(projectId: string): Scene[] {
    const rows = this.sqlite.prepare("SELECT * FROM scenes WHERE project_id = ? ORDER BY \"order\"")
      .all(projectId) as SceneRow[];
    return rows.map(fromRow);
  }

  private findScene(projectId: string, sceneId: string): Scene | undefined {
    const row = this.sqlite.prepare("SELECT * FROM scenes WHERE project_id = ? AND id = ?")
      .get(projectId, sceneId) as SceneRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  private saveScene(scene: Scene): void {
    this.sqlite.prepare(
      "UPDATE scenes SET \"order\" = ?, kind = ?, section_id = ?, label = ?, narration = ?, visual_notes = ?, visual_description = ?, visual_queries = ?, music_mood = ?, energy = ?, est_duration_sec = ?, duration_override_sec = ?, start_sec = ?, transition_note = ?, origin = ?, edited = ?, input_hash = ?, updated_at = ? WHERE id = ? AND project_id = ?",
    ).run(
      scene.order, scene.kind, scene.sectionId, scene.label, scene.narration, scene.visualNotes, scene.visualDescription,
      storedVisualQueries(scene), scene.musicMood, scene.energy, scene.estDurationSec,
      scene.durationOverrideSec, scene.startSec, scene.transitionNote, scene.origin, scene.edited ? 1 : 0,
      scene.inputHash, scene.updatedAt, scene.id, scene.projectId,
    );
  }

  private estimate(narration: string, project: Project): number {
    return round1(wordCount(narration) * 60 / project.settings.wordsPerMinute);
  }

  private totalDuration(scenes: Scene[]): number {
    return round1(scenes.reduce((total, scene) => total + (scene.durationOverrideSec ?? scene.estDurationSec), 0));
  }

  private recompute(projectId: string, project: Project) {
    const update = this.sqlite.prepare("UPDATE scenes SET \"order\" = ?, start_sec = ?, updated_at = ? WHERE id = ? AND project_id = ?");
    let startSec = 0;
    const timestamp = new Date().toISOString();
    const scenes = this.list(projectId);
    scenes.forEach((scene, order) => {
      update.run(order, round1(startSec), timestamp, scene.id, projectId);
      startSec = round1(startSec + (scene.durationOverrideSec ?? scene.estDurationSec));
    });
    const updated = this.list(projectId);
    return ScenePlanSummarySchema.parse({
      scenes: updated,
      totalSec: this.totalDuration(updated),
      targetSec: project.settings.targetDurationSec,
      stale: false,
    });
  }

  private setTemporaryOrder(projectId: string, count: number): void {
    const update = this.sqlite.prepare("UPDATE scenes SET \"order\" = ? WHERE id = ?");
    const rows = this.sqlite.prepare("SELECT id FROM scenes WHERE project_id = ? ORDER BY \"order\"")
      .all(projectId) as { id: string }[];
    rows.forEach((row, index) => update.run(-count - index - 1, row.id));
  }

  private compactOrders(projectId: string, previousCount: number): void {
    const rows = this.list(projectId);
    this.setTemporaryOrder(projectId, previousCount);
    const update = this.sqlite.prepare("UPDATE scenes SET \"order\" = ? WHERE id = ? AND project_id = ?");
    rows.forEach((scene, order) => update.run(order, scene.id, projectId));
  }
}

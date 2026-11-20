import {
  ApiErrorSchema,
  MergeScenesSchema,
  ReorderScenesSchema,
  ScenePatchSchema,
  ScenePlanSummarySchema,
  SplitSceneSchema,
} from "@vg/shared";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type Database from "better-sqlite3";
import { SceneService } from "../services/sceneService.js";
import { captureStageFeedback, feedbackSourceFor } from "../learning/stageFeedback.js";

const ParamsSchema = z.object({ id: z.string().uuid() }).strict();
const SceneParamsSchema = z.object({ id: z.string().uuid(), sceneId: z.string().uuid() }).strict();
const Errors = { 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema };

export type SceneSnapshot = { id: string; order: number; label: string; narration: string; visualQueries: string; noVisual: boolean };

// TASK-148a: snapshot of the plan before and after a scene edit. Best-effort: never blocks the edit.
function snapshotScenes(sqlite: Database.Database, projectId: string): SceneSnapshot[] {
  const rows = sqlite.prepare(
    `SELECT id, "order" AS "order", label, narration, visual_queries AS visualQueries, no_visual AS noVisual FROM scenes WHERE project_id = ? ORDER BY "order"`,
  ).all(projectId) as Array<Omit<SceneSnapshot, "noVisual"> & { noVisual: number }>;
  return rows.map((row) => ({ ...row, noVisual: Boolean(row.noVisual) }));
}

/** Only the scenes that changed, so a long plan does not hit the writer's byte cap. */
export function diffScenes(before: SceneSnapshot[], after: SceneSnapshot[]) {
  const key = (scene: SceneSnapshot) => JSON.stringify(scene);
  const beforeById = new Map(before.map((scene) => [scene.id, key(scene)]));
  const afterById = new Map(after.map((scene) => [scene.id, key(scene)]));
  const changedBefore = before.filter((scene) => afterById.get(scene.id) !== key(scene));
  const changedAfter = after.filter((scene) => beforeById.get(scene.id) !== key(scene));
  const touched = new Set([...changedBefore, ...changedAfter].map((scene) => scene.id));
  const single = touched.size === 1 ? [...changedAfter, ...changedBefore][0] : null;
  return { before: changedBefore, after: changedAfter, target: single ? `scene:${single.order}` : "scenes" };
}

export function registerSceneRoutes(app: FastifyInstance, service: SceneService, sqlite?: Database.Database): void {
  const captured = async <T>(request: FastifyRequest, projectId: string, run: () => T | Promise<T>): Promise<T> => {
    if (!sqlite) return run();
    let before: SceneSnapshot[] | null = null;
    try {
      before = snapshotScenes(sqlite, projectId);
    } catch (error) {
      request.log.warn({ err: error, projectId }, "stage feedback snapshot failed");
    }
    const result = await run();
    if (before) {
      try {
        const diff = diffScenes(before, snapshotScenes(sqlite, projectId));
        if (diff.before.length > 0 || diff.after.length > 0) {
          captureStageFeedback(sqlite, {
            projectId, stage: "SCENE_PLAN", kind: "user_edit", target: diff.target,
            before: diff.before, after: diff.after, source: feedbackSourceFor(request.actor),
          }, request.log);
        }
      } catch (error) {
        request.log.warn({ err: error, projectId }, "stage feedback capture failed");
      }
    }
    return result;
  };

  app.get("/api/projects/:id/scenes", {
    schema: { params: ParamsSchema, response: { 200: ScenePlanSummarySchema, 404: ApiErrorSchema } },
  }, async (request) => {
    const { id } = ParamsSchema.parse(request.params);
    return service.get(id);
  });

  app.patch("/api/projects/:id/scenes/:sceneId", {
    schema: {
      params: SceneParamsSchema,
      body: ScenePatchSchema,
      response: { 200: ScenePlanSummarySchema, ...Errors },
    },
  }, async (request) => {
    const { id, sceneId } = SceneParamsSchema.parse(request.params);
    const patch = ScenePatchSchema.parse(request.body);
    return captured(request, id, () => service.patch(id, sceneId, patch));
  });

  app.post("/api/projects/:id/scenes/reorder", {
    schema: {
      params: ParamsSchema,
      body: ReorderScenesSchema,
      response: { 200: ScenePlanSummarySchema, ...Errors },
    },
  }, async (request) => {
    const { id } = ParamsSchema.parse(request.params);
    const { sceneIds } = ReorderScenesSchema.parse(request.body);
    return captured(request, id, () => service.reorder(id, sceneIds));
  });

  app.post("/api/projects/:id/scenes/:sceneId/split", {
    schema: {
      params: SceneParamsSchema,
      body: SplitSceneSchema,
      response: { 200: ScenePlanSummarySchema, ...Errors },
    },
  }, async (request) => {
    const { id, sceneId } = SceneParamsSchema.parse(request.params);
    const { sentenceIndex } = SplitSceneSchema.parse(request.body);
    return captured(request, id, () => service.split(id, sceneId, sentenceIndex));
  });

  app.post("/api/projects/:id/scenes/merge", {
    schema: {
      params: ParamsSchema,
      body: MergeScenesSchema,
      response: { 200: ScenePlanSummarySchema, ...Errors },
    },
  }, async (request) => {
    const { id } = ParamsSchema.parse(request.params);
    const { sceneIds } = MergeScenesSchema.parse(request.body);
    return captured(request, id, () => service.merge(id, sceneIds));
  });

  app.delete("/api/projects/:id/scenes/:sceneId", {
    schema: {
      params: SceneParamsSchema,
      response: { 200: ScenePlanSummarySchema, ...Errors },
    },
  }, async (request) => {
    const { id, sceneId } = SceneParamsSchema.parse(request.params);
    return captured(request, id, () => service.delete(id, sceneId));
  });
}

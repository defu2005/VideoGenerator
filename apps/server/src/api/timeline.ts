import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { EditPlanSchema, MotionTemplateIdSchema, TimelineSchema, clampGraphics, previewWindow, resolveEditSettings, validateEditPlan, type EditPlan, type Project, type Timeline } from "@vg/shared";
import { AppError } from "../lib/errors.js";
import type { TimelineService } from "../services/timelineService.js";

const ProjectParams = z.object({ id: z.string().uuid() }).strict();

export function registerTimelineRoutes(
  app: FastifyInstance,
  timelines: TimelineService,
  projectService: { getProject: (id: string) => Promise<Project | undefined> },
  planWithLlm?: (project: Project, timeline: Timeline) => Promise<unknown>,
): void {
  app.get("/api/projects/:id/timeline", async (request) => {
    const { id } = ProjectParams.parse(request.params);
    if (!await projectService.getProject(id)) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    return timelines.get(id);
  });

  app.patch("/api/projects/:id/timeline/edit", async (request) => {
    const { id } = ProjectParams.parse(request.params);
    if (!await projectService.getProject(id)) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    const current = timelines.get(id).timeline;
    if (!current) throw new AppError(409, "TIMELINE_MISSING", "Chưa có timeline.");
    const plan = EditPlanSchema.parse({ ...current.editPlan, ...request.body as object, source: "user" });
    return { timeline: timelines.saveEditPlan(id, plan) };
  });

  app.post("/api/projects/:id/timeline/edit", async (request) => {
    const { id } = ProjectParams.parse(request.params);
    const project = await projectService.getProject(id);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    const current = timelines.get(id).timeline;
    if (!current) throw new AppError(409, "TIMELINE_MISSING", "Chưa có timeline.");
    const scenes = current.scenes.map((scene, index) => ({
      sceneId: scene.sceneId,
      startSec: scene.startSec,
      durationSec: scene.durationSec,
      incomingTransition: index === 0 ? undefined : current.scenes[index - 1]?.transitionOut?.type,
    }));
    let raw: unknown = null;
    if (planWithLlm) {
      try { raw = await planWithLlm(project, current); } catch { raw = null; }
    }
    const edit = resolveEditSettings({
      aspect: project.settings.aspectRatio,
      project: project.settings.edit,
    });
    const validated = validateEditPlan(raw, scenes, edit.preset, {
      emphasisEverySec: edit.emphasisEverySec,
      ...(project.settings.edit?.subtitleStyle ? { subtitleStyle: project.settings.edit.subtitleStyle } : {}),
    });
    const emphasis = edit.sfx
      ? validated.emphasis
      : validated.emphasis.flatMap((item) => {
        const effects = item.effects.filter((effect) => effect !== "sfx");
        return effects.length > 0 ? [{ ...item, effects }] : [];
      });
    const plan: EditPlan = {
      ...validated,
      emphasis,
      source: raw ? "llm" : "fallback",
      subtitleStyle: project.settings.edit?.subtitleStyle ?? validated.subtitleStyle,
    };
    return { timeline: timelines.saveEditPlan(id, plan) };
  });

  app.patch("/api/projects/:id/timeline/graphics", async (request) => {
    const { id } = ProjectParams.parse(request.params);
    if (!await projectService.getProject(id)) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    const current = timelines.get(id).timeline;
    if (!current) throw new AppError(409, "TIMELINE_MISSING", "Chưa có timeline.");
    const body = z.object({
      id: z.string().min(1).optional(),
      remove: z.boolean().optional(),
      templateId: MotionTemplateIdSchema,
      sceneId: z.string().nullable().optional(),
      startSec: z.number().nonnegative(),
      durationSec: z.number().positive(),
      variables: z.record(z.string(), z.union([z.string(), z.number()])),
    }).parse(request.body);
    const existing = current.graphics ?? [];
    const nextGraphics = body.remove && body.id
      ? existing.filter((item) => item.id !== body.id)
      : existing.some((item) => item.id === body.id)
        ? existing.map((item) => item.id === body.id ? {
          ...item,
          templateId: body.templateId,
          sceneId: body.sceneId ?? item.sceneId,
          startSec: body.startSec,
          durationSec: body.durationSec,
          variables: body.variables,
          source: "user" as const,
        } : item)
        : [...existing, {
          id: body.id ?? crypto.randomUUID(),
          templateId: body.templateId,
          sceneId: body.sceneId ?? null,
          startSec: body.startSec,
          durationSec: body.durationSec,
          variables: body.variables,
          layer: "overlay" as const,
          source: "user" as const,
        }];
    const clamped = clampGraphics({
      graphics: nextGraphics,
      totalDurationSec: current.totalDurationSec,
      scenes: current.scenes.map((scene) => ({
        sceneId: scene.sceneId,
        startSec: scene.startSec,
        durationSec: scene.durationSec,
        label: scene.label,
        placeholder: scene.visuals.every((visual) => visual.kind === "PLACEHOLDER"),
      })),
    });
    const timeline = TimelineSchema.parse({
      ...current,
      graphics: clamped.graphics,
      revision: (current.revision ?? 0) + 1,
    });
    return { timeline: timelines.writeEdited(id, timeline, "manual", body.remove ? "Xóa đồ họa" : "Sửa đồ họa") };
  });

  app.post("/api/projects/:id/timeline/preview", async (request) => {
    const { id } = ProjectParams.parse(request.params);
    if (!await projectService.getProject(id)) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    const current = timelines.get(id).timeline;
    if (!current) throw new AppError(409, "TIMELINE_MISSING", "Chưa có timeline.");
    const body = z.object({ sceneId: z.string() }).parse(request.body);
    const scene = current.scenes.find((item) => item.sceneId === body.sceneId) ?? current.scenes[0];
    if (!scene) throw new AppError(409, "TIMELINE_MISSING", "Chưa có cảnh.");
    const window = previewWindow(scene.startSec, current.totalDurationSec, 10);
    const graphics = (current.graphics ?? []).filter((graphic) => {
      const end = graphic.startSec + graphic.durationSec;
      return graphic.startSec < window.endSec && end > window.startSec;
    }).map((graphic) => ({
      templateId: graphic.templateId,
      startSec: graphic.startSec,
      durationSec: graphic.durationSec,
    }));
    return {
      ...window,
      width: 640,
      height: Math.round(640 * current.target.height / current.target.width),
      sceneId: scene.sceneId,
      graphics,
    };
  });
}
